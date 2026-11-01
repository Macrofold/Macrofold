import { afterAll, afterEach, expect, it } from 'vitest';
import pg from 'pg';
import { writeFile } from 'node:fs/promises';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { admitRun, getNativeRun as getRun, cancelRun, presentRuns } from '../../packages/core/src/runs';
import { claimRun, maintainRuns } from '../../packages/core/src/engine';
import { createWorktree } from '../../packages/core/src/files';
import * as resources from '../../packages/core/src/resources';
import { plans, getExecutionPolicy } from '../../packages/core/src/plans';
import { updateExecutionPolicy } from '../../packages/core/src/organizations';
import { schedulingReport, schedulingSQL, schedulingParameters } from '../../packages/core/src/scheduling';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { credit, reserve, settle } from '../../packages/core/src/ledger';
import { id } from '../../packages/core/src/crypto';
import { advanceCloudRun } from '../../packages/core/src/cloud-engine';
import type { MachineProvider } from '../../packages/core/src/ports';
import { dispatchFailed, MAX_DISPATCH_FAILURES } from '../../packages/core/src/dispatch-failures';

type Account = Awaited<ReturnType<typeof fixtureAccount>>;
const accounts: Account[] = [];
const originalLimit = process.env.GLOBAL_CONCURRENT_RUN_LIMIT;
async function account(plan = 'payg') {
  const a = await fixtureAccount('Scheduling ' + plan);
  accounts.push(a);
  await pool.query('UPDATE organizations SET plan=$2 WHERE id=$1', [a.p.organizationId, plan]);
  return a;
}
async function submit(a: Account, input: Partial<Parameters<typeof admitRun>[2]> = {}) {
  return transaction(a.p.organizationId, async (tx) => {
    const workspace = await resources.create(tx, 'workspaces', a.p.organizationId, {
      name: 'Scheduler fixture',
    });
    const ws = await createWorktree(tx, a.p, workspace.id, { name: 'main', branch: 'main' });
    return admitRun(tx, a.p, {
      worktree_id: String((ws.result as { worktree_id: string }).worktree_id),
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'No paid calls',
      ...input,
    });
  });
}
async function retire(a: Account, runId: string) {
  await transaction(a.p.organizationId, async (tx) => {
    const run = await getRun(tx, runId);
    if (['queued', 'provisioning', 'running', 'waiting_for_input', 'persisting'].includes(run.status))
      await settle(tx, a.p.organizationId, runId, BigInt(run.reservation_micro_usd), 0n);
    await tx.query("UPDATE runs SET status='cancelled',completed_at=now() WHERE id=$1", [runId]);
    await tx.query("UPDATE dispatch_jobs SET state='done' WHERE resource_id=$1", [runId]);
  });
}
afterEach(async () => {
  for (const a of accounts.splice(0)) {
    const rows = await transaction(a.p.organizationId, (tx) =>
      tx.query(
        "SELECT id FROM runs WHERE status IN ('queued','provisioning','running','waiting_for_input','persisting')",
      ),
    );
    for (const r of rows.rows) await retire(a, r.id);
  }
  if (originalLimit === undefined) delete process.env.GLOBAL_CONCURRENT_RUN_LIMIT;
  else process.env.GLOBAL_CONCURRENT_RUN_LIMIT = originalLimit;
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});

async function block(a: Account, runId: string) {
  for (let attempt = 0; attempt < MAX_DISPATCH_FAILURES; attempt++)
    await dispatchFailed(a.p.organizationId, 'run', runId, 'fixture_dispatch_failure');
}

