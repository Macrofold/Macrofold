import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import {
  authPool,
  credentialPool,
  pool,
  transaction,
  DatabaseBudgetError,
  TransactionCommitUnknownError,
  TransactionRolledBackError,
  afterCommit,
  lock,
} from '../../packages/db';
import { acquireWithin } from '../../packages/db/budget';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { id, sha256, seal } from '../../packages/core/src/crypto';
import { config } from '../../packages/core/src/config';
import { activeExecutionSQL, executionCapacity } from '../../packages/core/src/execution-admission';
import {
  actorAuthorized,
  apiKeyActorAuthorized,
  cancelApiKeyRuns,
} from '../../packages/core/src/actor-authorization';
import type { InferenceControlRow } from '../../packages/core/src/inference-control';

let a: Awaited<ReturnType<typeof fixtureAccount>>, b: Awaited<ReturnType<typeof fixtureAccount>>;
const extraOrganizations: string[] = [];
beforeAll(async () => {
  a = await fixtureAccount('Inference control A');
  b = await fixtureAccount('Inference control B');
});
afterAll(async () => {
  await retireFixtureRuns(a.p.organizationId);
  await retireFixtureRuns(b.p.organizationId);
  for (const organizationId of extraOrganizations) await retireFixtureRuns(organizationId);
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
});

async function controlRun(account: typeof a, overrides: Record<string, unknown> = {}, status = 'running') {
  return transaction(account.p.organizationId, async (tx) => {
    const key = (
      await tx.query<{ id: string }>('SELECT id FROM api_keys WHERE organization_id=$1 AND key_hash=$2', [
        account.p.organizationId,
        sha256(account.key),
      ])
    ).rows[0];
    const runId = id();
    const actor = {
      principal_kind: 'api_key' as const,
      principal_id: key.id,
      user_id: account.p.userId!,
      ...overrides,
    };
    await tx.query(
      `INSERT INTO runs(id,organization_id,kind,status,config,lease_generation,deadline)
      VALUES($1,$2,'inference',$3,$4,7,now()+interval '1 minute')`,
      [
        runId,
        account.p.organizationId,
        status,
        JSON.stringify({ executor_version: '1', definition: {}, context: {}, ...actor }),
      ],
    );
    return { id: runId, organization_id: account.p.organizationId, workspace_id: null, config: actor };
  });
}

it('exposes only current content-free cross-tenant control facts through the restricted view', async () => {
  const first = await controlRun(a),
    second = await controlRun(b);
  const observed = await pool.query<InferenceControlRow>(
    'SELECT * FROM reporting.inference_control WHERE id=ANY($1::uuid[])',
    [[first.id, second.id]],
  );
  expect(observed.rows).toHaveLength(2);
  for (const current of observed.rows) {
    expect(apiKeyActorAuthorized(current)).toBe(true);
    const source = current.id === first.id ? first : second;
    expect(await transaction(source.organization_id, (tx) => actorAuthorized(tx, source))).toBe(true);
    expect(Object.keys(current).sort()).toEqual([
      'cancel_requested',
      'deadline',
      'email_verified',
      'id',
      'key_bound',
      'key_expired',
      'key_revoked',
      'lease_generation',
      'member_role',
      'organization_id',
      'scope_allowed',
      'status',
      'worker_allowed',
      'workspace_allowed',
    ]);
  }
  const grants = (
    await pool.query(`SELECT
    pg_has_role(current_user,'platform_reporting','MEMBER') AS reporting_member,
    has_column_privilege('platform_reporting','api_keys','key_hash','SELECT') AS key_hash,
    has_column_privilege('platform_reporting','auth."user"','email','SELECT') AS email`)
  ).rows[0];
  expect(grants).toEqual({ reporting_member: false, key_hash: false, email: false });
  expect(
    (await pool.query('SELECT id FROM runs WHERE id=ANY($1::uuid[])', [[first.id, second.id]])).rowCount,
  ).toBe(0);
});

