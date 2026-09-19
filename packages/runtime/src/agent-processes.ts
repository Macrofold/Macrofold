import { lstat, readFile, readdir } from 'node:fs/promises';

/** Root owns quiescence. Harness/tool descendants share the isolated agent UID. */
export async function agentProcesses(): Promise<Map<number, string>> {
  const processes = new Map<number, string>();
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if ((await lstat(`/proc/${entry}`)).uid !== 10001) continue;
      const status = await readFile(`/proc/${entry}/status`, 'utf8');
      const state = /^State:\s+(\S)/m.exec(status)?.[1];
      if (state && state !== 'Z') processes.set(Number(entry), state);
    } catch (error) {
      if (!['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
    }
  }
  return processes;
}
export function signalAgent(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
/** Stop writers first, then discard tool descendants before retaining native state.
 * A failed fence is fatal; no checkpoint may be published while a writer lives. */
export async function freezeAgent(retain: ReadonlySet<number>) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const processes = await agentProcesses();
    if ([...processes].every(([pid, state]) => retain.has(pid) && state === 'T')) return;
    for (const [pid] of processes) signalAgent(pid, retain.has(pid) ? 'SIGSTOP' : 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('checkpoint_writers_remain');
}
export async function stopAgent() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const processes = await agentProcesses();
    if (!processes.size) return;
    for (const [pid] of processes) signalAgent(pid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('checkpoint_writers_remain');
}
