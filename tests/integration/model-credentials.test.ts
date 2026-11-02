import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { authPool, credentialPool, lock, pool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { id, seal, sha256 } from '../../packages/core/src/crypto';
import { credit } from '../../packages/core/src/ledger';
import {
  modelCredential,
  modelCredentialFromResult,
  modelCredentialQuery,
} from '../../packages/core/src/model-credentials';
import { prepareInference } from '../../packages/core/src/inferences';
import { refreshModelCatalog } from '../../packages/core/src/model-catalog';
import * as resources from '../../packages/core/src/resources';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
let ownerId: string;
const originalPaid = config.allowPaid;
const originalExecution = config.execution;
beforeAll(async () => {
  account = await fixtureAccount('Credential guard fixture');
  ownerId = account.p.userId ?? account.p.id;
  await transaction(account.p.organizationId, (tx) =>
    credit(tx, account.p.organizationId, 1_000_000n, `credential:${id()}`),
  );
});
afterEach(async () => {
  config.allowPaid = originalPaid;
  config.execution = originalExecution;
  vi.unstubAllEnvs();
  await retireFixtureRuns(account.p.organizationId);
  await transaction(account.p.organizationId, (tx) =>
    tx.query('UPDATE api_keys SET revoked_at=NULL WHERE key_hash=$1', [sha256(account.key)]),
  );
  await pool.query(
    "UPDATE model_catalog_cache SET models=NULL,fetched_at=NULL,refresh_after=now()+interval '1 day' WHERE provider='openrouter'",
  );
});
afterAll(() => Promise.all([pool.end(), authPool.end(), credentialPool.end()]));

async function connection(provider = 'openai') {
  return transaction(account.p.organizationId, (tx) =>
    resources.create(tx, 'connections', account.p.organizationId, {
      name: 'Exact model account',
      kind: 'model',
      provider,
      status: 'healthy',
      owner_subject_id: ownerId,
      secret_ciphertext: seal('fixture-customer-key'),
    }),
  );
}
function binding(connectionId: string) {
  return { provider: 'openai', billing_mode: 'byok', provider_connection_id: connectionId };
}
async function apiPrincipal() {
  const key = (
    await transaction(account.p.organizationId, (tx) =>
      tx.query<{ id: string }>('SELECT id FROM api_keys WHERE key_hash=$1', [sha256(account.key)]),
    )
  ).rows[0];
  return { ...account.p, id: key.id, kind: 'api_key' as const };
}
function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it('projects only exact credential fields and preserves tenant, owner and provider checks', async () => {
  const saved = await connection();
  const query = modelCredentialQuery(binding(saved.id));
  if (!query) throw new Error('BYOK must prepare its current credential lookup.');
  await transaction(account.p.organizationId, async (tx) => {
    await tx.query(
      `UPDATE connections SET data=data||jsonb_build_object('fixture_metadata',repeat('x',262144)) WHERE id=$1`,
      [saved.id],
    );
    const legacy = await resources.get(tx, 'connections', saved.id);
    const result = await tx.query(query);
    expect(Object.keys(result.rows[0]).sort()).toEqual([
      'id',
      'owner_subject_id',
      'provider',
      'secret_ciphertext',
      'status',
    ]);
    expect(Buffer.byteLength(JSON.stringify(legacy))).toBeGreaterThan(262144);
    expect(Buffer.byteLength(JSON.stringify(result.rows[0]))).toBeLessThan(512);
    expect(modelCredentialFromResult(ownerId, binding(saved.id), result)).toBe('fixture-customer-key');
    expect(() => modelCredentialFromResult('other-owner', binding(saved.id), result)).toThrowError(
      expect.objectContaining({ code: 'credentials_unavailable' }),
    );
    expect(() => modelCredentialFromResult(ownerId, binding(id()), result)).toThrowError(
      expect.objectContaining({ code: 'credentials_unavailable' }),
    );
    expect(() =>
      modelCredentialFromResult(ownerId, { ...binding(saved.id), provider: 'anthropic' }, result),
    ).toThrowError(expect.objectContaining({ code: 'credentials_unavailable' }));
  });
  await expect(
    transaction(id(), (tx) => modelCredential(tx, ownerId, binding(saved.id))),
  ).rejects.toMatchObject({ code: 'not_found' });
});

it('does not read a connection for managed funding or substitute it for unavailable BYOK', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture-managed-key');
  expect(modelCredentialQuery({ provider: 'openai', billing_mode: 'managed' })).toBeUndefined();
  await transaction(account.p.organizationId, async (tx) => {
    expect(await modelCredential(tx, ownerId, { provider: 'openai', billing_mode: 'managed' })).toBe(
      'fixture-managed-key',
    );
    await expect(modelCredential(tx, ownerId, binding(id()))).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      modelCredential(tx, ownerId, { provider: 'openai', billing_mode: 'byok' }),
    ).rejects.toMatchObject({ code: 'connection_required' });
    await expect(
      modelCredential(tx, ownerId, { provider: 'openai', billing_mode: 'other' }),
    ).rejects.toMatchObject({ code: 'funding_method_unavailable' });
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(
      modelCredential(tx, ownerId, { provider: 'openai', billing_mode: 'managed' }),
    ).rejects.toMatchObject({ code: 'provider_not_configured' });
  });
});

