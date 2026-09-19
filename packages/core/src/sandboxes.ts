import type { Tx } from '../../db';
import { lock, transaction, pool } from '../../db';
import type { components } from '../../contracts/api';
import type { SandboxBinding, SandboxProvider, SandboxProviderKind } from '../../contracts/sandbox-control';
import { assert } from './errors';
import { id, token, seal } from './crypto';
import { isLocal, realExecutionEnabled } from './config';
import { requireWorkspace, requireScopes, type Principal } from './auth';
import * as resources from './resources';
import { reserve, settleReservation } from './ledger';
import { computeRate, computeMaximum } from './catalog';
import { getExecutionPolicy } from './plans';

type Schema = components['schemas'];
export type SandboxRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  worktree_id: string;
  name: string | null;
  provider: SandboxProviderKind;
  long_running: boolean;
  keep_warm_seconds: number | null;
  status: 'creating' | 'ready' | 'pausing' | 'paused' | 'destroying' | 'destroyed' | 'error';
  generation: number;
  binding: SandboxBinding | null;
  secret_ciphertext: string;
  active_run_id: string | null;
  idle_expires_at: Date | null;
  expires_at: Date | null;
  started_at: Date | null;
  provisioning_at: Date;
  budget_micro_usd: string;
  reserved_micro_usd: string;
  cost_micro_usd: string;
  rate_micro_usd_per_minute: string;
  lease_id: string | null;
  lease_until: Date | null;
  next_check_at: Date;
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
};
export async function getSandbox(tx: Tx, sandboxId: string, p?: Principal): Promise<SandboxRow> {
  const row = (await tx.query<SandboxRow>('SELECT * FROM sandboxes WHERE id=$1', [sandboxId])).rows[0];
  assert(row, 404, 'not_found', 'Sandbox not found.');
  if (p) requireWorkspace(p, row.workspace_id);
  return row;
}
export function sandboxName(row: SandboxRow) {
  return `env-${row.id}-${row.provider === 'render' ? 1 : row.generation}`;
}
export function sandboxCost(row: SandboxRow, at = Date.now()) {
  const elapsed = row.started_at
    ? Math.max(0, Math.min(at, row.expires_at?.getTime() || Infinity) - row.started_at.getTime()) / 1000
    : 0;
  const measured = computeMaximum(Math.ceil(elapsed), row.rate_micro_usd_per_minute);
  return measured < BigInt(row.reserved_micro_usd) ? measured : BigInt(row.reserved_micro_usd);
}
export function presentSandbox(row: SandboxRow) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    worktree_id: row.worktree_id,
    name: row.name,
    long_running: row.long_running,
    keep_warm_seconds: row.keep_warm_seconds,
    status: row.status,
    active_run_id: row.active_run_id,
    idle_expires_at: row.idle_expires_at?.toISOString() || null,
    cost_micro_usd: (BigInt(row.cost_micro_usd) + sandboxCost(row)).toString(),
    max_cost_micro_usd: row.budget_micro_usd,
    reserved_micro_usd: row.reserved_micro_usd,
    rate_micro_usd_per_minute: row.rate_micro_usd_per_minute,
    failure_code: row.failure_code,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