it('discovers current Worktree heads without scanning retained terminal Run history', async () => {
  const a = await account(),
    active = await submit(a);
  expect(await claimRun(a.p.organizationId, active.run_id)).not.toBeNull();
  await transaction(a.p.organizationId, (tx) =>
    admitRun(tx, a.p, {
      session_id: active.session_id,
      prompt: 'Queued behind the active writer',
      queue_if_busy: true,
    }),
  );
  const queued = await submit(a);
  await transaction(a.p.organizationId, (tx) =>
    tx.query(
      `
    INSERT INTO runs(id,organization_id,workspace_id,worktree_id,session_id,kind,status,config,completed_at)
    SELECT gen_random_uuid(),organization_id,workspace_id,worktree_id,session_id,kind,'cancelled',config,now()
    FROM runs CROSS JOIN generate_series(1,5000) WHERE id=$1`,
      [active.run_id],
    ),
  );
  const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
  await owner.connect();
  try {
    await owner.query('ANALYZE runs');
  } finally {
    await owner.end();
  }

  type Plan = {
    'Node Type': string;
    'Relation Name'?: string;
    'Index Name'?: string;
    'Actual Rows'?: number;
    'Rows Removed by Filter'?: number;
    Plans?: Plan[];
  };
  const query = `${schedulingSQL} SELECT worktree_id,id FROM worktree_heads ORDER BY id`;
  const rows = (await pool.query(query, schedulingParameters())).rows;
  expect(rows.map((row) => row.id).sort()).toEqual([active.run_id, queued.run_id].sort());
  const explanation = (
    await pool.query<{ 'QUERY PLAN': { Plan: Plan; 'Execution Time': number }[] }>(
      'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + query,
      schedulingParameters(),
    )
  ).rows[0]['QUERY PLAN'][0];
  const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)];
  const runNodes = nodes(explanation.Plan).filter((plan) => plan['Relation Name'] === 'runs');
  const observation = {
    fixture: 'worktree_head_history',
    retained_rows: 5000,
    execution_ms: explanation['Execution Time'],
    run_scans: runNodes.map((plan) => ({
      type: plan['Node Type'],
      index: plan['Index Name'],
      rows: plan['Actual Rows'],
      removed: plan['Rows Removed by Filter'],
    })),
  };
  if (process.env.SCHEDULING_PLAN_OUTPUT)
    await writeFile(process.env.SCHEDULING_PLAN_OUTPUT, JSON.stringify(observation, null, 2), {
      mode: 0o600,
    });
  console.info(JSON.stringify(observation));
  expect(runNodes.length).toBeGreaterThan(0);
  expect(runNodes.some((plan) => plan['Node Type'] === 'Seq Scan')).toBe(false);
});

it('a blocked queued Run cannot steal fair turns from healthy Worktrees or other tenants', async () => {
  const a = await account(),
    b = await account();
  const blocked = await submit(a),
    healthy = await submit(a),
    other = await submit(b);
  await block(a, blocked.run_id);
  const observed = (
    await pool.query('SELECT dispatch_blocked FROM reporting.scheduling_runs WHERE id=$1', [blocked.run_id])
  ).rows[0];
  expect(observed).toEqual({ dispatch_blocked: true });
  expect(await claimRun(a.p.organizationId, healthy.run_id)).not.toBeNull();
  expect(await claimRun(b.p.organizationId, other.run_id)).not.toBeNull();
  const stopped = await transaction(a.p.organizationId, (tx) => getRun(tx, blocked.run_id));
  expect(stopped.status).toBe('queued');
  expect(stopped.started_at).toBeNull();
  expect(stopped.result.failure_code).toBe('run_recovery_required');
});

it('a blocked active Run still holds global capacity until its outcome is resolved', async () => {
  process.env.GLOBAL_CONCURRENT_RUN_LIMIT = '1';
  const a = await account(),
    b = await account();
  const active = await submit(a),
    waiting = await submit(b);
  expect(await claimRun(a.p.organizationId, active.run_id)).not.toBeNull();
  await block(a, active.run_id);
  expect(await claimRun(b.p.organizationId, waiting.run_id)).toBeNull();
  const report = await transaction(a.p.organizationId, (tx) =>
    schedulingReport(tx, new Date(0).toISOString(), new Date().toISOString()),
  );
  expect(report.active_executions).toBe(1);
  expect(report.eligible_queued_jobs).toBe(1);
});

