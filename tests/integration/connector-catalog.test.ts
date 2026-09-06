import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { handleApi } from '../../packages/core/src/http';
import { pool, authPool, transaction } from '../../packages/db';
import { createKey } from '../../packages/core/src/keys';
import { fixtureAccount } from '../fixtures/account';
import { config } from '../../packages/core/src/config';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
beforeAll(async () => {
  vi.stubEnv('COMPOSIO_API_KEY', '');
  account = await fixtureAccount('Catalog acceptance');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await pool.end();
  await authPool.end();
});

it('requires authentication and connections scope, and projects only public metadata', async () => {
  const url = `${config.origin}/v1/connector-catalog`;
  expect((await handleApi(new Request(url))).status).toBe(401);
  const limited = await transaction(account.p.organizationId, (tx) =>
    createKey(tx, account.p, { name: 'No connector scope', scopes: ['runs:read'] }),
  );
  expect(
    (await handleApi(new Request(url, { headers: { authorization: `Bearer ${limited.secret}` } }))).status,
  ).toBe(403);
  const response = await handleApi(new Request(url, { headers: { authorization: `Bearer ${account.key}` } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.source).toBe('snapshot');
  expect(body.data.length).toBeGreaterThan(1000);
  expect(body.data.every((entry: { connectable: boolean }) => !entry.connectable)).toBe(true);
  expect(Object.keys(body.data[0]).sort()).toEqual([
    'categories',
    'connectable',
    'description',
    'logo',
    'name',
    'slug',
    'tool_count',
  ]);
  expect(response.headers.get('cache-control')).toContain('private');
});
