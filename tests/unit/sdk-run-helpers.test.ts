import { describe, it, expect, vi, afterEach } from 'vitest';
import { Macrofold, RunFailedError, WaitTimeoutError, type Schema } from '../../sdk/typescript/src/index';

const id = '00000000-0000-4000-8000-000000000001';
const result = (persistence = 'verified', outcome = 'success'): Schema['RunResult'] => ({
  run_id: id,
  final: true,
  execution_outcome: outcome,
  persistence_status: persistence,
  output_text: 'Hello 🌍',
  checkpoint_id: id,
});
const frame = (sequence: string, type: string, text: unknown) =>
  `data: ${JSON.stringify({ sequence, type, data: { text } })}\n\n`;
const collect = async <T>(source: AsyncIterable<T>) => {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
};

describe('run convenience helpers', () => {
  afterEach(() => vi.useRealTimers());
  it('streams only new text through reconnects and keeps structured events available', async () => {
    let streams = 0,
      gets = 0;
    const cursors: string[] = [];
    const client = new Macrofold({
      apiKey: 'fixture',
      organization: id,
      fetch: async (input, init) => {
        expect(new Headers(init?.headers).get('X-Organization-Id')).toBe(id);
        expect(init?.method).toBe('GET');
        const url = new URL(String(input));
        if (url.pathname.endsWith('/stream')) {
          cursors.push(new Headers(init?.headers).get('Last-Event-ID')!);
          return new Response(
            streams++ === 0
              ? frame('1', 'output.delta', 'Hello ') + frame('2', 'tool.completed', 'SECRET TOOL')
              : frame('1', 'output.delta', 'Hello ') +
                  frame('2', 'tool.completed', 'SECRET TOOL') +
                  frame('3', 'output.delta', '🌍') +
                  frame('4', 'reasoning.delta', 'REASONING') +
                  frame('5', 'output.delta', {}) +
                  frame('6', 'run.succeeded', 'FULL RESPONSE'),
          );
        }
        if (url.pathname.endsWith('/result')) return Response.json(result());
        return Response.json({ id, status: gets++ === 0 ? 'running' : 'succeeded' });
      },
    });
    expect(await collect(client.runs.streamText(id))).toEqual(['Hello ', '🌍']);
    expect(cursors).toEqual(['0', '2']);
    expect((await collect(client.runs.events(id, { after: '3' }))).map((event) => event.type)).toEqual([
      'reasoning.delta',
      'output.delta',
      'run.succeeded',
    ]);
  });
  it.each(['failed', 'cancelled', 'timed_out', 'succeeded'])(
    'raises a typed error for %s / failed persistence, even after the terminal cursor',
    async (status) => {
      const client = new Macrofold({
        apiKey: 'fixture',
        fetch: async (input) => {
          const url = String(input);
          if (url.includes('/stream')) return new Response('');
          if (url.includes('/events')) return Response.json({ data: [], next_cursor: null });
          if (url.endsWith('/result'))
            return Response.json(
              result(
                status === 'succeeded' ? 'failed' : 'verified',
                status === 'succeeded' ? 'success' : status,
              ),
            );
          return Response.json({ id, status, failure_code: 'fixture_failure' });
        },
      });
      const failure = await collect(client.runs.streamText(id, { after: '99' })).catch((error) => error);
      expect(failure).toBeInstanceOf(RunFailedError);
      expect(failure).toMatchObject({ runId: id, status, failureCode: 'fixture_failure' });
      expect(failure.message).toContain(id);
    },
  );
  it('waits through execution and pending persistence without opening a stream or dropping result metadata', async () => {
    let calls = 0,
      results = 0;
    const client = new Macrofold({
      apiKey: 'fixture',
      fetch: async (input) => {
        expect(String(input)).not.toContain('/stream');
        if (String(input).endsWith('/result'))
          return Response.json(results++ ? result() : { ...result('pending'), final: false });
        return Response.json({ id, status: calls++ ? 'succeeded' : 'persisting' });
      },
    });
    expect(await client.runs.wait(id, { pollIntervalMs: 1 })).toEqual(result());
    expect(calls).toBe(3);
    expect(results).toBe(2);
  });
  it('detaches on iterator closure without a completion lookup or cancellation', async () => {
    let closed = false;
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(frame('1', 'output.delta', 'Hi')));
            },
            cancel() {
              closed = true;
            },
          }),
        ),
    );
    const stream = new Macrofold({ apiKey: 'fixture', fetch: fetcher }).runs.streamText(id);
    expect((await stream.next()).value).toBe('Hi');
    await stream.return(undefined);
    expect(closed).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('bounds in-flight requests and retry delays; timeout and abort never cancel execution', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let aborted = false;
    const client = new Macrofold({
      apiKey: 'fixture',
      fetch: async (input, init) => {
        calls.push(String(input));
        return new Promise((_resolve, reject) =>
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(init.signal?.reason);
            },
            { once: true },
          ),
        );
      },
    });
    const waiting = client.runs.wait(id, { timeoutMs: 100 });
    const assertion = expect(waiting).rejects.toMatchObject({ name: 'WaitTimeoutError', runId: id });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(aborted).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('cancel');
    const retryClient = new Macrofold({
      apiKey: 'fixture',
      fetch: async () => new Response('', { status: 503, headers: { 'Retry-After': '60' } }),
    });
    const retry = expect(retryClient.runs.wait(id, { timeoutMs: 100 })).rejects.toBeInstanceOf(
      WaitTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(100);
    await retry;
    const controller = new AbortController();
    controller.abort(new Error('Detached'));
    await expect(client.runs.wait(id, { signal: controller.signal })).rejects.toThrow('Detached');
    await expect(client.runs.wait(id, { timeoutMs: 0 })).rejects.toBeInstanceOf(WaitTimeoutError);
    await expect(client.runs.wait(id, { pollIntervalMs: 0 })).rejects.toThrow('pollIntervalMs');
  });
  it('surfaces revoked authorization without converting it to run success', async () => {
    const client = new Macrofold({
      apiKey: 'fixture',
      fetch: async () => Response.json({ error: { code: 'forbidden', message: 'Revoked' } }, { status: 403 }),
    });
    await expect(client.runs.wait(id)).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    await expect(collect(client.runs.streamText(id))).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });
});