it.each(['cancel', 'expire'] as const)(
  'settles an unstarted blocked Run after %s without reviving dispatch',
  async (action) => {
    const a = await account();
    const accepted = await submit(a);
    await block(a, accepted.run_id);
    if (action === 'cancel')
      await transaction(a.p.organizationId, (tx) => cancelRun(tx, a.p, accepted.run_id));
    else
      await transaction(a.p.organizationId, (tx) =>
        tx.query("UPDATE runs SET queue_expires_at=now()-interval '1 second' WHERE id=$1", [accepted.run_id]),
      );
    expect(await claimRun(a.p.organizationId, accepted.run_id)).toBeNull();
    const run = await transaction(a.p.organizationId, (tx) => getRun(tx, accepted.run_id));
    expect(run.status).toBe(action === 'cancel' ? 'cancelled' : 'failed');
    expect(run.result.failure_code).toBe(action === 'cancel' ? undefined : 'queue_expired');
    expect(run.started_at).toBeNull();
  },
);

it.each(plans())('$name enforces its runtime ceiling and exposes configurable account caps', async (plan) => {
  const a = await account(plan.id);
  const accepted = await submit(a, {
    limits: { timeout_seconds: plan.max_timeout_seconds, max_cost_micro_usd: '2000000' },
  });
  const row = await transaction(a.p.organizationId, (tx) => getRun(tx, accepted.run_id));
  expect(row.queue_expires_at.getTime() - row.created_at.getTime()).toBe(86400000);
  expect(row.deadline).toBeNull();
  expect(accepted).not.toHaveProperty('queue_position');
  await expect(
    submit(a, { limits: { timeout_seconds: plan.max_timeout_seconds + 1, max_cost_micro_usd: '2000000' } }),
  ).rejects.toMatchObject({ code: 'invalid_request' });
  await transaction(a.p.organizationId, async (tx) => {
    expect((await getExecutionPolicy(tx, a.p.organizationId)).concurrency_limit).toBe(plan.concurrency_limit);
    expect(
      await updateExecutionPolicy(tx, a.p, { concurrency_limit: 1, max_timeout_seconds: 20 }),
    ).toMatchObject({ concurrency_limit: 1, max_timeout_seconds: 20 });
  });
  await expect(
    transaction(a.p.organizationId, (tx) =>
      updateExecutionPolicy(tx, a.p, { concurrency_limit: plan.concurrency_limit + 1 }),
    ),
  ).rejects.toMatchObject({ code: 'plan_limit_exceeded' });
  expect(await claimRun(a.p.organizationId, accepted.run_id)).toBeNull();
  expect(
    (await transaction(a.p.organizationId, (tx) => getRun(tx, accepted.run_id))).result.failure_code,
  ).toBe('execution_limit_changed');
  await transaction(a.p.organizationId, async (tx) => {
    const policy = await updateExecutionPolicy(tx, a.p, {
      concurrency_limit: null,
      max_timeout_seconds: null,
    });
    expect(policy.concurrency_limit).toBe(plan.concurrency_limit);
    expect(policy.max_timeout_seconds).toBe(plan.max_timeout_seconds);
  });
});

it('keeps worktree ordering ahead of interactive priority, and explains each capacity constraint', async () => {
  const a = await account(),
    b = await account();
  await transaction(a.p.organizationId, (tx) => updateExecutionPolicy(tx, a.p, { concurrency_limit: 1 }));
  const first = await submit(a),
    next = await transaction(a.p.organizationId, (tx) =>
      admitRun(tx, a.p, {
        session_id: first.session_id,
        prompt: 'Follow-up',
        queue_if_busy: true,
        scheduling_class: 'interactive',
      }),
    );
  const independent = await submit(a);
  const read = (org: string, run: string) =>
    transaction(org, async (tx) => (await presentRuns(tx, [await getRun(tx, run)]))[0]);
  expect((await read(a.p.organizationId, next.run_id)).waiting_reason).toBe('earlier_worktree_work');
  expect(await claimRun(a.p.organizationId, next.run_id)).toBeNull();
  const started = await claimRun(a.p.organizationId, first.run_id);
  expect(started?.deadline!.getTime()! - started?.started_at!.getTime()!).toBe(900000);
  expect((await read(a.p.organizationId, independent.run_id)).waiting_reason).toBe('account_concurrency');
  const active = Number(
    (
      await pool.query(
        "SELECT count(*) FROM reporting.runs WHERE status IN ('provisioning','running','waiting_for_input','persisting')",
      )
    ).rows[0].count,
  );
  process.env.GLOBAL_CONCURRENT_RUN_LIMIT = String(active);
  const neighbor = await submit(b);
  expect((await read(b.p.organizationId, neighbor.run_id)).waiting_reason).toBe('global_capacity');
  await retire(a, first.run_id);
  expect(await claimRun(b.p.organizationId, neighbor.run_id)).toBeNull(); // interactive worktree follow-up wins now
  expect(await claimRun(a.p.organizationId, next.run_id)).not.toBeNull();
});

