import { assert } from './errors';
import { workerMicroBudget } from './worker-pricing';
import type {
  ComputeOffering,
  WorkerDesiredState,
  WorkerIdentity,
  WorkerInput,
  WorkerPolicyLimits,
  WorkerSettings,
  WorkerWaitReason,
} from './worker-types';

function integer(value: number, lower: number, upper: number, field: string): number {
  assert(
    Number.isSafeInteger(value) && value >= lower && value <= upper,
    400,
    'invalid_worker_setting',
    `${field} must be an integer between ${lower} and ${upper}.`,
    { field, minimum: lower, maximum: upper },
  );
  return value;
}
function selector(value: string, field: string): string {
  assert(
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,159}$/.test(value),
    400,
    'invalid_worker_setting',
    `Provide a supported ${field} identifier.`,
    { field },
  );
  return value;
}
export function resolveWorkerSettings(
  input: WorkerInput,
  limits: WorkerPolicyLimits,
  nowMs: number,
): WorkerSettings {
  assert(
    Number.isFinite(nowMs) &&
      Number.isSafeInteger(limits.max_instances) &&
      limits.max_instances >= 1 &&
      Number.isSafeInteger(limits.default_max_instances) &&
      limits.default_max_instances >= 1 &&
      limits.default_max_instances <= limits.max_instances &&
      Number.isSafeInteger(limits.max_concurrency) &&
      limits.max_concurrency >= 1 &&
      Number.isSafeInteger(limits.default_max_concurrency) &&
      limits.default_max_concurrency >= 1 &&
      limits.default_max_concurrency <= limits.max_concurrency,
    500,
    'invalid_worker_policy',
    'The deployment has invalid Worker limits.',
  );
  const compute = input.compute ?? 'sandbox';
  const dedicated = input.dedicated ?? false;
  const isolateRuns = input.isolate_runs ?? true;
  assert(
    compute === 'server' || compute === 'sandbox',
    400,
    'invalid_worker_setting',
    'Choose server or sandbox compute.',
  );
  assert(
    typeof dedicated === 'boolean' && typeof isolateRuns === 'boolean',
    400,
    'invalid_worker_setting',
    'dedicated and isolate_runs must be booleans.',
  );
  assert(
    dedicated || (input.min_instances === undefined && input.max_instances === undefined),
    400,
    'worker_instances_require_dedicated',
    'Instance limits apply only to dedicated Workers.',
  );
  const maximum = dedicated
    ? integer(input.max_instances ?? limits.default_max_instances, 1, limits.max_instances, 'max_instances')
    : null;
  const minimum = dedicated ? integer(input.min_instances ?? 0, 0, maximum ?? 0, 'min_instances') : 0;
  const idleTimeout = input.idle_timeout_seconds === undefined ? 300 : input.idle_timeout_seconds;
  if (idleTimeout !== null) integer(idleTimeout, 0, 86400, 'idle_timeout_seconds');
  assert(
    dedicated || idleTimeout !== null,
    400,
    'invalid_worker_setting',
    'Pooled allocations need finite idle retention.',
  );
  let expiration: number | null = null;
  if (input.expires_at !== undefined && input.expires_at !== null) {
    expiration = Date.parse(input.expires_at);
    assert(
      typeof input.expires_at === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.expires_at) &&
        Number.isFinite(expiration) &&
        expiration > nowMs &&
        new Date(expiration).toISOString().replace(/\.\d{3}Z$/, 'Z') ===
          input.expires_at.replace(/\.\d{1,3}Z$/, 'Z'),
      400,
      'invalid_worker_expiration',
      'expires_at must be a valid future UTC timestamp.',
    );
  }
  return {
    compute,
    dedicated,
    isolate_runs: isolateRuns,
    region: selector(input.region ?? limits.region, 'region'),
    runtime: selector(input.runtime ?? limits.runtime, 'runtime'),
    size: input.size == null ? null : selector(input.size, 'size'),
    min_instances: minimum,
    max_instances: maximum,
    max_concurrency: integer(
      input.max_concurrency ?? limits.default_max_concurrency,
      1,
      limits.max_concurrency,
      'max_concurrency',
    ),
    idle_timeout_seconds: idleTimeout,
    expires_at_ms: expiration,
    max_hourly_compute_cost_micro_usd: workerMicroBudget(
      input.max_hourly_compute_cost_micro_usd ?? limits.default_hourly_compute_cost_micro_usd,
    ).toString(),
  };
}
export function workerOfferingCompatible(settings: WorkerSettings, offering: ComputeOffering): boolean {
  return (
    settings.compute === offering.compute &&
    settings.dedicated === offering.dedicated &&
    (!settings.isolate_runs || offering.isolate_runs) &&
    settings.runtime === offering.runtime &&
    settings.region === offering.region &&
    (settings.size === null || settings.size === offering.size)
  );
}
export function workerAdmissionBlock(worker: WorkerIdentity, nowMs: number): WorkerWaitReason | null {
  if (worker.desired_state === 'destroyed') return 'worker_destroyed';
  if (worker.settings.expires_at_ms !== null && worker.settings.expires_at_ms <= nowMs)
    return 'worker_expired';
  if (worker.desired_state === 'paused') return 'worker_paused';
  return null;
}
export function requestWorkerAction(
  worker: WorkerIdentity,
  action: 'pause' | 'resume' | 'destroy',
  nowMs: number,
): WorkerDesiredState {
  assert(
    action === 'pause' || action === 'resume' || action === 'destroy',
    400,
    'invalid_worker_action',
    'Choose pause, resume, or destroy.',
  );
  if (action === 'destroy') return 'destroyed';
  assert(
    worker.desired_state !== 'destroyed',
    409,
    'worker_destroyed',
    'A destroyed Worker cannot be resumed or paused.',
  );
  if (action === 'pause') return 'paused';
  assert(
    worker.settings.expires_at_ms === null || worker.settings.expires_at_ms > nowMs,
    409,
    'worker_expired',
    'Create a new Worker; this Worker has expired.',
  );
  return 'enabled';
}
export type WorkerObservedStatus =
  'sleeping' | 'starting' | 'ready' | 'draining' | 'paused' | 'destroyed' | 'expired';
export function workerObservedStatus(
  worker: WorkerIdentity,
  counts: Readonly<{ ready: number; provisioning: number; draining: number; occupied_slots: number }>,
  nowMs: number,
): WorkerObservedStatus {
  for (const value of Object.values(counts))
    assert(
      Number.isSafeInteger(value) && value >= 0,
      500,
      'invalid_worker_observation',
      'Worker observations must be nonnegative counts.',
    );
  const block = workerAdmissionBlock(worker, nowMs);
  const hasLiveWork = counts.ready + counts.provisioning + counts.draining + counts.occupied_slots > 0;
  if (block) {
    if (hasLiveWork) return 'draining';
    return block === 'worker_destroyed' ? 'destroyed' : block === 'worker_expired' ? 'expired' : 'paused';
  }
  if (counts.ready > 0) return 'ready';
  if (counts.provisioning > 0) return 'starting';
  if (counts.draining > 0 || counts.occupied_slots > 0) return 'draining';
  return worker.settings.min_instances > 0 ? 'starting' : 'sleeping';
}
