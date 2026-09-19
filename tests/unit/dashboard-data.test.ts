import { afterEach, it, expect, vi } from 'vitest';
import { request, dataKey } from '../../apps/web/lib/dashboard-data';
import { Client, requestPath } from '../../sdk/typescript/src/client';
afterEach(() => vi.unstubAllGlobals());
it('calls browser fetch with the global receiver when reading a document through the SDK', async () => {
  vi.stubGlobal('fetch', function (this: unknown) {
    expect(this).toBe(globalThis);
    return Promise.resolve(new Response('Persisted contents', { headers: { ETag: '"revision"' } }));
  });
  const client = new Client({ baseURL: 'http://localhost', sessionAuth: true, retries: 0 });
  const response = await client.raw('readFile', {
    params: { path: { worktree_id: 'fixture' }, query: { path: 'notes.md' } },
  });
  expect(await response.text()).toBe('Persisted contents');
  expect(response.headers.get('etag')).toBe('"revision"');
});
it('reuses an aborted mutation identity when the same action is explicitly retried', async () => {
  const calls: RequestInit[] = [];
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init: RequestInit) => {
      calls.push(init);
      if (calls.length === 1) {
        controller.abort();
        throw controller.signal.reason;
      }
      return Response.json({ id: 'confirmed' });
    }),
  );
  const body = { name: `Aborted ${crypto.randomUUID()}` };
  await expect(request('createWorkspace', { body, signal: controller.signal })).rejects.toThrow();
  await request('createWorkspace', { body });
  expect(new Headers(calls[0].headers).get('Idempotency-Key')).toBe(
    new Headers(calls[1].headers).get('Idempotency-Key'),
  );
});
it('builds URL/cache keys from the same contract, including Unicode paths and escaped query values', () => {
  const query = {
    operation: 'listFiles' as const,
    params: { path: { worktree_id: 'id/escaped' }, query: { path: '日本語 + #?.md', recursive: false } },
  };
  const key = dataKey(query)[0];
  expect(key).toBe(requestPath(query.operation, query.params));
  expect(new URL(key, 'http://localhost').searchParams.get('path')).toBe('日本語 + #?.md');
  expect(key).toContain('id%2Fescaped');
});
it('retains the mutation identity after a lost response and passes cancellation through GET requests', async () => {
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init: RequestInit) => {
      calls.push(init);
      if (calls.length === 1) throw new Error('connection lost');
      return Response.json({ id: 'confirmed' });
    }),
  );
  const options = { body: { name: `Recovery ${crypto.randomUUID()}` } };
  await expect(request('createWorkspace', options)).rejects.toMatchObject({ code: 'connection_interrupted' });
  await request('createWorkspace', options);
  expect(new Headers(calls[0].headers).get('Idempotency-Key')).toBe(
    new Headers(calls[1].headers).get('Idempotency-Key'),
  );
  const controller = new AbortController();
  await request('getWorkspace', { params: { path: { workspace_id: 'id' } }, signal: controller.signal });
  expect(calls[2].signal).toBe(controller.signal);
});
