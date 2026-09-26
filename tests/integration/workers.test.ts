import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { authPool, lock, pool, transaction, type Tx } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import { credit } from '../../packages/core/src/ledger';
import { createWorker, getWorker, changeWorker, patchWorker, presentWorker, workerForRun } from '../../packages/core/src/workers';
import { reserveHost, getHost, hostSnapshots, claimHostRun, activeHostRun, releaseHostRun, settleHostSample } from '../../packages/core/src/host-allocations';
import { reconcileWorker } from '../../packages/core/src/worker-reconciler';
import { admitRun, cancelRun, getNativeRun } from '../../packages/core/src/runs';
import { createWorktree } from '../../packages/core/src/files';
import * as resources from '../../packages/core/src/resources';
import type { Principal } from '../../packages/core/src/auth';
import type { ResourceAllocation } from '../../packages/core/src/worker-types';
import type { HostProvider, HostBinding } from '../../packages/contracts/host-control';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
let other: Awaited<ReturnType<typeof fixtureAccount>>;
let principal: Principal;
const tx = <T>(action:(tx:Tx)=>Promise<T>)=>transaction(account.p.organizationId,action);
const allocations=new Map<string,HostBinding>();
let creates=0,stops=0;
const provider:HostProvider={
  async provision(spec){
    let binding=allocations.get(spec.name);
    if(!binding){binding={name:spec.name,sessionId:spec.id,controlBootId:spec.id,createdAt:new Date().toISOString()};allocations.set(spec.name,binding);creates++;}
    return binding;
  },
  async exists(binding){return allocations.has(binding.name);},
  async control(binding,_secret,request){
    if(request.action==='health')return {boot_id:binding.sessionId,started_at:binding.createdAt,configured:true,active_assignments:0,
      capabilities:{scoped_processes:true,sibling_isolation:true,resource_meter:true},meters:{kind:'resource',cpu_ms:'0',memory_mib_ms:'0'}};
    if(request.action==='configure')return {};
    throw new Error('Unexpected native control request in allocation fixture');
  },
  async destroy(name){if(allocations.delete(name))stops++;return true;},
};
beforeAll(async()=>{
  account=await fixtureAccount('Worker owner');other=await fixtureAccount('Other Worker owner');
  principal={...account.p,scopes:[...account.p.scopes,'workers:read','workers:use','workers:write']};
  await tx(async t=>{
    await credit(t,account.p.organizationId,1000000000n,`worker-test:${id()}`);
    await t.query("UPDATE organizations SET plan='scale' WHERE id=$1",[account.p.organizationId]);
  });
});
afterEach(async()=>{
  // Retire our synthetic queue entries, not merely request cancellation.
  // Global candidate discovery intentionally prioritizes pending cleanup.
  const queued=await tx(t=>t.query<{id:string}>("SELECT id FROM runs WHERE config ? 'worker_id' AND status='queued'"));
  for(const run of queued.rows)await tx(t=>cancelRun(t,principal,run.id));
});
afterAll(async()=>{await pool.end();await authPool.end();});
async function worker(input:Parameters<typeof createWorker>[2]={}){
  return tx(t=>createWorker(t,principal,{compute:'server',dedicated:true,isolate_runs:false,min_instances:0,max_instances:2,
    max_concurrency:6,max_hourly_compute_cost_micro_usd:'10000000',...input}));
}
async function newRun(workerId:string, workerResources?:ResourceAllocation){
  return tx(async t=>{
    const workspace=await resources.create(t,'workspaces',principal.organizationId,{name:`Worker files ${id()}`});
    const operation=await createWorktree(t,principal,workspace.id,{name:'main',branch:'main'});
    const accepted=await admitRun(t,principal,{worktree_id:operation.result.worktree_id,prompt:'fixture',harness:'codex',model:'fixture-model',billing_mode:'managed'});
    await t.query('UPDATE runs SET config=config||$2::jsonb WHERE id=$1',[accepted.run_id,JSON.stringify({
      worker_id:workerId,worker_resources:workerResources,compute_rate_micro_usd_per_minute:'0',
    })]);
    return getNativeRun(t,accepted.run_id);
  });
}
async function ensureBaseline(workerId:string){
  await reconcileWorker(principal.organizationId,workerId,()=>provider);
  return tx(async t=>(await t.query<{id:string}>("SELECT id FROM hosts WHERE worker_id=$1 AND status='ready' ORDER BY created_at",[workerId])).rows);
}

