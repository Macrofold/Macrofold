import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import pg from 'pg';
import { pool, authPool, credentialPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { listenDatabaseNotifications } from '../../packages/db/notifications';
import { dispatchWakeupChannel } from '../../packages/core/src/dispatch-wakeup';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { id } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import { createWorktree } from '../../packages/core/src/files';
import { admitRun, cancelRun } from '../../packages/core/src/runs';
import { credit } from '../../packages/core/src/ledger';
import { createWorker, getWorker } from '../../packages/core/src/workers';
import { reserveHost } from '../../packages/core/src/host-allocations';
import { handleApi } from '../../packages/core/src/http';
import type { InferenceCreate } from '../../packages/core/src/decision';
import { pendingRunCandidates, queueObservations } from '../../packages/core/src/scheduling';
import { updateExecutionPolicy } from '../../packages/core/src/organizations';
import { claimRun } from '../../packages/core/src/engine';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
let other: Awaited<ReturnType<typeof fixtureAccount>>;
const originalPaid = config.allowPaid;
let listener: ReturnType<typeof listenDatabaseNotifications>;
const received: (string | undefined)[] = [];
beforeAll(async () => {
  account = await fixtureAccount('Dispatch wake hints');
  other = await fixtureAccount('Other tenant queued work');
  await Promise.all(
    [account, other].map((fixture) =>
      transaction(fixture.p.organizationId, (tx) =>
        credit(tx, fixture.p.organizationId, 1_000_000_000n, `fixture:${id()}`),
      ),
    ),
  );
});
beforeEach(async () => {
  received.length = 0;
  listener = listenDatabaseNotifications({
    connectionString: config.databaseUrl,
    channel: dispatchWakeupChannel,
    notification: (payload) => received.push(payload),
  });
  await vi.waitFor(() => expect(listener.connected()).toBe(true));
});
afterEach(async () => {
  await listener.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  config.allowPaid = originalPaid;
  await Promise.all([account, other].map((fixture) => retireFixtureRuns(fixture.p.organizationId)));
  await transaction(account.p.organizationId, (tx) =>
    tx.query('DELETE FROM dispatch_jobs WHERE organization_id=$1', [account.p.organizationId]),
  );
});
afterAll(async () => {
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
});

/** Ordered sentinel avoids sleeps when proving the absence of a notification. */
async function delivered() {
  const sentinel = id();
  await transaction(account.p.organizationId, (tx) =>
    tx.query('SELECT pg_notify($1,$2)', [dispatchWakeupChannel, sentinel]),
  );
  await vi.waitFor(() => expect(received).toContain(sentinel));
  const index = received.indexOf(sentinel);
  return received.splice(0, index + 1).slice(0, -1);
}
async function job(kind = 'run', state = 'pending', available = new Date()) {
  const jobId = id();
  await transaction(account.p.organizationId, (tx) =>
    tx.query(
      'INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id,state,available_at) VALUES($1,$2,$3,$4,$5,$6)',
      [jobId, account.p.organizationId, kind, id(), state, available],
    ),
  );
  return jobId;
}

async function directInference(beforeResponse?: () => Promise<void>) {
  config.allowPaid = true;
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-wakeup-key');
  const provider = vi.fn(async () => {
    await beforeResponse?.();
    return Response.json({
      type: 'message',
      model: 'claude-haiku-4-5-20251001',
      content: [{ type: 'text', text: 'Synthetic response.' }],
      usage: { input_tokens: 17, output_tokens: 3 },
    });
  });
  vi.stubGlobal('fetch', provider);
  const input: InferenceCreate = {
    model_binding: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', billing_mode: 'managed' },
    input: { messages: [{ role: 'user', content: 'Synthetic direct inference.' }] },
    limits: { max_cost_micro_usd: '50000', max_output_tokens: 32, timeout_seconds: 20 },
  };
  const response = await handleApi(
    new Request(`${config.origin}/v1/inferences`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${account.key}`,
        'content-type': 'application/json',
        'idempotency-key': id(),
      },
      body: JSON.stringify(input),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'succeeded' });
  expect(provider).toHaveBeenCalledOnce();
}

async function nativeRun(fixture = account) {
  return transaction(fixture.p.organizationId, async (tx) => {
    const workspace = await resources.create(tx, 'workspaces', fixture.p.organizationId, {
      name: 'Queue fixture',
    });
    const worktree = await createWorktree(tx, fixture.p, workspace.id, { name: 'main', branch: 'main' });
    return admitRun(tx, fixture.p, {
      worktree_id: worktree.result.worktree_id,
      prompt: 'Synthetic queue fixture',
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
    });
  });
}

it('does not wake empty fleet discovery after a successful direct model response', async () => {
  await directInference();
  expect(await delivered()).toEqual([]);
});

it('wakes queued work in another tenant when a direct response frees shared capacity', async () => {
  vi.stubEnv('GLOBAL_CONCURRENT_RUN_LIMIT', '1');
  await directInference(async () => {
    const queued = await nativeRun(other);
    const reason = await transaction(other.p.organizationId, (tx) => queueObservations(tx, [queued.run_id]));
    expect(reason.get(queued.run_id)).toBe('global_capacity');
    expect(await delivered()).toEqual(['']);
  });
  expect(await delivered()).toEqual(['']);
});

it('uses the queued-only index without retained-history scans or workspace joins for capacity hints', async () => {
  const seed = await nativeRun();
  await transaction(account.p.organizationId, (tx) => cancelRun(tx, account.p, seed.run_id));
  await delivered();
  await transaction(account.p.organizationId, (tx) =>
    tx.query(
      `
    INSERT INTO runs(id,organization_id,workspace_id,worktree_id,session_id,kind,status,config,completed_at)
    SELECT gen_random_uuid(),organization_id,workspace_id,worktree_id,session_id,kind,'cancelled',config,now()
    FROM runs CROSS JOIN generate_series(1,5000) WHERE id=$1`,
      [seed.run_id],
    ),
  );
  // Gather representative fixture statistics as setup; the EXPLAIN below still
  // uses the restricted serving role and approved cross-tenant reporting view.
  const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
  await owner.connect();
  try {
    await owner.query('ANALYZE runs');
  } finally {
    await owner.end();
  }
  type PlanNode = { 'Node Type': string; 'Index Name'?: string; Plans?: PlanNode[] };
  type Explain = { Plan: PlanNode; 'Planning Time': number; 'Execution Time': number };
  const result = await transaction(account.p.organizationId, (tx) =>
    tx.query<{ 'QUERY PLAN': Explain[] }>(
      "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT EXISTS(SELECT 1 FROM reporting.scheduling_runs WHERE status='queued')",
    ),
  );
  const plan = result.rows[0]['QUERY PLAN'][0];
  const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
  const scanned = nodes(plan.Plan);
  expect(scanned.some((node) => node['Index Name'] === 'pending_runs')).toBe(true);
  expect(scanned.some((node) => /Seq Scan|Join/.test(node['Node Type']))).toBe(false);
  console.info(
    JSON.stringify({
      fixture: 'dispatch_capacity_hint',
      retained_history_rows: 5000,
      planning_ms: plan['Planning Time'],
      execution_ms: plan['Execution Time'],
      plan_nodes: scanned.map((node) => node['Node Type']),
    }),
  );
});

it('delivers a content-free wake only after commit, coalesces a batch and sends nothing after rollback', async () => {
  await expect(
    transaction(account.p.organizationId, async (tx) => {
      await tx.query(
        "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'run',$3)",
        [id(), account.p.organizationId, id()],
      );
      expect(received).toEqual([]);
      throw new Error('Rollback fixture');
    }),
  ).rejects.toThrow('Rollback fixture');
  await transaction(account.p.organizationId, async (tx) => {
    for (let count = 0; count < 2; count++)
      await tx.query(
        "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'run',$3)",
        [id(), account.p.organizationId, id()],
      );
    expect(received).toEqual([]);
  });
  expect(await delivered()).toEqual(['']);
});

it('ignores unrelated jobs and future recovery rows, then wakes when a running job becomes due', async () => {
  await job('operation');
  const future = await job('run', 'running', new Date(Date.now() + 3_600_000));
  expect(await delivered()).toEqual([]);
  await transaction(account.p.organizationId, (tx) =>
    tx.query('UPDATE dispatch_jobs SET available_at=clock_timestamp() WHERE id=$1', [future]),
  );
  expect(await delivered()).toEqual(['']);
  await transaction(account.p.organizationId, (tx) =>
    tx.query('UPDATE dispatch_jobs SET available_at=available_at,state=state WHERE id=$1', [future]),
  );
  expect(await delivered()).toEqual([]);
});

it('wakes for ordinary native admission and queued-head cancellation through the shared domain owners', async () => {
  const run = await transaction(account.p.organizationId, async (tx) => {
    const workspace = await resources.create(tx, 'workspaces', account.p.organizationId, {
      name: 'Wake files',
    });
    const operation = await createWorktree(tx, account.p, workspace.id, { name: 'main', branch: 'main' });
    return admitRun(tx, account.p, {
      worktree_id: operation.result.worktree_id,
      prompt: 'Synthetic wake fixture',
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
    });
  });
  expect(await delivered()).toEqual(['']);
  await transaction(account.p.organizationId, (tx) => cancelRun(tx, account.p, run.run_id));
  expect(await delivered()).toEqual(['']);
});

it('wakes a queued Run when account policy frees capacity, without hints for unchanged limits', async () => {
  try {
    await transaction(account.p.organizationId, (tx) =>
      updateExecutionPolicy(tx, account.p, { concurrency_limit: 1 }),
    );
    const active = await nativeRun();
    expect(await claimRun(account.p.organizationId, active.run_id)).not.toBeNull();
    const queued = await nativeRun();
    const reason = await transaction(account.p.organizationId, (tx) =>
      queueObservations(tx, [queued.run_id]),
    );
    expect(reason.get(queued.run_id)).toBe('account_concurrency');
    await delivered();

    await transaction(account.p.organizationId, (tx) =>
      updateExecutionPolicy(tx, account.p, { concurrency_limit: 2 }),
    );
    expect(await delivered()).toEqual(['']);
    expect((await pendingRunCandidates(10, 'native')).map((row) => row.resource_id)).toContain(queued.run_id);
    await transaction(account.p.organizationId, (tx) =>
      updateExecutionPolicy(tx, account.p, { concurrency_limit: 2 }),
    );
    expect(await delivered()).toEqual([]);
    await transaction(account.p.organizationId, (tx) =>
      tx.query('UPDATE organizations SET name=name WHERE id=$1', [account.p.organizationId]),
    );
    expect(await delivered()).toEqual([]);
  } finally {
    await transaction(account.p.organizationId, (tx) =>
      updateExecutionPolicy(tx, account.p, { concurrency_limit: null }),
    );
  }
});

it('wakes when Host capacity or Worker policy changes without notifying on unrelated metadata', async () => {
  const host = await transaction(account.p.organizationId, async (tx) => {
    const created = await createWorker(tx, account.p, {
      compute: 'server',
      dedicated: true,
      isolate_runs: false,
      min_instances: 0,
      max_instances: 1,
      max_concurrency: 1,
      max_hourly_compute_cost_micro_usd: '10000000',
    });
    const worker = await getWorker(tx, created.id);
    const offering = worker.offerings[0];
    if (!offering) throw new Error('The fixture has no accepted compute offering.');
    return reserveHost(tx, worker, offering);
  });
  expect(await delivered()).toEqual([]);
  await transaction(account.p.organizationId, (tx) =>
    tx.query("UPDATE hosts SET status='ready' WHERE id=$1", [host.id]),
  );
  expect(await delivered()).toEqual(['']);
  await transaction(account.p.organizationId, (tx) =>
    tx.query('UPDATE hosts SET last_observed_at=now() WHERE id=$1', [host.id]),
  );
  expect(await delivered()).toEqual([]);
  await transaction(account.p.organizationId, (tx) =>
    tx.query("UPDATE workers SET desired_state='paused' WHERE id=$1", [host.worker_id]),
  );
  expect(await delivered()).toEqual(['']);
  await transaction(account.p.organizationId, (tx) =>
    tx.query("UPDATE workers SET desired_state='enabled' WHERE id=$1", [host.worker_id]),
  );
  expect(await delivered()).toEqual(['']);
  await transaction(account.p.organizationId, (tx) =>
    tx.query('UPDATE workers SET settings=settings,next_check_at=now() WHERE id=$1', [host.worker_id]),
  );
  expect(await delivered()).toEqual([]);
});

it('wakes after the assignment on an already-ready Host releases its physical capacity', async () => {
  const assignment = id();
  await transaction(account.p.organizationId, async (tx) => {
    const workspace = await resources.create(tx, 'workspaces', account.p.organizationId, {
      name: 'Assignment',
    });
    const operation = await createWorktree(tx, account.p, workspace.id, { name: 'main', branch: 'main' });
    const run = await admitRun(tx, account.p, {
      worktree_id: operation.result.worktree_id,
      prompt: 'Synthetic assignment fixture',
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
    });
    const created = await createWorker(tx, account.p, {
      compute: 'server',
      dedicated: true,
      isolate_runs: false,
      min_instances: 0,
      max_instances: 1,
      max_concurrency: 1,
      max_hourly_compute_cost_micro_usd: '10000000',
    });
    const worker = await getWorker(tx, created.id);
    const offering = worker.offerings[0];
    if (!offering) throw new Error('No fixture compute offering.');
    const host = await reserveHost(tx, worker, offering);
    await tx.query("UPDATE hosts SET status='ready' WHERE id=$1", [host.id]);
    await tx.query(
      `INSERT INTO host_runs(id,organization_id,worker_id,host_id,host_generation,
      run_id,attempt,memory_mib,cpu_millis,configuration) VALUES($1,$2,$3,$4,$5,$6,1,128,100,'{}')`,
      [assignment, account.p.organizationId, worker.id, host.id, host.generation, run.run_id],
    );
  });
  expect(await delivered()).toEqual(['']);
  await transaction(account.p.organizationId, async (tx) => {
    const released = await tx.query(
      "UPDATE host_runs SET state='released',released_at=now() WHERE id=$1 RETURNING id",
      [assignment],
    );
    expect(released.rowCount).toBe(1);
  });
  expect(await delivered()).toEqual(['']);
});
