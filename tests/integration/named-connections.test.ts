import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Macrofold, type Schema } from '../../sdk/typescript/src/index';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import * as catalog from '../../packages/core/src/catalog';
import * as connections from '../../packages/core/src/connections';
import * as resources from '../../packages/core/src/resources';
import { validateConfiguration } from '../../packages/core/src/runs';

let owner: Awaited<ReturnType<typeof fixtureAccount>>, other: Awaited<ReturnType<typeof fixtureAccount>>;
const client = (key: string) =>
  new Macrofold({
    apiKey: key,
    baseURL: config.origin,
    fetch: (url, init) => handleApi(new Request(url, init)),
  });
beforeAll(async () => {
  owner = await fixtureAccount('Named accounts');
  other = await fixtureAccount('Other account owner');
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await pool.end();
  await authPool.end();
});

it('allows owned key selection only for the local simulation model without relaxing native provider checks', async () => {
  const sdk = client(owner.key);
  const key = await sdk.connections.create({
    name: 'Simulation selection',
    kind: 'model',
    provider: 'openai',
    auth_method: 'api_key',
    secret: 'unused-fixture-key',
  });
  const input = {
    name: 'Selected simulation key',
    harness: 'codex' as const,
    model: 'fixture-model',
    billing_mode: 'byok' as const,
    provider_connection_id: key.id,
  };
  expect((await sdk.agents.create(input)).provider_connection_id).toBe(key.id);
  const fixtureModels = await catalog.models();
  const models = vi.spyOn(catalog, 'models').mockResolvedValue(fixtureModels);
  const execution = config.execution;
  try {
    config.execution = 'docker';
    await expect(
      transaction(owner.p.organizationId, (tx) => validateConfiguration(tx, owner.p, input, 'preset')),
    ).rejects.toMatchObject({ code: 'credentials_incompatible' });
  } finally {
    config.execution = execution;
  }
  models.mockResolvedValue([{ ...fixtureModels[0], provider: 'anthropic', simulated: false }]);
  await expect(sdk.agents.create(input)).rejects.toMatchObject({ code: 'credentials_incompatible' });
  models.mockResolvedValue(fixtureModels);
  await transaction(owner.p.organizationId, (tx) =>
    resources.update(tx, 'connections', key.id, { owner_subject_id: other.p.userId }),
  );
  await expect(sdk.agents.create(input)).rejects.toMatchObject({ code: 'forbidden' });
});

it('creates independent named Claude configurations, preserves IDs on edits and keeps authentication gated', async () => {
  const sdk = client(owner.key);
  const rows: Schema['Connection'][] = [];
  for (const name of ['Claude Research', 'Claude Coding', 'Claude Personal'])
    rows.push(
      await sdk.connections.create({
        name,
        kind: 'claude_subscription',
        provider: 'anthropic',
        auth_method: 'claude_code',
      }),
    );
  expect(new Set(rows.map((row) => row.id)).size).toBe(3);
  for (const row of rows)
    expect(row).toMatchObject({
      status: 'pending',
      availability: 'pending_approval',
      api_fallback: { enabled: false },
    });
  expect(await sdk.connections.update(rows[0].id, { name: 'Research account' })).toMatchObject({
    id: rows[0].id,
    name: 'Research account',
    status: 'pending',
  });
  expect((await sdk.connections.get(rows[1].id)).name).toBe('Claude Coding');
  await expect(client(other.key).connections.get(rows[0].id)).rejects.toMatchObject({ status: 404 });
  await expect(
    transaction(owner.p.organizationId, (tx) =>
      connections.saveConnection(tx, { ...owner.p, userId: other.p.userId }, { name: 'Stolen' }, rows[0].id),
    ),
  ).rejects.toMatchObject({ code: 'forbidden' });
  const outbound = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No provider calls allowed'));
  await expect(sdk.connections.authorize(rows[0].id, {})).rejects.toMatchObject({
    code: 'claude_subscription_unavailable',
  });
  expect((await sdk.connections.test(rows[0].id, {})).status).toBe('unknown');
  expect(outbound).not.toHaveBeenCalled();
  await expect(
    sdk.connections.create({
      name: 'Unsafe token upload',
      kind: 'claude_subscription',
      provider: 'anthropic',
      auth_method: 'claude_code',
      secret: 'fixture-oauth-token',
    }),
  ).rejects.toMatchObject({ code: 'invalid_subscription_connection' });
  await sdk.connections.delete(rows[0].id);
  await expect(sdk.connections.get(rows[0].id)).rejects.toMatchObject({ status: 404 });
  expect((await sdk.connections.get(rows[1].id)).status).toBe('pending');
});

