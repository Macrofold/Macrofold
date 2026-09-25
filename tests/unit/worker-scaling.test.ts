import { describe, expect, it } from 'vitest';
import { planWorkerCapacity } from '../../packages/core/src/worker-scaling';
import type { ComputeOffering, HostSnapshot, RunDemand, WorkerIdentity, WorkerSettings } from '../../packages/core/src/worker-types';

const now = Date.parse('2026-09-01T00:00:00Z');
const small: ComputeOffering = {
  id: 'small', revision: 'quote-1', compute: 'server', dedicated: true, isolate_runs: false,
  region: 'local', runtime: 'managed-1', size: 'small', resources: { memory_mib: 2048, cpu_millis: 1000 },
  concurrency: 4, max_host_lifetime_seconds: null, price: { kind: 'allocation', hourly_micro_usd: '1000000' },
};
const large: ComputeOffering = {
  ...small, id: 'large', size: 'large', resources: { memory_mib: 8192, cpu_millis: 4000 },
  price: { kind: 'allocation', hourly_micro_usd: '2000000' },
};
function worker(settings: Partial<WorkerSettings> = {}): WorkerIdentity {
  return { id: 'worker-a', organization_id: 'org-a', desired_state: 'enabled', settings: {
    compute: 'server', dedicated: true, isolate_runs: false, region: 'local', runtime: 'managed-1', size: null,
    min_instances: 0, max_instances: 8, max_concurrency: 32, idle_timeout_seconds: 300,
    expires_at_ms: null, max_hourly_compute_cost_micro_usd: '10000000', ...settings,
  } };
}
function demand(patch: Partial<RunDemand> = {}): RunDemand {
  return { run_id: 'run-a', resources: { memory_mib: 1024, cpu_millis: 250 }, execution_seconds: 600,
    cleanup_seconds: 180, worktree: null, session: null, permission_view: 'view-a', compatibility_key: 'harness-a', ...patch };
}
function host(patch: Partial<HostSnapshot> = {}): HostSnapshot {
  return { id: 'host-a', worker_id: 'worker-a', organization_id: 'org-a', generation: 1, status: 'ready',
    billable: true, offering: small, occupied_slots: 0, allocated: { memory_mib: 0, cpu_millis: 0 },
    retained_memory_mib: 0, expires_at_ms: null, worktrees: [], warm_harnesses: [], ...patch };
}
const largeDemand = demand({ resources: { memory_mib: 4096, cpu_millis: 1000 } });

describe('queued Worker capacity planning', () => {
  it('uses a demand-sized Host for a single-instance baseline instead of buying an unusable cheap Host', () => {
    const plan = planWorkerCapacity(worker({ min_instances: 1, max_instances: 1 }), [largeDemand], [], [small, large], now);
    expect(plan.provision).toEqual([{ offering: large, execution_seconds: 600 }]);
    expect(plan.fund.size).toBe(0);
  });
  it('does not spend the rate ceiling on a cheap baseline before an affordable larger demand', () => {
    const plan = planWorkerCapacity(worker({ min_instances: 1, max_hourly_compute_cost_micro_usd: '2000000' }),
      [largeDemand], [], [small, large], now);
    expect(plan.provision).toEqual([{ offering: large, execution_seconds: 600 }]);
  });
  it('fills only the remaining baseline after demand-sized provisioning', () => {
    const plan = planWorkerCapacity(worker({ min_instances: 2 }), [largeDemand], [], [small, large], now);
    expect(plan.provision).toEqual([
      { offering: large, execution_seconds: 600 }, { offering: small, execution_seconds: 900 },
    ]);
  });
  it('still buys the economical baseline without queued demand and sleeps when the minimum is zero', () => {
    expect(planWorkerCapacity(worker({ min_instances: 1 }), [], [], [large, small], now).provision)
      .toEqual([{ offering: small, execution_seconds: 900 }]);
    expect(planWorkerCapacity(worker(), [], [], [small, large], now).provision).toEqual([]);
  });
  it.each(['paused', 'destroyed'] as const)('does not provision or extend funding for a %s Worker', desired_state => {
    const plan = planWorkerCapacity({ ...worker({ min_instances: 2 }), desired_state }, [demand()], [host()], [small], now);
    expect(plan.provision).toEqual([]);
    expect(plan.fund.size).toBe(0);
  });
  it('does not provision a baseline at the Worker expiration boundary', () => {
    const plan = planWorkerCapacity(worker({ min_instances: 1, expires_at_ms: now }), [demand()], [], [small], now);
    expect(plan.provision).toEqual([]);
    expect(plan.fund.size).toBe(0);
  });
});
