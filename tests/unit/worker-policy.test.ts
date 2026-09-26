import { describe, expect, it } from 'vitest';
import { resolveWorkerSettings, requestWorkerAction, workerAdmissionBlock, workerObservedStatus } from '../../packages/core/src/worker-policy';
import { workerAccruedCost, workerChargeDelta, workerHourlyExposure, workerMicroBudget, workerMicroToUsd, workerUsdToMicro } from '../../packages/core/src/worker-pricing';
import { chooseWorkerPlacement } from '../../packages/core/src/worker-placement';
import type { ComputeOffering, HostSnapshot, RunDemand, WorkerIdentity, WorkerInput, WorkerPolicyLimits } from '../../packages/core/src/worker-types';

const now = Date.parse('2026-09-01T00:00:00Z');
const limits: WorkerPolicyLimits = { region:'local',runtime:'managed-1',default_hourly_compute_cost_micro_usd:'4000000',
  default_max_instances:4,max_instances:16,default_max_concurrency:50,max_concurrency:50 };
const offering: ComputeOffering = { id:'server',revision:'quote-1',compute:'server',dedicated:true,isolate_runs:false,
  region:'local',runtime:'managed-1',size:'2cpu-4g',resources:{memory_mib:4096,cpu_millis:2000},concurrency:8,
  max_host_lifetime_seconds:null,price:{kind:'allocation',hourly_micro_usd:'1000000'} };
const worker = (input:WorkerInput={}):WorkerIdentity => ({id:'worker-a',organization_id:'org-a',desired_state:'enabled',
  settings:resolveWorkerSettings({compute:'server',dedicated:true,isolate_runs:false,...input},limits,now)});
const demand:RunDemand={run_id:'run-a',resources:{memory_mib:1024,cpu_millis:250},execution_seconds:600,cleanup_seconds:180,
  worktree:{id:'files-a',revision:'r2'},session:{id:'session-a',revision:'s3'},permission_view:'view-a',compatibility_key:'harness-a'};
const host = (patch:Partial<HostSnapshot>={}):HostSnapshot=>({id:'host-a',organization_id:'org-a',worker_id:'worker-a',generation:1,
  status:'ready',billable:true,offering,occupied_slots:0,allocated:{memory_mib:0,cpu_millis:0},retained_memory_mib:0,
  expires_at_ms:null,worktrees:[],warm_harnesses:[],...patch});

describe('Worker economic settings and lifecycle',()=>{
  it('defaults to isolated metered compute without forcing instance management',()=>{
    expect(resolveWorkerSettings({},limits,now)).toMatchObject({compute:'sandbox',dedicated:false,isolate_runs:true,
      min_instances:0,max_instances:null,max_concurrency:50,idle_timeout_seconds:300,size:null});
  });
  it('keeps tenancy independent from sibling isolation and preserves numeric zero',()=>{
    expect(worker({min_instances:0,idle_timeout_seconds:0,max_hourly_compute_cost_micro_usd:'0'}).settings)
      .toMatchObject({dedicated:true,isolate_runs:false,min_instances:0,idle_timeout_seconds:0,max_hourly_compute_cost_micro_usd:'0'});
  });
  it.each([-1,0.5,NaN,Infinity,17])('rejects invalid max_instances %s',value=>{
    expect(()=>worker({max_instances:value})).toThrow();
  });
  it.each([-1,0,1.5,51,Infinity])('rejects invalid max_concurrency %s',value=>{
    expect(()=>worker({max_concurrency:value})).toThrow();
  });
  it.each([-1,86401,0.5,NaN])('rejects invalid idle retention %s',value=>{
    expect(()=>worker({idle_timeout_seconds:value})).toThrow();
  });
  it.each(['2026-02-30T00:00:00Z','2026-08-31T23:59:59Z','2027-01-01','not-a-date'])('rejects expiration %s',value=>{
    expect(()=>worker({expires_at:value})).toThrow();
  });
  it('supports explicit future expiration without a provider lifetime binding',()=>{
    expect(worker({expires_at:'2027-01-01T00:00:00Z'}).settings.expires_at_ms).toBe(Date.parse('2027-01-01T00:00:00Z'));
  });
  it('rejects instance ownership and indefinite retention on pooled compute',()=>{
    for(const input of [{min_instances:0},{max_instances:1},{idle_timeout_seconds:null}])
      expect(()=>resolveWorkerSettings(input,limits,now)).toThrow();
  });
  it('separates manual pause intent from active draining and idle sleep',()=>{
    const enabled=worker();
    const paused={...enabled,desired_state:requestWorkerAction(enabled,'pause',now)};
    expect(workerAdmissionBlock(paused,now)).toBe('worker_paused');
    expect(workerObservedStatus(paused,{ready:1,provisioning:0,draining:0,occupied_slots:2},now)).toBe('draining');
    expect(workerObservedStatus(paused,{ready:0,provisioning:0,draining:0,occupied_slots:0},now)).toBe('paused');
    expect(workerObservedStatus(enabled,{ready:0,provisioning:0,draining:0,occupied_slots:0},now)).toBe('sleeping');
    expect(requestWorkerAction(paused,'resume',now)).toBe('enabled');
  });
  it('destroy is idempotent but neither resume nor pause resurrects a retired Worker',()=>{
    const retired={...worker(),desired_state:'destroyed' as const};
    expect(requestWorkerAction(retired,'destroy',now)).toBe('destroyed');
    expect(()=>requestWorkerAction(retired,'resume',now)).toThrow();
    expect(()=>requestWorkerAction(retired,'pause',now)).toThrow();
  });
});

