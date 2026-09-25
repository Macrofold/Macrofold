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
    expect(plan.replace_idle_host_id).toBeNull();
  });
  it('does not provision a baseline at the Worker expiration boundary', () => {
    const plan = planWorkerCapacity(worker({ min_instances: 1, expires_at_ms: now }), [demand()], [], [small], now);
    expect(plan.provision).toEqual([]);
    expect(plan.fund.size).toBe(0);
  });
  it('counts starting capacity without either duplicating it or hiding excess queued demand', () => {
    const starting = host({ status: 'provisioning', billable: false });
    const first = planWorkerCapacity(worker(), [demand()], [starting], [small], now);
    expect(first.provision).toEqual([]);
    expect(first.fund.get(starting.id)).toBe(600);
    const excess = planWorkerCapacity(worker(), [demand(), demand({ run_id: 'run-b' })], [starting], [small], now);
    expect(excess.provision).toEqual([{ offering: small, execution_seconds: 600 }]);
    expect(excess.fund.get(starting.id)).toBe(600);
  });
  it('reserves projected CPU as well as memory across queued Runs', () => {
    const cpuHeavy = demand({ resources: { memory_mib: 256, cpu_millis: 750 } });
    const plan = planWorkerCapacity(worker(), [cpuHeavy, { ...cpuHeavy, run_id: 'run-b' }], [host()], [small], now);
    expect(plan.fund.size).toBe(1);
    expect(plan.provision).toHaveLength(1);
  });
  it('holds Worker concurrency through cleanup even when execution memory has been released', () => {
    const plan = planWorkerCapacity(worker({ max_concurrency: 1 }), [demand()], [host({ occupied_slots: 1 })], [small], now);
    expect(plan.provision).toEqual([]);
    expect(plan.fund.size).toBe(0);
    expect(plan.replace_idle_host_id).toBeNull();
  });
  it.each([
    { max_instances: 2 }, { max_concurrency: 2 }, { max_hourly_compute_cost_micro_usd: '2000000' },
  ])('honors aggregate limits while simulating queued placements: %j', settings => {
    const demands = Array.from({ length: 8 }, (_, index) => demand({ run_id: `run-${index}` }));
    expect(planWorkerCapacity(worker(settings), demands, [], [small], now).provision).toHaveLength(2);
  });
  it('adds at most four allocations in one reconciliation pass', () => {
    const demands = Array.from({ length: 20 }, (_, index) => demand({ run_id: `run-${index}` }));
    expect(planWorkerCapacity(worker(), demands, [], [small], now).provision).toHaveLength(4);
  });
  it('bounds the queue projection to 32 demands', () => {
    const quote = { ...large, concurrency: 64 };
    const demands = Array.from({ length: 33 }, (_, index) => demand({ run_id: `run-${index}`,
      resources: { memory_mib: 1, cpu_millis: 1 }, execution_seconds: index === 32 ? 5000 : 600 }));
    expect(planWorkerCapacity(worker({ max_concurrency: 64 }), demands, [], [quote], now).provision)
      .toEqual([{ offering: quote, execution_seconds: 600 }]);
  });
  it('funds the longest projected turn on a Host rather than adding simultaneous durations', () => {
    const demands = [300, 900, 600].map((seconds, index) => demand({ run_id: `run-${index}`,
      execution_seconds: seconds, resources: { memory_mib: 512, cpu_millis: 250 } }));
    expect(planWorkerCapacity(worker(), demands, [host()], [small], now).fund.get('host-a')).toBe(900);
    expect(planWorkerCapacity(worker(), demands, [], [small], now).provision)
      .toEqual([{ offering: small, execution_seconds: 900 }]);
  });
  it('does not mutate existing Host resource or slot observations during projection', () => {
    const existing = host();
    const before = structuredClone(existing);
    Object.freeze(existing.allocated);
    Object.freeze(existing);
    planWorkerCapacity(worker(), [demand(), demand({ run_id: 'run-b' })], [existing], [small], now);
    expect(existing).toEqual(before);
  });
});

