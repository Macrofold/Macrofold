import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { createKey } from '../../packages/core/src/keys';
import { createWorktree } from '../../packages/core/src/files';
import { admitRun, getRun } from '../../packages/core/src/runs';
import { claimRun } from '../../packages/core/src/engine';
import { advanceCloudRun } from '../../packages/core/src/cloud-engine';
import { admitInference } from '../../packages/core/src/inferences';
import { credit, settle } from '../../packages/core/src/ledger';
import { queueObservations } from '../../packages/core/src/scheduling';
import { config } from '../../packages/core/src/config';
import * as resources from '../../packages/core/src/resources';
import { decisionExample } from '../../examples/decisions/contracts';
import type { Principal } from '../../packages/core/src/auth';
const originalPaid = config.allowPaid;
const accounts: string[] = [];
afterEach(async () => {
  for (const org of accounts.splice(0))
    await transaction(org, async (tx) => {
      const rows = await tx.query(
        "SELECT id,reservation_micro_usd,cost_micro_usd FROM runs WHERE status IN ('queued','provisioning','running')",
      );
      for (const row of rows.rows) {
        await settle(tx, org, row.id, BigInt(row.reservation_micro_usd), BigInt(row.cost_micro_usd));
        await tx.query("UPDATE runs SET status='cancelled',completed_at=now() WHERE id=$1", [row.id]);
      }
      await tx.query("UPDATE dispatch_jobs SET state='done' WHERE organization_id=$1", [org]);
    });
  config.allowPaid = originalPaid;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('preserves account caps while reserving one slot for lightweight work; never constructs its machine provider', async () => {
  const { p } = await fixtureAccount('Mixed execution fixture');
  accounts.push(p.organizationId);
  vi.stubEnv('DECISION_EXECUTOR_VERSION', '1');
  vi.stubEnv('LIGHTWEIGHT_RESERVED_SLOTS_PER_ORG', '1');
  vi.stubEnv('LIGHTWEIGHT_CONCURRENT_RUN_LIMIT', '1');
  // Other domain suites share this disposable database. Test this account's
  // capacity without depending on unrelated fixture leases being cleared.
  vi.stubEnv('GLOBAL_CONCURRENT_RUN_LIMIT', '1000');
  vi.stubEnv('ANTHROPIC_API_KEY', 'fixture');
  config.allowPaid = true;
  const { first, second, light1, light2 } = await transaction(p.organizationId, async (tx) => {
    await tx.query("UPDATE organizations SET plan='payg' WHERE id=$1", [p.organizationId]);
    await credit(tx, p.organizationId, 10000000n, 'mixed-fixture');
    const workspace = await resources.create(tx, 'workspaces', p.organizationId, { name: 'Mixed modes' });
    const a = await createWorktree(tx, p, workspace.id, { name: 'main', branch: 'main' }),
      b = await createWorktree(tx, p, workspace.id, { name: 'parallel', branch: 'parallel' });
    const first = await admitRun(tx, p, {
      worktree_id: a.result.worktree_id,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
    });
    const second = await admitRun(tx, p, {
      worktree_id: b.result.worktree_id,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
    });
    const key = await createKey(tx, p, {
      name: 'Application',
      workspace_id: workspace.id,
      scopes: ['runs:read', 'runs:write'],
    });
    const app: Principal = {
      ...p,
      id: key.id,
      kind: 'api_key',
      workspaceIds: [workspace.id],
      scopes: key.scopes,
    };
    const light1 = await admitInference(tx, app, decisionExample(workspace.id, 'actor'));
    const light2 = await admitInference(tx, app, decisionExample(workspace.id, 'triage'));
    return { first, second, light1, light2 };
  });
  // Lightweight requests are interactive; first occupy its reserved slot, then native capacity.
  const machines = vi.fn(() => {
    throw new Error('No machine may be created for inference');
  });
  await advanceCloudRun(p.organizationId, light1.run_id, machines);
  expect(machines).not.toHaveBeenCalled();
  expect((await transaction(p.organizationId, (tx) => getRun(tx, light1.run_id))).status).toBe(
    'running',
  );
  expect(await claimRun(p.organizationId, first.run_id)).toBeTruthy();
  expect(await claimRun(p.organizationId, second.run_id)).toBeNull();
  expect(await claimRun(p.organizationId, light2.run_id)).toBeNull();
  const reasons = await transaction(p.organizationId, (tx) =>
    queueObservations(tx, [second.run_id, light2.run_id]),
  );
  expect(reasons.get(second.run_id)).toBe('account_concurrency');
  expect(reasons.get(light2.run_id)).toBe('account_concurrency');
  // Retiring the light call leaves the reserved slot unavailable to a second native job.
  await transaction(p.organizationId, async (tx) => {
    const run = await getRun(tx, light1.run_id);
    await settle(tx, p.organizationId, run.id, BigInt(run.reservation_micro_usd), 0n);
    await tx.query("UPDATE runs SET status='cancelled',completed_at=now() WHERE id=$1", [run.id]);
  });
  expect(await claimRun(p.organizationId, second.run_id)).toBeNull();
  expect(
    (await transaction(p.organizationId, (tx) => queueObservations(tx, [second.run_id]))).get(second.run_id),
  ).toBe('reserved_lightweight_capacity');
  vi.stubEnv('DECISION_EXECUTOR_VERSION', '');
  const before = await transaction(p.organizationId, (tx) => getRun(tx, light2.run_id));
  expect(await advanceCloudRun(p.organizationId, light2.run_id, machines)).toMatchObject({ done: false });
  expect((await transaction(p.organizationId, (tx) => getRun(tx, light2.run_id))).status).toBe(before.status);
  expect(machines).not.toHaveBeenCalled();
});
