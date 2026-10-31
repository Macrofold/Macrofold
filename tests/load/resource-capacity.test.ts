import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { pool, authPool, credentialPool, transaction } from '../../packages/db';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { CloudDispatcher } from '../../packages/core/src/portable-dispatch';
import { LocalDispatcher } from '../../packages/core/src/local-dispatch';
import { admitInference } from '../../packages/core/src/inferences';
import { admitRun } from '../../packages/core/src/runs';
import { createWorktree } from '../../packages/core/src/files';
import { createTransfer } from '../../packages/core/src/transfers';
import { createKey } from '../../packages/core/src/keys';
import { credit } from '../../packages/core/src/ledger';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { id } from '../../packages/core/src/crypto';
import { mapConcurrent } from '../../packages/core/src/concurrent';
import { claimRun } from '../../packages/core/src/engine';
import { queueObservations } from '../../packages/core/src/scheduling';
import * as resources from '../../packages/core/src/resources';
import { decisionExample } from '../../examples/decisions/contracts';

const accounts: string[] = [];
const paid = config.allowPaid;
afterEach(async () => {
  for (const org of accounts.splice(0)) await retireFixtureRuns(org);
  config.allowPaid = paid;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
});

async function fixture() {
  const { p } = await fixtureAccount('Capacity boundary');
  accounts.push(p.organizationId);
  return transaction(p.organizationId, async (tx) => {
    await tx.query("UPDATE organizations SET plan='scale' WHERE id=$1", [p.organizationId]);
    await credit(tx, p.organizationId, 1_000_000_000n, `capacity:${id()}`);
    const workspace = await resources.create(tx, 'workspaces', p.organizationId, {
      name: 'Capacity fixture',
    });
    const key = await createKey(tx, p, { name: 'Capacity', scopes: p.scopes });
    const worktree = await createWorktree(tx, p, workspace.id, {});
    const saved = await resources.get(tx, 'worktrees', worktree.result.worktree_id);
    return {
      p,
      workspace,
      key,
      worktree: worktree.result.worktree_id,
      revision: saved.revision,
      app: { ...p, kind: 'api_key' as const, id: key.id, scopes: key.scopes },
    };
  });
}

it.each(['portable', 'local'] as const)(
  'makes progress through a multi-tenant burst with two %s dispatchers',
  async (mode) => {
    vi.stubEnv('GLOBAL_CONCURRENT_RUN_LIMIT', '2000');
    vi.stubEnv('LIGHTWEIGHT_CONCURRENT_RUN_LIMIT', '2000');
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-only');
    const tenants = await mapConcurrent([0, 1, 2, 3], 2, fixture);
    config.allowPaid = true;
    const calls = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({
        type: 'message',
        content: [{ type: 'text', text: '"wait"' }],
        usage: { input_tokens: 10, output_tokens: 2 },
      });
    });
    vi.stubGlobal('fetch', calls);
    const runIds = await mapConcurrent(
      Array.from({ length: 64 }, (_, i) => i),
      4,
      async (i) => {
        const f = tenants[i % tenants.length];
        return (
          await transaction(f.p.organizationId, (tx) =>
            admitInference(tx, f.app, decisionExample(f.workspace.id, 'triage')),
          )
        ).run_id;
      },
    );
    const dispatchers = [0, 1].map(() =>
      mode === 'portable'
        ? new CloudDispatcher(
            () => {
              throw Error('No native compute');
            },
            { inference: 32, provision: 1, transfer: 1, control: 1 },
          )
        : new LocalDispatcher(),
    );
    let completed = 0;
    try {
      const deadline = Date.now() + 45000;
      while (completed < runIds.length && Date.now() < deadline) {
        await Promise.all(dispatchers.map((d) => d.tick()));
        completed = (
          await pool.query(
            "SELECT count(*)::int AS n FROM reporting.runs WHERE id=ANY($1::uuid[]) AND status='succeeded'",
            [runIds],
          )
        ).rows[0].n;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      await Promise.all(dispatchers.map((d) => d.drain()));
    }
    expect(completed).toBe(runIds.length);
    expect(calls).toHaveBeenCalledTimes(runIds.length);
    for (const f of tenants)
      await transaction(f.p.organizationId, async (tx) => {
        const usage = (
          await tx.query('SELECT count(*)::int AS n,count(DISTINCT run_id)::int AS runs FROM model_usage')
        ).rows[0];
        expect(usage).toEqual({ n: 16, runs: 16 });
        expect(
          (
            await tx.query('SELECT reserved_micro_usd::text AS held FROM organizations WHERE id=$1', [
              f.p.organizationId,
            ])
          ).rows[0].held,
        ).toBe('0');
      });
  },
  60000,
);

