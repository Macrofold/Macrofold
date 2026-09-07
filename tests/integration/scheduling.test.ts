import { afterAll, afterEach, expect, it } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { admitRun, getRun, cancelRun, presentRuns } from '../../packages/core/src/runs';
import { claimRun, maintainRuns } from '../../packages/core/src/engine';
import { createWorkspace } from '../../packages/core/src/files';
import * as resources from '../../packages/core/src/resources';
import { plans, getExecutionPolicy } from '../../packages/core/src/plans';
import { updateExecutionPolicy } from '../../packages/core/src/organizations';
import { schedulingReport } from '../../packages/core/src/scheduling';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { credit, reserve, settle } from '../../packages/core/src/ledger';
import { id } from '../../packages/core/src/crypto';
import { advanceCloudRun } from '../../packages/core/src/cloud-engine';
import type { MachineProvider } from '../../packages/core/src/ports';

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
    const project = await resources.create(tx, 'projects', a.p.organizationId, { name: 'Scheduler fixture' });
    const ws = await createWorkspace(tx, a.p, project.id, { name: 'main', branch: 'main' });
    return admitRun(tx, a.p, {
      workspace_id: String((ws.result as { workspace_id: string }).workspace_id),
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

it('keeps workspace ordering ahead of interactive priority, and explains each capacity constraint', async () => {
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
  expect((await read(a.p.organizationId, next.run_id)).waiting_reason).toBe('earlier_workspace_work');
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
  expect(await claimRun(b.p.organizationId, neighbor.run_id)).toBeNull(); // interactive workspace follow-up wins now
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
  expect((await request('/v1/organization/execution-policy', 'PATCH', { concurrency_limit: 3 })).status).toBe(
    400,
  );
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
      updateExecutionPolicy(tx, { ...a.p, projectIds: [id()] }, { concurrency_limit: 1 }),
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it('cloud retries preserve waiting and explicitly finish expiry before touching a machine', async () => {
  const a = await account();
  const first = await submit(a);
  const queued = await transaction(a.p.organizationId, (tx) =>
    admitRun(tx, a.p, {
      session_id: first.session_id,
      prompt: 'Wait for workspace',
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
