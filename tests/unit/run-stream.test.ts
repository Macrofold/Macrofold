import { afterEach, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../packages/db', () => ({
  transaction: async (_org: string, work: (tx: unknown) => Promise<unknown>) => work({ query }),
}));
import { streamEvents } from '../../packages/core/src/events';

afterEach(() => {
  vi.useRealTimers();
  query.mockReset();
});

it('bounds prefetch for a stalled reader and resumes ordered historical output', async () => {
  vi.useFakeTimers();
  let pages = 0;
  query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.startsWith('SELECT status')) return { rows: [{ status: 'succeeded', event_sequence: '300' }] };
    pages++;
    const after = Number(args[1]);
    return {
      rows: Array.from({ length: Math.min(100, 300 - after) }, (_, i) => ({
        id: `event-${after + i + 1}`,
        run_id: 'run',
        sequence: after + i + 1,
        type: 'output.delta',
        occurred_at: new Date(0),
        ingested_at: new Date(0),
        data: {},
      })),
    };
  });
  const abort = new AbortController();
  const stream = await streamEvents('org', 'run', '0', abort.signal);
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(pages).toBe(1);
    const reader = stream.getReader(),
      decoder = new TextDecoder(),
      sequences: number[] = [];
    while (true) {
      const read = reader.read();
      await vi.advanceTimersByTimeAsync(150);
      const result = await read;
      if (result.done) break;
      sequences.push(Number(decoder.decode(result.value).match(/^id: (\d+)/)?.[1]));
    }
    expect(sequences).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
    expect(pages).toBe(3);
  } finally {
    abort.abort();
  }
});

it.each(['abort', 'timeout', 'cancel'] as const)('releases an idle stream on %s', async (reason) => {
  vi.useFakeTimers();
  query.mockResolvedValue({ rows: [] });
  const abort = new AbortController();
  const stream = await streamEvents('org', 'run', '0', abort.signal);
  await vi.advanceTimersByTimeAsync(1);
  if (reason === 'abort') abort.abort();
  if (reason === 'cancel') await stream.cancel();
  if (reason === 'timeout') await vi.advanceTimersByTimeAsync(55000);
  const count = query.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(query).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
});
