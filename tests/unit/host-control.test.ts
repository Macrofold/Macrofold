import { describe, expect, it } from 'vitest';
import { HostMeter } from '../../packages/runtime/src/host-meter';
import { assignedRoots, hostRunPaths, KeyedCommands } from '../../packages/runtime/src/host-paths';
import { hostControlRequest } from '../../packages/contracts/host-control';
import { HostController } from '../../packages/runtime/src/host-control';

const assignment='019e1700-0000-7000-8000-000000000001';
const handle='019e1700-0000-7000-8000-000000000002';
const worktree='019e1700-0000-7000-8000-000000000003';

describe('Host-scoped resource meters',()=>{
  it('accumulates active CPU and allocated memory but not idle speculative caching',async()=>{
    let clock=0n,cpu=0n;
    const meter=new HostMeter(async()=>cpu,()=>clock);
    await meter.claim('a',1024);
    clock=1000n;cpu=2000000n;
    expect(await meter.sample()).toEqual({kind:'resource',cpu_ms:'2000',memory_mib_ms:'1024000'});
    clock=2000n;cpu=3000000n;
    await meter.release('a');
    clock=5000n;cpu=8000000n;
    expect(await meter.sample()).toEqual({kind:'resource',cpu_ms:'3000',memory_mib_ms:'2048000'});
    await meter.claim('b',512);
    clock=6000n;cpu=8500000n;
    expect(await meter.sample()).toEqual({kind:'resource',cpu_ms:'3500',memory_mib_ms:'2560000'});
  });
  it('accounts overlapping allocations without double counting repeated claim or release',async()=>{
    let clock=0n;
    const meter=new HostMeter(async()=>0n,()=>clock);
    await meter.claim('a',1024);
    await meter.claim('a',1024);
    clock=100n;await meter.claim('b',512);
    clock=200n;await meter.release('a');
    await meter.release('a');
    clock=300n;await meter.release('b');
    expect(await meter.sample()).toEqual({kind:'resource',cpu_ms:'0',memory_mib_ms:'307200'});
  });
  it('rejects changed allocation identity and regressing CPU',async()=>{
    let cpu=1000n;
    const meter=new HostMeter(async()=>cpu,()=>100n);
    await meter.claim('a',512);
    await expect(meter.claim('a',1024)).rejects.toThrow('allocation_identity_changed');
    cpu=0n;
    await expect(meter.sample()).rejects.toThrow('host_meter_regressed');
  });
  it('does not translate missing CPU observations into zero usage',async()=>{
    const meter=new HostMeter(async()=>{throw new Error('missing');},()=>0n);
    await expect(meter.claim('a',512)).rejects.toThrow('missing');
  });
});