it('denies a foreign key binding, revoked key and removed membership consistently', async () => {
  const foreign = await controlRun(a, {
    principal_id: (
      await transaction(b.p.organizationId, (tx) =>
        tx.query('SELECT id FROM api_keys WHERE organization_id=$1 AND key_hash=$2', [
          b.p.organizationId,
          sha256(b.key),
        ]),
      )
    ).rows[0].id,
  });
  const valid = await controlRun(a);
  const read = async (runId: string) =>
    (await pool.query<InferenceControlRow>('SELECT * FROM reporting.inference_control WHERE id=$1', [runId]))
      .rows[0];
  expect(apiKeyActorAuthorized(await read(foreign.id))).toBe(false);
  expect(await transaction(a.p.organizationId, (tx) => actorAuthorized(tx, foreign))).toBe(false);
  await transaction(a.p.organizationId, async (tx) => {
    await tx.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [valid.config.principal_id]);
    await cancelApiKeyRuns(tx, valid.config.principal_id);
  });
  expect(await read(valid.id)).toMatchObject({ cancel_requested: true, key_revoked: true });
  expect(apiKeyActorAuthorized(await read(valid.id))).toBe(false);
  const second = await controlRun(b);
  await pool.query('DELETE FROM memberships WHERE organization_id=$1 AND user_id=$2', [
    b.p.organizationId,
    b.p.userId,
  ]);
  expect(apiKeyActorAuthorized(await read(second.id))).toBe(false);
  expect(await transaction(b.p.organizationId, (tx) => actorAuthorized(tx, second))).toBe(false);
  await pool.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')", [
    b.p.organizationId,
    b.p.userId,
  ]);
});

it.each(['scope', 'workspace', 'expired', 'unverified'] as const)(
  'matches the ordinary actor check for current %s denial',
  async (denial) => {
    const account = await fixtureAccount(`Inference facts ${denial}`);
    extraOrganizations.push(account.p.organizationId);
    const candidate = await controlRun(account);
    await transaction(account.p.organizationId, async (tx) => {
      if (denial === 'scope')
        await tx.query("UPDATE api_keys SET scopes=ARRAY['identity:read'] WHERE id=$1", [
          candidate.config.principal_id,
        ]);
      if (denial === 'workspace')
        await tx.query('UPDATE api_keys SET workspace_ids=ARRAY[$2::uuid] WHERE id=$1', [
          candidate.config.principal_id,
          id(),
        ]);
      if (denial === 'expired')
        await tx.query("UPDATE api_keys SET expires_at=now()-interval '1 second' WHERE id=$1", [
          candidate.config.principal_id,
        ]);
      if (denial === 'unverified')
        await tx.query('UPDATE auth."user" SET "emailVerified"=false WHERE id=$1', [account.p.userId]);
    });
    const observed = (
      await pool.query<InferenceControlRow>('SELECT * FROM reporting.inference_control WHERE id=$1', [
        candidate.id,
      ])
    ).rows[0];
    expect(apiKeyActorAuthorized(observed)).toBe(false);
    expect(await transaction(account.p.organizationId, (tx) => actorAuthorized(tx, candidate))).toBe(false);
  },
);

it('uses current occupancy without making an older queued Run a turn prerequisite', async () => {
  const queued = await controlRun(b, {}, 'queued');
  try {
    await transaction(a.p.organizationId, async (tx) => {
      await lock(tx, 'capacity:global');
      expect(await executionCapacity(tx, a.p.organizationId, 'inference')).toEqual({ allowed: true });
      await tx.query('UPDATE organizations SET run_concurrency_limit=1 WHERE id=$1', [a.p.organizationId]);
      expect(await executionCapacity(tx, a.p.organizationId, 'inference')).toEqual({
        allowed: false,
        reason: 'account_concurrency',
      });
      await tx.query('UPDATE organizations SET run_concurrency_limit=NULL WHERE id=$1', [a.p.organizationId]);
    });
    vi.stubEnv('LIGHTWEIGHT_CONCURRENT_RUN_LIMIT', '1');
    await transaction(a.p.organizationId, async (tx) => {
      await lock(tx, 'capacity:global');
      expect(await executionCapacity(tx, a.p.organizationId, 'inference')).toEqual({
        allowed: false,
        reason: 'lightweight_capacity',
      });
    });
  } finally {
    vi.unstubAllEnvs();
    await transaction(b.p.organizationId, (tx) =>
      tx.query("UPDATE runs SET status='cancelled' WHERE id=$1", [queued.id]),
    );
  }
});

