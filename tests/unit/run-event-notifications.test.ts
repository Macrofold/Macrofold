import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ local: true, clients: [] as EventEmitter[] }));
vi.mock('../../packages/core/src/config', () => ({
  config: { databaseUrl: 'postgres://app@127.0.0.1:55432/fixture' },
  isLocal: () => fixture.local,
}));
vi.mock('pg', () => ({
  default: {
    Client: class extends EventEmitter {
      connect = vi.fn(async () => {});
      query = vi.fn(async () => {});
      end = vi.fn(async () => {});
      constructor() {
        super();
        fixture.clients.push(this);
      }
    },
  },
}));
import { listenRunEvents, runEventChannel } from '../../packages/core/src/run-event-notifications';
afterEach(() => {
  fixture.local = true;
  fixture.clients.length = 0;
  vi.useRealTimers();
});

it('uses one session listener, accepts only content-free ID hints, and closes without reconnecting', async () => {
  vi.useFakeTimers();
  const hint = vi.fn(),
    listener = listenRunEvents(hint)!;
  await vi.advanceTimersByTimeAsync(0);
  expect(listener.connected()).toBe(true);
  const client = fixture.clients[0];
  const ids = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
  for (const payload of [undefined, '{', JSON.stringify(['private text']), JSON.stringify([3, 4])])
    client.emit('notification', { channel: runEventChannel, payload });
  client.emit('notification', { channel: 'other', payload: JSON.stringify(ids) });
  expect(hint).not.toHaveBeenCalled();
  client.emit('notification', { channel: runEventChannel, payload: JSON.stringify(ids) });
  expect(hint).toHaveBeenCalledExactlyOnceWith(...ids);
  listener.close();
  client.emit('notification', { channel: runEventChannel, payload: JSON.stringify(ids) });
  client.emit('end');
  await vi.advanceTimersByTimeAsync(5000);
  expect(hint).toHaveBeenCalledTimes(1);
  expect(listener.connected()).toBe(false);
  expect(fixture.clients).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('falls back after a lost connection and retries once per bounded interval until disposed', async () => {
  vi.useFakeTimers();
  const listener = listenRunEvents(vi.fn())!;
  await vi.advanceTimersByTimeAsync(0);
  fixture.clients[0].emit('error', new Error('fixture socket failure'));
  fixture.clients[0].emit('end');
  expect(listener.connected()).toBe(false);
  await vi.advanceTimersByTimeAsync(4999);
  expect(fixture.clients).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fixture.clients).toHaveLength(2);
  expect(listener.connected()).toBe(true);
  fixture.clients[1].emit('end');
  listener.close();
  await vi.advanceTimersByTimeAsync(5000);
  expect(fixture.clients).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('leaves hosted/serverless processes on bounded shared repair without a session socket', () => {
  fixture.local = false;
  expect(listenRunEvents(vi.fn())).toBeUndefined();
  expect(fixture.clients).toHaveLength(0);
});
