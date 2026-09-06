import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authPool, pool, type Tx } from '../../packages/db';
import type { Principal } from '../../packages/core/src/auth';
import { validateConfiguration } from '../../packages/core/src/runs';
import * as resources from '../../packages/core/src/resources';

vi.mock('better-auth', () => ({ betterAuth: () => ({}) }));

vi.mock('../../packages/core/src/catalog', () => ({
  models: () => [{ id: 'test-model', provider: 'test-provider', enabled: true, harnesses: ['codex'] }],
}));
vi.mock('../../packages/core/src/resources', () => ({ get: vi.fn() }));
const p: Principal = {
  id: 'user',
  userId: 'user',
  organizationId: 'org',
  role: 'owner',
  kind: 'user',
  scopes: [],
  projectIds: [],
  operator: false,
};
// Configuration validation reads the account policy, without any provider calls.
const tx = {
  query: vi.fn(async () => ({
    rows: [{ plan: 'scale', run_concurrency_limit: null, run_timeout_seconds: null }],
  })),
} as unknown as Tx;
const base = {
  workspace_id: 'workspace',
  harness: 'codex',
  model: 'test-model',
  billing_mode: 'managed',
} as const;
beforeEach(() => vi.clearAllMocks());
afterAll(async () => {
  await pool.end();
  await authPool.end();
});

describe('run admission boundaries', () => {
  it.each([1, 7200])('accepts the timeout boundary %i seconds', async (timeout_seconds) => {
    const result = await validateConfiguration(tx, p, {
      ...base,
      limits: { timeout_seconds, max_cost_micro_usd: '2000000' },
    });
    expect(result.limits.timeout_seconds).toBe(timeout_seconds);
  });
  it.each([0, -1, 7201, 1.5, NaN, Infinity])('rejects timeout %s', async (timeout_seconds) => {
    await expect(
      validateConfiguration(tx, p, { ...base, limits: { timeout_seconds, max_cost_micro_usd: '2000000' } }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
  });
  it.each(['1', '999999999999'])('preserves exact integer budget %s', async (max_cost_micro_usd) => {
    const result = await validateConfiguration(tx, p, {
      ...base,
      limits: { timeout_seconds: 900, max_cost_micro_usd },
    });
    expect(result.limits.max_cost_micro_usd).toBe(max_cost_micro_usd);
  });
  it.each(['0', '-1', '1.5', '1e6', '1000000000000', '', ' 1', '1\n'])(
    'rejects invalid budget %j',
    async (max_cost_micro_usd) => {
      await expect(
        validateConfiguration(tx, p, { ...base, limits: { timeout_seconds: 900, max_cost_micro_usd } }),
      ).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
    },
  );
  it('requires an explicit BYOK connection without falling back to managed credentials', async () => {
    await expect(validateConfiguration(tx, p, { ...base, billing_mode: 'byok' })).rejects.toMatchObject({
      code: 'credentials_required',
    });
    expect(resources.get).not.toHaveBeenCalled();
  });
  it.each([
    { kind: 'mcp', provider: 'test-provider', status: 'healthy' },
    { kind: 'model', provider: 'other-provider', status: 'healthy' },
    { kind: 'model', provider: 'test-provider', status: 'revoked' },
  ])('rejects an incompatible BYOK connection: %j', async (connection) => {
    vi.mocked(resources.get).mockResolvedValue({
      id: 'connection',
      organization_id: 'org',
      revision: 'revision',
      created_at: '2026-09-06T00:00:00Z',
      owner_subject_id: 'user',
      ...connection,
    });
    await expect(
      validateConfiguration(tx, p, { ...base, billing_mode: 'byok', provider_connection_id: 'connection' }),
    ).rejects.toMatchObject({ code: 'credentials_incompatible' });
  });
  it('rejects another member’s otherwise healthy BYOK credential', async () => {
    vi.mocked(resources.get).mockResolvedValue({
      id: 'connection',
      organization_id: 'org',
      revision: 'revision',
      created_at: '2026-09-06T00:00:00Z',
      kind: 'model',
      provider: 'test-provider',
      status: 'healthy',
      owner_subject_id: 'another-user',
    });
    await expect(
      validateConfiguration(tx, p, { ...base, billing_mode: 'byok', provider_connection_id: 'connection' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('rejects a model incompatible with the selected harness', async () => {
    await expect(validateConfiguration(tx, p, { ...base, harness: 'claude-code' })).rejects.toMatchObject({
      code: 'model_unavailable',
    });
  });
});
