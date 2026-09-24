import type { Tx } from '../../db';
import { lock } from '../../db';
import { id, seal, token, sha256 } from './crypto';
import { assert } from './errors';
import { reserve, settleReservation } from './ledger';
import { getWorker, type WorkerRow } from './workers';
import { chooseWorkerPlacement, workerCommittedRate } from './worker-placement';
import { workerAccruedCost, workerChargeDelta, workerHourlyExposure, type ComputeMeters } from './worker-pricing';
import { workerAdmissionBlock } from './worker-policy';
import type { HostOffering } from './worker-catalog';
import type { HostSnapshot, RunDemand, ResourceAllocation } from './worker-types';
import type { NativeRunRow } from './runs';
import type { MachineBinding } from './ports';

export type HostBinding = MachineBinding & { controlBootId?: string; providerId?: string; url?: string };
export type HostRow = {
  id: string; organization_id: string; worker_id: string; generation: number;
  status: 'provisioning' | 'ready' | 'draining' | 'stopped'; provider: HostOffering['driver']; provider_name: string;
  binding: HostBinding | null; secret_ciphertext: string; offering: HostOffering;
  capacity: number; memory_mib: number; cpu_millis: number;
  reserved_micro_usd: string; charged_micro_usd: string; billing_cursor: ComputeMeters | null; billing_sequence: string;
  usage_finalized_at: Date | null;
  funded_until: Date; started_at: Date | null; stopped_at: Date | null; expires_at: Date | null; idle_since: Date | null;
  last_observed_at: Date | null; lease_id: string | null; lease_until: Date | null; next_check_at: Date;
  failure_code: string | null; created_at: Date; updated_at: Date;
};
export type HostRunRow = {
  id: string; organization_id: string; worker_id: string; host_id: string; host_generation: number;
  run_id: string; attempt: number; worktree_id: string | null; session_id: string | null;
  memory_mib: number; cpu_millis: number; state: 'claimed' | 'prepared' | 'running' | 'capturing' | 'releasing' | 'quarantined' | 'released';
  configuration: { checkpoint_id?: string | null; permission_view?: string; session_revision?: string; compatibility_key?: string };
  claimed_at: Date; launched_at: Date | null; released_at: Date | null;
};
export const HOST_CLEANUP_SECONDS = 180;
export const defaultRunResources: ResourceAllocation = { memory_mib: 1024, cpu_millis: 250 };
export const rateForDuration = (hourly: bigint, seconds: number) => (hourly * BigInt(seconds) + 3599n) / 3600n;

