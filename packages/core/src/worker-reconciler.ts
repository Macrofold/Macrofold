import { transaction, lock, pool, type Tx } from '../../db';
import { AppError, assert } from './errors';
import { id, unseal } from './crypto';
import { getWorker, type WorkerRow } from './workers';
import { getHost, hostSnapshots, reserveHost, extendHostFunding, settleHostSample, releaseHostFunding,
  defaultRunResources, type HostRow, HOST_CLEANUP_SECONDS } from './host-allocations';
import { planWorkerCapacity } from './worker-scaling';
import type { RunDemand } from './worker-types';
import { workerAdmissionBlock } from './worker-policy';
import { workerHourlyExposure, type ComputeMeters } from './worker-pricing';
import type { NativeRunRow } from './runs';
import { hostProvider } from '../../providers/src/hosts';
import { hostHealth, type HostProvider } from '../../contracts/host-control';

export type HostProviderFactory = (driver: HostRow['provider']) => HostProvider;
const providerLeaseMs = 120000;
const retrySeconds = 5;
const allocationMeters = (host: HostRow, now: number): ComputeMeters => ({ kind: 'allocation', elapsed_ms:
  String(host.started_at ? Math.max(0, Math.min(now, host.stopped_at?.getTime() ?? Infinity) - host.started_at.getTime()) : 0) });

async function mutateHost(org: string, hostId: string, leaseId: string, action: (tx: Tx, host: HostRow) => Promise<void>) {
  return transaction(org, async tx => {
    const before = await getHost(tx, hostId);
    await lock(tx, `worker:${before.worker_id}`);
    await lock(tx, `host:${hostId}`);
    const current = await getHost(tx, hostId);
    assert(current.lease_id === leaseId, 409, 'host_lease_lost', 'Another reconciler owns this Host operation.');
    await action(tx, current);
  });
}

