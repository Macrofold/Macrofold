import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { customerScopes, type Principal } from '../../packages/core/src/auth';
import { fixtureAccount } from '../fixtures/account';
import { createKey } from '../../packages/core/src/keys';
import { credit } from '../../packages/core/src/ledger';
import { executeRun } from '../../packages/core/src/engine';
import { reconcileWorker } from '../../packages/core/src/worker-reconciler';
import { id } from '../../packages/core/src/crypto';
import { pool, authPool, transaction } from '../../packages/db';
import type { ExecutionProvider } from '../../packages/providers/src/execution';
import type { components } from '../../packages/contracts/api';
import contract from '../../docs/api/openapi.json';

type Schema=components['schemas'];
const ajv=new Ajv({strict:false});addFormats(ajv);
let owner:Principal,key:string;
beforeAll(async()=>{
  const account=await fixtureAccount('Worker API');
  owner={...account.p,scopes:customerScopes};
  await transaction(owner.organizationId,async tx=>{
    await credit(tx,owner.organizationId,100000000n,`worker-api:${id()}`);
    await tx.query("UPDATE organizations SET plan='scale' WHERE id=$1",[owner.organizationId]);
    key=(await createKey(tx,owner,{name:'Worker API tests',scopes:customerScopes})).secret;
  });
});
afterAll(async()=>{await pool.end();await authPool.end();});
async function request<T extends keyof Schema>(schema:T,method:string,path:string,body?:unknown,credential=key,idem=id()) {
  const response=await handleApi(new Request(`${config.origin}${path}`,{
    method,headers:{authorization:`Bearer ${credential}`,'content-type':'application/json','idempotency-key':idem},
    body:body===undefined?undefined:JSON.stringify(body),
  }));
  const value:unknown=await response.json();
  const validate=ajv.compile<Schema[T]>({$ref:`#/components/schemas/${schema}`,components:contract.components});
  if(!validate(value))throw new Error(`HTTP ${response.status} does not match ${schema}: ${JSON.stringify({value,errors:validate.errors})}`);
  return {response,value};
}
const fast:ExecutionProvider={async execute(input,emit){
  await emit({type:'runtime.started',data:{harness:input.harness,simulated:true}});
  return {output:'Worker API fixture complete',files:input.files,resumeState:'fixture-state',inputTokens:0,outputTokens:0,usageComplete:true};
}};
async function createWorker(extra:Partial<Schema['WorkerCreate']>={}) {
  const result=await request('Worker','POST','/v1/workers',{name:`api-worker-${id()}`,compute:'server',dedicated:true,isolate_runs:false,
    min_instances:0,max_instances:2,max_concurrency:4,max_hourly_compute_cost_micro_usd:'1000000',...extra});
  expect(result.response.status).toBe(202);return result.value;
}
async function run(workerId:string,extra:Partial<Schema['RunCreate']>={}) {
  const workspace=(await request('Workspace','POST','/v1/workspaces',{name:`Worker files ${id()}`})).value;
  const result=await request('RunAccepted','POST','/v1/runs',{worktree_id:workspace.default_worktree_id,prompt:'Worker API fixture',
    harness:'codex',model:'fixture-model',billing_mode:'managed',worker_id:workerId,...extra});
  expect(result.response.status).toBe(202);return result.value;
}