// Synthetic accepted rates exercise real SQL/ledger decisions, not commercial provider pricing.
async function resizableWorker(){
  const created=await worker({min_instances:1,max_instances:1,max_hourly_compute_cost_micro_usd:'2000000'});
  await tx(async t=>{
    await lock(t,`worker:${created.id}`);
    const row=await getWorker(t,created.id);
    const base=row.offerings.find(quote=>quote.compute==='server' && quote.dedicated && !quote.isolate_runs);
    if(!base)throw new Error('Expected a local shared-runtime offering');
    const small={...base,id:'sizing-small',revision:id(),price:{kind:'allocation' as const,hourly_micro_usd:'1000000'}};
    const large={...small,id:'sizing-large',revision:id(),size:'2cpu-8g',resources:{memory_mib:8192,cpu_millis:2000},
      price:{kind:'allocation' as const,hourly_micro_usd:'2000000'}};
    await t.query('UPDATE workers SET offerings=$2 WHERE id=$1',[created.id,JSON.stringify([small,large])]);
  });
  return created;
}

describe('Worker authority and desired lifecycle',()=>{
  it('creates an inert autoscaling target without a Worktree or a machine charge',async()=>{
    const created=await worker();
    expect(created).toMatchObject({status:'sleeping',desired_state:'enabled',ready_instances:0,cost_micro_usd:'0',reserved_micro_usd:'0'});
    expect(created).not.toHaveProperty('worktree_id');
    expect(created).not.toHaveProperty('secret_ciphertext');
    expect(created.accepted_offerings.every(value=>!Object.hasOwn(value,'driver'))).toBe(true);
  });
  it('enforces tenant RLS and separates Worker use from lifecycle control',async()=>{
    const created=await worker();
    await expect(transaction(other.p.organizationId,t=>getWorker(t,created.id,{...other.p,scopes:['workers:read']}))).rejects.toMatchObject({status:404});
    const user={...principal,role:'member',scopes:['workers:use']};
    expect((await tx(t=>workerForRun(t,user,created.id))).id).toBe(created.id);
    await expect(tx(t=>changeWorker(t,user,created.id,'pause'))).rejects.toMatchObject({status:403});
    await expect(tx(t=>getWorker(t,created.id,{...principal,scopes:['workers:use']}))).rejects.toMatchObject({status:403});
    await expect(tx(t=>changeWorker(t,{...principal,scopes:['workers:use']}),created.id,'pause')).rejects.toMatchObject({status:403});
    await expect(tx(t=>changeWorker(t,{...principal,workspaceIds:[id()]},created.id,'pause'))).rejects.toMatchObject({code:'worker_management_forbidden'});
  });
  it('manual pause cannot be undone by incoming traffic, while explicit resume re-enables it',async()=>{
    const created=await worker();
    expect((await tx(t=>changeWorker(t,principal,created.id,'pause'))).status).toBe('paused');
    await expect(tx(t=>workerForRun(t,principal,created.id))).rejects.toMatchObject({code:'worker_paused'});
    expect((await tx(t=>changeWorker(t,principal,created.id,'resume'))).status).toBe('sleeping');
  });
  it('accepts only one concurrent configuration revision without losing the winner',async()=>{
    const created=await worker();
    const results=await Promise.allSettled([
      tx(t=>patchWorker(t,principal,created.id,{expected_revision:created.revision,name:'Revision winner A'})),
      tx(t=>patchWorker(t,principal,created.id,{expected_revision:created.revision,name:'Revision winner B'})),
    ]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
    expect((await tx(t=>getWorker(t,created.id))).revision).toBe(created.revision+1);
  });
  it('rejects duplicate names only within the same organization',async()=>{
    const name=`Unique-${id()}`;
    await worker({name});
    await expect(worker({name:name.toUpperCase()})).rejects.toMatchObject({code:'worker_name_exists'});
    await transaction(other.p.organizationId,t=>createWorker(t,{...other.p,scopes:['workers:write']},{name}));
  });
  it('keeps stopped Worker identity and durable file state independent',async()=>{
    const created=await worker({min_instances:1});
    const run=await newRun(created.id);
    const before=await tx(t=>resources.get(t,'worktrees',run.worktree_id));
    await ensureBaseline(created.id);
    await tx(t=>changeWorker(t,principal,created.id,'destroy'));
    await reconcileWorker(principal.organizationId,created.id,()=>provider);
    const after=await tx(async t=>presentWorker(t,await getWorker(t,created.id)));
    expect(after.status).toBe('destroyed');
    expect((await tx(t=>resources.get(t,'worktrees',run.worktree_id))).revision).toBe(before.revision);
  });
});

describe('durable capacity and graceful shutdown',()=>{
  it('serializes duplicate reconcilers before creating paid capacity',async()=>{
    const created=await worker({min_instances:1,max_instances:1});
    const before=creates;
    await Promise.all(Array.from({length:8},()=>reconcileWorker(principal.organizationId,created.id,()=>provider)));
    const hosts=await tx(t=>t.query('SELECT id FROM hosts WHERE worker_id=$1',[created.id]));
    expect(hosts.rowCount).toBe(1);
    expect(creates-before).toBe(1);
  });
  it('uses queued resource requirements before reserving a single-instance baseline',async()=>{
    const created=await resizableWorker();
    const run=await newRun(created.id,{memory_mib:4096,cpu_millis:1000});
    const before=creates;
    const hosts=await ensureBaseline(created.id);
    expect(hosts).toHaveLength(1);
    const selected=await tx(t=>getHost(t,hosts[0].id));
    expect(selected.offering.id).toBe('sizing-large');
    expect(selected.memory_mib).toBe(8192);
    expect(creates-before).toBe(1);
    const assignment=await tx(t=>claimHostRun(t,run));
    expect(assignment?.host_id).toBe(selected.id);
    if(assignment)await tx(t=>releaseHostRun(t,assignment,false,null));
  });
  it('retains idle replacement liability until provider-confirmed release and then admits the larger Run',async()=>{
    const created=await resizableWorker();
    const initial=await ensureBaseline(created.id);
    const original=await tx(t=>getHost(t,initial[0].id));
    expect(original.offering.id).toBe('sizing-small');
    const run=await newRun(created.id,{memory_mib:4096,cpu_millis:1000});
    const before=creates;
    const uncertain:HostProvider={...provider,destroy:async()=>false};
    await reconcileWorker(principal.organizationId,created.id,()=>uncertain);
    const held=await tx(t=>getHost(t,original.id));
    expect(held.status).toBe('draining');
    expect(held.stopped_at).toBeNull();
    expect(BigInt(held.reserved_micro_usd)).toBeGreaterThan(0n);
    await reconcileWorker(principal.organizationId,created.id,()=>uncertain);
    expect(creates).toBe(before);
    expect((await tx(t=>getNativeRun(t,run.id))).status).toBe('queued');
    expect(await tx(t=>activeHostRun(t,run.id))).toBeUndefined();
    // Make the persisted provider retry due without a wall-clock sleep.
    await tx(t=>t.query('UPDATE hosts SET next_check_at=now() WHERE id=$1',[original.id]).then(()=>{}));
    await reconcileWorker(principal.organizationId,created.id,()=>provider);
    const released=await tx(t=>getHost(t,original.id));
    expect(released.status).toBe('stopped');
    expect(released.reserved_micro_usd).toBe('0');
    expect(creates).toBe(before);
    const replacements=await ensureBaseline(created.id);
    expect(replacements).toHaveLength(1);
    expect(replacements[0].id).not.toBe(original.id);
    const replacement=await tx(t=>getHost(t,replacements[0].id));
    expect(replacement.offering.id).toBe('sizing-large');
    expect(replacement.memory_mib).toBe(8192);
    expect(creates-before).toBe(1);
    const assignment=await tx(t=>claimHostRun(t,run));
    expect(assignment?.host_id).toBe(replacement.id);
    if(assignment)await tx(t=>releaseHostRun(t,assignment,false,null));
  });
  it.each(['replacement','idle scale-down'] as const)('preserves unpublished state outside the bounded cache view during %s',async mode=>{
    const created=mode==='replacement' ? await resizableWorker() : await worker({min_instances:1,max_instances:1,idle_timeout_seconds:0});
    const initial=await ensureBaseline(created.id);
    const original=await tx(t=>getHost(t,initial[0].id));
    const run=await newRun(created.id,{memory_mib:4096,cpu_millis:1000});
    if(mode==='idle scale-down'){
      await tx(t=>patchWorker(t,principal,created.id,{expected_revision:created.revision,min_instances:0}));
      await tx(t=>t.query('UPDATE runs SET cancel_requested=true WHERE id=$1',[run.id]).then(()=>{}));
      await tx(t=>t.query("UPDATE hosts SET idle_since=now()-interval '1 hour' WHERE id=$1",[original.id]).then(()=>{}));
    }
    await tx(t=>t.query(`INSERT INTO host_materializations
      (organization_id,host_id,host_generation,worktree_id,permission_view,state,last_used_at)
      SELECT $1,$2,$3,$4,'fixture-view-'||n,
        CASE WHEN n=0 THEN 'recovery_required' ELSE 'clean' END,
        CASE WHEN n=0 THEN now()-interval '1 hour' ELSE now() END
      FROM generate_series(0,256) AS series(n)`,[principal.organizationId,original.id,original.generation,run.worktree_id]).then(()=>{}));
    const snapshots=await tx(t=>hostSnapshots(t,created.id));
    expect(snapshots[0].worktrees).toHaveLength(256);
    expect(snapshots[0].worktrees.every(cache=>cache.state==='clean')).toBe(true);
    const before=stops;
    await reconcileWorker(principal.organizationId,created.id,()=>provider);
    expect((await tx(t=>getHost(t,original.id))).status).toBe('ready');
    expect(stops).toBe(before);
    expect((await tx(t=>getNativeRun(t,run.id))).status).toBe('queued');
    if(mode==='idle scale-down'){
      // Model an explicitly recovered/published cache; retirement is now safe.
      await tx(t=>t.query("UPDATE host_materializations SET state='clean' WHERE host_id=$1 AND host_generation=$2",[original.id,original.generation]).then(()=>{}));
      await reconcileWorker(principal.organizationId,created.id,()=>provider);
      expect((await tx(t=>getHost(t,original.id))).status).toBe('stopped');
      expect(stops).toBe(before+1);
    }
  });
  it('releases excess idle capacity while queued work is blocked by the Worker concurrency limit',async()=>{
    const created=await worker({min_instances:2,idle_timeout_seconds:0});
    const initial=await ensureBaseline(created.id);
    expect(initial).toHaveLength(2);
    const running=await newRun(created.id);
    const assignment=await tx(t=>claimHostRun(t,running));
    expect(assignment).not.toBeNull();
    if(!assignment)throw new Error('Expected assignment');
    try{
      const queued=await newRun(created.id);
      const spare=initial.find(host=>host.id!==assignment.host_id);
      if(!spare)throw new Error('Expected an idle Host');
      await tx(t=>patchWorker(t,principal,created.id,{expected_revision:created.revision,min_instances:1,max_concurrency:1}));
      await tx(t=>t.query("UPDATE hosts SET idle_since=now()-interval '1 hour',next_check_at=now() WHERE id=$1",[spare.id]).then(()=>{}));
      const before=creates;
      const uncertain:HostProvider={...provider,destroy:async()=>false};
      await reconcileWorker(principal.organizationId,created.id,()=>uncertain);
      const held=await tx(t=>getHost(t,spare.id));
      expect(held.status).toBe('draining');
      expect(held.stopped_at).toBeNull();
      expect((await tx(t=>getHost(t,assignment.host_id))).status).toBe('ready');
      expect((await tx(t=>activeHostRun(t,running.id)))?.id).toBe(assignment.id);
      expect((await tx(t=>getNativeRun(t,queued.id))).status).toBe('queued');
      expect(await tx(t=>activeHostRun(t,queued.id))).toBeUndefined();
      await tx(t=>t.query('UPDATE hosts SET next_check_at=now() WHERE id=$1',[spare.id]).then(()=>{}));
      await reconcileWorker(principal.organizationId,created.id,()=>provider);
      expect((await tx(t=>getHost(t,spare.id))).status).toBe('stopped');
      expect((await tx(t=>getHost(t,spare.id))).reserved_micro_usd).toBe('0');
      expect(creates).toBe(before);
    }finally{
      await tx(t=>releaseHostRun(t,assignment,false,null));
    }
  });
  it('retains the idle Host selected for queued work without retaining every idle Host',async()=>{
    const created=await worker({min_instances:2,idle_timeout_seconds:0});
    const initial=await ensureBaseline(created.id);
    expect(initial).toHaveLength(2);
    const queued=await newRun(created.id);
    await tx(t=>patchWorker(t,principal,created.id,{expected_revision:created.revision,min_instances:0}));
    await tx(t=>t.query("UPDATE hosts SET idle_since=now()-interval '1 hour',next_check_at=now() WHERE worker_id=$1",[created.id]).then(()=>{}));
    const before=creates;
    const remaining=await ensureBaseline(created.id);
    expect(remaining).toHaveLength(1);
    expect(initial.some(host=>host.id===remaining[0].id)).toBe(true);
    expect(creates).toBe(before);
    expect((await tx(t=>getNativeRun(t,queued.id))).status).toBe('queued');
    const assignment=await tx(t=>claimHostRun(t,queued));
    expect(assignment?.host_id).toBe(remaining[0].id);
    if(assignment)await tx(t=>releaseHostRun(t,assignment,false,null));
  });
  it('keeps a busy Worker draining until its final assignment releases, without replay or forced cancellation',async()=>{
    const created=await worker({min_instances:1,max_instances:1});
    await ensureBaseline(created.id);
    const run=await newRun(created.id);
    const assignment=await tx(t=>claimHostRun(t,run));
    expect(assignment).not.toBeNull();
    if(!assignment)throw new Error('Expected assignment');
    const beforeStops=stops;
    const paused=await tx(t=>changeWorker(t,principal,created.id,'pause'));
    expect(paused.status).toBe('draining');
    await reconcileWorker(principal.organizationId,created.id,()=>provider);
    expect(stops).toBe(beforeStops);
    expect((await tx(t=>getNativeRun(t,run.id))).cancel_requested).toBe(false);
    await tx(t=>releaseHostRun(t,assignment,false,null));
    await reconcileWorker(principal.organizationId,created.id,()=>provider);
    const current=await tx(async t=>presentWorker(t,await getWorker(t,created.id)));
    expect(current).toMatchObject({status:'paused',occupied_slots:0,reserved_micro_usd:'0'});
    expect(stops).toBe(beforeStops+1);
  });
  it('does not oversubscribe a Host when many concurrent claimers see spare capacity',async()=>{
    const created=await worker({min_instances:1,max_instances:1,max_concurrency:50});
    await ensureBaseline(created.id);
    const runs=[];
    for(let index=0;index<8;index++)runs.push(await newRun(created.id));
    const claimed=await Promise.all(runs.map(run=>tx(t=>claimHostRun(t,run))));
    expect(claimed.filter(Boolean)).toHaveLength(3);
    const memory=await tx(async t=>(await t.query<{n:string}>('SELECT coalesce(sum(memory_mib),0)::text AS n FROM host_runs WHERE worker_id=$1 AND released_at IS NULL',[created.id])).rows[0].n);
    expect(memory).toBe('3072');
    for(const assignment of claimed)if(assignment)await tx(t=>releaseHostRun(t,assignment,false,null));
  });
  it('reuses one assignment identity on duplicate claim and records a later pre-launch attempt separately',async()=>{
    const created=await worker({min_instances:1});
    await ensureBaseline(created.id);
    const run=await newRun(created.id);
    const first=await tx(t=>claimHostRun(t,run));
    expect(first).not.toBeNull();if(!first)throw new Error('Expected assignment');
    const repeated=await tx(t=>claimHostRun(t,run));
    expect(repeated?.id).toBe(first.id);
    await tx(t=>releaseHostRun(t,first,false,null));
    const second=await tx(t=>claimHostRun(t,run));
    expect(second?.id).not.toBe(first.id);expect(second?.attempt).toBe(2);
    expect((await tx(t=>activeHostRun(t,run.id)))?.id).toBe(second?.id);
    if(second)await tx(t=>releaseHostRun(t,second,false,null));
  });
  it('holds uncertain provider releases and never counts a timeout as absence',async()=>{
    const created=await worker({min_instances:1});
    const hosts=await ensureBaseline(created.id);
    await tx(t=>changeWorker(t,principal,created.id,'destroy'));
    const uncertain={...provider,destroy:async()=>{throw new Error('timeout');}};
    await reconcileWorker(principal.organizationId,created.id,()=>uncertain);
    expect((await tx(t=>getHost(t,hosts[0].id))).status).toBe('draining');
    await reconcileWorker(principal.organizationId,created.id,()=>provider);
    expect((await tx(t=>getHost(t,hosts[0].id))).status).toBe('stopped');
  });
});

describe('immutable quote and resource billing boundaries',()=>{
  it('reserves exactly the accepted allocation and settles duplicate cumulative samples once',async()=>{
    const created=await worker({max_instances:1,max_hourly_compute_cost_micro_usd:'3600000'});
    const host=await tx(async t=>{
      await lock(t,`worker:${created.id}`);
      const row=await getWorker(t,created.id);
      const quote={...row.offerings[0],revision:id(),price:{kind:'allocation' as const,hourly_micro_usd:'3600000'}};
      await t.query('UPDATE workers SET offerings=$2 WHERE id=$1',[created.id,JSON.stringify([quote])]);
      return reserveHost(t,{...row,offerings:[quote]},quote);
    });
    expect(host.reserved_micro_usd).toBe('3600000');
    await tx(async t=>{await lock(t,`host:${host.id}`);await settleHostSample(t,await getHost(t,host.id),{kind:'allocation',elapsed_ms:'1000'});});
    await tx(async t=>{await lock(t,`host:${host.id}`);await settleHostSample(t,await getHost(t,host.id),{kind:'allocation',elapsed_ms:'1000'});});
    const current=await tx(t=>getHost(t,host.id));
    expect(current.charged_micro_usd).toBe('1000');expect(current.reserved_micro_usd).toBe('3599000');
    await expect(tx(async t=>{await lock(t,`host:${host.id}`);await settleHostSample(t,await getHost(t,host.id),{kind:'allocation',elapsed_ms:'999'});})).rejects.toMatchObject({code:'compute_meter_regressed'});
  });
});
