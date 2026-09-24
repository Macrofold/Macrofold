from pathlib import Path
edits={}
def read(p):return edits.get(p,Path(p).read_text())
def replace(p,a,b,count=1):
 s=read(p)
 if s.count(a)!=count:raise RuntimeError(f'{p}: changed anchor {a[:100]} ({s.count(a)}/{count})')
 edits[p]=s.replace(a,b)

p='scripts/build-runtime.ts';s=read(p)
for line in s.splitlines(True):
 if '/sandbox-control' in line:s=s.replace(line,'')
edits[p]=s

edits['packages/core/src/worker-scaling.ts']='''import { chooseWorkerPlacement, workerCommittedRate } from './worker-placement';
import { workerOfferingCompatible } from './worker-policy';
import { workerHourlyExposure } from './worker-pricing';
import type { ComputeOffering, HostSnapshot, RunDemand, WorkerIdentity } from './worker-types';

export type CapacityPlan = {
  provision: { offering: ComputeOffering; execution_seconds: number }[];
  fund: Map<string, number>;
};
/** Estimate bounded queued demand, not future traffic. Simulated slots prevent
 * every queued Run from counting the same free memory. SQL remains authoritative. */
export function planWorkerCapacity(worker: WorkerIdentity, demands: readonly RunDemand[],
  hosts: readonly HostSnapshot[], offerings: readonly ComputeOffering[], nowMs: number): CapacityPlan {
  const plan: CapacityPlan = { provision: [], fund: new Map() };
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
  while (quotes[0] && projected.filter(host => host.status === 'ready').length < worker.settings.min_instances)
    if (!add(quotes[0], 900)) break;
  for (const demand of demands.slice(0, 32)) {
    const placement = chooseWorkerPlacement(worker, demand, projected, offerings, nowMs);
    const selected = placement.action === 'place' ? projected.find(host => host.id === placement.host_id) :
      placement.action === 'provision' ? add(placement.offering, demand.execution_seconds) : undefined;
    if (!selected) continue;
    projected[projected.indexOf(selected)] = { ...selected, occupied_slots: selected.occupied_slots + 1,
      allocated: { memory_mib: selected.allocated.memory_mib + demand.resources.memory_mib,
        cpu_millis: selected.allocated.cpu_millis + demand.resources.cpu_millis } };
    if (selected.id.startsWith('planned:')) {
      const item = plan.provision[Number(selected.id.slice(8))];
      item.execution_seconds = Math.max(item.execution_seconds, demand.execution_seconds);
    } else plan.fund.set(selected.id, Math.max(plan.fund.get(selected.id) || 0, demand.execution_seconds));
  }
  return plan;
}
'''
p='packages/core/src/worker-reconciler.ts'
replace(p,"  runDemand, type HostRow, HOST_CLEANUP_SECONDS }", "  defaultRunResources, type HostRow, HOST_CLEANUP_SECONDS }")
replace(p,"import { chooseWorkerPlacement } from './worker-placement';", "import { planWorkerCapacity } from './worker-scaling';\nimport type { RunDemand } from './worker-types';")
replace(p,"import { workerAdmissionBlock, workerOfferingCompatible }", "import { workerAdmissionBlock }")
replace(p,"import { workerHourlyExposure, type ComputeMeters }", "import { type ComputeMeters }")
replace(p,"import { getNativeRun, type NativeRunRow }", "import { type NativeRunRow }")
replace(p,"const rows = (await tx.query<{ id: string }>(`SELECT r.id FROM runs r", "const rows = (await tx.query<NativeRunRow>(`SELECT r.* FROM runs r")
replace(p,"  const runs: NativeRunRow[] = [];\n  for (const row of rows) runs.push(await getNativeRun(tx,row.id));\n  return runs;", "  return rows;")
s=read(p);a=s.index('      const quotes = worker.offerings.filter(');b=s.index('      let remaining = serving.length;',a)
edits[p]=s[:a]+'''      const serving = snapshots.filter(host => host.status === 'ready' || host.status === 'provisioning');
      const readyDemand = await queuedDemand(tx, worker);
      // Scaling needs frozen resource needs, not full filesystem manifests or native
      // continuation data. Actual admission builds and rechecks the authorized view.
      const demands: RunDemand[] = readyDemand.map(run => ({ run_id: run.id,
        resources: run.config.worker_resources || defaultRunResources,
        execution_seconds: run.config.limits?.timeout_seconds || 900, cleanup_seconds: HOST_CLEANUP_SECONDS,
        worktree: null, session: null, permission_view: '', compatibility_key: '' }));
      const plan = planWorkerCapacity(worker, demands, snapshots, worker.offerings, Date.now());
      for (const item of plan.provision) {
        const quote = worker.offerings.find(offer => offer.id === item.offering.id && offer.revision === item.offering.revision);
        assert(quote, 500, 'worker_quote_missing', 'The accepted compute quote is unavailable.');
        try { hosts.push(await reserveHost(tx, worker, quote, item.execution_seconds)); }
        catch (error) {
          if (!(error instanceof AppError) || ![402,409].includes(error.status)) throw error;
          await tx.query('UPDATE workers SET failure_code=$2 WHERE id=$1', [workerId,error.code]);
          break;
        }
      }
      for (const [hostId, seconds] of plan.fund) {
        const selected = hosts.find(host => host.id === hostId);
        if (!selected) continue;
        try { await extendHostFunding(tx, selected, new Date(Date.now() + (seconds + HOST_CLEANUP_SECONDS + 120) * 1000)); }
        catch (error) {
          if (!(error instanceof AppError) || error.status !== 402) throw error;
          await tx.query('UPDATE workers SET failure_code=$2 WHERE id=$1', [workerId,error.code]);
        }
      }
''' +s[b:]
p='packages/core/src/host-allocations.ts'
replace(p,"harness: run.config.harness, model: run.config.model, instructions: run.config.instructions,", "harness: run.config.harness, model: run.config.model, instructions: run.config.instructions,\n      model_parameters: run.config.model_parameters, harness_prompt_mode: run.config.harness_prompt_mode,")

