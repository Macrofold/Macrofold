import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { handleApi } from '../../packages/core/src/http';
import { id, unseal } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import * as network from '../../packages/providers/src/network';
import { searchProviders } from '../../packages/contracts/search';

let a: Awaited<ReturnType<typeof fixtureAccount>>, b: Awaited<ReturnType<typeof fixtureAccount>>;
beforeAll(async () => {
  a = await fixtureAccount('Search owner');
  b = await fixtureAccount('Other search account');
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
async function request(method: string, path: string, body?: unknown, key = a.key) {
  return handleApi(
    new Request(config.origin + path, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': id(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
it.each(Object.keys(searchProviders))(
  'creates, tests and grants a %s BYOK connection without an outbound call or secret disclosure',
  async (provider) => {
    const outbound = vi.spyOn(network, 'safeFetch').mockRejectedValue(new Error('Outbound denied'));
    const response = await request('POST', '/v1/connections', {
      name: 'Search fixture',
      kind: 'search',
      provider,
      auth_method: 'api_key',
      secret: 'synthetic-key',
    });
    expect(response.status).toBe(201);
    const value = await response.json();
    expect(value).toMatchObject({ provider, kind: 'search', auth_method: 'api_key' });
    expect(JSON.stringify(value)).not.toContain('synthetic-key');
    expect(value.secret_ciphertext).toBeUndefined();
    const stored = await transaction(a.p.organizationId, (tx) => resources.get(tx, 'connections', value.id));
    expect(unseal(stored.secret_ciphertext as string)).toBe('synthetic-key');
    const probe = await request('POST', `/v1/connections/${value.id}/test`, {});
    expect(probe.status).toBe(200);
    expect(await probe.json()).toMatchObject({ status: 'unknown' });
    const tools = await request('GET', `/v1/connections/${value.id}/tools`);
    expect(await tools.json()).toMatchObject({
      data: [expect.objectContaining({ name: 'web_search', granted: false })],
    });
    const grant = await request('PUT', `/v1/connections/${value.id}/grants`, {
      version: 1,
      subject_type: 'user',
      subject_id: a.p.userId,
      tools: ['web_search'],
    });
    expect(grant.status).toBe(200);
    const granted = await request('GET', `/v1/connections/${value.id}/tools`);
    expect(await granted.json()).toMatchObject({
      data: [expect.objectContaining({ name: 'web_search', granted: true })],
    });
    expect((await request('GET', `/v1/connections/${value.id}`, undefined, b.key)).status).toBe(404);
    const changed = await request('PATCH', `/v1/connections/${value.id}`, {
      provider: provider === 'exa' ? 'brave' : 'exa',
    });
    expect(changed.status).toBe(409);
    expect(outbound).not.toHaveBeenCalled();
  },
);
it.each(['exa', 'tavily', 'parallel', 'firecrawl'])(
  'rejects managed %s and missing keys before creating resources',
  async (provider) => {
    for (const input of [
      { auth_method: 'none' },
      { auth_method: 'api_key' },
      { auth_method: 'api_key', secret: ' ' },
    ]) {
      const result = await request('POST', '/v1/connections', {
        name: 'Rejected search',
        kind: 'search',
        provider,
        ...input,
      });
      expect(result.status).toBe(400);
    }
    const rows = await transaction(a.p.organizationId, (tx) =>
      tx.query("SELECT id FROM connections WHERE data->>'name'='Rejected search'"),
    );
    expect(rows.rows).toEqual([]);
  },
);