it('sweeps expired and cancelled queued jobs at a full ceiling, releases reservations exactly once and retains history', async () => {
  const a = await account();
  const active = await submit(a);
  expect(await claimRun(a.p.organizationId, active.run_id)).not.toBeNull();
  process.env.GLOBAL_CONCURRENT_RUN_LIMIT = '1';
  const expired = await transaction(a.p.organizationId, (tx) =>
    admitRun(tx, a.p, {
      session_id: active.session_id,
      prompt: 'Expires behind writer',
      queue_if_busy: true,
      queue_timeout_seconds: 1,
    }),
  );
  const cancelled = await submit(a);
  await transaction(a.p.organizationId, async (tx) => {
    await credit(tx, a.p.organizationId, 6000000n, 'deadline-test');
    await reserve(tx, a.p.organizationId, 4000000n);
    await tx.query('UPDATE runs SET reservation_micro_usd=2000000 WHERE id=ANY($1::uuid[])', [
      [expired.run_id, cancelled.run_id],
    ]);
    await tx.query("UPDATE runs SET queue_expires_at=now()-interval '1 second' WHERE id=$1", [
      expired.run_id,
    ]);
    await tx.query(
      "UPDATE dispatch_jobs SET available_at=now()+interval '1 day',lease_until=now()+interval '1 day' WHERE resource_id=$1",
      [expired.run_id],
    );
  });
  await Promise.all([
    maintainRuns(),
    maintainRuns(),
    transaction(a.p.organizationId, (tx) => cancelRun(tx, a.p, cancelled.run_id)),
  ]);
  await transaction(a.p.organizationId, async (tx) => {
    const run = await getRun(tx, expired.run_id);
    expect(run).toMatchObject({ status: 'failed', started_at: null });
    expect(run.result).toMatchObject({ failure_code: 'queue_expired', persistence_status: 'not_required' });
    expect(run.config.prompt).toBe('Expires behind writer');
    expect(
      (await tx.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [a.p.organizationId]))
        .rows[0].reserved_micro_usd,
    ).toBe('0');
    expect(
      (
        await tx.query("SELECT count(*) FROM run_events WHERE run_id=$1 AND type='run.failed'", [
          expired.run_id,
        ])
      ).rows[0].count,
    ).toBe('1');
  });
});

it('rotates weighted organizations, admits new tenants promptly and borrows all idle capacity', async () => {
  const tenants = await Promise.all(['payg', 'pro', 'scale'].map(account));
  // Two complete 1:2:4 service cycles need ten ordered jobs per tenant.
  // Larger bursts belong in the separate multi-process load suite.
  for (const a of tenants) {
    const first = await submit(a);
    for (let i = 0; i < 9; i++)
      await transaction(a.p.organizationId, (tx) =>
        admitRun(tx, a.p, {
          session_id: first.session_id,
          prompt: 'Ordered fairness fixture',
          queue_if_busy: true,
        }),
      );
  }
  const { pendingRunCandidates } = await import('../../packages/core/src/scheduling');
  const served = new Map<string, number>();
  for (let i = 0; i < 14; i++) {
    const head = (await pendingRunCandidates(1))[0];
    const tenant = tenants.find((a) => a.p.organizationId === head.organization_id)!;
    expect(await claimRun(head.organization_id, head.resource_id)).not.toBeNull();
    served.set(head.organization_id, (served.get(head.organization_id) || 0) + 1);
    await retire(tenant, head.resource_id);
  }
  expect(tenants.map((a) => served.get(a.p.organizationId))).toEqual([2, 4, 8]);
  const newcomer = await account();
  const fresh = await submit(newcomer);
  let opportunity = 0;
  while (++opportunity <= 4) {
    const head = (await pendingRunCandidates(1))[0];
    expect(await claimRun(head.organization_id, head.resource_id)).not.toBeNull();
    if (head.resource_id === fresh.run_id) break;
    await retire(
      tenants.find((a) => a.p.organizationId === head.organization_id)!,
      head.resource_id,
    );
  }
  expect(opportunity).toBeLessThanOrEqual(4);
  const report = await transaction(null, (tx) =>
    schedulingReport(tx, new Date(Date.now() - 86400000).toISOString(), new Date().toISOString()),
  );
  expect(report.active_executions).toBeGreaterThanOrEqual(1);
  expect(report.accounts.find((a) => a.organization_id === newcomer.p.organizationId)?.starts).toBe(1);
  expect(report.eligible_queued_jobs).toBeGreaterThan(0);
});

