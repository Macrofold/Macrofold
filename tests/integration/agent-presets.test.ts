import { afterAll, expect, it } from 'vitest';
import { Macrofold } from '../../sdk/typescript/src/index';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { pool, authPool } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';

afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('returns the persisted preset version across create, get, list, and update without exposing another tenant', async () => {
  const account = await fixtureAccount('Preset version');
  const other = await fixtureAccount('Other preset owner');
  const client = (key: string) =>
    new Macrofold({
      apiKey: key,
      baseURL: config.origin,
      fetch: async (url, init) => handleApi(new Request(url, init)),
    });
  const sdk = client(account.key);
  const preset = await sdk.agents.create({
    name: 'Research',
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
  });
  expect(preset.version).toBe(1);
  expect((await sdk.agents.get(preset.id)).version).toBe(1);
  expect((await sdk.agents.list()).data).toContainEqual(preset);
  const updated = await sdk.agents.update(preset.id, { instructions: 'Write a concise report.' });
  expect(updated).toMatchObject({
    version: 2,
    instructions: 'Write a concise report.',
    harness: 'codex',
    billing_mode: 'managed',
  });
  expect((await sdk.agents.get(preset.id)).version).toBe(2);
  await expect(client(other.key).agents.get(preset.id)).rejects.toMatchObject({ status: 404 });
  expect((await client(other.key).agents.list()).data).toEqual([]);
});
