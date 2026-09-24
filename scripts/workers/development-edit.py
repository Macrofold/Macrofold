"""Reviewed cross-layer Worker integration; no provider calls or workflow edits occur here."""
from pathlib import Path

def edit(file,old,new):
    p=Path(file);s=p.read_text()
    if old not in s:raise RuntimeError(f'Expected source changed: {file}: {old[:100]}')
    p.write_text(s.replace(old,new,1))

edit('apps/web/lib/key-permissions.ts', "  'runs:write': { label: 'Manage presets and run agents', preset: 'read-write' },", "  'runs:write': { label: 'Manage presets and run agents', preset: 'read-write' },\n  'workers:read': { label: 'View Worker configuration and compute usage', preset: 'read-only' },\n  'workers:use': { label: 'Run agents on authorized Workers', preset: 'read-write' },\n  'workers:write': { label: 'Manage Worker capacity, spending and lifecycle', preset: 'full-access' },")
edit('apps/web/lib/key-permissions.ts', 'Excludes billing, API-key and team administration, and permanent workspace deletion.', 'Excludes Worker spending/lifecycle, billing, API-key and team administration, and permanent workspace deletion.')
edit('packages/cli/src/stream.ts', "    worktree_unavailable: 'worktree unavailable',", """    worktree_unavailable: 'worktree unavailable',
    worker_paused: 'Worker manually paused; resume it to continue',
    worker_destroyed: 'Worker retired; finalizing this Run',
    worker_expired: 'Worker expired; finalizing this Run',
    worker_concurrency: 'Worker execution limit occupied',
    worker_cost_limit: 'Worker compute spending ceiling',
    worker_instance_limit: 'Worker allocation limit',
    worker_starting: 'Worker capacity is starting',
    worker_capacity: 'waiting for compatible Worker capacity',
    worker_lifetime: 'insufficient remaining Worker lifetime',
    compute_unavailable: 'requested compute offering unavailable',
    insufficient_credits: 'insufficient compute funding',""")

# Advertised eligibility must include cleanup and funding, before weighted queue selection.
edit('packages/db/044_worker_admission.sql', "       AND h.stopped_at IS NULL AND (h.expires_at", "       AND h.funded_until>=now()+(r.window_seconds+60)*interval '1 second'\n       AND h.stopped_at IS NULL AND (h.expires_at")
edit('packages/db/044_worker_admission.sql', "WHEN expires_at IS NOT NULL AND expires_at<now()+window_seconds*interval '1 second' THEN 'worker_expired'", "WHEN expires_at IS NOT NULL AND expires_at<=now() THEN 'worker_expired'\n     WHEN expires_at IS NOT NULL AND expires_at<now()+window_seconds*interval '1 second' THEN 'worker_lifetime'")
edit('packages/core/src/scheduling.ts', ' AS worktree_blocked\n', " AS worktree_blocked,\n EXISTS(SELECT 1 FROM reporting.host_writers hw WHERE hw.worktree_id=r.worktree_id AND hw.run_id<>r.id) AS cleanup_blocked,\n coalesce(wp.eligible,true) AS worker_eligible,wp.waiting_reason AS worker_waiting_reason\n")
edit('packages/core/src/scheduling.ts', ' CROSS JOIN scheduler_clock c LEFT JOIN active a', ' CROSS JOIN scheduler_clock c LEFT JOIN reporting.worker_placement wp ON wp.id=r.id LEFT JOIN active a')
edit('packages/core/src/scheduling.ts', 'FROM queue WHERE NOT worktree_blocked AND NOT unavailable', 'FROM queue WHERE NOT worktree_blocked AND NOT cleanup_blocked AND worker_eligible AND NOT unavailable')
edit('packages/core/src/scheduling.ts', 'q.queue_expires_at<=now() OR q.unavailable', "q.queue_expires_at<=now() OR q.unavailable OR q.worker_waiting_reason IN ('worker_destroyed','worker_expired','worker_lifetime')")
edit('packages/core/src/scheduling.ts', "WHEN worktree_blocked THEN 'earlier_worktree_work'", "WHEN worktree_blocked OR cleanup_blocked THEN 'earlier_worktree_work'\n      WHEN NOT worker_eligible THEN worker_waiting_reason")

