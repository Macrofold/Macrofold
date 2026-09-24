import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';

type ProcessInfo = { uid: number; state: string; rssKiB: number };
let inventoryInFlight: Promise<Map<number, ProcessInfo>> | undefined;
function identity(uid: number) {
  if (!Number.isSafeInteger(uid) || uid < 10001 || uid > 2147483646) throw new Error('invalid_agent_identity');
}
/** Concurrent supervisors share only an in-flight scan, never a stale quiescence result. */
async function inventory(): Promise<Map<number, ProcessInfo>> {
  if (inventoryInFlight) return inventoryInFlight;
  const task = (async () => {
    const processes = new Map<number, ProcessInfo>();
    const entries = (await readdir('/proc')).filter(name => /^\d+$/.test(name));
    for (let offset = 0; offset < entries.length; offset += 32) await Promise.all(entries.slice(offset, offset + 32).map(async entry => {
      try {
        const status = await readFile(`/proc/${entry}/status`, 'utf8');
        const uid = Number(/^Uid:\s+\d+\s+(\d+)/m.exec(status)?.[1]);
        const state = /^State:\s+(\S)/m.exec(status)?.[1];
        if (Number.isInteger(uid) && state && state !== 'Z') processes.set(Number(entry), {
          uid, state, rssKiB: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] || 0),
        });
      } catch (error) {
        if (!['ESRCH','ENOENT'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      }
    }));
    return processes;
  })();
  inventoryInFlight = task;
  try { return await task; }
  finally { if (inventoryInFlight === task) inventoryInFlight = undefined; }
}
export async function agentProcesses(uid = 10001): Promise<Map<number, string>> {
  identity(uid);
  return new Map([...await inventory()].filter(([,value]) => value.uid === uid).map(([pid,value]) => [pid,value.state]));
}
export async function agentMemoryMiB(uid = 10001): Promise<number> {
  identity(uid);
  return Math.ceil([...await inventory()].filter(([,value]) => value.uid === uid).reduce((sum,[,value]) => sum+value.rssKiB,0)/1024);
}
/** The signal sender drops to the target UID. PID reuse therefore cannot signal another handle's process. */
export async function signalAgents(pids: Iterable<number>, signal: 'SIGSTOP' | 'SIGCONT' | 'SIGTERM' | 'SIGKILL', uid = 10001) {
  identity(uid);
  const targets = [...pids];
  if (targets.some(pid => !Number.isSafeInteger(pid) || pid <= 1)) throw new Error('invalid_agent_process');
  for (let offset = 0; offset < targets.length; offset += 128) await new Promise<void>((resolve,reject) => {
    const child = spawn('/bin/kill', ['-s', signal, '--', ...targets.slice(offset,offset+128).map(String)], {
      uid, gid: uid, stdio: 'ignore', env: { PATH: '/usr/bin:/bin', NODE_ENV: 'production' },
    });
    child.once('error', reject);
    // A disappeared/reused PID may return EPERM/ESRCH. The following inventory, not an exit-code guess, proves quiescence.
    child.once('close', () => resolve());
  });
}
/** Two consecutive quiescent inventories close the fork-versus-/proc-enumeration race. */
export async function freezeAgent(retain: ReadonlySet<number>, uid = 10001) {
  let stable = 0;
  for (let attempt = 0; attempt < 80; attempt++) {
    const processes = await agentProcesses(uid);
    if ([...processes].every(([pid,state]) => retain.has(pid) && state === 'T')) {
      if (++stable === 2) return;
    } else {
      stable = 0;
      await signalAgents([...processes.keys()].filter(pid => retain.has(pid)), 'SIGSTOP', uid);
      await signalAgents([...processes.keys()].filter(pid => !retain.has(pid)), 'SIGKILL', uid);
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('checkpoint_writers_remain');
}
export async function stopAgent(uid = 10001) {
  let stable = 0;
  for (let attempt = 0; attempt < 80; attempt++) {
    const processes = await agentProcesses(uid);
    if (!processes.size) { if (++stable === 2) return; }
    else { stable = 0; await signalAgents(processes.keys(), 'SIGKILL', uid); }
    await new Promise(resolve => setTimeout(resolve,25));
  }
  throw new Error('checkpoint_writers_remain');
}
