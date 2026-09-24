import type { Tx } from '../../db';
import { lock } from '../../db';
import { requireScopes, type Principal } from './auth';
import { id } from './crypto';
import { assert } from './errors';
import { workerOfferings, workerPolicyLimits, publicOffering, type HostOffering } from './worker-catalog';
import {
  requestWorkerAction,
  resolveWorkerSettings,
  workerAdmissionBlock,
  workerObservedStatus,
  workerOfferingCompatible,
} from './worker-policy';
import { workerHourlyExposure } from './worker-pricing';
import type { WorkerIdentity, WorkerInput, WorkerSettings } from './worker-types';

export type WorkerRow = WorkerIdentity & {
  name: string | null;
  revision: number;
  offerings: HostOffering[];
  expires_at: Date | null;
  next_check_at: Date;
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
};
export type WorkerCreateInput = WorkerInput & { name?: string };
export type WorkerPatchInput = WorkerInput & { name?: string; expected_revision: number };
export function authorizeWorker(p: Principal, scope: 'workers:read' | 'workers:use' | 'workers:write') {
  requireScopes(p, [scope]);
  if (scope === 'workers:write')
    assert(
      !p.workspaceIds.length && ['owner', 'admin'].includes(p.role),
      403,
      'worker_management_forbidden',
      'Worker lifecycle and spending changes require an unrestricted organization owner or administrator.',
    );
}
export async function getWorker(
  tx: Tx,
  workerId: string,
  p?: Principal,
  scope: 'workers:read' | 'workers:use' | 'workers:write' = 'workers:read',
): Promise<WorkerRow> {
  if (p) {
    authorizeWorker(p, scope);
    assert(!p.workerIds?.length || p.workerIds.includes(workerId), 404, 'not_found', 'Worker not found.');
  }
  const row = (await tx.query<WorkerRow>('SELECT * FROM workers WHERE id=$1', [workerId])).rows[0];
  assert(row && (!p || row.organization_id === p.organizationId), 404, 'not_found', 'Worker not found.');
  return row;
}
function nameValue(name: string | undefined): string | null {
  if (name === undefined) return null;
  assert(
    typeof name === 'string' && name.trim().length > 0 && name.length <= 100,
    400,
    'invalid_worker_name',
    'Choose a Worker name between 1 and 100 characters.',
  );
  return name.trim();
}
async function nameAvailable(tx: Tx, name: string | null, except?: string) {
  if (name === null) return;
  const found = await tx.query(
    "SELECT 1 FROM workers WHERE lower(name)=lower($1) AND desired_state<>'destroyed' AND ($2::uuid IS NULL OR id<>$2)",
    [name, except || null],
  );
  assert(!found.rowCount, 409, 'worker_name_exists', 'Choose another Worker name.');
}
async function resolve(tx: Tx, organizationId: string, input: WorkerCreateInput) {
  const catalog = await workerOfferings(tx);
  const candidates = catalog.filter(
    (item) =>
      item.compute === (input.compute ?? 'sandbox') &&
      item.dedicated === (input.dedicated ?? false) &&
      (!(input.isolate_runs ?? true) || item.isolate_runs),
  );
  assert(
    candidates.length,
    503,
    'compute_unavailable',
    'The requested economic and isolation offering is not enabled. Inspect worker-offerings.',
  );
  const preferred = candidates.find(
    (item) =>
      (!input.region || input.region === item.region) &&
      (!input.runtime || input.runtime === item.runtime) &&
      (!input.size || input.size === item.size),
  );
  assert(
    preferred,
    400,
    'worker_configuration_unavailable',
    'No enabled offering matches this size, runtime, region and isolation combination.',
  );
  const limits = await workerPolicyLimits(tx, organizationId, catalog);
  const settings = resolveWorkerSettings(
    input,
    {
      ...limits,
      region: preferred.region,
      runtime: preferred.runtime,
      default_hourly_compute_cost_micro_usd: (
        workerHourlyExposure(preferred.price, preferred.resources) * BigInt(limits.default_max_instances)
      ).toString(),
    },
    Date.now(),
  );
  const offerings = catalog.filter((item) => workerOfferingCompatible(settings, item));
  assert(
    offerings.length,
    400,
    'worker_configuration_unavailable',
    'No enabled offering matches this size, runtime, region and isolation combination.',
  );
  validateBaseline(settings, offerings);
  return { settings, offerings };
}
function validateBaseline(settings: WorkerSettings, offerings: readonly HostOffering[]) {
  const lowest = offerings.reduce<bigint | null>((value, item) => {
    const rate = workerHourlyExposure(item.price, item.resources);
    return value === null || rate < value ? rate : value;
  }, null);
  assert(
    lowest !== null &&
      lowest * BigInt(Math.max(1, settings.min_instances)) <=
        BigInt(settings.max_hourly_compute_cost_micro_usd),
    400,
    'worker_cost_limit',
    'The spending ceiling cannot fund one matching allocation and the requested baseline.',
  );
}
type WorkerObservation = {
  counts: { ready: number; provisioning: number; draining: number; occupied_slots: number };
  active_runs: number;
  queued_runs: number;
  charged_micro_usd: string;
  reserved_micro_usd: string;
  committed_hourly_compute_cost_micro_usd: string;
};
/** One bounded batch per resource kind; listing 100 Workers must not issue 200 extra queries. */
async function workerObservations(
  tx: Tx,
  rows: readonly WorkerRow[],
): Promise<Map<string, WorkerObservation>> {
  const observations = new Map<string, WorkerObservation>(
    rows.map((row) => [
      row.id,
      {
        counts: { ready: 0, provisioning: 0, draining: 0, occupied_slots: 0 },
        active_runs: 0,
        queued_runs: 0,
        charged_micro_usd: '0',
        reserved_micro_usd: '0',
        committed_hourly_compute_cost_micro_usd: '0',
      },
    ]),
  );
  if (!rows.length) return observations;
  const ids = rows.map((row) => row.id);
  const hosts = (
    await tx.query<{
      worker_id: string;
      status: 'ready' | 'provisioning' | 'draining';
      offering: HostOffering;
      reserved_micro_usd: string;
    }>(
      "SELECT worker_id,status,offering,reserved_micro_usd FROM hosts WHERE worker_id=ANY($1::uuid[]) AND status<>'stopped'",
      [ids],
    )
  ).rows;
  for (const host of hosts) {
    const observation = observations.get(host.worker_id)!;
    observation.counts[host.status]++;
    observation.reserved_micro_usd = (
      BigInt(observation.reserved_micro_usd) + BigInt(host.reserved_micro_usd)
    ).toString();
    observation.committed_hourly_compute_cost_micro_usd = (
      BigInt(observation.committed_hourly_compute_cost_micro_usd) +
      workerHourlyExposure(host.offering.price, host.offering.resources)
    ).toString();
  }
  const occupied = (
    await tx.query<{ worker_id: string; occupied: number; active: number }>(
      `SELECT a.worker_id,count(*)::integer AS occupied,
      count(*) FILTER(WHERE r.status IN ('provisioning','running','waiting_for_input','persisting'))::integer AS active
      FROM host_runs a JOIN runs r ON r.id=a.run_id
      WHERE a.worker_id=ANY($1::uuid[]) AND a.released_at IS NULL GROUP BY a.worker_id`,
      [ids],
    )
  ).rows;
  for (const row of occupied) {
    const observation = observations.get(row.worker_id)!;
    observation.counts.occupied_slots = row.occupied;
    observation.active_runs = row.active;
  }
  const queued = (
    await tx.query<{ worker_id: string; queued: number }>(
      `SELECT config->>'worker_id' AS worker_id,count(*)::integer AS queued FROM runs
      WHERE config->>'worker_id'=ANY($1::text[]) AND status='queued' GROUP BY config->>'worker_id'`,
      [ids],
    )
  ).rows;
  for (const row of queued) observations.get(row.worker_id)!.queued_runs = row.queued;
  const costs = (
    await tx.query<{ worker_id: string; total: string }>(
      'SELECT worker_id,coalesce(sum(charged_micro_usd),0)::text AS total FROM hosts WHERE worker_id=ANY($1::uuid[]) GROUP BY worker_id',
      [ids],
    )
  ).rows;
  for (const row of costs) observations.get(row.worker_id)!.charged_micro_usd = row.total;
  return observations;
}
export async function workerObservation(tx: Tx, row: WorkerRow): Promise<WorkerObservation> {
  return (await workerObservations(tx, [row])).get(row.id)!;
}
export async function presentWorker(tx: Tx, row: WorkerRow, observed?: WorkerObservation) {
  const observation = observed ?? (await workerObservation(tx, row));
  const { expires_at_ms: _expiration, ...settings } = row.settings;
  return {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    revision: row.revision,
    ...settings,
    expires_at: row.expires_at?.toISOString() || null,
    desired_state: row.desired_state,
    status: workerObservedStatus(row, observation.counts, Date.now()),
    active_runs: observation.active_runs,
    occupied_slots: observation.counts.occupied_slots,
    queued_runs: observation.queued_runs,
    ready_instances: observation.counts.ready,
    starting_instances: observation.counts.provisioning,
    draining_instances: observation.counts.draining,
    committed_hourly_compute_cost_micro_usd: observation.committed_hourly_compute_cost_micro_usd,
    cost_micro_usd: observation.charged_micro_usd,
    reserved_micro_usd: observation.reserved_micro_usd,
    accepted_offerings: row.offerings.map(publicOffering),
    failure_code: row.failure_code,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    observed_at: new Date().toISOString(),
  };
}
export async function createWorker(tx: Tx, p: Principal, input: WorkerCreateInput) {
  authorizeWorker(p, 'workers:write');
  assert(
    !p.workerIds?.length,
    403,
    'worker_management_forbidden',
    'Creating Workers requires a credential without Worker restrictions.',
  );
  await lock(tx, `workers:${p.organizationId}`);
  const name = nameValue(input.name);
  await nameAvailable(tx, name);
  const resolved = await resolve(tx, p.organizationId, input);
  const workerId = id();
  await tx.query(
    'INSERT INTO workers(id,organization_id,name,settings,offerings,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
    [
      workerId,
      p.organizationId,
      name,
      JSON.stringify(resolved.settings),
      JSON.stringify(resolved.offerings),
      resolved.settings.expires_at_ms === null ? null : new Date(resolved.settings.expires_at_ms),
    ],
  );
  return presentWorker(tx, await getWorker(tx, workerId));
}
function settingsInput(settings: WorkerSettings): WorkerInput {
  return {
    compute: settings.compute,
    dedicated: settings.dedicated,
    isolate_runs: settings.isolate_runs,
    region: settings.region,
    runtime: settings.runtime,
    ...(settings.size ? { size: settings.size } : {}),
    ...(settings.dedicated
      ? { min_instances: settings.min_instances, max_instances: settings.max_instances ?? undefined }
      : {}),
    max_concurrency: settings.max_concurrency,
    idle_timeout_seconds: settings.idle_timeout_seconds,
    expires_at: settings.expires_at_ms === null ? null : new Date(settings.expires_at_ms).toISOString(),
    max_hourly_compute_cost_micro_usd: settings.max_hourly_compute_cost_micro_usd,
  };
}
export async function patchWorker(tx: Tx, p: Principal, workerId: string, patch: WorkerPatchInput) {
  authorizeWorker(p, 'workers:write');
  await lock(tx, `workers:${p.organizationId}`);
  await lock(tx, `worker:${workerId}`);
  const row = await getWorker(tx, workerId, p, 'workers:write');
  assert(
    row.revision === patch.expected_revision,
    409,
    'revision_conflict',
    'Refresh this Worker before applying changes.',
  );
  assert(row.desired_state !== 'destroyed', 409, 'worker_destroyed', 'A destroyed Worker cannot be changed.');
  assert(
    row.settings.expires_at_ms === null || row.settings.expires_at_ms > Date.now(),
    409,
    'worker_expired',
    'An expired Worker cannot be changed. Create a new Worker.',
  );
  const disruptive = (['compute', 'dedicated', 'isolate_runs', 'region', 'runtime', 'size'] as const).some(
    (key) => patch[key] !== undefined && patch[key] !== row.settings[key],
  );
  const observation = await workerObservation(tx, row);
  if (disruptive)
    assert(
      row.desired_state === 'paused' &&
        observation.counts.occupied_slots === 0 &&
        observation.counts.ready + observation.counts.provisioning + observation.counts.draining === 0,
      409,
      'worker_not_paused',
      'Pause and finish draining the Worker before changing its compute or security contract.',
    );
  const input = { ...settingsInput(row.settings), ...patch };
  if (!input.dedicated) {
    assert(
      patch.min_instances === undefined && patch.max_instances === undefined,
      400,
      'worker_instances_require_dedicated',
      'Instance limits apply only to dedicated Workers.',
    );
    delete input.min_instances;
    delete input.max_instances;
  }
  let settings: WorkerSettings;
  let offerings = row.offerings;
  if (disruptive) ({ settings, offerings } = await resolve(tx, p.organizationId, input));
  else {
    const limits = await workerPolicyLimits(tx, p.organizationId, await workerOfferings(tx));
    settings = resolveWorkerSettings(input, limits, Date.now());
  }
  validateBaseline(settings, offerings);
  assert(
    BigInt(settings.max_hourly_compute_cost_micro_usd) >=
      BigInt(observation.committed_hourly_compute_cost_micro_usd),
    409,
    'worker_committed_cost',
    'Pause or drain capacity before lowering the ceiling below existing obligations.',
  );
  const name = patch.name === undefined ? row.name : nameValue(patch.name);
  await nameAvailable(tx, name, workerId);
  await tx.query(
    'UPDATE workers SET name=$2,settings=$3,offerings=$4,expires_at=$5,revision=revision+1,next_check_at=now(),updated_at=now(),failure_code=NULL WHERE id=$1',
    [
      workerId,
      name,
      JSON.stringify(settings),
      JSON.stringify(offerings),
      settings.expires_at_ms === null ? null : new Date(settings.expires_at_ms),
    ],
  );
  return presentWorker(tx, await getWorker(tx, workerId));
}
export async function changeWorker(
  tx: Tx,
  p: Principal,
  workerId: string,
  action: 'pause' | 'resume' | 'destroy',
  force = false,
) {
  authorizeWorker(p, 'workers:write');
  await lock(tx, `worker:${workerId}`);
  const row = await getWorker(tx, workerId, p, 'workers:write');
  const desired = requestWorkerAction(row, action, Date.now());
  if (desired !== row.desired_state)
    await tx.query(
      'UPDATE workers SET desired_state=$2,revision=revision+1,next_check_at=now(),updated_at=now(),failure_code=NULL WHERE id=$1',
      [workerId, desired],
    );
  if (action === 'destroy' || force)
    await tx.query(
      `UPDATE runs SET cancel_requested=true WHERE config->>'worker_id'=$1 AND
      (status='queued' OR ($2 AND status IN ('provisioning','running','waiting_for_input','persisting')))`,
      [workerId, force],
    );
  return presentWorker(tx, await getWorker(tx, workerId));
}
export async function listWorkers(tx: Tx, p: Principal, query: URLSearchParams) {
  authorizeWorker(p, 'workers:read');
  const limit = Math.min(100, Math.max(1, Number(query.get('limit') || 25)));
  const rows = (
    await tx.query<WorkerRow>(
      'SELECT * FROM workers WHERE ($1::uuid IS NULL OR id<$1) AND (cardinality($3::uuid[])=0 OR id=ANY($3::uuid[])) ORDER BY id DESC LIMIT $2',
      [query.get('cursor'), limit + 1, p.workerIds || []],
    )
  ).rows;
  const selected = rows.slice(0, limit);
  const observations = await workerObservations(tx, selected);
  const data = await Promise.all(selected.map((row) => presentWorker(tx, row, observations.get(row.id))));
  return { data, next_cursor: rows.length > limit ? rows[limit - 1].id : null };
}
export async function workerForRun(tx: Tx, p: Principal, workerId: string) {
  await lock(tx, `worker:${workerId}`);
  const worker = await getWorker(tx, workerId, p, 'workers:use');
  const reason = workerAdmissionBlock(worker, Date.now());
  assert(
    !reason,
    409,
    reason || 'worker_unavailable',
    'Resume an enabled, unexpired Worker or choose another Worker.',
  );
  await tx.query('UPDATE workers SET next_check_at=now() WHERE id=$1', [workerId]);
  return worker;
}