/** Reconcile one physical generation. Provider I/O never runs while tenant/capacity locks are held. */
export async function advanceHost(org: string, hostId: string, providerFactory: HostProviderFactory = hostProvider): Promise<void> {
  const leaseId = id();
  const claimed = await transaction(org, async tx => {
    const before = await getHost(tx, hostId);
    await lock(tx, `worker:${before.worker_id}`);
    await lock(tx, `host:${hostId}`);
    const host = await getHost(tx, hostId);
    if (host.status === 'stopped' || host.next_check_at.getTime() > Date.now() || (host.lease_until && host.lease_until.getTime() > Date.now())) return null;
    await tx.query('UPDATE hosts SET lease_id=$2,lease_until=$3 WHERE id=$1', [hostId, leaseId, new Date(Date.now() + providerLeaseMs)]);
    return { host, worker: await getWorker(tx, host.worker_id) };
  });
  if (!claimed) return;
  let host = claimed.host;
  const provider = providerFactory(host.provider);
  const secret = unseal<string>(host.secret_ciphertext);
  try {
    if (host.status === 'provisioning') {
      const worker = claimed.worker;
      if (workerAdmissionBlock(worker, Date.now()) || host.funded_until.getTime() <= Date.now() + HOST_CLEANUP_SECONDS * 1000) {
        await mutateHost(org, hostId, leaseId, async tx => {
          await tx.query("UPDATE hosts SET status='draining',next_check_at=now() WHERE id=$1", [hostId]);
        });
        return;
      }
      const binding = await provider.provision({
        id: host.id, generation: host.generation, name: host.provider_name, secret,
        lifetime_seconds: host.offering.max_host_lifetime_seconds, resources: host.offering.resources,
        region: host.offering.region, size: host.offering.driver_size || host.offering.size,
        runtime: host.offering.runtime, concurrency: host.capacity, isolate_runs: host.offering.isolate_runs,
      });
      if (!binding) return;
      const start = new Date(binding.createdAt);
      assert(Number.isFinite(start.getTime()) && start.getTime() >= host.created_at.getTime() - 60000 && start.getTime() <= Date.now() + 60000,
        503, 'host_start_time_invalid', 'The provider returned an invalid allocation start time.');
      // Persist the provider receipt before health/configuration can fail, including billable startup time.
      await mutateHost(org, hostId, leaseId, async tx => {
        await tx.query('UPDATE hosts SET binding=$2,started_at=coalesce(started_at,$3),expires_at=$4,last_observed_at=now() WHERE id=$1',
          [hostId, JSON.stringify(binding), start, host.offering.max_host_lifetime_seconds === null ? null :
            new Date(start.getTime() + host.offering.max_host_lifetime_seconds * 1000)]);
      });
      await provider.start?.(binding, secret);
      const health = hostHealth.parse(await provider.control(binding, secret, { action: 'health' }));
      const fencedBinding = { ...binding, controlBootId: health.boot_id, ...(host.provider === 'render' ? { sessionId: health.boot_id } : {}) };
      assert(health.capabilities.scoped_processes && (!host.offering.isolate_runs || health.capabilities.sibling_isolation),
        503, 'host_isolation_unavailable', 'The runtime cannot enforce the accepted process/isolation contract.');
      assert(host.offering.price.kind !== 'resource' || health.capabilities.resource_meter,
        503, 'host_meter_unavailable', 'This resource-priced offering requires an available cumulative usage meter.');
      await provider.control(fencedBinding, secret, { action: 'configure', host_id: host.id, generation: host.generation,
        concurrency: host.capacity, isolate_runs: host.offering.isolate_runs, resources: host.offering.resources,
        warm_memory_mib: host.offering.isolate_runs ? 0 : Math.floor(host.memory_mib / 4), warm_idle_seconds: 300 });
      await mutateHost(org, hostId, leaseId, async (tx, current) => {
        const latestWorker = await getWorker(tx, current.worker_id);
        await tx.query(`UPDATE hosts SET binding=$2,status=$3,idle_since=now(),failure_code=NULL,last_observed_at=now(),updated_at=now()
          WHERE id=$1`, [hostId, JSON.stringify(fencedBinding), workerAdmissionBlock(latestWorker,Date.now()) ? 'draining' : 'ready']);
      });
      host = await transaction(org, tx => getHost(tx,hostId));
    }

    // A restarted controller cannot prove ownership of its old process trees. Stop the
    // allocation, not just its DB lease; Run recovery then releases the fenced claims.
    if (host.failure_code === 'host_generation_changed' && !host.stopped_at) {
      if (!await provider.destroy(host.provider_name, host.binding)) return;
      await mutateHost(org, hostId, leaseId, async tx => {
        await tx.query("UPDATE hosts SET status='draining',stopped_at=now(),updated_at=now() WHERE id=$1", [hostId]);
        await tx.query(`UPDATE dispatch_jobs SET available_at=now() WHERE kind='run' AND resource_id IN
          (SELECT run_id FROM host_runs WHERE host_id=$1 AND released_at IS NULL)`, [hostId]);
      });
      host = await transaction(org, tx => getHost(tx, hostId));
    }
    let meters: ComputeMeters | undefined;
    if (host.binding && !host.stopped_at) {
      const running = await provider.exists(host.binding, secret);
      if (!running) {
        await mutateHost(org, hostId, leaseId, async tx => {
          await tx.query("UPDATE hosts SET status='draining',stopped_at=now(),failure_code='host_lost',updated_at=now() WHERE id=$1", [hostId]);
          // Native phase recovery observes the lost generation; no prompt is replayed here.
          await tx.query(`UPDATE dispatch_jobs SET available_at=now() WHERE kind='run' AND resource_id IN
            (SELECT run_id FROM host_runs WHERE host_id=$1 AND released_at IS NULL)`, [hostId]);
        });
        host = await transaction(org, tx => getHost(tx, hostId));
      } else {
        const health = hostHealth.parse(await provider.control(host.binding, secret, { action: 'health' }));
        assert(health.boot_id === host.binding.controlBootId, 409, 'host_generation_changed',
          'The Host controller changed; stop the old allocation before releasing claims.');
        if (health.rotation_requested || health.quiesced) await mutateHost(org, hostId, leaseId, async tx => {
          await tx.query("UPDATE hosts SET status='draining',next_check_at=now() WHERE id=$1", [hostId]);
        });
        if (host.offering.price.kind === 'resource') {
          assert(health.meters, 503, 'host_usage_unknown',
            'The current generation did not provide its required resource meter. Funding is retained for reconciliation.');
          meters = health.meters;
        }
      }
    }
    if (host.started_at) {
      if (host.offering.price.kind === 'allocation') meters = allocationMeters(host, Date.now());
      if (host.offering.price.kind === 'resource' && host.stopped_at && !meters) {
        // Last acknowledged usage is not evidence that the missing tail consumed nothing.
        if (!host.usage_finalized_at && workerHourlyExposure(host.offering.price,host.offering.resources) > 0n) throw new AppError(503,'host_usage_unknown',
          'Resource usage after the last observation is unknown; retain this allocation for reconciliation.');
        meters = host.billing_cursor || { kind: 'resource', cpu_ms: '0', memory_mib_ms: '0' };
      }
      if (meters) { const sample = meters; await mutateHost(org, hostId, leaseId, async (tx, current) => settleHostSample(tx, current, sample)); }
    }
    host = await transaction(org, tx => getHost(tx, hostId));
    if (host.status === 'ready' && host.funded_until.getTime() < Date.now() + 600000) {
      try {
        await mutateHost(org, hostId, leaseId, async (tx, current) => extendHostFunding(tx,current,new Date(Date.now()+3600000)));
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 402) throw error;
        await mutateHost(org, hostId, leaseId, async tx => {
          await tx.query("UPDATE hosts SET status='draining',failure_code='insufficient_credits' WHERE id=$1", [hostId]);
          await tx.query("UPDATE workers SET failure_code='insufficient_credits',next_check_at=now() WHERE id=$1", [host.worker_id]);
        });
      }
    }
    host = await transaction(org, tx => getHost(tx, hostId));
    if (host.status === 'draining') {
      const count = await transaction(org, async tx => (await tx.query<{ n: number }>(
        'SELECT count(*)::integer AS n FROM host_runs WHERE host_id=$1 AND released_at IS NULL', [hostId])).rows[0].n);
      if (count) return;
      if (host.binding && !host.stopped_at && host.offering.price.kind === 'resource' && !host.usage_finalized_at) {
        const receipt = hostHealth.parse(await provider.control(host.binding, secret, { action: 'quiesce' }));
        assert(receipt.boot_id === host.binding.controlBootId && receipt.quiesced && receipt.active_assignments === 0 && receipt.meters,
          503, 'host_usage_unknown', 'A stopped workload and final cumulative meter must be confirmed before deallocation.');
        const finalMeters = receipt.meters;
        await mutateHost(org, hostId, leaseId, async (tx, current) => {
          await settleHostSample(tx, current, finalMeters);
          await tx.query('UPDATE hosts SET usage_finalized_at=now() WHERE id=$1', [hostId]);
        });
        host = await transaction(org, tx => getHost(tx, hostId));
      }
      const released = host.stopped_at !== null || await provider.destroy(host.provider_name,host.binding);
      if (!released) return;
      await mutateHost(org, hostId, leaseId, async (tx, current) => {
        // Allocation-time pricing includes the confirmed stop boundary, not merely the DELETE acknowledgement.
        if (current.started_at && current.offering.price.kind === 'allocation') {
          await settleHostSample(tx,current,allocationMeters(current,Date.now()));
          current = await getHost(tx,hostId);
        }
        await releaseHostFunding(tx,current);
      });
    }
  } catch (error) {
    if (error instanceof AppError && error.code === 'host_lease_lost') return;
    const code = error instanceof AppError ? error.code : 'host_provider_unavailable';
    await mutateHost(org, hostId, leaseId, async tx => {
      await tx.query('UPDATE hosts SET failure_code=$2,updated_at=now() WHERE id=$1', [hostId,code]);
      await tx.query('UPDATE workers SET failure_code=$2,updated_at=now() WHERE id=$1', [host.worker_id,code]);
      if (['host_isolation_unavailable','host_meter_unavailable','host_stopped','host_funding_exhausted','host_generation_changed'].includes(code))
        await tx.query("UPDATE hosts SET status='draining' WHERE id=$1", [hostId]);
    });
  } finally {
    await transaction(org, async tx => {
      await tx.query(`UPDATE hosts SET lease_id=NULL,lease_until=NULL,next_check_at=now()+($3*interval '1 second')
        WHERE id=$1 AND lease_id=$2`, [hostId,leaseId,retrySeconds]);
    });
  }
}