describe('idle capacity replacement', () => {
  it('replaces an undersized single-instance baseline without counting its release as free capacity', () => {
    const target = worker({ min_instances: 1, max_instances: 1 });
    const plan = planWorkerCapacity(target, [largeDemand], [host()], [small, large], now);
    expect(plan.replace_idle_host_id).toBe('host-a');
    expect(plan.provision).toEqual([]);
    expect(plan.fund.size).toBe(0);
    const stopping = planWorkerCapacity(target, [largeDemand], [host({ status: 'draining' })], [small, large], now);
    expect(stopping.provision).toEqual([]);
    expect(stopping.replace_idle_host_id).toBeNull();
    const stopped = planWorkerCapacity(target, [largeDemand], [host({ status: 'stopped' })], [small, large], now);
    expect(stopped.provision).toEqual([{ offering: large, execution_seconds: 600 }]);
  });
  it('can release an idle allocation blocking the exact accepted rate ceiling', () => {
    const plan = planWorkerCapacity(worker({ max_hourly_compute_cost_micro_usd: '2000000' }), [largeDemand], [host()], [small, large], now);
    expect(plan.replace_idle_host_id).toBe('host-a');
    expect(plan.provision).toEqual([]);
  });
  it.each([
    { occupied_slots: 1 }, { allocated: { memory_mib: 1, cpu_millis: 0 } },
    { allocated: { memory_mib: 0, cpu_millis: 1 } }, { status: 'provisioning' as const }, { generation: 0 },
  ])('does not replace capacity with ownership or unconfirmed readiness: %j', patch => {
    const plan = planWorkerCapacity(worker({ max_instances: 1 }), [largeDemand], [host(patch)], [small, large], now);
    expect(plan.replace_idle_host_id).toBeNull();
  });
  it('does not evict capacity needed by a later independent eligible Run', () => {
    const plan = planWorkerCapacity(worker({ max_instances: 1 }), [largeDemand, demand({ run_id: 'run-b' })], [host()], [small, large], now);
    expect(plan.fund.get('host-a')).toBe(600);
    expect(plan.replace_idle_host_id).toBeNull();
  });
  it('does not evict if no replacement fits the accepted shape or rate', () => {
    expect(planWorkerCapacity(worker({ max_instances: 1, size: 'small' }), [largeDemand], [host()], [small, large], now).replace_idle_host_id).toBeNull();
    expect(planWorkerCapacity(worker({ max_instances: 1, max_hourly_compute_cost_micro_usd: '1999999' }),
      [largeDemand], [host()], [small, large], now).replace_idle_host_id).toBeNull();
    expect(planWorkerCapacity(worker({ max_instances: 1 }), [largeDemand], [host()], [small], now).replace_idle_host_id).toBeNull();
  });
  it('does not sacrifice idle capacity for work that cannot finish before expiration', () => {
    const target = worker({ max_instances: 1, expires_at_ms: now + 600000 });
    expect(planWorkerCapacity(target, [largeDemand], [host()], [small, large], now).replace_idle_host_id).toBeNull();
  });
  it.each(['active', 'recovery_required'] as const)('preserves %s materializations instead of using them for demand replacement', state => {
    const existing = host({ worktrees: [{ worktree_id: 'files-a', revision: 'r1', permission_view: 'view-a', state }] });
    expect(planWorkerCapacity(worker({ max_instances: 1 }), [largeDemand], [existing], [small, large], now).replace_idle_host_id).toBeNull();
  });
  it('keeps a leased warm handle even if its slot observation is absent', () => {
    const existing = host({ warm_harnesses: [{ session_id: 'session-a', session_revision: 's1', compatibility_key: 'harness-a',
      permission_view: 'view-a', worktree_id: null, worktree_revision: null, state: 'leased', reserved_memory_mib: 512 }] });
    expect(planWorkerCapacity(worker({ max_instances: 1 }), [largeDemand], [existing], [small, large], now).replace_idle_host_id).toBeNull();
  });
  it('waits rather than discarding multiple allocations for an unproven multi-Host replacement', () => {
    const hosts = [host(), host({ id: 'host-b' })];
    const plan = planWorkerCapacity(worker({ max_instances: 2, max_hourly_compute_cost_micro_usd: '2000000' }),
      [largeDemand], hosts, [small, large], now);
    expect(plan.replace_idle_host_id).toBeNull();
    expect(plan.provision).toEqual([]);
  });
});
