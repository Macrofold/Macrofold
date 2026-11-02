import { hostRunContextSchema, hostRunPaths } from './host-paths';
import { controlDirectory } from './control-directory';
import { permissionLayersSchema } from '../../contracts/permissions';
import {
  agentProcesses,
  agentMemorySample,
  largestMemoryProcesses,
  agentPss,
  freezeAgent,
  stopAgent,
  signalAgents,
  type AgentMemorySample,
} from './agent-processes';
import { warmSessionKey } from './warm-session';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import { appendFile, chmod, chown, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { harnessNames } from '../../contracts/harnesses';
import { mediaLimits } from '../../contracts/media';
import { nativeModelLimitsSchema, nativeResultMaximumBytes } from '../../contracts/native-model';
import {
  nativeProfileCaptureSchema,
  nativeDiagnosticFrameSchema,
  nativeMemoryProfileSchema,
  type MemoryFailure,
} from '../../contracts/native-diagnostics';
import { MemoryProfileAccumulator } from './memory-profile';
import { atomicJSON, captureSnapshot } from './manifest';
import type { NativeConfiguration, NativeResult } from './types';

// Optional observer limits are per Host process, independent of customer capacity.
let activeProfiles = 0,
  pssReads = 0;

export const runtimeConfiguration = z.object({
  runId: z.uuid(),
  hostRun: hostRunContextSchema.optional(),
  warm: z
    .object({ sessionId: z.uuid(), checkpointId: z.string().nullable(), toolFingerprint: z.string() })
    .optional(),
  harness: z.enum(harnessNames),
  model: z.string().min(1),
  modelLimits: nativeModelLimitsSchema,
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
  performance: z
    .unknown()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const parsed = nativeProfileCaptureSchema.safeParse(value);
      if (parsed.success) return parsed.data;
      console.warn(JSON.stringify({ code: 'native_profile_configuration_invalid' }));
      return undefined;
    }),
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
  let writer = Promise.resolve(),
    pendingWrites = 0,
    writerClosing = false;
  const appendEvent = async (type: string, data: Record<string, unknown>) => {
    if (truncated) return;
    let safe = data;
    // Private transport timing only; public ingestion copies type/data and its
    // producer identity, never this supervisor metadata into the public payload.
    const source = { sequence: ++sequence, emitted_at: Date.now() };
    let line = JSON.stringify({ ...source, type, data: safe });
    if (Buffer.byteLength(line) > 64 * 1024) {
      safe = {
        truncated: true,
        message: 'Tool payload exceeded 64 KiB; inspect persisted files for full output.',
      };
      line = JSON.stringify({ ...source, type, data: safe });
    }
    written += Buffer.byteLength(line);
    if (written > 64 * 1024 * 1024) {
      truncated = true;
      line = JSON.stringify({
        ...source,
        type: 'runtime.trace_truncated',
        data: { limit_bytes: 64 * 1024 * 1024 },
      });
    }
    await appendFile(path.join(directory, 'events.jsonl'), `${line}\n`, { mode: 0o640 });
  };
  const event = (type: string, data: Record<string, unknown>) => {
    pendingWrites++;
    const write = writer.then(() => appendEvent(type, data));
    writer = write.catch(() => {});
    return write.finally(() => {
      pendingWrites--;
    });
  };
  const tryAppendDiagnostic = (data: Record<string, unknown>) => {
    if (pendingWrites || writerClosing || truncated) return;
    // Reuse the one event writer; optional append failure cannot terminate a child.
    void event('runtime.memory_profile', data).catch(() => {});
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
  let resumeId = c.resumeId;
  let result: NativeResult | undefined,
    pendingInput: string | undefined,
    failure: 'cancelled' | 'timed_out' | undefined;
  let resourceFailure: string | undefined;
  let memoryFailure: MemoryFailure | undefined,
    peakObservedRss = 0;
  // A resumed worker can emit output while SIGCONT is still being awaited.
  let stopAt: number | undefined;
  const reused = Boolean(resident?.child);
  const capture = c.performance;
  const profile =
    capture && capture.expires_at_ms > Date.now() && activeProfiles < 8
      ? new MemoryProfileAccumulator({ configuration: c, capture, reused })
      : undefined;
  if (profile) activeProfiles++;
  let profileReleased = false,
    nextPssAt = -Infinity;
  const finishProfile = (endedBy: 'turn_end' | 'capture_expired') => {
    if (!profile || profileReleased) return;
    profileReleased = true;
    activeProfiles--;
    try {
      const result = profile.finish(endedBy);
      const valid = nativeMemoryProfileSchema.safeParse(result);
      if (valid.success) tryAppendDiagnostic(valid.data);
    } catch {
      /* Optional diagnostics never change execution. */
    } finally {
      profile.dispose();
    }
  };
  const enrichPss = (sample: AgentMemorySample) => {
    if (!profile?.active() || sample.observedAtMs < nextPssAt) return;
    nextPssAt = sample.observedAtMs + 5000;
    if (pssReads >= 2) {
      profile.dropped.pss_reads++;
      profile.pssUnavailable('busy');
      return;
    }
    const candidates = largestMemoryProcesses(sample, 8);
    const start = performance.now(),
      deadline = start + 100,
      offset = profile.offset();
    let index = 0,
      covered = 0,
      rss = 0,
      pss = 0;
    const read = async () => {
      while (index < candidates.length && profile.active()) {
        if (performance.now() >= deadline) {
          profile.pssUnavailable('deadline');
          return;
        }
        if (pssReads >= 2) {
          profile.dropped.pss_reads++;
          profile.pssUnavailable('busy');
          return;
        }
        const candidate = candidates[index++];
        pssReads++;
        let result;
        try {
          result = await agentPss(candidate.pid, UID);
        } finally {
          pssReads--;
        }
        // A read keeps its slot until it actually settles; late callbacks cannot
        // mutate a finalized report or the next warm turn.
        if (!profile.active()) return;
        if (performance.now() >= deadline) {
          profile.pssUnavailable('deadline');
          return;
        }
        if ('reason' in result) {
          profile.pssUnavailable(result.reason);
          continue;
        }
        covered++;
        rss += candidate.rss_bytes;
        pss += result.pssBytes;
        profile.pss({
          offset_ms: offset,
          age_ms: 0,
          read_ms: performance.now() - start,
          covered_processes: covered,
          observed_processes: sample.processCount,
          covered_rss_bytes: rss,
          pss_bytes: pss,
          complete: covered === sample.processCount,
        });
      }
    };
    // A fixed candidate walk, not a queue; two shared slots bound actual reads.
    void read().catch(() => profile.pssUnavailable('read_failed'));
    void read().catch(() => profile.pssUnavailable('read_failed'));
  };
  let child: ChildProcessWithoutNullStreams;
  try {
    child =
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
  } catch (error) {
    finishProfile('turn_end');
    writerClosing = true;
    await writer;
    throw error;
  }
  child.stderr.resume();
  if (resident && !reused) resident.processes = new Set([child.pid!]);
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  child.once('exit', finish);
  child.once('error', finish);
  let dispatch = Promise.resolve();
  let lineBytes = 0;
  // Bound raw JSONL before readline buffers/decodes it. Checking only a completed
  // line leaves an unterminated native record unbounded in supervisor memory.
  const output = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      if (resourceFailure === 'native_result_too_large') return done();
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        lineBytes += (newline < 0 ? chunk.length : newline) - offset;
        if (lineBytes > nativeResultMaximumBytes) {
          resourceFailure = 'native_result_too_large';
          failure = 'cancelled';
          stopAt ||= Date.now();
          result = { output: '', outcome: 'failure', failureCode: resourceFailure };
          child.kill('SIGTERM');
          finish();
          return done();
        }
        if (newline < 0) break;
        lineBytes = 0;
        offset = newline + 1;
      }
      done(null, chunk);
    },
  });
  child.stdout.pipe(output);
  const lines = createInterface({ input: output, crlfDelay: Infinity });
  lines.on('line', (line) => {
    dispatch = dispatch
      .then(async () => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.type === 'event') {
          if (message.event?.type === 'runtime.memory_profile') return;
          if (
            message.event.type === 'runtime.started' &&
            typeof message.event.data?.native_session_id === 'string' &&
            message.event.data.native_session_id
          )
            resumeId = message.event.data.native_session_id;
          if (resident && !reused && message.event.type === 'runtime.started')
            resident.processes = new Set((await agentProcesses(UID)).keys());
          await event(message.event.type, message.event.data);
        }
        if (message.type === 'result') {
          result = { ...message.result, memoryFailure: undefined };
          finish();
        }
        if (message.type === 'diagnostic' && profile?.active()) {
          if (Buffer.byteLength(line) > 1024) {
            profile.dropped.frames++;
            return;
          }
          const frame = nativeDiagnosticFrameSchema.safeParse(message.data);
          if (frame.success && frame.data.run_id === c.runId && frame.data.capture_id === capture?.capture_id)
            profile.frame(frame.data);
          else profile.dropped.frames++;
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
        let sample: AgentMemorySample | undefined;
        if (!failure && c.hostRun) {
          sample = await agentMemorySample(UID);
          peakObservedRss = Math.max(peakObservedRss, sample.rssBytes);
          if (Math.ceil(sample.rssBytes / 1024 / 1024) > c.hostRun.memoryMiB) {
            resourceFailure = 'memory_limit';
            failure = 'cancelled';
          }
        }
        if (failure) {
          stopAt = Date.now();
          child.kill('SIGTERM');
          // Signal first. The projection uses the already-read guard inventory.
          if (resourceFailure === 'memory_limit' && sample && c.hostRun)
            memoryFailure = {
              measurement: 'process_rss_sum',
              limit_bytes: c.hostRun.memoryMiB * 1024 * 1024,
              observed_rss_bytes: sample.rssBytes,
              peak_observed_rss_bytes: peakObservedRss,
              process_count: sample.processCount,
              unavailable_process_count: sample.unavailableProcessCount,
              largest_processes: largestMemoryProcesses(sample),
            };
        } else if (sample && profile?.active()) {
          try {
            if (profile.observe(sample)) enrichPss(sample);
          } catch {
            /* A failed observer cannot disable required enforcement. */
          }
        }
      }
      if (profile?.expired()) finishProfile('capture_expired');
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
    if (reused && resident) {
      child.stdin.write(`${JSON.stringify({ type: 'turn', configuration: c })}\n`);
      await signalAgents(resident.processes, 'SIGCONT', UID);
    }
    if (resident && c.warm) {
      await finished;
      await dispatch;
      await stopChecking();
      if (!failure && result?.outcome === 'success' && child.exitCode === null && !child.killed) {
        await freezeAgent(resident.processes, UID);
        resident.child = child;
        resident.key = warmSessionKey(c);
        resident.resumeId = result.resumeId || resumeId;
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
    finishProfile(profile?.expired() ? 'capture_expired' : 'turn_end');
    writerClosing = true;
    lines.close();
    child.stdout.unpipe(output);
    output.destroy();
    child.removeListener('exit', finish);
    child.removeListener('error', finish);
    if (!retained) {
      await stopAgent(UID);
      if (resident) await discardHarness(resident);
    }
    await dispatch;
    await writer;
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
      { workspace: c.workspace, home: c.stateHome, harness: c.harness },
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
    // Cancellation can beat the SDK's final message after a gateway fence. The
    // already-observed native identity still belongs to this captured Session.
    ...(!result?.resumeId && resumeId ? { resumeId } : {}),
    ...(failure
      ? { outcome: resourceFailure ? 'failure' : failure, failureCode: resourceFailure || failure }
      : {}),
    ...(memoryFailure ? { memoryFailure } : {}),
    snapshotBytes,
    persistence,
    persistenceError,
    completedAt: new Date().toISOString(),
  };
  await atomicJSON(path.join(directory, 'result.json'), final);
  await atomicJSON(path.join(directory, 'status.json'), { state: 'finished' });
}