describe('exact Worker prices and sampling-independent billing',()=>{
  it.each(['-1','01','1e3','1.1','',' 1','1000000000000000'])('rejects micro-USD value %j',value=>{
    expect(()=>workerMicroBudget(value)).toThrow();
  });
  it('converts dollar strings without floating point rounding',()=>{
    expect(workerUsdToMicro('12.345678')).toBe(12345678n);
    expect(workerMicroToUsd(12345678n)).toBe('12.345678');
    expect(workerUsdToMicro('0.000001')).toBe(1n);
  });
  it('prices active CPU and allocated memory with exact units',()=>{
    const price={kind:'resource' as const,cpu_hour_micro_usd:'2000000',gib_hour_micro_usd:'1000000'};
    expect(workerHourlyExposure(price,{cpu_millis:250,memory_mib:512})).toBe(1000000n);
    expect(workerAccruedCost(price,{kind:'resource',cpu_ms:'1800000',memory_mib_ms:'1843200000'})).toBe(1500000n);
  });
  it('charges the same allocation regardless of how often observations arrive',()=>{
    const price={kind:'allocation' as const,hourly_micro_usd:'37'};
    let charged=0n;
    for(let ms=1;ms<=1000;ms++) charged+=workerChargeDelta(price,{kind:'allocation',elapsed_ms:String(ms-1)},{kind:'allocation',elapsed_ms:String(ms)});
    expect(charged).toBe(1n);
    expect(charged).toBe(workerAccruedCost(price,{kind:'allocation',elapsed_ms:'1000'}));
  });
  it('deduplicates identical samples and rejects regressing meters',()=>{
    const sample={kind:'allocation' as const,elapsed_ms:'1000'};
    expect(workerChargeDelta(offering.price,sample,sample)).toBe(0n);
    expect(()=>workerChargeDelta(offering.price,sample,{kind:'allocation',elapsed_ms:'999'})).toThrow();
  });
});

describe('reactive placement under hard constraints',()=>{
  it('reuses matching clean files independently from a warm process',()=>{
    expect(chooseWorkerPlacement(worker(),demand,[host({worktrees:[{worktree_id:'files-a',revision:'r2',permission_view:'view-a',state:'clean'}]})],[offering],now))
      .toMatchObject({action:'place',host_id:'host-a',reuse:'files'});
  });
  it.each(['wrong-view','stale','dirty'])('does not treat %s files as a cache hit',kind=>{
    const cache={worktree_id:'files-a',revision:kind==='stale'?'r1':'r2',permission_view:kind==='wrong-view'?'view-b':'view-a',
      state:kind==='dirty'?'recovery_required' as const:'clean' as const};
    expect(chooseWorkerPlacement(worker(),demand,[host({worktrees:[cache]})],[offering],now)).toMatchObject({action:'place',reuse:'cold'});
  });
  it('ignores another tenant and another Worker even when their cache looks useful',()=>{
    expect(chooseWorkerPlacement(worker(),demand,[host({organization_id:'org-b'}),host({worker_id:'worker-b'})],[offering],now)).toMatchObject({action:'provision'});
  });
  it('counts draining and unconfirmed-start allocations against the price ceiling',()=>{
    const w=worker({max_hourly_compute_cost_micro_usd:'1999999'});
    expect(chooseWorkerPlacement(w,demand,[host({status:'draining'})],[offering],now)).toEqual({action:'wait',reason:'worker_cost_limit'});
    expect(chooseWorkerPlacement(worker({max_hourly_compute_cost_micro_usd:'2000000'}),demand,[host({status:'draining'})],[offering],now)).toMatchObject({action:'provision'});
  });
  it('does not create duplicate capacity while compatible compute is starting',()=>{
    expect(chooseWorkerPlacement(worker(),demand,[host({status:'provisioning',billable:false})],[offering],now)).toEqual({action:'wait',reason:'worker_starting'});
  });
  it('requires resource headroom and does not let a cache hit overrule capacity',()=>{
    const full=host({allocated:{memory_mib:3000,cpu_millis:1000},occupied_slots:2,
      worktrees:[{worktree_id:'files-a',revision:'r2',permission_view:'view-a',state:'clean'}]});
    expect(chooseWorkerPlacement(worker(),demand,[full],[offering],now)).toMatchObject({action:'provision'});
  });
  it('honors cleanup ownership in the concurrent execution ceiling',()=>{
    expect(chooseWorkerPlacement(worker({max_concurrency:1}),demand,[host({occupied_slots:1})],[offering],now)).toEqual({action:'wait',reason:'worker_concurrency'});
  });
  it('never substitutes a different economic offering',()=>{
    expect(chooseWorkerPlacement(worker(),demand,[],[{...offering,compute:'sandbox'}],now)).toEqual({action:'wait',reason:'compute_unavailable'});
  });
  it('does not admit a Run beyond the customer expiration',()=>{
    expect(chooseWorkerPlacement(worker({expires_at:new Date(now+700000).toISOString()}),demand,[],[offering],now)).toEqual({action:'wait',reason:'worker_lifetime'});
  });
  it('ignores a Host that cannot survive the execution and cleanup window',()=>{
    expect(chooseWorkerPlacement(worker(),demand,[host({expires_at_ms:now+600000})],[offering],now)).toMatchObject({action:'provision'});
  });
});