it('bounds pool checkout and releases a client granted after its caller deadline', async () => {
  const isolated = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
  const held = await isolated.connect();
  let released = false;
  try {
    await expect(acquireWithin(isolated, Date.now() + 30)).rejects.toMatchObject({
      phase: 'acquire',
      rollbackConfirmed: true,
    });
    held.release();
    released = true;
    await vi.waitFor(() => expect(isolated.idleCount).toBe(1));
    expect((await isolated.query('SELECT 1 AS value')).rows[0].value).toBe(1);
  } finally {
    if (!released) held.release();
    await isolated.end();
  }
});

it('uses one cumulative SQL budget and recovers the pool after expiry', async () => {
  let firstCompleted = false;
  const attempt = transaction(
    null,
    async (tx) => {
      await tx.query('SELECT pg_sleep(0.08)');
      firstCompleted = true;
      await tx.query('SELECT pg_sleep(1.45)');
    },
    { deadlineAtMs: Date.now() + 1500 },
  );
  await expect(attempt).rejects.toBeInstanceOf(DatabaseBudgetError);
  expect(firstCompleted).toBe(true);
  expect((await pool.query("SELECT current_setting('statement_timeout') AS deadline")).rows[0].deadline).toBe(
    '1min',
  );
});

it('marks an acknowledged rollback after a server statement timeout as safe refusal', async () => {
  const pending = transaction(null, (tx) => tx.query('SELECT pg_sleep(1)'), {
    deadlineAtMs: Date.now() + 1000,
    statementTimeoutMs: 30,
  });
  await expect(pending).rejects.toMatchObject({ phase: 'statement', rollbackConfirmed: true });
});

