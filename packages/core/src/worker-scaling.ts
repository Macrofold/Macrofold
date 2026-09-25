import { chooseWorkerPlacement, workerCommittedRate } from './worker-placement';
import { workerAdmissionBlock, workerOfferingCompatible } from './worker-policy';
import { workerHourlyExposure } from './worker-pricing';
import type { ComputeOffering, HostSnapshot, RunDemand, WorkerIdentity } from './worker-types';

export type CapacityPlan = {
  provision: { offering: ComputeOffering; execution_seconds: number }[];
  fund: Map<string, number>;
  replace_idle_host_id: string | null;
};
/** Estimate bounded queued demand, not future traffic. Simulated slots prevent
 * every queued Run from counting the same free memory. SQL remains authoritative. */
export function planWorkerCapacity(worker: WorkerIdentity, demands: readonly RunDemand[],
  hosts: readonly HostSnapshot[], offerings: readonly ComputeOffering[], nowMs: number): CapacityPlan {
  const plan: CapacityPlan = { provision: [], fund: new Map(), replace_idle_host_id: null };
  if (workerAdmissionBlock(worker, nowMs)) return plan;
  const projected: HostSnapshot[] = hosts.map(host => ({ ...host,
    // Starting capacity already counts toward expected supply; never create its duplicate.
    status: host.status === 'provisioning' ? 'ready' : host.status, allocated: { ...host.allocated } }));
  const quotes = offerings.filter(quote => workerOfferingCompatible(worker.settings, quote)).sort((a, b) => {
    const delta = workerHourlyExposure(a.price, a.resources) - workerHourlyExposure(b.price, b.resources);
    return delta < 0n ? -1 : delta > 0n ? 1 : a.resources.memory_mib - b.resources.memory_mib || b.concurrency - a.concurrency;
  });
  function add(offering: ComputeOffering, executionSeconds: number) {
    if (plan.provision.length >= 4 || projected.filter(host => host.status !== 'stopped').length >=
      (worker.settings.max_instances ?? worker.settings.max_concurrency) ||
      workerCommittedRate(projected) + workerHourlyExposure(offering.price, offering.resources) >
      BigInt(worker.settings.max_hourly_compute_cost_micro_usd)) return undefined;
    const index = plan.provision.length;
    plan.provision.push({ offering, execution_seconds: executionSeconds });
    const host: HostSnapshot = { id: `planned:${index}`, worker_id: worker.id, organization_id: worker.organization_id,
      generation: 1, status: 'ready', billable: false, offering, occupied_slots: 0,
      allocated: { memory_mib: 0, cpu_millis: 0 }, retained_memory_mib: 0,
      expires_at_ms: offering.max_host_lifetime_seconds === null ? null : nowMs + offering.max_host_lifetime_seconds * 1000,
      worktrees: [], warm_harnesses: [] };
    projected.push(host);
    return host;
  }
  const waiting: RunDemand[] = [];
  for (const demand of demands.slice(0, 32)) {
    const placement = chooseWorkerPlacement(worker, demand, projected, offerings, nowMs);
    const selected = placement.action === 'place' ? projected.find(host => host.id === placement.host_id) :
      placement.action === 'provision' ? add(placement.offering, demand.execution_seconds) : undefined;
    if (!selected) { waiting.push(demand); continue; }
    projected[projected.indexOf(selected)] = { ...selected, occupied_slots: selected.occupied_slots + 1,
      allocated: { memory_mib: selected.allocated.memory_mib + demand.resources.memory_mib,
        cpu_millis: selected.allocated.cpu_millis + demand.resources.cpu_millis } };
    if (selected.id.startsWith('planned:')) {
      const item = plan.provision[Number(selected.id.slice(8))];
      item.execution_seconds = Math.max(item.execution_seconds, demand.execution_seconds);
    } else plan.fund.set(selected.id, Math.max(plan.fund.get(selected.id) || 0, demand.execution_seconds));
  }
  // A queued Run must not pin unusable idle capacity forever at an instance/rate
  // limit. Only retire an existing idle Host when its confirmed release would
  // permit an accepted replacement. Never project the release as free capacity
  // in this plan: failed/uncertain stops still carry their full liability.
  const readyIds = new Set(hosts.filter(host => host.status === 'ready').map(host => host.id));
  const removable = projected.filter(host => readyIds.has(host.id) && host.generation > 0 &&
    host.occupied_slots === 0 && host.allocated.memory_mib === 0 && host.allocated.cpu_millis === 0 &&
    host.worktrees.every(cache => cache.state === 'clean') && host.warm_harnesses.every(handle => handle.state === 'idle'));
  for (const demand of waiting) {
    const blocked = chooseWorkerPlacement(worker, demand, projected, offerings, nowMs);
    if (blocked.action !== 'wait' || !['worker_instance_limit', 'worker_cost_limit'].includes(blocked.reason)) continue;
    const candidate = removable.find(host => chooseWorkerPlacement(worker, demand,
      projected.filter(item => item.id !== host.id), offerings, nowMs).action === 'provision');
    if (candidate) {
      plan.replace_idle_host_id = candidate.id;
      // Do not refill a cheap baseline in the same pass as retiring it. Demand
      // sizing runs first again after the provider confirms the old Host stopped.
      return plan;
    }
  }
  // Demand-sized Hosts also satisfy the baseline. Buying the cheapest baseline
  // first can consume the only instance/rate slot with a shape no queued Run fits.
  while (quotes[0] && projected.filter(host => host.status === 'ready').length < worker.settings.min_instances)
    if (!add(quotes[0], 900)) break;
  return plan;
}
