import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../apps/web/lib/client';

afterEach(() => vi.unstubAllGlobals());

it('a successful concurrent action cannot erase another action’s uncertain recovery key', async () => {
  let finishFirst!: (response: Response) => void;
  let failSecond!: (error: Error) => void;
  const firstResponse = new Promise<Response>((resolve) => {
    finishFirst = resolve;
  });
  const secondResponse = new Promise<Response>((_resolve, reject) => {
    failSecond = reject;
  });
  const keys: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get('Idempotency-Key')!);
      if (keys.length === 1) return firstResponse;
      if (keys.length === 2) return secondResponse;
      return Promise.resolve(Response.json({ id: 'recovered' }));
    }),
  );

  const path = `/v1/projects?fixture=${crypto.randomUUID()}`;
  const body = { name: 'Concurrent fixture' };
  const first = api(path, 'POST', body);
  await vi.waitFor(() => expect(keys).toHaveLength(1));
  const secondError = api(path, 'POST', body).catch((error: unknown) => error);
  await vi.waitFor(() => expect(keys).toHaveLength(2));
  expect(keys[0]).not.toBe(keys[1]);

  // The second action may have committed. Its recovery record arrives while
  // the independent first action is still waiting for its successful response.
  failSecond(new Error('Response lost after commit'));
  await expect(secondError).resolves.toMatchObject({
    code: 'connection_interrupted',
    idempotencyKey: keys[1],
  });
  finishFirst(Response.json({ id: 'first' }));
  await first;

  expect(await api(path, 'POST', body)).toEqual({ id: 'recovered' });
  expect(keys[2]).toBe(keys[1]);
  await api(path, 'POST', body);
  expect(keys[3]).not.toBe(keys[1]);
});