it('pushes observed Run IDs into the primary index despite retained terminal history', async () => {
  const selected = await controlRun(a);
  await transaction(a.p.organizationId, (tx) =>
    tx.query(
      `INSERT INTO runs(id,organization_id,kind,status,config,completed_at)
     SELECT gen_random_uuid(),$1,'inference','succeeded',$2,now() FROM generate_series(1,10000)`,
      [
        a.p.organizationId,
        JSON.stringify({ executor_version: '1', definition: {}, context: {}, ...selected.config }),
      ],
    ),
  );
  // Statistics are fixture provisioning; the measured query still executes as
  // the restricted runtime role rather than the owner that can bypass RLS.
  const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
  await owner.connect();
  try {
    await owner.query('ANALYZE runs');
  } finally {
    await owner.end();
  }
  type Plan = { 'Node Type': string; 'Index Name'?: string; 'Relation Name'?: string; Plans?: Plan[] };
  const explanation = await pool.query<{ 'QUERY PLAN': { Plan: Plan }[] }>(
    'EXPLAIN (FORMAT JSON) SELECT * FROM reporting.inference_control WHERE id=ANY($1::uuid[])',
    [[selected.id]],
  );
  const nodes: Plan[] = [];
  const collect = (node: Plan) => {
    nodes.push(node);
    for (const child of node.Plans ?? []) collect(child);
  };
  collect(explanation.rows[0]['QUERY PLAN'][0].Plan);
  expect(nodes.some((node) => node['Index Name'] === 'runs_pkey')).toBe(true);
  expect(nodes.some((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'runs')).toBe(
    false,
  );
  const occupancy = await pool.query<{ 'QUERY PLAN': { Plan: Plan }[] }>(
    `EXPLAIN (FORMAT JSON) ${activeExecutionSQL}`,
  );
  nodes.length = 0;
  collect(occupancy.rows[0]['QUERY PLAN'][0].Plan);
  expect(nodes.some((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'runs')).toBe(
    false,
  );
});

it('does not report a failed COMMIT acknowledgment as confirmed rollback', async () => {
  const lost = new Error('Synthetic lost commit acknowledgment');
  const queries = vi.spyOn(pg.Client.prototype, 'query');
  try {
    const pending = transaction(null, async (tx) => {
      await tx.query('SELECT 1');
      // Fail precisely at the wrapper's next operation: COMMIT. Its caller has
      // no proof whether the server accepted that operation.
      queries.mockImplementationOnce(() => {
        throw lost;
      });
    });
    await expect(pending).rejects.toBeInstanceOf(TransactionCommitUnknownError);
    await expect(pending).rejects.toMatchObject({ cause: lost });
  } finally {
    queries.mockRestore();
  }
  expect((await pool.query('SELECT 1 AS value')).rows[0].value).toBe(1);
});

it('never acknowledges admission or emits commit notifications after a caught SQL abort', async () => {
  const committed = vi.fn();
  const pending = transaction(null, async (tx) => {
    afterCommit(tx, committed);
    try {
      await tx.query('SELECT 1/0');
    } catch {
      /* Reproduce an incorrectly swallowed SQL failure. */
    }
    return { admitted: true };
  });
  await expect(pending).rejects.toBeInstanceOf(TransactionRolledBackError);
  expect(committed).not.toHaveBeenCalled();
});

it('applies migration 054 to populated invocation history without inventing completion timestamps', async () => {
  const ownerURL = new URL(config.ownerDatabaseUrl),
    runtimeURL = new URL(config.databaseUrl);
  expect(config.mode).toBe('local');
  expect(config.allowPaid).toBe(false);
  for (const url of [ownerURL, runtimeURL]) {
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(url.hostname);
    expect(url.pathname).toMatch(/^\/platform_test_[a-f0-9]+$/);
  }
  expect(ownerURL.pathname).toBe(runtimeURL.pathname);
  const runtimeRole = (await pool.query<{ role: string }>('SELECT current_user AS role')).rows[0].role;
  expect(runtimeRole).toMatch(/^[a-z_][a-z0-9_]*$/);
  const key = (await pool.query<{ id: string }>('SELECT id FROM api_keys WHERE key_hash=$1', [sha256(b.key)]))
    .rows[0];
  const runId = id(),
    invocationId = id();
  const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await owner.query("SELECT set_config('app.organization_id',$1,true)", [b.p.organizationId]);
    // Reconstruct only this migration's boundary. DDL, fixture history and
    // privilege changes all roll back; no existing fixture rows are replaced.
    await owner.query('DROP VIEW reporting.inference_control');
    await owner.query('ALTER TABLE decision_invocations DROP COLUMN provider_completed_at');
    await owner.query('REVOKE USAGE ON SCHEMA auth FROM platform_reporting');
    await owner.query('REVOKE SELECT(id,"emailVerified") ON auth."user" FROM platform_reporting');
    await owner.query(
      'REVOKE SELECT(id,organization_id,user_id,revoked_at,expires_at,scopes,workspace_ids) ON api_keys FROM platform_reporting',
    );
    await owner.query(
      `INSERT INTO runs(id,organization_id,kind,status,config,result,lease_generation,started_at,completed_at)
       VALUES($1,$2,'inference','succeeded',$3,$4,3,now()-interval '2 days',now()-interval '1 day')`,
      [
        runId,
        b.p.organizationId,
        {
          executor_version: '1',
          definition: {},
          context: {},
          principal_kind: 'api_key',
          principal_id: key.id,
          user_id: b.p.userId,
          model: 'synthetic-history',
          billing_mode: 'byok',
        },
        { inference: { outcome: 'value', value: 'Synthetic historical result' } },
      ],
    );
    await owner.query(
      `INSERT INTO gateway_requests(id,organization_id,run_id,lease_generation,model,provider,billing_mode,status,reserved_micro_usd,actual_micro_usd,completed_at)
       VALUES($1,$2,$3,3,'synthetic-history','anthropic','byok','succeeded',0,0,now()-interval '1 day')`,
      [invocationId, b.p.organizationId, runId],
    );
    await owner.query(
      `INSERT INTO decision_invocations(id,organization_id,run_id,step,state,provider_request_digest,body_ciphertext,response_ciphertext,dispatch_started_at,responded_at)
       VALUES($1,$2,$3,0,'responded',$4,$5,$6,now()-interval '2 days',now()-interval '1 day')`,
      [
        invocationId,
        b.p.organizationId,
        runId,
        sha256('synthetic-request'),
        seal({ input: 'Synthetic historical input' }),
        seal({ value: 'Synthetic historical result' }),
      ],
    );
    const snapshot = async () =>
      (
        await owner.query<{
          run: Record<string, unknown>;
          invocation: Record<string, unknown>;
          gateway: Record<string, unknown>;
        }>(
          `SELECT to_jsonb(r) AS run,to_jsonb(i) AS invocation,to_jsonb(g) AS gateway
      FROM runs r JOIN decision_invocations i ON i.run_id=r.id JOIN gateway_requests g ON g.id=i.id WHERE r.id=$1`,
          [runId],
        )
      ).rows[0];
    const before = await snapshot();
    expect(before.invocation.responded_at).not.toBeNull();
    expect(before.invocation).not.toHaveProperty('provider_completed_at');
    // Match the runner's temporary CREATE grant and final runtime-view grant.
    await owner.query('GRANT CREATE ON SCHEMA reporting TO platform_reporting');
    await owner.query(
      await readFile(
        new URL('../../packages/db/054_immediate_inference_control.sql', import.meta.url),
        'utf8',
      ),
    );
    await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO ${runtimeRole}`);
    await owner.query('REVOKE CREATE ON SCHEMA reporting FROM platform_reporting');
    expect(await snapshot()).toEqual({
      ...before,
      invocation: { ...before.invocation, provider_completed_at: null },
    });
    await owner.query("SELECT set_config('app.organization_id','',true)");
    await owner.query(`SET LOCAL ROLE ${runtimeRole}`);
    const control = (
      await owner.query<InferenceControlRow>('SELECT * FROM reporting.inference_control WHERE id=$1', [runId])
    ).rows[0];
    expect(control).toMatchObject({ id: runId, status: 'succeeded', lease_generation: '3' });
    expect(apiKeyActorAuthorized(control)).toBe(true);
    expect((await owner.query('SELECT id FROM runs WHERE id=$1', [runId])).rows).toEqual([]);
    const grants = (
      await owner.query(`SELECT
      pg_has_role(current_user,'platform_reporting','MEMBER') AS reporting_member,
      has_column_privilege('platform_reporting','api_keys','key_hash','SELECT') AS key_hash,
      has_column_privilege('platform_reporting','api_keys','worker_ids','SELECT') AS worker_ids,
      has_column_privilege('platform_reporting','auth."user"','email','SELECT') AS email`)
    ).rows[0];
    expect(grants).toEqual({ reporting_member: false, key_hash: false, worker_ids: false, email: false });
  } finally {
    try {
      await owner.query('ROLLBACK');
    } finally {
      await owner.end();
    }
  }
  // Rollback restores both the current schema and all preceding fixture data.
  expect(
    (await pool.query('SELECT provider_completed_at FROM decision_invocations WHERE id=$1', [invocationId]))
      .rows,
  ).toEqual([]);
  expect((await pool.query('SELECT id FROM reporting.inference_control WHERE id=$1', [runId])).rows).toEqual(
    [],
  );
});
