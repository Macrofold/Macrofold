import { spawn } from 'node:child_process';
import { open, readFile, readdir } from 'node:fs/promises';
import type { MemoryFailure } from '../../contracts/native-diagnostics';

type ProcessKind = MemoryFailure['largest_processes'][number]['kind'];
type ProcessInfo = { uid: number; state: string; rssKiB: number | null; kind: ProcessKind };
export type AgentMemorySample = {
  observedAtMs: number;
  rssBytes: number;
  processCount: number;
  unavailableProcessCount: number;
  processes: ReadonlyMap<number, { rssBytes: number | null; kind: ProcessKind }>;
};
let inventoryInFlight: Promise<Map<number, ProcessInfo>> | undefined;
function identity(uid: number) {
  if (!Number.isSafeInteger(uid) || uid < 10001 || uid > 2147483646)
    throw new Error('invalid_agent_identity');
}
/** Concurrent supervisors share only an in-flight scan, never a stale quiescence result. */
async function inventory(): Promise<Map<number, ProcessInfo>> {
  if (inventoryInFlight) return inventoryInFlight;
  const task = (async () => {
    const processes = new Map<number, ProcessInfo>();
    const entries = (await readdir('/proc')).filter((name) => /^\d+$/.test(name));
    for (let offset = 0; offset < entries.length; offset += 32)
      await Promise.all(
        entries.slice(offset, offset + 32).map(async (entry) => {
          try {
            const status = await readFile(`/proc/${entry}/status`, 'utf8');
            const uid = Number(/^Uid:\s+\d+\s+(\d+)/m.exec(status)?.[1]);
            const state = /^State:\s+(\S)/m.exec(status)?.[1];
            const name = /^Name:\s+([^\n]+)/m.exec(status)?.[1];
            const kind: ProcessKind =
              name === 'node' || name === 'MainThread'
                ? 'node'
                : name === 'opencode'
                  ? 'opencode'
                  : name === 'bun'
                    ? 'bun'
                    : name === 'python' || name === 'python3'
                      ? 'python'
                      : 'other';
            const rss = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1];
            const rssKiB = rss === undefined ? null : Number(rss);
            if (Number.isInteger(uid) && state && state !== 'Z')
              processes.set(Number(entry), {
                uid,
                state,
                kind,
                rssKiB:
                  rssKiB !== null && Number.isSafeInteger(rssKiB) && rssKiB <= Number.MAX_SAFE_INTEGER / 1024
                    ? rssKiB
                    : null,
              });
          } catch (error) {
            if (!['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
          }
        }),
      );
    return processes;
  })();
  inventoryInFlight = task;
  try {
    return await task;
  } finally {
    if (inventoryInFlight === task) inventoryInFlight = undefined;
  }
}
export async function agentProcesses(uid = 10001): Promise<Map<number, string>> {
  identity(uid);
  return new Map(
    [...(await inventory())]
      .filter(([, value]) => value.uid === uid)
      .map(([pid, value]) => [pid, value.state]),
  );
}
export async function agentMemoryMiB(uid = 10001): Promise<number> {
  return Math.ceil((await agentMemorySample(uid)).rssBytes / 1024 / 1024);
}
/** Reuse the guard's inventory; RSS is a sum, not unique physical memory. */
export async function agentMemorySample(uid = 10001): Promise<AgentMemorySample> {
  identity(uid);
  const current = await inventory();
  const processes = new Map<number, { rssBytes: number | null; kind: ProcessKind }>();
  let rssBytes = 0,
    unavailableProcessCount = 0;
  for (const [pid, value] of current)
    if (value.uid === uid) {
      const bytes = value.rssKiB === null ? null : value.rssKiB * 1024;
      processes.set(pid, { rssBytes: bytes, kind: value.kind });
      if (bytes === null) unavailableProcessCount++;
      else rssBytes += bytes;
    }
  return {
    observedAtMs: performance.now(),
    rssBytes,
    processCount: processes.size,
    unavailableProcessCount,
    processes,
  };
}

/** Retain only a fixed projection, never the inventory or raw process names. */
export function largestMemoryProcesses(
  sample: AgentMemorySample,
  limit: 5 | 8 = 5,
): MemoryFailure['largest_processes'] {
  const largest: MemoryFailure['largest_processes'] = [];
  for (const [pid, value] of sample.processes) {
    if (value.rssBytes === null) continue;
    const rssBytes = value.rssBytes;
    const index = largest.findIndex(
      (other) => rssBytes > other.rss_bytes || (rssBytes === other.rss_bytes && pid < other.pid),
    );
    if (index >= 0) largest.splice(index, 0, { pid, kind: value.kind, rss_bytes: rssBytes });
    else if (largest.length < limit) largest.push({ pid, kind: value.kind, rss_bytes: rssBytes });
    if (largest.length > limit) largest.pop();
  }
  return largest;
}

export type PssRead =
  { pssBytes: number } | { reason: 'permissions' | 'unsupported' | 'vanished' | 'read_failed' };
/** Verify and read one descriptor, so PID reuse cannot redirect the read to another UID. */
export async function agentPss(pid: number, uid: number): Promise<PssRead> {
  identity(uid);
  if (!Number.isSafeInteger(pid) || pid <= 1) return { reason: 'vanished' };
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(`/proc/${pid}/smaps_rollup`, 'r');
    if ((await file.stat()).uid !== uid) return { reason: 'vanished' };
    const bytes = Buffer.alloc(16 * 1024 + 1);
    const result = await file.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead > 16 * 1024) return { reason: 'read_failed' };
    const value = /^Pss:\s+(\d+)\s+kB$/m.exec(bytes.toString('utf8', 0, result.bytesRead))?.[1];
    if (value === undefined) return { reason: 'unsupported' };
    const pssBytes = Number(value) * 1024;
    return Number.isSafeInteger(pssBytes) ? { pssBytes } : { reason: 'read_failed' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      reason:
        code === 'EACCES' || code === 'EPERM'
          ? 'permissions'
          : code === 'ENOENT' || code === 'ESRCH'
            ? 'vanished'
            : 'read_failed',
    };
  } finally {
    await file?.close().catch(() => {});
  }
}
/** The signal sender drops to the target UID. PID reuse therefore cannot signal another handle's process. */
export async function signalAgents(
  pids: Iterable<number>,
  signal: 'SIGSTOP' | 'SIGCONT' | 'SIGTERM' | 'SIGKILL',
  uid = 10001,
) {
  identity(uid);
  const targets = [...pids];
  if (targets.some((pid) => !Number.isSafeInteger(pid) || pid <= 1)) throw new Error('invalid_agent_process');
  for (let offset = 0; offset < targets.length; offset += 128)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        '/bin/kill',
        ['-s', signal, '--', ...targets.slice(offset, offset + 128).map(String)],
        {
          uid,
          gid: uid,
          stdio: 'ignore',
          env: { PATH: '/usr/bin:/bin', NODE_ENV: 'production' },
        },
      );
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
    if ([...processes].every(([pid, state]) => retain.has(pid) && state === 'T')) {
      if (++stable === 2) return;
    } else {
      stable = 0;
      await signalAgents(
        [...processes.keys()].filter((pid) => retain.has(pid)),
        'SIGSTOP',
        uid,
      );
      await signalAgents(
        [...processes.keys()].filter((pid) => !retain.has(pid)),
        'SIGKILL',
        uid,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('checkpoint_writers_remain');
}
export async function stopAgent(uid = 10001) {
  let stable = 0;
  for (let attempt = 0; attempt < 80; attempt++) {
    const processes = await agentProcesses(uid);
    if (!processes.size) {
      if (++stable === 2) return;
    } else {
      stable = 0;
      await signalAgents(processes.keys(), 'SIGKILL', uid);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('checkpoint_writers_remain');
}