edit('packages/core/src/engine.ts', "import { acquireSandbox", "import { getWorker } from './workers';\nimport { workerAdmissionBlock } from './worker-policy';\nimport { claimHostRun, activeHostRun, releaseHostRun } from './host-allocations';\nimport { acquireSandbox")
edit('packages/core/src/engine.ts', '    const subscriptionUnavailable =', """    const worker = run.kind === 'native_agent' && run.config.worker_id ? await getWorker(tx,run.config.worker_id) : null;
    const workerState = worker ? workerAdmissionBlock(worker,Date.now()) : null;
    const workerUnavailable = workerState === 'worker_destroyed' || workerState === 'worker_expired' ||
      (worker && worker.settings.expires_at_ms !== null && worker.settings.expires_at_ms < Date.now()+((run.config.limits?.timeout_seconds || 900)+180)*1000);
    const subscriptionUnavailable =""")
edit('packages/core/src/engine.ts', 'subscriptionUnavailable || sandboxUnavailable\n', 'subscriptionUnavailable || sandboxUnavailable || workerUnavailable\n')
edit('packages/core/src/engine.ts', "              : sandboxUnavailable\n", "              : workerUnavailable\n                ? workerState || 'worker_lifetime'\n              : sandboxUnavailable\n")
edit('packages/core/src/engine.ts', "    if (sandbox?.status === 'pausing')", "    if (workerState === 'worker_paused') return null;\n    if (sandbox?.status === 'pausing')")
edit('packages/core/src/engine.ts', '    await recordTurn(tx, org, turn);', "    if (worker && run.kind === 'native_agent' && !(await claimHostRun(tx,run))) return null;\n    await recordTurn(tx, org, turn);")
# Release simulation assignments only once its provider execution is finished. Native cleanup uses WorkerMachines.close.
edit('packages/core/src/engine.ts', '  } finally {\n    clearInterval(heartbeat);', """  } finally {
    clearInterval(heartbeat);
    if (run.config.worker_id) await transaction(org,async tx=>{
      await lock(tx,`worktree:${run.worktree_id}`);
      const assignment=await activeHostRun(tx,run.id);
      if(assignment) {
        const current=await getRun(tx,run.id);
        const worktree=await resources.get(tx,'worktrees',run.worktree_id);
        await releaseHostRun(tx,assignment,current.result.persistence_status==='verified',worktree.latest_checkpoint_id ?? null);
      }
    });""")
# Match mutation lock order for graceful force cancellation versus simulator publication.
p=Path('packages/core/src/engine.ts');s=p.read_text()
s=s.replace('      await lock(tx, `worktree:${run.worktree_id}`);\n      const current', '      await lock(tx, `worktree:${run.worktree_id}`);\n      if(run.config.worker_id) await lock(tx,`worker:${run.config.worker_id}`);\n      const current')
s=s.replace("  } catch (error) {\n    await transaction(org, async (tx) => {\n      const current", "  } catch (error) {\n    await transaction(org, async (tx) => {\n      await lock(tx,`worktree:${run.worktree_id}`);\n      if(run.config.worker_id) await lock(tx,`worker:${run.config.worker_id}`);\n      const current")
s=s.replace("WHERE status='queued' AND (queue_expires_at<=now() OR cancel_requested OR unavailable)", "WHERE status='queued' AND (queue_expires_at<=now() OR cancel_requested OR unavailable OR id IN\n      (SELECT id FROM reporting.worker_placement WHERE waiting_reason IN ('worker_destroyed','worker_expired','worker_lifetime')))")
s=s.replace('        await lock(tx, `worktree:${run.worktree_id}`);\n        await tx.query', '        await lock(tx, `worktree:${run.worktree_id}`);\n        if(run.config.worker_id) await lock(tx,`worker:${run.config.worker_id}`);\n        await tx.query')
s=s.replace('        abandoned++;', "        const assignment=await activeHostRun(tx,run.id);\n        if(assignment)await releaseHostRun(tx,assignment,false,null);\n        abandoned++;")
p.write_text(s)