async function checkCapacity(tx: Tx, org: string) {
  await lock(tx, `sandboxes:${org}`);
  const policy = await getExecutionPolicy(tx, org);
  const count = (
    await tx.query<{ count: string }>(
      "SELECT count(*) FROM sandboxes WHERE status NOT IN ('paused','destroyed')",
    )
  ).rows[0];
  assert(
    Number(count.count) < policy.concurrency_limit,
    429,
    'sandbox_limit',
    'Pause or destroy an unused sandbox before creating or resuming another.',
  );
}
export async function createSandbox(tx: Tx, p: Principal, input: Schema['SandboxCreate']) {
  requireScopes(p, ['runs:write']);
  assert(
    realExecutionEnabled(),
    503,
    'execution_disabled',
    'Enable isolated execution before creating a sandbox.',
  );
  const worktree = await resources.get(tx, 'worktrees', input.worktree_id, p);
  const workspace = await resources.get(tx, 'workspaces', worktree.workspace_id, p);
  assert(
    !workspace.archived && !workspace.deleted && !worktree.deleted,
    409,
    'worktree_unavailable',
    'This worktree is unavailable.',
  );
  await checkCapacity(tx, p.organizationId);
  if (input.name) {
    const existing = await tx.query(
      "SELECT 1 FROM sandboxes WHERE lower(name)=lower($1) AND status<>'destroyed'",
      [input.name],
    );
    assert(!existing.rowCount, 409, 'sandbox_name_exists', 'Choose another sandbox name.');
  }
  const provider: SandboxProviderKind = isLocal() ? 'docker' : input.long_running ? 'render' : 'vercel';
  assert(
    provider !== 'render' || process.env.RENDER_SANDBOX_ENABLED === 'true',
    503,
    'render_unavailable',
    'Long-running execution is not configured.',
  );
  const budget = input.max_cost_micro_usd || '5000000';
  assert(
    /^\d{1,12}$/.test(budget) && BigInt(budget) > 0n,
    400,
    'invalid_budget',
    'Provide a positive sandbox compute budget.',
  );
  const rate = provider === 'render' ? process.env.RENDER_COMPUTE_MICRO_USD_PER_MINUTE : computeRate();
  assert(
    rate && /^\d+$/.test(rate) && (provider === 'docker' || BigInt(rate) > 0n),
    503,
    'compute_price_unavailable',
    'Configure the sandbox compute rate.',
  );
  const warm =
    input.keep_warm_seconds === undefined ? (input.long_running ? null : 0) : input.keep_warm_seconds;
  const sandboxId = id();
  await reserve(tx, p.organizationId, BigInt(budget));
  await tx.query(
    `INSERT INTO sandboxes(id,organization_id,workspace_id,worktree_id,name,provider,long_running,keep_warm_seconds,secret_ciphertext,budget_micro_usd,reserved_micro_usd,rate_micro_usd_per_minute)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11)`,
    [
      sandboxId,
      p.organizationId,
      workspace.id,
      worktree.id,
      input.name || null,
      provider,
      !!input.long_running,
      warm,
      seal(token('control')),
      budget,
      rate,
    ],
  );
  return presentSandbox(await getSandbox(tx, sandboxId));
}
export async function changeSandbox(
  tx: Tx,
  p: Principal,
  sandboxId: string,
  action: 'pause' | 'resume' | 'destroy',
) {
  requireScopes(p, ['runs:write']);
  await lock(tx, `sandbox:${sandboxId}`);
  const row = await getSandbox(tx, sandboxId, p);
  assert(
    !row.active_run_id,
    409,
    'sandbox_busy',
    'Wait for the active run to finish before changing its sandbox.',
  );
  assert(
    !row.lease_until || row.lease_until.getTime() <= Date.now(),
    409,
    'sandbox_busy',
    'A lifecycle operation is in progress. Retry shortly.',
  );
  if (action === 'destroy' && row.status === 'destroyed') return presentSandbox(row);
  assert(
    row.status !== 'destroyed',
    409,
    'sandbox_destroyed',
    'Create a new sandbox; this ID is permanently retired.',
  );
  if (
    (action === 'resume' && ['ready', 'creating'].includes(row.status)) ||
    (action === 'pause' && row.status === 'paused')
  )
    return presentSandbox(row);
  if (action === 'resume') {
    assert(
      row.status === 'paused',
      409,
      'sandbox_not_paused',
      'Finish the current lifecycle operation first.',
    );
    const workspace = await resources.get(tx, 'workspaces', row.workspace_id, p);
    const worktree = await resources.get(tx, 'worktrees', row.worktree_id, p);
    assert(
      !workspace.archived && !workspace.deleted && !worktree.deleted,
      409,
      'worktree_unavailable',
      'This worktree is unavailable.',
    );
    await checkCapacity(tx, p.organizationId);
    await reserve(tx, p.organizationId, BigInt(row.budget_micro_usd));
    await tx.query(
      `UPDATE sandboxes SET status='creating',generation=generation+1,binding=NULL,started_at=NULL,provisioning_at=now(),
      reserved_micro_usd=budget_micro_usd,idle_expires_at=NULL,expires_at=NULL,failure_code=NULL,next_check_at=now(),updated_at=now() WHERE id=$1`,
      [sandboxId],
    );
  } else
    await tx.query('UPDATE sandboxes SET status=$2,next_check_at=now(),updated_at=now() WHERE id=$1', [
      sandboxId,
      action === 'pause' ? 'pausing' : 'destroying',
    ]);
  return presentSandbox(await getSandbox(tx, sandboxId));
}
/** Bind before provisioning and hold until runtime cleanup, even after the run becomes terminal. */
export async function acquireSandbox(tx: Tx, sandboxId: string, runId: string, worktreeId: string) {
  await lock(tx, `sandbox:${sandboxId}`);
  const row = await getSandbox(tx, sandboxId);
  assert(
    row.worktree_id === worktreeId,
    409,
    'sandbox_worktree_mismatch',
    'A sandbox belongs to one worktree.',
  );
  assert(
    ['ready', 'creating'].includes(row.status),
    409,
    'sandbox_unavailable',
    'Resume this sandbox before starting a run.',
  );
  assert(
    !row.lease_until || row.lease_until.getTime() <= Date.now(),
    409,
    'sandbox_starting',
    'Sandbox lifecycle is still in progress.',
  );
  assert(
    !row.active_run_id || row.active_run_id === runId,
    409,
    'sandbox_busy',
    'The previous run is still releasing this sandbox.',
  );
  await tx.query('UPDATE sandboxes SET active_run_id=$2,idle_expires_at=NULL WHERE id=$1', [
    sandboxId,
    runId,
  ]);
  return row;
}
export async function releaseSandbox(
  org: string,
  sandboxId: string,
  runId: string,
  keepWarm: number | null | undefined,
  failed: boolean,
) {
  await transaction(org, async (tx) => {
    await lock(tx, `sandbox:${sandboxId}`);
    const row = await getSandbox(tx, sandboxId);
    if (row.active_run_id !== runId) return;
    const seconds = keepWarm === undefined ? row.keep_warm_seconds : (keepWarm ?? 0);
    // null on an explicitly long-running environment means no idle shutdown. A run's null means stop.
    const always = keepWarm === undefined && row.long_running && seconds === null;
    await tx.query(
      `UPDATE sandboxes SET active_run_id=NULL,status=$2,idle_expires_at=$3,next_check_at=now(),updated_at=now() WHERE id=$1`,
      [
        sandboxId,
        failed || (!always && !seconds) ? 'pausing' : 'ready',
        always ? null : new Date(Date.now() + (seconds || 0) * 1000),
      ],
    );
  });
}