async function queuedDemand(tx: Tx, worker: WorkerRow): Promise<NativeRunRow[]> {
  return (await tx.query<NativeRunRow>(`SELECT r.* FROM runs r WHERE r.config->>'worker_id'=$1 AND r.status='queued'
    AND NOT r.cancel_requested AND r.queue_expires_at>now() AND r.kind='native_agent'
    AND NOT EXISTS(SELECT 1 FROM runs earlier WHERE earlier.worktree_id=r.worktree_id AND earlier.id<>r.id AND
      (earlier.status IN ('provisioning','running','waiting_for_input','persisting') OR
      (earlier.status='queued' AND (earlier.created_at,earlier.id)<(r.created_at,r.id))))
    ORDER BY CASE r.config->>'scheduling_class' WHEN 'interactive' THEN 0 ELSE 1 END,r.created_at,r.id LIMIT 32`, [worker.id])).rows;
}

export async function reconcileWorker(org: string, workerId: string, providerFactory: HostProviderFactory = hostProvider): Promise<void> {
  const hostIds = await transaction(org, async tx => {
    await lock(tx, `worker:${workerId}`);
    const worker = await getWorker(tx,workerId);
    const hosts = (await tx.query<HostRow>("SELECT * FROM hosts WHERE worker_id=$1 AND status<>'stopped' ORDER BY created_at,id",[workerId])).rows;
    const snapshots = await hostSnapshots(tx,workerId);
    const blocked = workerAdmissionBlock(worker,Date.now());
    if (blocked) {
      await tx.query("UPDATE hosts SET status='draining',next_check_at=now() WHERE worker_id=$1 AND status<>'stopped'",[workerId]);
    } else {
      const serving = snapshots.filter(host => host.status === 'ready' || host.status === 'provisioning');
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
      let remaining = serving.length;
      for (const host of hosts) {
        const snapshot = snapshots.find(item=>item.id===host.id);
        const nearExpiry = host.expires_at !== null && host.expires_at.getTime() <= Date.now() + HOST_CLEANUP_SECONDS*1000;
        const idleExpired = host.idle_since !== null && worker.settings.idle_timeout_seconds !== null &&
          host.idle_since.getTime() + worker.settings.idle_timeout_seconds*1000 <= Date.now();
        const extra = remaining > worker.settings.min_instances;
        // The planner used these snapshots under the Worker claim lock. Replacement
        // only requests a drain; advanceHost retains claims and funding until stop.
        const replaceIdle = host.id === plan.replace_idle_host_id;
        // A nonempty queue does not need every idle Host: concurrency/resource
        // limits can block it, or another Host can supply its projected capacity.
        const releaseIdle = extra && snapshot !== undefined && snapshot.occupied_slots === 0 &&
          idleExpired && !plan.fund.has(host.id);
        if (host.status !== 'ready' || !(nearExpiry || replaceIdle || releaseIdle)) continue;
        if (!nearExpiry) {
          // Placement cache metadata is bounded. Every elective retirement must
          // check the complete generation for older unpublished state.
          const unpublished = await tx.query(`SELECT 1 FROM host_materializations
            WHERE host_id=$1 AND host_generation=$2 AND state<>'clean' LIMIT 1`, [host.id,host.generation]);
          if (unpublished.rowCount) continue;
        }
        await tx.query("UPDATE hosts SET status='draining',next_check_at=now() WHERE id=$1",[host.id]);
        remaining--;
      }
    }
    await tx.query("UPDATE workers SET next_check_at=now()+interval '2 seconds' WHERE id=$1",[workerId]);
    return hosts.map(host=>host.id);
  });
  // Bound provider fan-out; every operation still has its own durable Host lease.
  for (let offset=0; offset<hostIds.length; offset+=4)
    await Promise.all(hostIds.slice(offset,offset+4).map(hostId=>advanceHost(org,hostId,providerFactory)));
}

export async function dispatchWorkers(limit=10, providerFactory: HostProviderFactory = hostProvider): Promise<number> {
  const rows = (await pool.query<{ id:string; organization_id:string }>(
    'SELECT id,organization_id FROM reporting.worker_schedule WHERE next_check_at<=now() ORDER BY next_check_at,id LIMIT $1', [limit])).rows;
  for (let offset=0; offset<rows.length; offset+=4) await Promise.all(rows.slice(offset,offset+4).map(async row=>{
    try { await reconcileWorker(row.organization_id,row.id,providerFactory); }
    catch (error) {
      await transaction(row.organization_id,tx=>tx.query("UPDATE workers SET failure_code=$2,next_check_at=now()+interval '30 seconds' WHERE id=$1",
        [row.id,error instanceof AppError ? error.code : 'worker_reconciliation_failed']).then(()=>{}));
    }
  }));
  return rows.length;
}
