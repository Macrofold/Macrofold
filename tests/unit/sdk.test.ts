import { describe, it, expect, vi } from 'vitest';
import { Client, TransportError, serviceOrigin, sseFrames } from '../../sdk/typescript/src/client';

describe('public TypeScript client', () => {
  it('retains mutation identity across lost responses and does not forward credentials on redirects', async () => {
    const keys: string[] = [];
    let attempt = 0;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      keys.push(new Headers(options?.headers).get('idempotency-key')!);
      expect(options?.redirect).toBe('error');
      if (attempt++ === 0) throw new Error('lost response');
      return Response.json({ id: 'project', name: 'Fixture' });
    });
    const client = new Client({ baseURL: 'https://fixture.invalid', token: 'fixture-key', fetch: fetcher });
    const result = await client.request('createProject', { body: { name: 'Fixture' } });
    expect(result.id).toBe('project');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
  it('reconnects a split SSE frame from its durable cursor, deduplicates replay and stops on the terminal event', async () => {
    let connection = 0;
    const cursors: string[] = [];
    const event = (sequence: string, type: string) =>
      `id: ${sequence}\nevent: ${type}\ndata: ${JSON.stringify({ sequence, type, data: { text: 'Hello 🌏' } })}\n\n`;
    const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      if (String(url).includes('/stream')) {
        cursors.push(new Headers(options?.headers).get('last-event-id')!);
        return new Response(
          connection++ === 0
            ? event('1', 'output.delta')
            : event('1', 'output.delta') + event('2', 'run.succeeded'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }
      return Response.json({ id: 'run', status: 'running' });
    });
    const values = [];
    for await (const value of new Client({
      baseURL: 'https://fixture.invalid',
      token: 'fixture',
      fetch: fetcher,
    }).stream('run'))
      values.push(value);
    expect(values.map((v) => v.sequence)).toEqual(['1', '2']);
    expect(cursors).toEqual(['0', '1']);
  });
  it('parses UTF-8 split across chunks and multiline SSE data', async () => {
    const bytes = new TextEncoder().encode('id: 7\r\ndata: Hello 🌏\r\ndata: Again\r\n\r\n');
    let index = 0;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          if (index === bytes.length) controller.close();
          else controller.enqueue(bytes.slice(index, index++ + 1));
        },
      }),
    );
    const frames = [];
    for await (const frame of sseFrames(response)) frames.push(frame);
    expect(frames).toEqual([{ id: '7', data: 'Hello 🌏\nAgain' }]);
  });
  it('surfaces structured errors and refuses unsafe service origins', async () => {
    const client = new Client({
      baseURL: 'https://fixture.invalid',
      token: 'fixture',
      fetch: async () =>
        Response.json(
          { error: { code: 'insufficient_credit', message: 'Add credits', request_id: 'request' } },
          { status: 402 },
        ),
    });
    await expect(client.request('listProjects')).rejects.toMatchObject({
      status: 402,
      code: 'insufficient_credit',
      requestId: 'request',
    });
    expect(() => serviceOrigin('http://public.example')).toThrow();
    expect(() => serviceOrigin('https://user:secret@example.com')).toThrow();
    expect(() => serviceOrigin('https://example.com/untrusted')).toThrow();
    expect(serviceOrigin('http://localhost:3210')).toBe('http://localhost:3210');
  });
  it('preserves the recovery identity when success headers arrive but the mutation body is lost', async () => {
    let identity: string | null = null;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      identity = new Headers(options?.headers).get('Idempotency-Key');
      return new Response('{"id":', { status: 201 });
    });
    const client = new Client({ baseURL: 'https://fixture.invalid', token: 'fixture', fetch: fetcher });
    const error = await client.request('createProject', { body: { name: 'Fixture' } }).catch((e) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error.idempotencyKey).toBe(identity);
    expect(identity).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a malformed cursor before making a request', async () => {
    const fetcher = vi.fn();
    const client = new Client({ baseURL: 'https://fixture.invalid', token: 'fixture', fetch: fetcher });
    await expect(client.stream('run', { after: 'invalid' }).next()).rejects.toThrow('numeric event cursor');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels a stalled SSE body when the caller detaches', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const controller = new AbortController();
    const pending = sseFrames(response, controller.signal).next();
    controller.abort(new Error('Detached'));
    await expect(pending).rejects.toThrow('Detached');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
