import { describe, expect, it } from 'vitest';
import { HostMeter } from '../../packages/runtime/src/host-meter';
import { hostRunPaths, KeyedCommands } from '../../packages/runtime/src/host-paths';
import { hostControlRequest } from '../../packages/contracts/host-control';

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
  it('requires assignment fencing on all execution-control messages',()=>{
    expect(hostControlRequest.safeParse({action:'launch',run_id:assignment}).success).toBe(false);
    expect(hostControlRequest.safeParse({action:'launch',run_id:assignment,assignment_id:handle}).success).toBe(true);
  });
  it('rejects control transfers outside approved chunk and manifest paths',()=>{
    for(const unsafe of ['../config.json','/etc/passwd','page-1.json/../../config','chunks/abc'])
      expect(hostControlRequest.safeParse({action:'stage',run_id:assignment,assignment_id:handle,files:[{path:unsafe,content:''}]}).success).toBe(false);
  });
});