export async function advanceSandbox(org: string, sandboxId: string, provider: SandboxProvider) {
  const lease = id();
  const row = await transaction(org, async (tx) => {
    await lock(tx, `sandbox:${sandboxId}`);
    const current = await getSandbox(tx, sandboxId);
    if (
      ['paused', 'destroyed'].includes(current.status) ||
      (current.lease_until && current.lease_until.getTime() > Date.now())
    )
      return null;
    if (current.active_run_id && current.status !== 'creating') return null;
    const workspace = await resources.get(tx, 'workspaces', current.workspace_id);
    const worktree = await resources.get(tx, 'worktrees', current.worktree_id);
    if (!current.active_run_id && (workspace.deleted || workspace.archived || worktree.deleted)) {
      await tx.query("UPDATE sandboxes SET status='destroying' WHERE id=$1", [sandboxId]);
      current.status = 'destroying';
    }
    await tx.query("UPDATE sandboxes SET lease_id=$2,lease_until=now()+interval '3 minutes' WHERE id=$1", [
      sandboxId,
      lease,
    ]);
    return current;
  });
  if (!row) return;
  const waiting =
    row.status === 'ready' &&
    (await transaction(
      org,
      async (tx) =>
        !!(
          await tx.query("SELECT 1 FROM runs WHERE status='queued' AND config->>'sandbox_id'=$1 LIMIT 1", [
            sandboxId,
          ])
        ).rowCount,
    ));
  let binding = row.binding;
  let status = row.status;
  try {
    if (status === 'creating' && row.provisioning_at.getTime() + 10 * 60_000 <= Date.now())
      status = 'pausing';
    if (status === 'creating') {
      const { unseal } = await import('./crypto');
      binding = await provider.create(
        sandboxName(row),
        unseal<string>(row.secret_ciphertext),
        row.long_running && row.provider === 'docker'
          ? null
          : BigInt(row.rate_micro_usd_per_minute) === 0n
            ? 86400
            : Math.min(
                86400,
                Math.max(
                  1,
                  Number((BigInt(row.reserved_micro_usd) * 60n) / BigInt(row.rate_micro_usd_per_minute)),
                ),
              ),
      );
      if (binding) status = 'ready';
    } else if (
      status === 'ready' &&
      ((!waiting &&
        ((row.idle_expires_at && row.idle_expires_at.getTime() <= Date.now()) ||
          (row.expires_at && row.expires_at.getTime() <= Date.now()))) ||
        sandboxCost(row) >= BigInt(row.reserved_micro_usd))
    )
      status = 'pausing';
    if (status === 'pausing' || status === 'destroying') {
      if (status === 'destroying') await provider.destroy(sandboxName(row), binding);
      else await provider.pause(sandboxName(row), binding);
      status = status === 'destroying' ? 'destroyed' : 'paused';
    }
    await transaction(org, async (tx) => {
      await lock(tx, `sandbox:${sandboxId}`);
      const current = await getSandbox(tx, sandboxId);
      if (current.lease_id !== lease) return;
      if (current.status !== row.status) status = current.status;
      const stopped = status === 'paused' || status === 'destroyed';
      const cost = stopped ? sandboxCost(current) : 0n;
      if (stopped)
        await settleReservation(
          tx,
          org,
          `sandbox:${sandboxId}:${row.generation}`,
          BigInt(row.reserved_micro_usd),
          cost,
        );
      await tx.query(
        `UPDATE sandboxes SET status=$2,binding=$3,started_at=CASE WHEN $2='ready' THEN coalesce(started_at,now()) ELSE started_at END,
        expires_at=CASE WHEN $2='ready' AND expires_at IS NULL AND NOT long_running THEN ($3::jsonb->>'createdAt')::timestamptz + interval '23 hours' ELSE expires_at END,
        idle_expires_at=CASE WHEN $2='ready' AND started_at IS NULL AND active_run_id IS NULL AND NOT(long_running AND keep_warm_seconds IS NULL) THEN now()+make_interval(secs=>greatest(coalesce(keep_warm_seconds,0),300)) ELSE idle_expires_at END,
        reserved_micro_usd=CASE WHEN $4 THEN 0 ELSE reserved_micro_usd END,cost_micro_usd=cost_micro_usd+$5,
        lease_id=NULL,lease_until=NULL,failure_code=NULL,next_check_at=now()+interval '15 seconds',updated_at=now() WHERE id=$1`,
        [sandboxId, status, JSON.stringify(binding), stopped, cost.toString()],
      );
    });
  } catch {
    await transaction(org, (tx) =>
      tx.query(
        "UPDATE sandboxes SET lease_id=NULL,lease_until=NULL,failure_code='sandbox_provider_failed',next_check_at=now()+interval '30 seconds' WHERE id=$1 AND lease_id=$2",
        [sandboxId, lease],
      ),
    );
  }
}
export async function dispatchSandboxes() {
  const { sandboxProvider } = await import('../../providers/src/sandboxes');
  const rows = (
    await pool.query<{ id: string; organization_id: string }>(
      'SELECT id,organization_id FROM reporting.sandbox_schedule WHERE next_check_at<=now() ORDER BY next_check_at LIMIT 3',
    )
  ).rows;
  const results = await Promise.allSettled(
    rows.map(async (row) => {
      const sandbox = await transaction(row.organization_id, (tx) => getSandbox(tx, row.id));
      await advanceSandbox(row.organization_id, row.id, sandboxProvider(sandbox.provider));
    }),
  );
  return {
    sandboxes_checked: rows.length,
    sandboxes_failed: results.filter((result) => result.status === 'rejected').length,
  };
}
