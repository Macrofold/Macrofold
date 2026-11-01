import pg from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import { listenDatabaseNotifications } from '../../packages/db/notifications';
import { PollerWakeup } from '../../packages/core/src/poller-wakeup';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function connection() {
  const client = new pg.Client();
  const connect = vi.spyOn(client, 'connect').mockResolvedValue();
  const query = vi.spyOn(client, 'query').mockResolvedValue();
  const end = vi.spyOn(client, 'end').mockResolvedValue();
  return { client, connect, query, end };
}

it('retains a wake received during a scan and coalesces multiple hints', async () => {
  const wakeup = new PollerWakeup();
  const scanned = wakeup.generation;
  wakeup.notify();
  wakeup.notify();
  await wakeup.wait(scanned, new AbortController().signal);
  const controller = new AbortController();
  let resolved = false;
  const next = wakeup.wait(wakeup.generation, controller.signal).then(() => {
    resolved = true;
  });
  await Promise.resolve();
  expect(resolved).toBe(false);
  wakeup.notify();
  await next;
  expect(resolved).toBe(true);
});

it('cancels a losing wait and accepts an already-aborted signal', async () => {
  const wakeup = new PollerWakeup();
  const controller = new AbortController();
  const cancelled = wakeup.wait(wakeup.generation, controller.signal);
  controller.abort();
  await cancelled;
  await wakeup.wait(wakeup.generation, controller.signal);
  const active = wakeup.wait(wakeup.generation, new AbortController().signal);
  wakeup.notify();
  await active;
});

it('listens on one owned connection, filters channels and stops notifications after close', async () => {
  const fixture = connection(),
    hint = vi.fn(),
    ready = vi.fn();
  const listener = listenDatabaseNotifications(
    {
      connectionString: 'fixture-not-used',
      channel: 'test_wakeup',
      notification: hint,
      connected: ready,
    },
    () => fixture.client,
  );
  try {
    await vi.waitFor(() => expect(listener.connected()).toBe(true));
    expect(fixture.connect).toHaveBeenCalledOnce();
    expect(fixture.query).toHaveBeenCalledExactlyOnceWith('LISTEN test_wakeup');
    expect(ready).toHaveBeenCalledOnce();
    fixture.client.emit('notification', { channel: 'other', payload: 'private' });
    fixture.client.emit('notification', { channel: 'test_wakeup', payload: '' });
    expect(hint).toHaveBeenCalledExactlyOnceWith('');
  } finally {
    await listener.close();
  }
  fixture.client.emit('notification', { channel: 'test_wakeup', payload: '' });
  expect(hint).toHaveBeenCalledOnce();
  expect(listener.connected()).toBe(false);
  expect(fixture.end).toHaveBeenCalledOnce();
  await listener.close();
  expect(fixture.end).toHaveBeenCalledOnce();
});

it('reestablishes LISTEN after disconnection and cancels a pending reconnect on close', async () => {
  vi.useFakeTimers();
  const first = connection(),
    second = connection(),
    ready = vi.fn(),
    lost = vi.fn();
  const clients = vi.fn().mockReturnValueOnce(first.client).mockReturnValueOnce(second.client);
  const listener = listenDatabaseNotifications(
    {
      connectionString: 'fixture-not-used',
      channel: 'test_wakeup',
      notification: vi.fn(),
      connected: ready,
      unavailable: lost,
      retryMs: 1000,
    },
    clients,
  );
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(listener.connected()).toBe(true);
    const failure = new Error('private database URL');
    first.client.emit('error', failure);
    first.client.emit('end');
    await vi.advanceTimersByTimeAsync(999);
    expect(listener.connected()).toBe(false);
    expect(clients).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(listener.connected()).toBe(true);
    expect(second.query).toHaveBeenCalledExactlyOnceWith('LISTEN test_wakeup');
    expect(ready).toHaveBeenCalledTimes(2);
    expect(lost).toHaveBeenCalledOnce();
    expect(lost).toHaveBeenCalledWith(failure);
    second.client.emit('end');
    await listener.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(clients).toHaveBeenCalledTimes(2);
  } finally {
    await listener.close();
  }
});

it('contains failed LISTEN setup and closes a connection that finishes connecting after shutdown', async () => {
  const first = connection();
  const failure = new Error('private connection details');
  first.query.mockRejectedValueOnce(failure);
  const lost = vi.fn();
  const unavailable = listenDatabaseNotifications(
    {
      connectionString: 'fixture-not-used',
      channel: 'test_wakeup',
      notification: vi.fn(),
      unavailable: lost,
    },
    () => first.client,
  );
  try {
    await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce());
    expect(lost).toHaveBeenCalledWith(failure);
    expect(unavailable.connected()).toBe(false);
    expect(first.end).toHaveBeenCalledOnce();
  } finally {
    await unavailable.close();
  }
  const second = connection();
  let finish!: () => void;
  second.connect.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const listener = listenDatabaseNotifications(
    {
      connectionString: 'fixture-not-used',
      channel: 'test_wakeup',
      notification: vi.fn(),
    },
    () => second.client,
  );
  const closed = listener.close();
  finish();
  await closed;
  expect(second.query).not.toHaveBeenCalled();
  expect(second.end).toHaveBeenCalledOnce();
  expect(listener.connected()).toBe(false);
});

it('rejects non-static channel identifiers before constructing a connection', () => {
  const create = vi.fn();
  expect(() =>
    listenDatabaseNotifications(
      {
        connectionString: 'fixture-not-used',
        channel: 'bad; SELECT 1',
        notification: vi.fn(),
      },
      create,
    ),
  ).toThrow('Invalid notification channel');
  expect(create).not.toHaveBeenCalled();
});

it('keeps a malformed optional connection from stopping the poller and bounds graceful shutdown', async () => {
  vi.useFakeTimers();
  const fixture = connection(),
    lost = vi.fn();
  const failure = new Error('private URL');
  const factory = vi
    .fn()
    .mockImplementationOnce(() => {
      throw failure;
    })
    .mockReturnValueOnce(fixture.client);
  const listener = listenDatabaseNotifications(
    {
      connectionString: 'fixture-not-used',
      channel: 'test_wakeup',
      notification: vi.fn(),
      unavailable: lost,
      retryMs: 1000,
    },
    factory,
  );
  try {
    expect(listener.connected()).toBe(false);
    expect(lost).toHaveBeenCalledOnce();
    expect(lost).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener.connected()).toBe(true);
    fixture.end.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          fixture.client.connection.stream.once('close', () => resolve());
        }),
    );
    const destroy = vi.spyOn(fixture.client.connection.stream, 'destroy');
    const closed = listener.close();
    await vi.advanceTimersByTimeAsync(999);
    expect(destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await closed;
    expect(destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await listener.close();
  }
});
