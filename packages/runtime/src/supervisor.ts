import { hostRunContextSchema, hostRunPaths } from './host-paths';
import { controlDirectory } from './control-directory';
import { permissionLayersSchema } from '../../contracts/permissions';
import { agentProcesses, agentMemoryMiB, freezeAgent, stopAgent, signalAgents } from './agent-processes';
import { warmSessionKey } from './warm-session';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFile, chmod, chown, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { harnessNames } from '../../contracts/harnesses';
import { mediaLimits } from '../../contracts/media';
import { atomicJSON, captureSnapshot } from './manifest';
import type { NativeConfiguration, NativeResult } from './types';

export const runtimeConfiguration = z.object({
  runId: z.uuid(),
  hostRun: hostRunContextSchema.optional(),
  warm: z
    .object({ sessionId: z.uuid(), checkpointId: z.string().nullable(), toolFingerprint: z.string() })
    .optional(),
  harness: z.enum(harnessNames),
  model: z.string().min(1),
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  prompt: z.string(),
  instructions: z.string().optional(),
  harnessPromptMode: z.enum(['replace', 'extend']).optional(),
  attachments: z
    .array(
      z.object({
        path: z.string().min(1).max(4096),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        size_bytes: z.string().regex(/^\d+$/),
        media_type: z.string().min(1),
      }),
    )
    .max(mediaLimits.attachments)
    .optional(),
  workspace: z.string(),
  stateHome: z.string(),
  gatewayURL: z.url(),
  toolURL: z.url(),
  token: z.string().min(1),
  deadline: z.iso.datetime(),
  resumeId: z.string().optional(),
  toolGrants: z.boolean(),
  permissions: permissionLayersSchema.optional(),
});
export type LiveHarness = {
  uid?: number;
  child?: ChildProcessWithoutNullStreams;
  key?: string;
  checkpointId?: string | null;
  resumeId?: string;
  processes: Set<number>;
};
export async function discardHarness(resident: LiveHarness) {
  await stopAgent(resident.uid ?? 10001);
  resident.child?.stdin.destroy();
  resident.child = undefined;
  resident.key = undefined;
  resident.processes.clear();
}
export async function supervise(configurationPath: string, workerPath: string, resident?: LiveHarness) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0)
    throw new Error('Supervisor requires an isolated Linux sandbox and its root user.');
  const c: NativeConfiguration = runtimeConfiguration.parse(
    JSON.parse(await readFile(configurationPath, 'utf8')),
  );
  const UID = c.hostRun?.uid ?? resident?.uid ?? 10001;
  const directory = path.dirname(configurationPath);
  const hostPaths = c.hostRun ? hostRunPaths(c.hostRun) : undefined;
  if (c.hostRun && (!resident || resident.uid !== UID)) throw new Error('Invalid handle ownership');
  if (
    c.workspace !== (hostPaths?.workspace ?? '/workspace') ||
    c.stateHome !== (hostPaths?.home ?? '/agent-home') ||
    (directory !== (hostPaths?.control ?? controlDirectory()) &&
      !(resident && /^\/platform-control\/runs\/[a-f0-9-]+$/.test(directory)))
  )
    throw new Error('Unexpected runtime directories');
  // This atomic marker is deliberately never removed. A retried dispatch cannot repeat native side effects.
  try {
    await mkdir(path.join(directory, 'execution.lock'), { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
  let sequence = 0,
    written = 0,
    truncated = false;
  const event = async (type: string, data: Record<string, unknown>) => {
    if (truncated) return;
    let safe = data;
    let line = JSON.stringify({ sequence: ++sequence, type, data: safe });
    if (Buffer.byteLength(line) > 64 * 1024) {
      safe = {
        truncated: true,
        message: 'Tool payload exceeded 64 KiB; inspect persisted files for full output.',
      };
      line = JSON.stringify({ sequence, type, data: safe });
    }
    written += Buffer.byteLength(line);
    if (written > 64 * 1024 * 1024) {
      truncated = true;
      line = JSON.stringify({
        sequence,
        type: 'runtime.trace_truncated',
        data: { limit_bytes: 64 * 1024 * 1024 },
      });
    }
    await appendFile(path.join(directory, 'events.jsonl'), `${line}\n`, { mode: 0o640 });
  };
  for (const root of [c.workspace, c.stateHome]) {
    await mkdir(root, { recursive: true });
    await chown(root, UID, UID);
  }
  // The capability is scoped to this run. The supervisor's state and checkpoint staging are inaccessible to the agent.
  const workerConfig = path.join(c.stateHome, '.runtime-config.json');
  const transient = path.join(c.stateHome, '.runtime-transient');
  const temporary = hostPaths?.temp ?? path.join(transient, 'tmp');
  if (!hostPaths) {
    // The isolated harness must traverse its private scratch parent as well as
    // write the leaf. Recursive mkdir alone leaves a root-owned 0700 parent.
    await mkdir(transient, { recursive: true, mode: 0o700 });
    await chown(transient, UID, UID);
  }
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  await chown(temporary, UID, UID);
  await writeFile(workerConfig, JSON.stringify(c), { mode: 0o600 });
  await chown(workerConfig, UID, UID);
  await chmod(directory, 0o2770);
  await atomicJSON(path.join(directory, 'status.json'), {
    state: 'running',
    startedAt: new Date().toISOString(),
  });
  let result: NativeResult | undefined,
    pendingInput: string | undefined,
    failure: 'cancelled' | 'timed_out' | undefined;
  let resourceFailure: string | undefined;
  const reused = Boolean(resident?.child);
  const child =
    resident?.child ||
    spawn(process.execPath, [workerPath, workerConfig], {
      cwd: c.workspace,
      uid: UID,
      gid: UID,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        HOME: c.stateHome,
        TMPDIR: temporary,
        USER: `agent${UID}`,
        LOGNAME: `agent${UID}`,
        LANG: 'C.UTF-8',
      },
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  child.stderr.resume();
  if (resident && !reused) resident.processes = new Set([child.pid!]);
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  child.once('exit', finish);
  child.once('error', finish);
  let dispatch = Promise.resolve();
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (Buffer.byteLength(line) > 4 * 1024 * 1024) return;
    dispatch = dispatch
      .then(async () => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.type === 'event') {
          if (resident && !reused && message.event.type === 'runtime.started')
            resident.processes = new Set((await agentProcesses(UID)).keys());
          await event(message.event.type, message.event.data);
        }
        if (message.type === 'result') {
          result = message.result;
          finish();
        }
        if (message.type === 'input') {
          pendingInput = message.id;
          await atomicJSON(path.join(directory, 'input.json'), {
            id: message.id,
            question: message.question,
            details: message.details,
          });
        }
      })
      .catch(() => {
        child.kill('SIGTERM');
      });
  });
  if (reused && resident) {
    child.stdin.write(`${JSON.stringify({ type: 'turn', configuration: c })}\n`);
    await signalAgents(resident.processes, 'SIGCONT', UID);
  }
  let stopAt: number | undefined;
  let checking: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (checking) return;
    checking = (async () => {
      if (!failure) {
        try {
          await lstat(path.join(directory, 'cancel'));
          failure = 'cancelled';
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (Date.now() >= Date.parse(c.deadline)) failure = 'timed_out';
        if (!failure && c.hostRun && (await agentMemoryMiB(UID)) > c.hostRun.memoryMiB) {
          resourceFailure = 'memory_limit';
          failure = 'cancelled';
        }
        if (failure) {
          stopAt = Date.now();
          child.kill('SIGTERM');
        }
      }
      if (stopAt && Date.now() - stopAt > 4000) await stopAgent(UID);
      if (pendingInput && !failure) {
        try {
          const response = JSON.parse(await readFile(path.join(directory, 'answer.json'), 'utf8'));
          if (response.id === pendingInput) {
            child.stdin.write(`${JSON.stringify(response)}\n`);
            pendingInput = undefined;
            await unlink(path.join(directory, 'input.json'));
            await unlink(path.join(directory, 'answer.json'));
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    })()
      .catch(() => {
        failure = 'cancelled';
        stopAt ||= Date.now();
        child.kill('SIGTERM');
      })
      .finally(() => {
        checking = undefined;
      });
  }, 500);
  const stopChecking = async () => {
    clearInterval(timer);
    // A timer callback may already be awaiting /proc or an input file. It must
    // finish before this UID can be retained and assigned to the next turn.
    await checking;
  };
  let retained = false;
  try {
    if (resident && c.warm) {
      await finished;
      await dispatch;
      await stopChecking();
      if (!failure && result?.outcome === 'success' && child.exitCode === null && !child.killed) {
        await freezeAgent(resident.processes, UID);
        resident.child = child;
        resident.key = warmSessionKey(c);
        resident.resumeId = result.resumeId;
        retained = true;
      }
    } else {
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) resolve();
        else {
          child.once('exit', resolve);
          child.once('error', resolve);
        }
      });
      await stopAgent(UID);
      if (!child.stdout.destroyed) await new Promise<void>((resolve) => child.once('close', resolve));
      await dispatch;
    }
  } finally {
    await stopChecking();
    lines.close();
    child.removeListener('exit', finish);
    child.removeListener('error', finish);
    if (!retained) {
      await stopAgent(UID);
      if (resident) await discardHarness(resident);
    }
  }
  await unlink(workerConfig).catch(() => {});
  await atomicJSON(path.join(directory, 'status.json'), {
    state: 'capturing',
    finishedAt: new Date().toISOString(),
  });
  let snapshotBytes = 0;
  let persistence: 'captured' | 'failed' = 'captured',
    persistenceError: string | undefined;
  try {
    const live = await agentProcesses(UID);
    if ([...live.values()].some((state) => !retained || state !== 'T'))
      throw new Error('checkpoint_writers_remain');
    const snapshot = await captureSnapshot(
      { workspace: c.workspace, home: c.stateHome },
      path.join(directory, 'snapshot'),
    );
    snapshotBytes = snapshot.totalBytes;
  } catch (error) {
    persistence = 'failed';
    if (resident) await discardHarness(resident);
    persistenceError =
      error instanceof Error && error.message.startsWith('checkpoint_')
        ? error.message
        : 'checkpoint_capture_failed';
  }
  const final = {
    ...(result || { output: '', outcome: 'failure', failureCode: 'native_process_exited' }),
    ...(failure
      ? { outcome: resourceFailure ? 'failure' : failure, failureCode: resourceFailure || failure }
      : {}),
    snapshotBytes,
    persistence,
    persistenceError,
    completedAt: new Date().toISOString(),
  };
  await atomicJSON(path.join(directory, 'result.json'), final);
  await atomicJSON(path.join(directory, 'status.json'), { state: 'finished' });
}