describe('control ownership',()=>{
  it('serializes one assignment while other assignments remain responsive',async()=>{
    const queue=new KeyedCommands();
    let release!:()=>void;
    const barrier=new Promise<void>(resolve=>{release=resolve;});
    const order:string[]=[];
    const slow=queue.run('a',async()=>{order.push('a-start');await barrier;order.push('a-end');});
    const same=queue.run('a',async()=>{order.push('a-second');});
    await queue.run('b',async()=>{order.push('b');});
    expect(order).toEqual(['a-start','b']);
    release();await Promise.all([slow,same]);
    expect(order).toEqual(['a-start','b','a-end','a-second']);
  });
  it('does not poison subsequent control messages after a failed command',async()=>{
    const queue=new KeyedCommands();
    await expect(queue.run('a',async()=>{throw new Error('failure');})).rejects.toThrow('failure');
    await expect(queue.run('a',async()=>42)).resolves.toBe(42);
  });
  it('keeps Worktree paths stable while assignment and harness control roots differ',()=>{
    const roots=hostRunPaths({assignmentId:assignment,handleId:handle,worktreeId:worktree,uid:20000,memoryMiB:1024});
    expect(roots.workspace).toBe(`/host-data/worktrees/${worktree}`);
    expect(roots.control).toBe(`/platform-control/assignments/${assignment}`);
    expect(roots.home).toBe(`/host-data/handles/${handle}/home`);
  });
  it('rejects arbitrary directories and wrong ownership before resolving a path',()=>{
    expect(()=>hostRunPaths({assignmentId:'../root',handleId:handle,worktreeId:worktree,uid:20000,memoryMiB:1024})).toThrow();
    expect(()=>hostRunPaths({assignmentId:assignment,handleId:handle,worktreeId:worktree,uid:0,memoryMiB:1024})).toThrow();
  });
  it('resolves protected command roots only from the assignment that owns the control directory',()=>{
    const hostRun={assignmentId:assignment,handleId:handle,worktreeId:worktree,uid:20000,memoryMiB:1024};
    const paths=hostRunPaths(hostRun);
    expect(assignedRoots({workspace:'/workspace',stateHome:'/agent-home'},'/platform-control'))
      .toEqual({workspace:'/workspace',home:'/agent-home',uid:10001});
    expect(assignedRoots({hostRun,workspace:paths.workspace,stateHome:paths.home},paths.control))
      .toEqual({workspace:paths.workspace,home:paths.home,uid:20000});
  });
  it.each([
    ['a different default workspace',{workspace:'/etc',stateHome:'/agent-home'},'/platform-control'],
    ['a different default home',{workspace:'/workspace',stateHome:'/root'},'/platform-control'],
    ['default roots for an assigned HostRun',{hostRun:{assignmentId:assignment,handleId:handle,worktreeId:worktree,uid:20000,memoryMiB:1024},workspace:'/workspace',stateHome:'/agent-home'},`/platform-control/assignments/${assignment}`],
    ['another assignment control directory',{hostRun:{assignmentId:assignment,handleId:handle,worktreeId:worktree,uid:20000,memoryMiB:1024},workspace:`/host-data/worktrees/${worktree}`,stateHome:`/host-data/handles/${handle}/home`},'/platform-control/assignments/019e1700-0000-7000-8000-000000000009'],
  ])('rejects %s before a protected command changes identity',(_name,configuration,control)=>{
    expect(()=>assignedRoots(configuration,control)).toThrow('Unexpected runtime roots');
  });
  it('requires assignment fencing on all execution-control messages',()=>{
    expect(hostControlRequest.safeParse({action:'launch',run_id:assignment}).success).toBe(false);
    expect(hostControlRequest.safeParse({action:'launch',run_id:assignment,assignment_id:handle}).success).toBe(true);
  });
  it('rejects control transfers outside approved chunk and manifest paths',()=>{
    for(const unsafe of ['../config.json','/etc/passwd','page-1.json/../../config','chunks/abc'])
      expect(hostControlRequest.safeParse({action:'stage',run_id:assignment,assignment_id:handle,files:[{path:unsafe,content:''}]}).success).toBe(false);
  });
});

describe('Host controller generation fences',()=>{
  const run='019e1700-0000-7000-8000-000000000011';
  const request=(value:unknown)=>hostControlRequest.parse(value);
  const configure=(overrides:Record<string,unknown>={})=>request({action:'configure',host_id:'019e1700-0000-7000-8000-000000000012',
    generation:1,concurrency:2,isolate_runs:false,resources:{memory_mib:4096,cpu_millis:2000},warm_memory_mib:1024,warm_idle_seconds:300,...overrides});
  const release=(assignmentId:string)=>request({action:'release',run_id:run,assignment_id:assignmentId,checkpoint_id:null,session_revision:'1',persisted:false});
  it('reports an unconfigured generation and refuses work before configuration',async()=>{
    const host=new HostController();
    expect(await host.control(request({action:'health'}))).toMatchObject({boot_id:host.boot,configured:false,quiesced:false,active_assignments:0});
    await expect(host.control(request({action:'prepare',run_id:run,assignment_id:assignment,configuration:{},worktree_id:worktree,session_id:null,
      permission_view:'a'.repeat(64),checkpoint_id:null,session_revision:'0',compatibility_key:'b'.repeat(64),resources:{memory_mib:1024,cpu_millis:250}})))
      .rejects.toThrow('host_rotation_required');
  });
  it('rejects shared concurrency on an isolated generation before touching Host storage',async()=>{
    const host=new HostController();
    await expect(host.control(configure({isolate_runs:true,concurrency:2}))).rejects.toThrow('isolation_requires_exclusive_host');
    expect(await host.control(request({action:'health'}))).toMatchObject({configured:false});
  });
  it('seals a quiescent generation with a repeatable receipt that cannot be reconfigured',async()=>{
    const host=new HostController();
    const receipt=await host.control(request({action:'quiesce'}));
    expect(receipt).toMatchObject({boot_id:host.boot,quiesced:true,active_assignments:0});
    // A lost acknowledgement is retried against the same immutable receipt.
    expect(await host.control(request({action:'quiesce'}))).toEqual(receipt);
    await expect(host.control(configure())).rejects.toThrow('host_rotation_required');
  });
  it('tombstones an unknown release idempotently and fails other commands for unknown assignments closed',async()=>{
    const host=new HostController();
    expect(await host.control(release(assignment))).toEqual({});
    expect(await host.control(release(assignment))).toEqual({});
    await expect(host.control(request({action:'probe',run_id:run,assignment_id:assignment,offset:0}))).rejects.toThrow('assignment_not_active');
    await expect(host.control(request({action:'launch',run_id:run,assignment_id:handle}))).rejects.toThrow('assignment_not_active');
  });
});