edit('packages/providers/src/machines.ts', "import { SandboxMachines }", "import { WorkerMachines } from '../../core/src/worker-machines';\nimport { SandboxMachines }")
edit('packages/providers/src/machines.ts', "  if (run?.config.sandbox_id)", "  if (run?.config.worker_id) return new WorkerMachines(run);\n  if (run?.config.sandbox_id)")
edit('packages/core/src/git-jobs.ts', "    ['sandboxes',", "    ['workers', async () => ({ workers_checked: await (await import('./worker-reconciler')).dispatchWorkers() })],\n    ['sandboxes',")
edit('packages/core/src/maintenance.ts', 'coalesce((SELECT sum(reserved_micro_usd) FROM sandboxes),0)', 'coalesce((SELECT sum(reserved_micro_usd) FROM sandboxes),0)+coalesce((SELECT sum(reserved_micro_usd) FROM hosts),0)')

# Direct writes wait through Host cleanup. Automatic Git publication can queue behind its own just-completed Run.
edit('packages/core/src/files.ts', 'export async function ensureWritable(tx: Tx, worktreeId: string)', 'export async function ensureWritable(tx: Tx, worktreeId: string, completedRunId?: string)')
edit('packages/core/src/files.ts', '"SELECT id FROM runs WHERE worktree_id=$1 AND status IN (\'provisioning\',\'running\',\'waiting_for_input\',\'persisting\')",\n    [worktreeId],', "\"SELECT id FROM runs WHERE worktree_id=$1 AND status IN ('provisioning','running','waiting_for_input','persisting') UNION ALL SELECT run_id AS id FROM host_runs WHERE worktree_id=$1 AND released_at IS NULL AND ($2::uuid IS NULL OR run_id<>$2)\",\n    [worktreeId,completedRunId || null],")
edit('packages/core/src/git-jobs.ts', '  await ensureWritable(tx, worktreeId);', '  await ensureWritable(tx, worktreeId, sourceRunId);')

# Fund the complete accepted execution window before a placement becomes eligible.
edit('packages/core/src/worker-reconciler.ts', "        } else await tx.query('UPDATE workers SET failure_code=$2 WHERE id=$1',[workerId,choice.action==='wait' ? choice.reason : null]);", """        } else if(choice.action==='place') {
          const selected=await getHost(tx,choice.host_id);
          try {
            await extendHostFunding(tx,selected,new Date(Date.now()+(demand.execution_seconds+HOST_CLEANUP_SECONDS+120)*1000));
            await tx.query('UPDATE workers SET failure_code=NULL WHERE id=$1',[workerId]);
          } catch(error) {
            if(!(error instanceof AppError) || error.status!==402)throw error;
            await tx.query('UPDATE workers SET failure_code=$2 WHERE id=$1',[workerId,error.code]);
          }
        } else await tx.query('UPDATE workers SET failure_code=$2 WHERE id=$1',[workerId,choice.reason]);""")
# Quote ties favor density for a trusted-sharing request instead of accidentally picking the isolated one-slot shape.
edit('packages/core/src/worker-placement.ts', 'a.resources.memory_mib - b.resources.memory_mib || a.id.localeCompare(b.id)', 'a.resources.memory_mib - b.resources.memory_mib || b.concurrency-a.concurrency || a.id.localeCompare(b.id)')
edit('packages/core/src/worker-reconciler.ts', 'a.resources.memory_mib-b.resources.memory_mib;', 'a.resources.memory_mib-b.resources.memory_mib || b.concurrency-a.concurrency;')

# Restore authorization snapshots before testing HTTP execution.
for file in ['packages/core/src/http.ts','packages/core/src/http-contract.ts','scripts/worker.ts']:
    lines=Path(file).read_text().splitlines()
    for i,line in enumerate(lines):
        if any(value in line for value in ['operationId','dispatchMaintenance','pendingRuns','actorAuthorized','requestBody']):
            if file.endswith('http.ts') and 'operationId' in line:continue
            print('FOLLOWUP',file,i+1,'\n'.join(lines[max(0,i-2):i+4]))
