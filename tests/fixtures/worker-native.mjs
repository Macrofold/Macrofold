// Runs inside a disposable Linux image with networking disabled. Models/tools are loopback protocol fixtures.
import { nativeModelFixture } from './native-model.mjs';
import { nativeBroker } from './native-broker.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const harness=process.argv[2] || 'codex';
const mode=process.argv[3] || 'concurrent';
const secret='synthetic-worker-control-secret-offline-only';
const control=spawn('node',['/opt/platform/host-control.mjs'],{
  env:{PATH:process.env.PATH,NODE_ENV:'production',HOST_CONTROL_SECRET:secret,PORT:'10000'},stdio:'inherit',
});
const digest=value=>createHash('sha256').update(value).digest('hex');
const tokens=new Map();
const characters=[];
const pendingSockets=new Set();
let boot;
const model=createServer((req,res)=>{
  const token=(req.headers.authorization || `Bearer ${req.headers['x-api-key']}`).replace(/^Bearer /,'');
  const character=tokens.get(token);
  if(!character){res.writeHead(401).end();return;}
  if(character.hold && req.url!=='/mcp') {
    character.blocked=true;
    const release=()=>{pendingSockets.delete(release);if(!res.destroyed)character.fixture.handler(req,res);};
    character.releaseModel=release;pendingSockets.add(release);
    return;
  }
  return req.url==='/mcp'?character.broker.handle(req,res):character.fixture.handler(req,res);
});
await new Promise(resolve=>model.listen(8787,'127.0.0.1',resolve));
function character(saved) {
  const value={worktree:saved?.worktree || randomUUID(),session:saved?.session || randomUUID(),revision:saved?.revision || '0',
    checkpoint:saved?.checkpoint || null,resumeId:saved?.resumeId,entries:saved?.entries || [],chunks:saved?.chunks || [],
    hold:false,blocked:false,releaseModel:undefined,token:undefined};
  value.fixture=nativeModelFixture({workspace:`/host-data/worktrees/${value.worktree}`});
  value.broker=nativeBroker(()=>value.token);
  characters.push(value);
  return value;
}
async function request(value,expected=200) {
  const response=await fetch('http://127.0.0.1:10000/control',{
    method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},
    body:JSON.stringify({boot_id:boot,request:value}),signal:AbortSignal.timeout(60000),
  });
  const result=await response.json();
  assert.equal(response.status,expected,JSON.stringify({request:value.action,result}));
  return result.value;
}
async function until(fn,label) {
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error(`Timed out: ${label}`);
}
const scoped=(run,action,extra={})=>({action,run_id:run.id,assignment_id:run.assignment,...extra});
async function start(value,expectWarm=false) {
  const run={id:randomUUID(),assignment:randomUUID(),character:value};
  value.token=`fixture-turn-${run.id}`;
  tokens.set(value.token,value);
  const configuration={runId:run.id,harness,provider:harness==='claude-code'?'anthropic':'openai',
    model:harness==='claude-code'?'claude-sonnet-4-6':'gpt-5.4',
    prompt:value.resumeId?'Confirm the prior task is complete.':'Create native.txt with a short note, then finish.',
    workspace:'/workspace',stateHome:'/agent-home',gatewayURL:'http://127.0.0.1:8787',toolURL:'http://127.0.0.1:8787/mcp',
    token:value.token,deadline:new Date(Date.now()+90000).toISOString(),toolGrants:false,resumeId:value.resumeId};
  const prepare=scoped(run,'prepare',{configuration,worktree_id:value.worktree,session_id:value.session,
    permission_view:digest('fixture-permissions'),checkpoint_id:value.checkpoint,session_revision:value.revision,
    compatibility_key:digest(`fixture-${harness}`),resources:{memory_mib:1536,cpu_millis:500}});
  const prepared=await request(prepare);
  assert.equal(prepared.reused,expectWarm,'warm reuse is distinct from a filesystem cache hit');
  assert.deepEqual(await request(prepare),prepared,'duplicate preparation retains the same identity');
  const selected=value.entries.filter(entry=>prepared.restoreNamespaces?.includes(entry.namespace));
  const hashes=new Set(selected.flatMap(entry=>entry.chunks.map(chunk=>chunk.hash)));
  for(const chunk of value.chunks)if(hashes.has(chunk.path.slice('chunks/'.length)))await request(scoped(run,'stage',{files:[chunk]}));
  if(!expectWarm) {
    await request(scoped(run,'stage',{files:[{path:'page-0.json',content:Buffer.from(JSON.stringify(selected)).toString('base64')}]}));
    await request(scoped(run,'restore'));
    await until(async()=>{const result=await request(scoped(run,'restored'));assert.notEqual(result,'failure');return result==='success';},'verified restore');
  }
  await request(scoped(run,'launch'));
  await request(scoped(run,'launch'));
  return run;
}
async function finish(run,outcome='success',expectWarm=false) {
  const result=await until(async()=>(await request(scoped(run,'probe',{offset:0}))).result,'native completion');
  const probe=await request(scoped(run,'probe',{offset:0}));
  assert.equal(result.outcome,outcome,JSON.stringify({result,events:probe.events}));
  assert.equal(result.persistence,'captured',JSON.stringify(result));
  if(outcome==='success')assert(probe.events.some(event=>event.type==='runtime.started' && event.data.reused===expectWarm),
    `native adapter ${harness} must report actual process reuse`);
  const value=run.character;
  value.entries=[];
  let total=1;
  while(value.entries.length<total){const page=await request(scoped(run,'snapshot',{offset:value.entries.length}));value.entries.push(...page.entries);total=page.total;}
  value.chunks=[];
  for(const hash of new Set(value.entries.flatMap(entry=>entry.chunks.map(chunk=>chunk.hash)))) {
    const chunk=await request(scoped(run,'chunk',{hash}));value.chunks.push({path:`chunks/${hash}`,content:chunk.content});
  }
  if(outcome==='success')assert(value.entries.some(entry=>entry.namespace==='workspace'&&entry.path==='native.txt'),'tool output was captured');
  const excluded=['.runtime-config.json','.claude/.credentials.json','.codex/auth.json','.codex/config.toml','.local/share/opencode/auth.json','.hermes/auth.json','.pi/agent/auth.json'];
  assert(!value.entries.some(entry=>entry.namespace==='home' && excluded.includes(entry.path)),'native credentials cannot enter a checkpoint');
  value.resumeId=result.resumeId;
  value.checkpoint=randomUUID();value.revision=String(Number(value.revision)+1);
  await until(async()=>{
    try{await request(scoped(run,'release',{checkpoint_id:value.checkpoint,session_revision:value.revision,persisted:true}));return true;}
    catch(error){if(!String(error).includes('runtime_not_quiescent'))throw error;return false;}
  },'quiescent release');
  await request(scoped(run,'release',{checkpoint_id:value.checkpoint,session_revision:value.revision,persisted:true}));
  await request(scoped(run,'launch'),409);
  tokens.delete(value.token);
  return result;
}
async function save(value) {
  await writeFile('/worker-exchange/state.json',JSON.stringify({harness,worktree:value.worktree,session:value.session,
    revision:value.revision,checkpoint:value.checkpoint,resumeId:value.resumeId,entries:value.entries,chunks:value.chunks}),{mode:0o600});
}
try {
  boot=(await until(async()=>{try{return await request({action:'health'});}catch{return null;}},'Host startup')).boot_id;
  assert.equal((await fetch('http://127.0.0.1:10000/control',{method:'POST',body:'{}'})).status,401);
  await request({action:'configure',host_id:randomUUID(),generation:1,concurrency:2,isolate_runs:false,
    resources:{memory_mib:4096,cpu_millis:2000},warm_memory_mib:2048,warm_idle_seconds:300});
  if(mode==='import') {
    const saved=JSON.parse(await readFile('/worker-exchange/state.json','utf8'));
    assert.equal(saved.harness,harness);
    const restored=character(saved);
    const run=await start(restored,false);
    await finish(run,'success',false);
    assert(restored.fixture.observed.some(event=>event.hasPriorPrompt),'a fresh Host recovered native conversation history');
    assert.equal(await readFile(`/host-data/worktrees/${restored.worktree}/native.txt`,'utf8'),'native tool persisted\n');
    console.log(`PASS ${harness}: cold continuation on a fresh container, verified files and no injected credentials.`);
  } else {
    const a=character();
    if(mode==='export') {
      const run=await start(a);await finish(run);await save(a);
      console.log(`PASS ${harness}: exported verified Worktree and native continuation for a fresh Host.`);
    } else {
      const b=character();a.hold=true;b.hold=true;
      const first=await start(a);const neighbor=await start(b);
      await until(()=>a.blocked&&b.blocked,'two actual native model requests in flight');
      assert.equal((await request({action:'health'})).active_assignments,2);
      a.hold=false;a.releaseModel();
      await finish(first);
      assert.equal((await request(scoped(neighbor,'probe',{offset:0}))).result,null,'checkpoint and release A cannot stop B');
      await request(scoped(neighbor,'cancel'));
      await finish(neighbor,'cancelled');
      const prior=a.fixture.observed.length;
      const second=await start(a,true);await finish(second,'success',true);
      assert(a.fixture.observed.slice(prior).some(event=>event.hasPriorPrompt),'warm continuation retains the conversation');
      await request(scoped(first,'cancel'),409);
      // Force a new native process and rebuild a stale materialization without depending on the old process.
      a.checkpoint=randomUUID();
      const third=await start(a,false);await finish(third,'success',false);
      const c=character(),d=character();c.hold=true;d.hold=true;
      const cancelled=await start(c);const continuing=await start(d);
      await until(()=>c.blocked&&d.blocked,'concurrent cancellation precondition');
      await request(scoped(cancelled,'cancel'));await finish(cancelled,'cancelled');
      assert.equal((await request(scoped(continuing,'probe',{offset:0}))).result,null,'cancelling C cannot signal D');
      d.hold=false;d.releaseModel();await finish(continuing);
      assert.equal((await request({action:'health'})).active_assignments,0);
      console.log(`PASS ${harness}: simultaneous native Runs, independent capture/cancel, warm continuation, cold reload, credentials and stale-assignment fencing.`);
    }
  }
} finally {
  for(const release of pendingSockets)release();
  control.kill('SIGTERM');
  model.closeAllConnections();model.close();
  // The disposable container owns all native descendants; no process escapes to the developer host.
}