it('accepts all 100 queued follow-ups, rejects only overflow, and resumes admission when a slot is released', async () => {
  const f = await fixture();
  const first = await transaction(f.p.organizationId, (tx) =>
    admitRun(tx, f.p, {
      worktree_id: f.worktree,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
    }),
  );
  const append = () =>
    transaction(f.p.organizationId, (tx) =>
      admitRun(tx, f.p, {
        session_id: first.session_id,
        queue_if_busy: true,
        prompt: 'Queued fixture',
      }),
    );
  await mapConcurrent(Array.from({ length: 99 }), 8, append);
  await expect(append()).rejects.toMatchObject({ code: 'queue_full' });
  await transaction(f.p.organizationId, (tx) =>
    tx.query("UPDATE runs SET status='cancelled',completed_at=now() WHERE id=$1", [first.run_id]),
  );
  await expect(append()).resolves.toHaveProperty('run_id');
});

it('allows 100 simultaneous push plans without limiting downloads or previews, and frees expired slots', async () => {
  const f = await fixture();
  const plan = (direction: 'push' | 'pull' = 'push', dry_run = false) =>
    transaction(f.p.organizationId, (tx) =>
      createTransfer(tx, f.p, f.worktree, {
        direction,
        dry_run,
        base_revision: f.revision,
        include_ignored: false,
        delete: false,
        paths: [],
        manifest: [],
      }),
    );
  await mapConcurrent(Array.from({ length: 100 }), 8, () => plan());
  await expect(plan()).rejects.toMatchObject({ code: 'too_many_transfers' });
  await expect(plan('pull')).resolves.toBeDefined();
  await expect(plan('push', true)).resolves.toBeDefined();
  await transaction(f.p.organizationId, (tx) =>
    tx.query(
      "UPDATE transfers SET data=jsonb_set(data,'{expires_at}',to_jsonb((now()-interval '1 second')::text))",
    ),
  );
  await expect(plan()).resolves.toBeDefined();
});

