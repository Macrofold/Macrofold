import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaginationCursor } from '../../packages/contracts/pagination';
import { boundedBody } from '../../packages/core/src/body';
import { Client, sseFrames } from '../../sdk/typescript/src/client';
import { R2Store } from '../../packages/providers/src/storage';
import type { S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { readInferenceStream } from '../../packages/providers/src/inference-stream';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('finite input and pagination', () => {
  it('rejects invalid retry settings and bounds an endlessly reconnecting empty stream', async () => {
    for (const retries of [Infinity, NaN, -1, 9, 1.5])
      expect(() => new Client({ apiKey: 'fixture', retries })).toThrow(RangeError);
    vi.useFakeTimers();
    let connections = 0;
    const client = new Client({
      apiKey: 'fixture',
      fetch: async (input) => {
        if (String(input).includes('/stream')) {
          connections++;
          return new Response('');
        }
        return Response.json({ status: 'running' });
      },
    });
    const outcome = (async () => {
      for await (const _event of client.stream('fixture')) {
      }
    })().catch((error) => error);
    await vi.advanceTimersByTimeAsync(600_000);
    expect((await outcome).message).toContain('Stream attachment limit');
    expect(connections).toBe(2048);
  });
  it('rejects repeated cursors and excessive distinct pages without truncating results', () => {
    const repeated = new PaginationCursor();
    expect(repeated.next('a')).toBe('a');
    expect(() => repeated.next('a')).toThrow('Pagination');
    const pages = new PaginationCursor(2);
    pages.next('a');
    expect(() => pages.next('b')).toThrow('page limit');
    expect(new PaginationCursor(1).next(null)).toBeUndefined();
    for (const value of [Infinity, NaN, 0, -1, 1.5])
      expect(() => new PaginationCursor(value)).toThrow(RangeError);
  });
  it('cancels a stalled body at its deadline and releases the reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const outcome = boundedBody(stream, 100, 20).catch((error) => error);
    await vi.advanceTimersByTimeAsync(20);
    expect(await outcome).toMatchObject({ code: 'body_read_timeout', status: 408 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
  it('does not wait forever for source cancellation after a body or SSE deadline', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const outcome = boundedBody(body, 100, 20).catch((error) => error);
    await vi.advanceTimersByTimeAsync(20);
    expect(await outcome).toMatchObject({ code: 'body_read_timeout' });
    expect(body.locked).toBe(false);
    const events = new ReadableStream<Uint8Array>({ cancel });
    const frames = sseFrames(new Response(events), undefined, 20);
    const pending = frames.next().catch((error) => error);
    await vi.advanceTimersByTimeAsync(20);
    expect((await pending).message).toContain('deadline exceeded');
    expect(events.locked).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(2);
  });
  it('rejects endless empty chunks and oversize bodies, accepting legitimate empty content', async () => {
    const empty = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array());
      },
    });
    await expect(boundedBody(empty, 100)).rejects.toMatchObject({ code: 'body_not_progressing' });
    await expect(boundedBody(new Response('123').body, 2)).rejects.toMatchObject({ status: 413 });
    expect(await boundedBody(new Response('').body, 0)).toEqual(Buffer.alloc(0));
  });
  it('interrupts stalled object bodies after headers without treating partial bytes as success', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const body = new Readable({ read() {} });
    const send = vi.fn().mockResolvedValue({ Body: body, ContentLength: 10 });
    const store = new R2Store({ send } as unknown as S3Client, 'fixture');
    const pending = expect(store.readUpload('staging/fixture', 10)).rejects.toThrow('timed out');
    // Expire after headers, independently of first-use SDK loading speed.
    await vi.waitFor(() => expect(body.listenerCount('readable')).toBeGreaterThan(0));
    deadline.abort();
    await pending;
    expect(body.destroyed).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][1].abortSignal.aborted).toBe(true);
  });
  it('rejects non-progressing model streams without waiting for a run timeout', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array());
      },
    });
    const result = await readInferenceStream(
      new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
      true,
    );
    expect(result.incomplete).toBe('provider_stream_not_progressing');
    expect(body.locked).toBe(false);
  });
});