export async function getHost(tx: Tx, hostId: string): Promise<HostRow> {
  const row = (await tx.query<HostRow>('SELECT * FROM hosts WHERE id=$1', [hostId])).rows[0];
  assert(row, 404, 'host_not_found', 'Execution allocation not found.');
  return row;
}
export async function hostSnapshots(tx: Tx, workerId: string): Promise<HostSnapshot[]> {
  const rows = (await tx.query<HostRow & { occupied_slots: number; allocated_memory: number; allocated_cpu: number }>(
    `SELECT h.*,coalesce(a.slots,0)::integer AS occupied_slots,coalesce(a.memory,0)::integer AS allocated_memory,
      coalesce(a.cpu,0)::integer AS allocated_cpu FROM hosts h LEFT JOIN
      (SELECT host_id,count(*) AS slots,sum(memory_mib) AS memory,sum(cpu_millis) AS cpu FROM host_runs
       WHERE worker_id=$1 AND released_at IS NULL GROUP BY host_id) a ON a.host_id=h.id
      WHERE h.worker_id=$1 AND h.status<>'stopped' ORDER BY h.created_at,h.id`, [workerId],
  )).rows;
  const caches = (await tx.query<{ host_id: string; host_generation: number; worktree_id: string; checkpoint_id: string | null; permission_view: string; state: 'clean' | 'active' | 'recovery_required' }>(
    `SELECT m.* FROM host_materializations m JOIN hosts h ON h.id=m.host_id AND h.generation=m.host_generation
      WHERE h.worker_id=$1 AND h.status='ready' ORDER BY m.last_used_at DESC LIMIT 256`, [workerId],
  )).rows;
  const byHost = new Map<string, HostSnapshot['worktrees']>();
  for (const cache of caches) {
    const entries = byHost.get(cache.host_id) || [];
    entries.push({ worktree_id: cache.worktree_id, revision: cache.checkpoint_id || 'empty',
      permission_view: cache.permission_view, state: cache.state });
    byHost.set(cache.host_id, entries);
  }
  return rows.map(row => ({
    id: row.id, worker_id: row.worker_id, organization_id: row.organization_id, generation: row.generation,
    status: row.status, billable: row.started_at !== null, offering: row.offering,
    occupied_slots: row.occupied_slots, allocated: { memory_mib: row.allocated_memory, cpu_millis: row.allocated_cpu },
    retained_memory_mib: 0, expires_at_ms: row.expires_at?.getTime() ?? null,
    worktrees: byHost.get(row.id) || [], warm_harnesses: [],
  }));
}
export async function runDemand(tx: Tx, run: NativeRunRow): Promise<RunDemand> {
  const worktree = (await tx.query<{ data: { latest_checkpoint_id?: string } }>('SELECT data FROM worktrees WHERE id=$1', [run.worktree_id])).rows[0];
  const session = (await tx.query<{ revision: number }>('SELECT revision FROM sessions WHERE id=$1', [run.session_id])).rows[0];
  assert(worktree && session, 409, 'execution_context_missing', 'The Run context is unavailable.');
  const permissionView = sha256(JSON.stringify(run.config.permission_layers || []));
  return {
    run_id: run.id, resources: run.config.worker_resources || defaultRunResources,
    execution_seconds: run.config.limits?.timeout_seconds || 900, cleanup_seconds: HOST_CLEANUP_SECONDS,
    worktree: { id: run.worktree_id, revision: worktree.data.latest_checkpoint_id || 'empty' },
    session: { id: run.session_id, revision: String(session.revision) }, permission_view: permissionView,
    compatibility_key: sha256(JSON.stringify({ harness: run.config.harness, model: run.config.model, instructions: run.config.instructions,
      permissions: run.config.permission_layers, connections: run.config.connection_access, grants: run.config.connection_grants })),
  };
}
/** Called with the Worker's advisory lock. Quotes are selected from its accepted immutable snapshot. */
export async function reserveHost(tx: Tx, worker: WorkerRow, offering: HostOffering, requiredSeconds = 900, now = new Date()): Promise<HostRow> {
  assert(!workerAdmissionBlock(worker, now.getTime()), 409, 'worker_unavailable', 'This Worker is not accepting new allocations.');
  assert(worker.offerings.some(item => item.id === offering.id && item.revision === offering.revision),
    409, 'worker_quote_changed', 'This quote was not accepted by the Worker.');
  const current = await hostSnapshots(tx, worker.id);
  const maximum = worker.settings.max_instances ?? worker.settings.max_concurrency;
  assert(current.length < maximum, 409, 'worker_instance_limit', 'The Worker reached its allocation limit.');
  const rate = workerHourlyExposure(offering.price, offering.resources);
  assert(workerCommittedRate(current) + rate <= BigInt(worker.settings.max_hourly_compute_cost_micro_usd),
    409, 'worker_cost_limit', 'Additional compute would exceed the Worker spending ceiling.');
  const seconds = Math.max(3600, requiredSeconds + HOST_CLEANUP_SECONDS + 300);
  const held = rateForDuration(rate, seconds);
  await reserve(tx, worker.organization_id, held);
  const hostId = id();
  await tx.query(`INSERT INTO hosts(id,organization_id,worker_id,provider,provider_name,secret_ciphertext,offering,
      capacity,memory_mib,cpu_millis,reserved_micro_usd,funded_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [hostId, worker.organization_id, worker.id, offering.driver, `env-${hostId}-1`, seal(token('host')),
      JSON.stringify(offering), offering.concurrency, offering.resources.memory_mib, offering.resources.cpu_millis,
      held.toString(), new Date(now.getTime() + seconds * 1000)]);
  return getHost(tx, hostId);
}
/** Renew finite liability before admitting longer work. A failed renewal leaves existing obligations intact. */
export async function extendHostFunding(tx: Tx, host: HostRow, until: Date) {
  if (host.funded_until >= until) return;
  const extraSeconds = Math.ceil((until.getTime() - host.funded_until.getTime()) / 1000);
  const extra = rateForDuration(workerHourlyExposure(host.offering.price, host.offering.resources), extraSeconds);
  await reserve(tx, host.organization_id, extra);
  await tx.query('UPDATE hosts SET reserved_micro_usd=reserved_micro_usd+$2::bigint,funded_until=$3,updated_at=now() WHERE id=$1',
    [host.id, extra.toString(), until]);
}
export async function activeHostRun(tx: Tx, runId: string): Promise<HostRunRow | undefined> {
  return (await tx.query<HostRunRow>('SELECT * FROM host_runs WHERE run_id=$1 AND released_at IS NULL', [runId])).rows[0];
}
/** Resource counts and writer ownership commit together. An advisory placement result alone grants nothing. */
export async function claimHostRun(tx: Tx, run: NativeRunRow): Promise<HostRunRow | null> {
  const workerId = run.config.worker_id;
  assert(workerId, 500, 'worker_required', 'Worker assignment needs a Worker target.');
  await lock(tx, `worker:${workerId}`);
  const existing = await activeHostRun(tx, run.id);
  if (existing) return existing;
  const worker = await getWorker(tx, workerId);
  const demand = await runDemand(tx, run);
  const placement = chooseWorkerPlacement(worker, demand, await hostSnapshots(tx, workerId), worker.offerings, Date.now());
  if (placement.action !== 'place') return null;
  const host = await getHost(tx, placement.host_id);
  await extendHostFunding(tx, host, new Date(Date.now() + (demand.execution_seconds + HOST_CLEANUP_SECONDS + 60) * 1000));
  const claimed = (await tx.query<HostRunRow>(
    `INSERT INTO host_runs(id,organization_id,worker_id,host_id,host_generation,run_id,attempt,worktree_id,session_id,memory_mib,cpu_millis,configuration)
      SELECT $1,$2,$3,$4,$5,$6,coalesce(max(attempt),0)+1,$7,$8,$9,$10,$11 FROM host_runs WHERE run_id=$6
      ON CONFLICT DO NOTHING RETURNING *`,
    [id(), run.organization_id, workerId, host.id, host.generation, run.id, run.worktree_id, run.session_id,
      demand.resources.memory_mib, demand.resources.cpu_millis, JSON.stringify({
        checkpoint_id: demand.worktree?.revision === 'empty' ? null : demand.worktree?.revision,
        permission_view: demand.permission_view, session_revision: demand.session?.revision, compatibility_key: demand.compatibility_key,
      })],
  )).rows[0];
  if (!claimed) return null;
  await tx.query('UPDATE hosts SET idle_since=NULL,next_check_at=now() WHERE id=$1', [host.id]);
  return claimed;
}
export async function releaseHostRun(tx: Tx, assignment: HostRunRow, clean: boolean, checkpointId: string | null) {
  await lock(tx, `worker:${assignment.worker_id}`);
  const released = await tx.query(`UPDATE host_runs SET state='released',released_at=now() WHERE id=$1 AND released_at IS NULL RETURNING id`, [assignment.id]);
  if (!released.rowCount) return;
  if (assignment.worktree_id && assignment.configuration.permission_view) await tx.query(
    `INSERT INTO host_materializations(organization_id,host_id,host_generation,worktree_id,permission_view,checkpoint_id,state)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(host_id,host_generation,worktree_id,permission_view)
     DO UPDATE SET checkpoint_id=excluded.checkpoint_id,state=excluded.state,last_used_at=now()`,
    [assignment.organization_id, assignment.host_id, assignment.host_generation, assignment.worktree_id,
      assignment.configuration.permission_view, checkpointId, clean ? 'clean' : 'recovery_required']);
  await tx.query(`UPDATE hosts SET status=CASE WHEN (offering->>'isolate_runs')::boolean THEN 'draining' ELSE status END,
    idle_since=CASE WHEN NOT EXISTS(SELECT 1 FROM host_runs WHERE host_id=$1 AND released_at IS NULL)
      THEN coalesce(idle_since,now()) ELSE NULL END,next_check_at=now() WHERE id=$1`, [assignment.host_id]);
  await tx.query('UPDATE workers SET next_check_at=now() WHERE id=$1', [assignment.worker_id]);
}
/** A receipt is cumulative, monotonic, and settled once under the Host lock. */
export async function settleHostSample(tx: Tx, host: HostRow, meters: ComputeMeters) {
  const previous = host.billing_cursor;
  const amount = previous ? workerChargeDelta(host.offering.price, previous, meters) : workerAccruedCost(host.offering.price, meters);
  assert(amount <= BigInt(host.reserved_micro_usd), 402, 'host_funding_exhausted', 'The allocation exhausted its authorized funding; stop growth and reconcile its usage.');
  if (amount === 0n && previous && JSON.stringify(previous) === JSON.stringify(meters)) return;
  const sequence = BigInt(host.billing_sequence) + 1n;
  await settleReservation(tx, host.organization_id, `host:${host.id}:${sequence}`, amount, amount);
  await tx.query(`UPDATE hosts SET reserved_micro_usd=reserved_micro_usd-$2::bigint,charged_micro_usd=charged_micro_usd+$2::bigint,
    billing_cursor=$3,billing_sequence=$4,last_observed_at=now(),updated_at=now() WHERE id=$1`,
    [host.id, amount.toString(), JSON.stringify(meters), sequence.toString()]);
}
export async function releaseHostFunding(tx: Tx, host: HostRow) {
  assert(host.status === 'draining', 409, 'host_not_draining', 'Only a confirmed stopped allocation may release its funding.');
  await settleReservation(tx, host.organization_id, `host:${host.id}:release`, BigInt(host.reserved_micro_usd), 0n);
  await tx.query("UPDATE hosts SET status='stopped',stopped_at=coalesce(stopped_at,now()),reserved_micro_usd=0,binding=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1", [host.id]);
}