it('validates explicit backup ownership, provider and spending limits without exposing keys', async () => {
  const sdk = client(owner.key);
  const backup = await sdk.connections.create({
    name: 'Paid Anthropic',
    kind: 'model',
    provider: 'anthropic',
    auth_method: 'api_key',
    secret: 'fixture-api-key',
  });
  const claude = await sdk.connections.create({
    name: 'Claude with backup',
    kind: 'claude_subscription',
    provider: 'anthropic',
    auth_method: 'claude_code',
    api_fallback: { enabled: true, connection_id: backup.id, max_cost_micro_usd: '1000000' },
  });
  expect(claude.api_fallback).toEqual({
    enabled: true,
    connection_id: backup.id,
    max_cost_micro_usd: '1000000',
  });
  expect(JSON.stringify(await sdk.connections.list())).not.toContain('fixture-api-key');
  await expect(
    sdk.connections.update(claude.id, {
      api_fallback: { enabled: true, connection_id: backup.id, max_cost_micro_usd: '0' },
    }),
  ).rejects.toMatchObject({ code: 'invalid_fallback_budget' });
  await expect(
    transaction(owner.p.organizationId, (tx) =>
      connections.saveConnection(
        tx,
        { ...owner.p, userId: other.p.userId },
        {
          name: 'Other owner',
          kind: 'claude_subscription',
          provider: 'anthropic',
          auth_method: 'claude_code',
          api_fallback: { enabled: true, connection_id: backup.id, max_cost_micro_usd: '1' },
        },
      ),
    ),
  ).rejects.toMatchObject({ code: 'forbidden' });
  const wrong = await sdk.connections.create({
    name: 'OpenAI',
    kind: 'model',
    provider: 'openai',
    auth_method: 'api_key',
    secret: 'fixture-other-key',
  });
  await expect(
    sdk.connections.update(claude.id, {
      api_fallback: { enabled: true, connection_id: wrong.id, max_cost_micro_usd: '1' },
    }),
  ).rejects.toMatchObject({ code: 'credentials_incompatible' });
  await sdk.connections.delete(backup.id);
  const renamed = await sdk.connections.update(claude.id, { name: 'Claude without a working backup' });
  expect(renamed.id).toBe(claude.id);
  expect(renamed.api_fallback).toEqual(claude.api_fallback);
  await expect(
    sdk.connections.update(claude.id, {
      api_fallback: { enabled: true, connection_id: backup.id, max_cost_micro_usd: '1' },
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (await sdk.connections.update(claude.id, { api_fallback: { enabled: false } })).api_fallback,
  ).toEqual({ enabled: false });
});

it('keeps presets on their selected account and rejects execution before reserving funds or creating a dispatch', async () => {
  vi.spyOn(catalog, 'models').mockResolvedValue([
    {
      id: 'fixture-claude',
      name: 'Fixture Claude',
      provider: 'anthropic',
      enabled: true,
      harnesses: ['claude-code'],
      input_micro_usd_per_million: '1',
      output_micro_usd_per_million: '1',
    },
  ]);
  const sdk = client(owner.key);
  const first = await sdk.connections.create({
    name: 'Claude preset account',
    kind: 'claude_subscription',
    provider: 'anthropic',
    auth_method: 'claude_code',
  });
  const preset = await sdk.agents.create({
    name: 'Research',
    harness: 'claude-code',
    model: 'fixture-claude',
    billing_mode: 'subscription',
    provider_connection_id: first.id,
  });
  await sdk.connections.create({
    name: 'Later Claude account',
    kind: 'claude_subscription',
    provider: 'anthropic',
    auth_method: 'claude_code',
  });
  expect((await sdk.agents.get(preset.id)).provider_connection_id).toBe(first.id);
  const workspace = await sdk.workspaces.create({ name: 'Gated subscription workspace' });
  const before = await transaction(owner.p.organizationId, (tx) =>
    tx.query('SELECT count(*)::int AS count FROM runs'),
  );
  await expect(
    sdk.runs.create({ workspace_id: workspace.id, agent_id: preset.id, prompt: 'Do not execute' }),
  ).rejects.toMatchObject({ code: 'claude_subscription_unavailable' });
  expect(
    (await transaction(owner.p.organizationId, (tx) => tx.query('SELECT count(*)::int AS count FROM runs')))
      .rows,
  ).toEqual(before.rows);
  expect(
    (await transaction(owner.p.organizationId, (tx) => resources.get(tx, 'agents', preset.id)))
      .provider_connection_id,
  ).toBe(first.id);
});

it('stores a TypeSafe decision key without adding Jev to native harness eligibility', async () => {
  const sdk = client(owner.key);
  const connection = await sdk.connections.create({
    name: 'Typed decisions',
    kind: 'model',
    provider: 'typesafe',
    auth_method: 'api_key',
    secret: 'synthetic-jev-key',
  });
  expect(connection).toMatchObject({ provider: 'typesafe', status: 'healthy' });
  expect(connection).not.toHaveProperty('secret_ciphertext');
  const { modelCredential } = await import('../../packages/core/src/model-credentials');
  expect(
    await transaction(owner.p.organizationId, (tx) =>
      modelCredential(tx, owner.p.userId!, {
        provider: 'typesafe',
        billing_mode: 'byok',
        provider_connection_id: connection.id,
      }),
    ),
  ).toBe('synthetic-jev-key');
  await expect(
    sdk.agents.create({
      name: 'Not a native model',
      harness: 'codex',
      model: 'jev-1.13.0',
      billing_mode: 'byok',
      provider_connection_id: connection.id,
    }),
  ).rejects.toMatchObject({ status: 400 });
});
