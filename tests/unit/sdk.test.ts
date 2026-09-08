import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Client,
  ApiError,
  DEFAULT_ORIGIN,
  TransportError,
  serviceOrigin,
  sseFrames,
} from '../../sdk/typescript/src/client';

describe('public TypeScript client', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('uses the hosted origin and environment key, with explicit overrides and clear missing-auth errors', async () => {
    vi.stubEnv('MACROFOLD_API_KEY', 'environment-fixture');
    const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      expect(String(url)).toBe(`${DEFAULT_ORIGIN}/v1/projects`);
      expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer environment-fixture');
      return Response.json({ data: [], next_cursor: null });
    });
    expect((await new Client({ fetch: fetcher }).projects.list()).data).toEqual([]);
    expect(new Client({ apiKey: 'explicit', baseURL: 'http://localhost:3210' }).baseURL).toBe(
      'http://localhost:3210',
    );
    expect(() => new Client({ apiKey: '' })).toThrow('Missing Macrofold API key');
    expect(() => new Client({ token: '' })).toThrow('Missing Macrofold API key');
    expect(() => new Client({ apiKey: 'one', token: 'two' })).toThrow('not both');
    vi.stubEnv('MACROFOLD_API_KEY', '');
    expect(() => new Client()).toThrow('MACROFOLD_API_KEY');
    const supplier = new Client({ token: async () => '', fetch: fetcher });
    await expect(supplier.projects.list()).rejects.toThrow('Missing Macrofold API key');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['', 'must-not-be-used'])(
    'uses only cookies in explicit session mode with environment key %j',
    async (key) => {
      vi.stubEnv('MACROFOLD_API_KEY', key);
      const fetcher = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
        expect(options?.credentials).toBe('same-origin');
        expect(options?.redirect).toBe('error');
        expect(new Headers(options?.headers).has('Authorization')).toBe(false);
        return Response.json({ data: [], next_cursor: null });
      });
      const client = new Client({
        baseURL: 'https://dashboard.example.test',
        sessionAuth: true,
        fetch: fetcher,
      });
      expect((await client.projects.list()).data).toEqual([]);
      expect(fetcher).toHaveBeenCalledOnce();
      for (const credentials of [{ apiKey: 'key' }, { token: 'token' }, { token: async () => 'token' }])
        expect(() => new Client({ sessionAuth: true, ...credentials })).toThrow('cannot be combined');
    },
  );
  it('preserves server authentication failures in session mode', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: { code: 'unauthorized', message: 'Sign in again' } }, { status: 401 }),
    );
    const client = new Client({ sessionAuth: true, fetch: fetcher });
    await expect(client.projects.list()).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('serializes resource options into the correct body, query, path, and precondition headers', async () => {
    const calls: { url: URL; init?: RequestInit }[] = [];
    const client = new Client({
      apiKey: 'explicit',
      fetch: async (url, init) => {
        calls.push({ url: new URL(String(url)), init });
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer explicit');
        return Response.json({ id: 'fixture', data: [], next_cursor: null });
      },
    });
    await client.projects.list({ archived: false, limit: 1, query: 'a + b' });
    expect(calls[0].url.searchParams.get('archived')).toBe('false');
    expect(calls[0].url.searchParams.get('query')).toBe('a + b');
    const content = new Uint8Array([0, 255, 4]);
    await client.workspaces.writeFile(
      'workspace / one',
      { path: 'notes/a + b', ifMatch: 'revision', content },
      { idempotencyKey: 'stable' },
    );
    expect(calls[1].url.pathname).toContain('workspace%20%2F%20one');
    expect(calls[1].url.searchParams.get('path')).toBe('notes/a + b');
    expect(calls[1].init?.body).toBe(content);
    const headers = new Headers(calls[1].init?.headers);
    expect(headers.get('If-Match')).toBe('revision');
    expect(headers.get('Idempotency-Key')).toBe('stable');
    expect(headers.get('Content-Type')).toBe('application/octet-stream');
    await client.runs.cancel('run');
    expect(calls[2].init?.body).toBe('{}');
  });
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
    const result = await client.projects.create({ name: 'Fixture' });
    expect(result.id).toBe('project');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
  it.each([
    ['empty', new Uint8Array()],
    ['binary', new Uint8Array([0, 255, 10, 128])],
    ['JSON text', new TextEncoder().encode('{"text":"Hello 🌍"}\n')],
  ] as const)('reads %s file bytes without interpreting them as JSON', async (_name, content) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/v1/workspaces/workspace/file');
      expect(url.searchParams.get('path')).toBe('notes/日本語 + #?.bin');
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture');
      return new Response(content, { headers: { 'Content-Type': 'application/octet-stream' } });
    });
    const client = new Client({ apiKey: 'fixture', fetch: fetcher });
    expect(await client.workspaces.readFile('workspace', { path: 'notes/日本語 + #?.bin' })).toEqual(content);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects an interrupted file body instead of returning partial content', async () => {
    let pulls = 0;
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (pulls++ === 0) controller.enqueue(new Uint8Array([1, 2]));
              else controller.error(new Error('Connection lost'));
            },
          }),
        ),
    );
    const client = new Client({ apiKey: 'fixture', fetch: fetcher });
    await expect(client.workspaces.readFile('workspace', { path: 'file.bin' })).rejects.toBeInstanceOf(
      TransportError,
    );
    expect(pulls).toBe(2);
    expect(fetcher).toHaveBeenCalledOnce();
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
    }).runs.stream('run'))
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
    await expect(client.projects.list()).rejects.toMatchObject({
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
    const error = await client.projects.create({ name: 'Fixture' }).catch((e) => e);
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