it('honors real default rate boundaries while keeping cancellation independent of exhausted reads and writes', async () => {
  const f = await fixture();
  const run = await transaction(f.p.organizationId, (tx) =>
    admitRun(tx, f.p, {
      worktree_id: f.worktree,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
    }),
  );
  // Retry-After is the remainder of the current minute, not always sixty.
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  vi.spyOn(Date, 'now').mockReturnValue(now);
  // Seed counters rather than wait for thousands of identical requests. The
  // capacity benchmark separately measures sustained HTTP throughput.
  for (const [group, limit] of [
    ['read', 12000],
    ['write', 1200],
    ['control', 1200],
  ] as const)
    await pool.query('INSERT INTO rate_limits(key,bucket,count) VALUES($1,$2,$3)', [
      `${f.p.organizationId}:${f.key.id}:${group}`,
      Math.floor(now / 60000),
      limit - 1,
    ]);
  const request = (path: string, method = 'GET', body?: unknown) =>
    handleApi(
      new Request(config.origin + '/v1' + path, {
        method,
        headers: {
          authorization: `Bearer ${f.key.secret}`,
          'content-type': 'application/json',
          'idempotency-key': id(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  expect((await request('/workspaces')).status).toBe(200);
  expect((await request('/workspaces')).status).toBe(429);
  expect((await request('/workspaces', 'POST', { name: 'Rate fixture' })).status).toBe(201);
  expect((await request('/workspaces', 'POST', { name: 'Rate fixture' })).status).toBe(429);
  const cancelled = await request(`/runs/${run.run_id}/cancel`, 'POST', {});
  expect(cancelled.ok).toBe(true);
  const limited = await request(`/runs/${run.run_id}/cancel`, 'POST', {});
  expect(limited.status).toBe(429);
  expect(limited.headers.get('Retry-After')).toBe('60');
});

// Occupancy tests exercise the real admission query at default fleet/account
// sizes without purchasing machines or pretending fixtures execute 2,000 models.
async function occupyInference(f: Awaited<ReturnType<typeof fixture>>, count: number) {
  return transaction(f.p.organizationId, async (tx) => {
    const run = await admitInference(tx, f.app, decisionExample(f.workspace.id, 'triage'));
    await tx.query(
      `INSERT INTO runs(id,organization_id,workspace_id,kind,status,config,started_at,deadline)
      SELECT gen_random_uuid(),organization_id,workspace_id,kind,'running',config,now(),now()+interval '10 minutes'
      FROM runs CROSS JOIN generate_series(1,$2) WHERE id=$1`,
      [run.run_id, count],
    );
    return run;
  });
}

it.each([
  ['payg', 20],
  ['pro', 100],
  ['scale', 500],
] as const)(
  'enforces the %s default at %i active Runs without rejecting its last slot',
  async (plan, limit) => {
    const f = await fixture();
    vi.stubEnv('GLOBAL_CONCURRENT_RUN_LIMIT', '10000');
    vi.stubEnv('LIGHTWEIGHT_CONCURRENT_RUN_LIMIT', '2000');
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-only');
    config.allowPaid = true;
    await pool.query('UPDATE organizations SET plan=$2 WHERE id=$1', [f.p.organizationId, plan]);
    const run = await occupyInference(f, limit - 1);
    expect(await claimRun(f.p.organizationId, run.run_id)).toBeTruthy();
    const overflow = await transaction(f.p.organizationId, (tx) =>
      admitInference(tx, f.app, decisionExample(f.workspace.id, 'triage')),
    );
    expect(await claimRun(f.p.organizationId, overflow.run_id)).toBeNull();
    expect(
      (await transaction(f.p.organizationId, (tx) => queueObservations(tx, [overflow.run_id]))).get(
        overflow.run_id,
      ),
    ).toBe('account_concurrency');
  },
);

it('checks the 2,000-inference fleet boundary independently of native occupancy', async () => {
  vi.stubEnv('GLOBAL_CONCURRENT_RUN_LIMIT', '2200');
  vi.stubEnv('LIGHTWEIGHT_CONCURRENT_RUN_LIMIT', '2000');
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-only');
  config.allowPaid = true;
  for (let i = 0; i < 4; i++) {
    const f = await fixture();
    const seed = await occupyInference(f, 500);
    await transaction(f.p.organizationId, (tx) =>
      tx.query("UPDATE runs SET status='cancelled',completed_at=now() WHERE id=$1", [seed.run_id]),
    );
  }
  const f = await fixture();
  const light = await occupyInference(f, 0);
  expect(await claimRun(f.p.organizationId, light.run_id)).toBeNull();
  expect(
    (await transaction(f.p.organizationId, (tx) => queueObservations(tx, [light.run_id]))).get(light.run_id),
  ).toBe('lightweight_capacity');
  const native = await transaction(f.p.organizationId, (tx) =>
    admitRun(tx, f.p, {
      worktree_id: f.worktree,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
    }),
  );
  expect(await claimRun(f.p.organizationId, native.run_id)).toBeTruthy();
});

it('fills the 200-native fleet allowance across distinct worktrees and queues the excess', async () => {
  const f = await fixture();
  vi.stubEnv('NATIVE_CONCURRENT_RUN_LIMIT', '200');
  vi.stubEnv('GLOBAL_CONCURRENT_RUN_LIMIT', '2200');
  const runs = await mapConcurrent(Array.from({ length: 201 }), 8, async () =>
    transaction(f.p.organizationId, async (tx) => {
      // Occupancy fixture: distinct valid Worktree records without initializing
      // 201 Git repositories unrelated to the SQL admission boundary.
      const worktree = await resources.create(tx, 'worktrees', f.p.organizationId, {
        workspace_id: f.workspace.id,
        name: id(),
        branch: id(),
        status: 'idle',
        deleted: false,
        files: [],
        git_files: [],
      });
      return admitRun(tx, f.p, {
        worktree_id: worktree.id,
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
        prompt: 'Fixture',
      });
    }),
  );
  const ordered = (
    await pool.query('SELECT id FROM reporting.runs WHERE id=ANY($1::uuid[]) ORDER BY created_at,id', [
      runs.map((r) => r.run_id),
    ])
  ).rows;
  for (const run of ordered.slice(0, 200)) expect(await claimRun(f.p.organizationId, run.id)).toBeTruthy();
  expect(await claimRun(f.p.organizationId, ordered[200].id)).toBeNull();
  expect(
    (await transaction(f.p.organizationId, (tx) => queueObservations(tx, [ordered[200].id]))).get(
      ordered[200].id,
    ),
  ).toBe('global_capacity');
}, 60000);
