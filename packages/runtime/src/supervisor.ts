import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  appendFile,
  chmod,
  chown,
  lstat,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { atomicJSON, captureSnapshot } from './manifest';
import type { NativeConfiguration, NativeResult } from './types';

const UID = 10001;
export const runtimeConfiguration = z.object({
  runId: z.uuid(),
  harness: z.enum(['codex', 'claude-code', 'opencode']),
  model: z.string().min(1),
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  prompt: z.string(),
  instructions: z.string().optional(),
  workspace: z.string(),
  stateHome: z.string(),
  gatewayURL: z.url(),
  toolURL: z.url(),
  token: z.string().min(1),
  deadline: z.iso.datetime(),
  resumeId: z.string().optional(),
  toolGrants: z.boolean(),
});
async function killAgentProcesses() {
  // A separate UID catches daemonized grandchildren that escaped the original process group.
  for (const pid of await readdir('/proc'))
    if (/^\d+$/.test(pid)) {
      try {
        if ((await lstat(`/proc/${pid}`)).uid === UID) process.kill(Number(pid), 'SIGKILL');
      } catch (error) {
        if (!['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      }
    }
}
async function hasLiveAgentProcesses() {
  for (const pid of await readdir('/proc'))
    if (/^\d+$/.test(pid)) {
      try {
        if ((await lstat(`/proc/${pid}`)).uid === UID) {
          const status = await readFile(`/proc/${pid}/status`, 'utf8');
          if (!/^State:\s+Z/m.test(status)) return true;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  return false;
}
export async function supervise(configurationPath: string, workerPath: string) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0)
    throw new Error('Supervisor requires an isolated Linux sandbox and its root user.');
  const c: NativeConfiguration = runtimeConfiguration.parse(
    JSON.parse(await readFile(configurationPath, 'utf8')),
  );
  const directory = path.dirname(configurationPath);
  if (c.workspace !== '/workspace' || c.stateHome !== '/agent-home' || directory !== '/platform-control')
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
  const workerConfig = '/agent-home/.runtime-config.json';
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
  const child = spawn(process.execPath, [workerPath, workerConfig], {
    cwd: c.workspace,
    uid: UID,
    gid: UID,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', HOME: c.stateHome, LANG: 'C.UTF-8' },
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.resume();
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
        if (message.type === 'event') await event(message.event.type, message.event.data);
        if (message.type === 'result') result = message.result;
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
  let stopAt: number | undefined,
    checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void (async () => {
      if (!failure) {
        try {
          await lstat(path.join(directory, 'cancel'));
          failure = 'cancelled';
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (Date.now() >= Date.parse(c.deadline)) failure = 'timed_out';
        if (failure) {
          stopAt = Date.now();
          child.kill('SIGTERM');
        }
      }
      if (stopAt && Date.now() - stopAt > 4000) await killAgentProcesses();
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
        checking = false;
      });
  }, 500);
  try {
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.once('error', () => resolve());
    });
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    await exited;
    // A daemon can retain the worker's stdout. Stop all writers before waiting for
    // pipe closure, then drain the final result; `exit` alone can precede stdout.
    await killAgentProcesses();
    await closed;
    await dispatch;
  } finally {
    clearInterval(timer);
    await killAgentProcesses();
  }
  // SIGKILL is asynchronous. No checkpoint is claimed quiescent until the UID has no live processes.
  for (let i = 0; i < 20; i++) {
    await killAgentProcesses();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await unlink(workerConfig).catch(() => {});
  await atomicJSON(path.join(directory, 'status.json'), {
    state: 'capturing',
    finishedAt: new Date().toISOString(),
  });
  let persistence: 'captured' | 'failed' = 'captured',
    persistenceError: string | undefined;
  try {
    if (await hasLiveAgentProcesses()) throw new Error('checkpoint_writers_remain');
    await captureSnapshot({ workspace: c.workspace, home: c.stateHome }, path.join(directory, 'snapshot'));
  } catch (error) {
    persistence = 'failed';
    persistenceError =
      error instanceof Error && error.message.startsWith('checkpoint_')
        ? error.message
        : 'checkpoint_capture_failed';
  }
  const final = {
    ...(result || { output: '', outcome: 'failure', failureCode: 'native_process_exited' }),
    ...(failure ? { outcome: failure, failureCode: failure } : {}),
    persistence,
    persistenceError,
    completedAt: new Date().toISOString(),
  };
  await atomicJSON(path.join(directory, 'result.json'), final);
  await atomicJSON(path.join(directory, 'status.json'), { state: 'finished' });
}