it('authorizes execution policy mutations and validates deadline input through the public API', async () => {
  const a = await account();
  const request = (route: string, method = 'GET', body?: unknown) =>
    handleApi(
      new Request(config.origin + route, {
        method,
        headers: {
          Authorization: 'Bearer ' + a.key,
          'Content-Type': 'application/json',
          'Idempotency-Key': id(),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  expect((await request('/v1/organization/execution-policy')).status).toBe(200);
  const saved = await request('/v1/organization/execution-policy', 'PATCH', { concurrency_limit: 1 });
  expect(saved.status).toBe(200);
  expect((await saved.json()).concurrency_limit).toBe(1);
  expect(
    (await request('/v1/organization/execution-policy', 'PATCH', { concurrency_limit: 21 })).status,
  ).toBe(400);
  const run = await submit(a);
  for (const queue_timeout_seconds of [0, 86401, 1.5])
    expect(
      (
        await request('/v1/runs', 'POST', {
          session_id: run.session_id,
          prompt: 'invalid',
          queue_if_busy: true,
          queue_timeout_seconds,
        })
      ).status,
    ).toBe(400);
  await expect(
    transaction(a.p.organizationId, (tx) =>
      updateExecutionPolicy(tx, { ...a.p, role: 'member' }, { concurrency_limit: 1 }),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    transaction(a.p.organizationId, (tx) =>
      updateExecutionPolicy(tx, { ...a.p, workspaceIds: [id()] }, { concurrency_limit: 1 }),
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it('cloud retries preserve waiting and explicitly finish expiry before touching a machine', async () => {
  const a = await account();
  const first = await submit(a);
  const queued = await transaction(a.p.organizationId, (tx) =>
    admitRun(tx, a.p, {
      session_id: first.session_id,
      prompt: 'Wait for worktree',
      queue_if_busy: true,
    }),
  );
  const machine = new Proxy({} as MachineProvider, {
    get() {
      throw new Error('Queued work must not invoke the machine provider');
    },
  });
  const waiting = await advanceCloudRun(a.p.organizationId, queued.run_id, machine);
  expect(waiting).toMatchObject({ done: false, queued: true });
  expect(waiting.delaySeconds).toBeGreaterThan(0);
  expect(waiting.delaySeconds).toBeLessThanOrEqual(60);
  await transaction(a.p.organizationId, async (tx) => {
    await tx.query("UPDATE runs SET queue_expires_at=now()-interval '1 second' WHERE id=$1", [queued.run_id]);
    const visible = await presentRuns(tx, [await getRun(tx, queued.run_id)]);
    expect(visible[0].waiting_reason).toBe('deadline_expired');
  });
  expect(await advanceCloudRun(a.p.organizationId, queued.run_id, machine)).toEqual({
    done: true,
    delaySeconds: 0,
    queued: false,
  });
  const final = await transaction(a.p.organizationId, (tx) => getRun(tx, queued.run_id));
  expect(final.result.failure_code).toBe('queue_expired');
  expect(final.started_at).toBeNull();
});
