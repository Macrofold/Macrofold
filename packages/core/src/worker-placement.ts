import { workerAdmissionBlock, workerOfferingCompatible } from './worker-policy';
import { workerHourlyExposure, validateWorkerResources } from './worker-pricing';
import type { ComputeOffering, HostSnapshot, RunDemand, WorkerIdentity, WorkerPlacement } from './worker-types';

/** Kernel/controller headroom is not sold as application memory. */
export const hostMemoryHeadroom = (memoryMiB: number) => Math.min(512, Math.ceil(memoryMiB / 8));
export function offeringFits(offering: ComputeOffering, demand: RunDemand): boolean {
  return demand.resources.memory_mib <= offering.resources.memory_mib - hostMemoryHeadroom(offering.resources.memory_mib) &&
    demand.resources.cpu_millis <= offering.resources.cpu_millis &&
    (offering.max_host_lifetime_seconds === null || offering.max_host_lifetime_seconds >= demand.execution_seconds + demand.cleanup_seconds);
}
export function workerCommittedRate(hosts: readonly HostSnapshot[]): bigint {
  return hosts.filter(host => host.status !== 'stopped').reduce((sum, host) =>
    sum + workerHourlyExposure(host.offering.price, host.offering.resources), 0n);
}
function reuseKind(host: HostSnapshot, demand: RunDemand): 'warm' | 'files' | 'cold' {
  const files = demand.worktree !== null && host.worktrees.some(cache =>
    cache.state === 'clean' && cache.worktree_id === demand.worktree?.id && cache.revision === demand.worktree.revision &&
    cache.permission_view === demand.permission_view);
  const warm = files && demand.session !== null && host.warm_harnesses.some(handle =>
    handle.state === 'idle' && handle.session_id === demand.session?.id && handle.session_revision === demand.session.revision &&
    handle.permission_view === demand.permission_view && handle.compatibility_key === demand.compatibility_key &&
    handle.worktree_id === demand.worktree?.id && handle.worktree_revision === demand.worktree?.revision);
  return warm ? 'warm' : files ? 'files' : 'cold';
}
/** Returns a hint from trusted bounded observations. The caller must claim it under SQL locks. */
export function chooseWorkerPlacement(worker: WorkerIdentity, demand: RunDemand, hosts: readonly HostSnapshot[],
  offerings: readonly ComputeOffering[], nowMs: number): WorkerPlacement {
  validateWorkerResources(demand.resources);
  const block = workerAdmissionBlock(worker, nowMs);
  if (block) return { action: 'wait', reason: block };
  if (!Number.isSafeInteger(demand.execution_seconds) || demand.execution_seconds < 1 ||
      !Number.isSafeInteger(demand.cleanup_seconds) || demand.cleanup_seconds < 0) return { action: 'wait', reason: 'worker_lifetime' };
  const end = nowMs + (demand.execution_seconds + demand.cleanup_seconds) * 1000;
  if (worker.settings.expires_at_ms !== null && worker.settings.expires_at_ms < end)
    return { action: 'wait', reason: 'worker_lifetime' };
  const owned = hosts.filter(host => host.worker_id === worker.id && host.organization_id === worker.organization_id);
  const live = owned.filter(host => host.status !== 'stopped');
  if (live.reduce((sum, host) => sum + host.occupied_slots, 0) >= worker.settings.max_concurrency)
    return { action: 'wait', reason: 'worker_concurrency' };
  const compatible = live.filter(host => workerOfferingCompatible(worker.settings, host.offering) && offeringFits(host.offering, demand));
  const available = compatible.filter(host => host.status === 'ready' && host.generation > 0 &&
    (host.expires_at_ms === null || host.expires_at_ms >= end) && host.occupied_slots < host.offering.concurrency &&
    host.allocated.memory_mib + demand.resources.memory_mib <= host.offering.resources.memory_mib - hostMemoryHeadroom(host.offering.resources.memory_mib) &&
    host.allocated.cpu_millis + demand.resources.cpu_millis <= host.offering.resources.cpu_millis);
  // Idle handles are evictable; runtime preparation rechecks memory before launching a new process.
  const rank = { warm: 0, files: 1, cold: 2 };
  available.sort((a, b) => rank[reuseKind(a, demand)] - rank[reuseKind(b, demand)] || b.occupied_slots - a.occupied_slots || a.id.localeCompare(b.id));
  if (available[0]) return { action: 'place', host_id: available[0].id, host_generation: available[0].generation,
    reuse: reuseKind(available[0], demand) };
  if (compatible.some(host => host.status === 'provisioning')) return { action: 'wait', reason: 'worker_starting' };
  const maximum = worker.settings.max_instances ?? worker.settings.max_concurrency;
  if (live.length >= maximum) return { action: 'wait', reason: 'worker_instance_limit' };
  const fitting = offerings.filter(offering => workerOfferingCompatible(worker.settings, offering) && offeringFits(offering, demand));
  fitting.sort((a,b) => {
    const difference = workerHourlyExposure(a.price,a.resources) - workerHourlyExposure(b.price,b.resources);
    return difference < 0n ? -1 : difference > 0n ? 1 : a.resources.memory_mib - b.resources.memory_mib || b.concurrency-a.concurrency || a.id.localeCompare(b.id);
  });
  const chosen = fitting[0];
  if (!chosen) return { action: 'wait', reason: 'compute_unavailable' };
  if (workerCommittedRate(owned) + workerHourlyExposure(chosen.price, chosen.resources) > BigInt(worker.settings.max_hourly_compute_cost_micro_usd))
    return { action: 'wait', reason: 'worker_cost_limit' };
  return { action: 'provision', offering: chosen };
}