describe('public Worker contract and execution path',()=>{
  it('executes a Run on its chosen Worker and releases capacity after verified persistence',async()=>{
    const worker=await createWorker();
    const accepted=await run(worker.id);
    expect(accepted.worker_id).toBe(worker.id);
    expect(await executeRun(owner.organizationId,accepted.run_id,fast)).toBe(false);
    await reconcileWorker(owner.organizationId,worker.id);
    expect(await executeRun(owner.organizationId,accepted.run_id,fast)).toBe(true);
    const completed=(await request('Run','GET',`/v1/runs/${accepted.run_id}`)).value;
    expect(completed).toMatchObject({status:'succeeded',worker_id:worker.id,persistence_status:'verified'});
    const observed=(await request('Worker','GET',`/v1/workers/${worker.id}`)).value;
    expect(observed).toMatchObject({occupied_slots:0,active_runs:0,ready_instances:1,cost_micro_usd:'0'});
    const pause=await request('Worker','POST',`/v1/workers/${worker.id}/pause`);
    expect(pause.response.status).toBe(202);expect(pause.value.status).toBe('draining');
    await reconcileWorker(owner.organizationId,worker.id);
    expect((await request('Worker','GET',`/v1/workers/${worker.id}`)).value.status).toBe('paused');
    const rejected=await request('Error','POST','/v1/runs',{session_id:completed.session_id,prompt:'Must not wake manual pause',worker_id:worker.id});
    expect(rejected.response.status).toBe(409);expect(rejected.value.error.code).toBe('worker_paused');
  });
  it('retains ordinary Session continuation shorthand when changing compute',async()=>{
    const first=await createWorker();const accepted=await run(first.id);
    await reconcileWorker(owner.organizationId,first.id);await executeRun(owner.organizationId,accepted.run_id,fast);
    const second=await createWorker();
    const next=await request('RunAccepted','POST','/v1/runs',{session_id:accepted.session_id,prompt:'Continue on another Worker',worker_id:second.id});
    expect(next.value.session_id).toBe(accepted.session_id);expect(next.value.worker_id).toBe(second.id);
    await reconcileWorker(owner.organizationId,second.id);expect(await executeRun(owner.organizationId,next.value.run_id,fast)).toBe(true);
    expect((await request('Run','GET',`/v1/runs/${next.value.run_id}`)).value.status).toBe('succeeded');
  });
  it('uses additional Hosts for concurrent resource demand without asking the caller to route',async()=>{
    const worker=await createWorker({max_instances:2,max_concurrency:2});
    const a=await run(worker.id,{memory_mib:2048});const b=await run(worker.id,{memory_mib:2048});
    await reconcileWorker(owner.organizationId,worker.id);
    let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;});
    const barrier=new Promise<void>(resolve=>{release=resolve;});
    const held:ExecutionProvider={async execute(input,emit){entered();await barrier;return fast.execute(input,emit);}};
    const active=executeRun(owner.organizationId,a.run_id,held);
    try {
      await started;
      // One reconciliation projects both queued allocations; no second wake is required.
      expect((await request('Worker','GET',`/v1/workers/${worker.id}`)).value.ready_instances).toBe(2);
      expect(await executeRun(owner.organizationId,b.run_id,fast)).toBe(true);
      const during=(await request('Worker','GET',`/v1/workers/${worker.id}`)).value;
      expect(during.active_runs).toBe(1);expect(during.occupied_slots).toBe(1);
    } finally {release();await active;}
  });
  it('deduplicates Worker creation and enforces configuration revisions at the HTTP boundary',async()=>{
    const body={compute:'server',dedicated:true,isolate_runs:false,name:`Idempotent ${id()}`};const key=id();
    const first=await request('Worker','POST','/v1/workers',body,undefined,key);
    const duplicate=await request('Worker','POST','/v1/workers',body,undefined,key);
    expect(duplicate.value.id).toBe(first.value.id);
    const updated=await request('Worker','PATCH',`/v1/workers/${first.value.id}`,{expected_revision:first.value.revision,name:`Updated ${id()}`});
    expect(updated.value.revision).toBe(first.value.revision+1);
    const stale=await request('Error','PATCH',`/v1/workers/${first.value.id}`,{expected_revision:first.value.revision,name:'Stale edit'});
    expect(stale.response.status).toBe(409);expect(stale.value.error.code).toBe('revision_conflict');
  });
  it('returns a sanitized offering catalog and finite effective limits',async()=>{
    const result=await request('WorkerOfferings','GET','/v1/worker-offerings');
    expect(result.value.data.length).toBeGreaterThan(0);
    expect(result.value.limits.max_concurrency).toBe(50);
    expect(JSON.stringify(result.value)).not.toContain('secret_ciphertext');
    expect(result.value.data.every(offer=>!Object.hasOwn(offer,'driver'))).toBe(true);
  });
  it('enforces Worker-ID restrictions independently of Workspace authority',async()=>{
    const a=await createWorker();const b=await createWorker();
    const restricted=await transaction(owner.organizationId,tx=>createKey(tx,owner,{
      name:'One Worker only',scopes:['workers:read','workers:use','runs:read','runs:write','keys:write'],worker_ids:[a.id],
    }));
    expect((await request('Worker','GET',`/v1/workers/${a.id}`,undefined,restricted.secret)).value.id).toBe(a.id);
    const denied=await request('Error','GET',`/v1/workers/${b.id}`,undefined,restricted.secret);
    expect(denied.response.status).toBe(404);
    const listed=(await request('WorkerPage','GET','/v1/workers',undefined,restricted.secret)).value;
    expect(listed.data.map(value=>value.id)).toEqual([a.id]);
    const management=await request('Error','POST',`/v1/workers/${a.id}/pause`,undefined,restricted.secret);
    expect(management.response.status).toBe(403);
    const escalation=await request('Error','POST','/v1/api-keys',{name:'Escalation',scopes:['workers:use']},restricted.secret);
    expect(escalation.response.status).toBe(403);
  });
});