p='scripts/workers/stress.ts'
replace(p,"import { spawn } from 'node:child_process';", "import { spawn, execFileSync } from 'node:child_process';")
replace(p,'await sleep(500);','await sleep(2000);')
s=read(p);a=s.index('    while (remaining.size) {');b=s.index('    const terminal = ',a)
edits[p]=s[:a]+'''    const inFlight = new Map<string, Promise<void>>();
    const retryAt = new Map<string, number>();
    let executionError: unknown;
    let reconcileAt = 0;
    try {
      while (remaining.size) {
        if (executionError) throw executionError;
        if (Date.now() > deadline || stats.rounds++ > 2400) throw new Error(`Workload did not drain: ${remaining.size} Runs remain.`);
        if (Date.now() >= reconcileAt) { await reconcileWorker(org, worker.id); reconcileAt = Date.now() + 500; }
        // Refill as soon as a task finishes or defers. A batch barrier would make
        // scheduler fairness, rather than resource capacity, determine the offered load.
        for (const runId of remaining) {
          if (inFlight.size >= 32) break;
          if (inFlight.has(runId) || (retryAt.get(runId) || 0) > Date.now()) continue;
          const task = executeRun(org, runId, syntheticExecution).then(done => {
            if (done) { remaining.delete(runId); stats.completed_runs++; }
            else { stats.scheduling_deferrals++; retryAt.set(runId, Date.now() + 150); }
          }).catch(error => { executionError ??= error; }).finally(() => { inFlight.delete(runId); });
          inFlight.set(runId, task);
        }
        await sleep(100);
        await observe();
      }
      if (executionError) throw executionError;
    } finally { await Promise.allSettled(inFlight.values()); }
''' +s[b:]
replace(p,"source_commit: process.env.GITHUB_SHA || null", "source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()")
p='apps/web/components/workers.tsx';edits[p]=read(p).replace('/docs/execution/workers','/docs/workers')
p='docs/maintainers/TODO.md'
replace(p,'## Worker cutover regression obligations\n','''## Worker cutover regression obligations

- [ ] Cover aggregate queued-demand scaling, existing provisioning as projected supply, mixed resource sizes, bounded four-allocation expansion, Worker caps, financial reservation rechecks, and no repeated provisioning for the same pending pressure.
''')
for p,s in edits.items():Path(p).parent.mkdir(parents=True,exist_ok=True);Path(p).write_text(s)
print('APPLIED_SOURCE_FILES',', '.join(edits))