it('retains the exact routed BYOK binding when the guard group also checks catalog terms', async () => {
  config.allowPaid = true;
  config.execution = 'docker';
  const principal = await apiPrincipal();
  const saved = await connection('openrouter');
  await refreshModelCatalog(
    async () => [
      {
        id: 'openai/gpt-5.4-mini',
        name: 'Credential catalog fixture',
        tools: true,
        context_tokens: 128000,
        output_tokens: 8192,
        text: true,
        pricing: { prompt: '0.00000075', completion: '0.0000045', request: '0' },
      },
    ],
    ['openrouter'],
  );
  const prepared = await prepareInference(
    principal,
    {
      model_binding: {
        provider: 'openrouter',
        model: 'openai/gpt-5.4-mini',
        billing_mode: 'byok',
        provider_connection_id: saved.id,
      },
      input: { messages: [{ role: 'user', content: 'No provider request' }] },
      limits: { timeout_seconds: 20, max_output_tokens: 32, max_cost_micro_usd: '50000' },
    },
    'inference',
    true,
  );
  try {
    await transaction(account.p.organizationId, (tx) => prepared.commit(tx, principal));
    expect(prepared.inferencePermit?.()?.secret).toBe('fixture-customer-key');
  } finally {
    await prepared.dispose();
  }
});

it.each(['rotate', 'disconnect', 'key_revocation'] as const)(
  'observes %s after direct admission actually waits for shared capacity',
  async (change) => {
    config.allowPaid = true;
    vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-managed-must-not-be-used');
    const saved = await connection('anthropic');
    const principal = await apiPrincipal();
    const prepared = await prepareInference(
      principal,
      {
        model_binding: {
          ...binding(saved.id),
          provider: 'anthropic',
          billing_mode: 'byok',
          model: 'claude-haiku-4-5-20251001',
        },
        input: { messages: [{ role: 'user', content: 'Fixture; do not execute a provider request.' }] },
        limits: { timeout_seconds: 20, max_output_tokens: 32, max_cost_micro_usd: '50000' },
      },
      'inference',
      true,
    );
    const acquired = barrier(),
      release = barrier();
    const holder = transaction(account.p.organizationId, async (tx) => {
      await lock(tx, 'capacity:global');
      acquired.release();
      await release.promise;
      if (change === 'key_revocation')
        await tx.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [principal.id]);
      else
        await resources.update(
          tx,
          'connections',
          saved.id,
          change === 'rotate' ? { secret_ciphertext: seal('fixture-rotated-key') } : { status: 'error' },
        );
    });
    await acquired.promise;
    let candidatePid = 0;
    const candidate = transaction(principal.organizationId, async (tx) => {
      candidatePid = (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      return prepared.commit(tx, principal);
    });
    const outcome =
      change === 'rotate'
        ? candidate
        : expect(candidate).rejects.toMatchObject({
            code: change === 'key_revocation' ? 'authorization_revoked' : 'credentials_unavailable',
          });
    try {
      await expect
        .poll(async () =>
          candidatePid
            ? (
                await pool.query<{ n: number }>('SELECT cardinality(pg_blocking_pids($1)) AS n', [
                  candidatePid,
                ])
              ).rows[0].n
            : 0,
        )
        .toBeGreaterThan(0);
    } finally {
      release.release();
    }
    try {
      await holder;
      await outcome;
      if (change === 'rotate') expect(prepared.inferencePermit?.()?.secret).toBe('fixture-rotated-key');
      else expect(prepared.inferencePermit?.()).toBeUndefined();
    } finally {
      await prepared.dispose();
    }
  },
);
