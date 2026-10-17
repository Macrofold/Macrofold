import { blockRunRecovery } from './dispatch-failures';
import type { RunRecoveryStep } from '../../contracts/run-recovery';
import { publishArtifacts } from './artifacts';
import { fileAllowed, guardedToolsRequired, questionsAllowed } from '../../contracts/permissions';
import { permissionOutput } from './agent-permissions';
import { queueAutomaticSync } from './git-jobs';
import { transaction, afterCommit, lock, type Tx } from '../../db';
import { runTraceContext } from './run-tracing';
import { recordTrace } from './tracing';
import { observeWorkerStep, observeRuntimeEvents } from './worker-diagnostics';
import { id, sha256 } from './crypto';
import { assert, AppError } from './errors';
import { config } from './config';
import { claimRun, principalFor } from './engine';
import type { NativeRunRow } from './runs';
import { getRun, getNativeRun, requireNativeRun, terminal } from './runs';
import { emit, emitBatch } from './events';
import { settle } from './ledger';
import { computeMaximum } from './catalog';
import { runtimeToken } from './runtime-auth';
import * as resources from './resources';
import { prepareCheckpoint, saveCheckpoint, checkpointState, type FileRecord } from './files';
import { storagePreparation } from './storage-preparation';
import type { MachineBinding, MachineProvider, RuntimeProbe } from './ports';
import type { NativeConfiguration } from '../../runtime/src/types';
import type { SnapshotEntry } from '../../runtime/src/manifest';
import { isPersistentPath } from '../../runtime/src/persistence-paths';
import { describeContent, saveContent } from '../../providers/src/storage';
import {
  readRestoreInventoryPage,
  stageRestoreObjects,
  RESTORE_BATCH_OBJECTS,
  type RestoreObject,
} from './execution-hydration';
import { settleOrphanModelRequests } from './model-gateway';
import { queueRetryAt } from './queue-wait';
import { mapConcurrent } from './concurrent';
import type { DispatchClass } from './capacity';

type Phase =
  | 'input'
  | 'provision'
  | 'hydrate'
  | 'restore'
  | 'restore_wait'
  | 'launch'
  | 'poll'
  | 'index'
  | 'upload'
  | 'publish'
  | 'close'
  | 'done';
// Mirrors the content-free scheduling view in 051_dispatch_resources.sql. The
// hint retains an existing slot only; every resource change returns to SQL claim.
const phaseDispatchClass: Record<Phase, Exclude<DispatchClass, 'inference'>> = {
  provision: 'provision',
  input: 'transfer',
  hydrate: 'transfer',
  restore: 'transfer',
  restore_wait: 'control',
  launch: 'control',
  poll: 'control',
  index: 'transfer',
  upload: 'transfer',
  publish: 'transfer',
  close: 'control',
  done: 'control',
};
export type ExecutionState = {
  provider: 'vercel' | 'docker';
  phase: Phase;
  machine?: MachineBinding;
  inputOffset?: number;
  inputRevision?: { worktree: string; session: string };
  restoreNamespaces?: ('workspace' | 'home')[];
  indexOffset?: number;
  eventOffset?: number;
  result?: NonNullable<RuntimeProbe['result']>;
  error?: string;
  inputId?: string;
  questionDenied?: boolean;
  preserve?: boolean;
  snapshotId?: string;
  lock?: string;
  lockExpires?: number;
  failures?: number;
  advances?: number;
  recoveryBlocked?: boolean;
  /** Last publication operation, for safe diagnostics without exposing raw exceptions. */
  publicationStep?: RunRecoveryStep;
  cancelStartedAt?: number;
  /** Internal timings only; wall time includes orchestration waits and retries. */
  phaseTimings?: Partial<
    Record<Phase, { startedAt: number; completedAt?: number; activeMs: number; attempts: number }>
  >;
};
// Covers the legal 100k-entry/10-GiB restore and publish envelope, including
// one-object hydration batches. Wall-clock deadlines independently cap stalls.
export const MAX_RUN_ADVANCES = 250_000;
export const RUN_RECOVERY_MS = 30 * 60_000;
export const MAX_RECOVERY_FAILURES = 8;
type ExecutionObject = { id: string; kind: string; name: string; data: Record<string, unknown> };
async function objects(
  tx: Tx,
  org: string,
  run: string,
  entries: { kind: string; name: string; data: unknown }[],
) {
  if (!entries.length) return;
  await tx.query(
    `INSERT INTO execution_objects(id,organization_id,run_id,kind,name,data)
     SELECT item.id,$1,$2,item.kind,item.name,item.data
     FROM jsonb_to_recordset($3::jsonb) AS item(id uuid,kind text,name text,data jsonb)
     ON CONFLICT(run_id,kind,name) DO NOTHING`,
    [org, run, JSON.stringify(entries.map((entry) => ({ ...entry, id: id() })))],
  );
}
async function pending<T extends ExecutionObject = ExecutionObject>(
  org: string,
  run: string,
  kinds: string[],
  count = 4,
) {
  return transaction(
    org,
    async (tx) =>
      (
        await tx.query<T>(
          'SELECT * FROM execution_objects WHERE run_id=$1 AND kind=ANY($2::text[]) AND NOT processed ORDER BY kind,name LIMIT $3',
          [run, kinds, count],
        )
      ).rows,
  );
}
async function processed(org: string, objects: ExecutionObject[]) {
  if (objects.length)
    await transaction(org, (tx) =>
      tx.query('UPDATE execution_objects SET processed=true WHERE id=ANY($1::uuid[])', [
        objects.map((o) => o.id),
      ]),
    );
}

/** A small durable state machine. Each call performs bounded I/O and is safe to repeat.
 * The machine has a stable name and the native supervisor has its own non-removable execution marker. */
export async function advanceCloudRun(
  org: string,
  runId: string,
  machineProvider: MachineProvider | ((run: NativeRunRow) => MachineProvider),
): Promise<{
  done: boolean;
  delaySeconds: number;
  queued?: boolean;
  nextDispatchClass?: DispatchClass;
  canContinue?: boolean;
}> {
  let run = await transaction(org, (tx) => getRun(tx, runId));
  if (run.kind !== 'native_agent') {
    const { advanceInference } = await import('./inference-engine');
    return advanceInference(org, runId);
  }
  const provider = typeof machineProvider === 'function' ? machineProvider(run) : machineProvider;
  if (run.config.execution_provider && run.config.execution_provider !== config.execution)
    return { done: false, delaySeconds: 60, queued: run.status === 'queued' };
  if (run.status === 'queued') {
    const claimed = await claimRun(org, runId);
    if (!claimed) {
      const current = await transaction(org, (tx) => getRun(tx, runId));
      const now = Date.now();
      return {
        done: terminal(current.status),
        delaySeconds: Math.max(0, (queueRetryAt(current, now).getTime() - now) / 1000),
        queued: current.status === 'queued',
      };
    }
    requireNativeRun(claimed);
    run = claimed;
  }
  let state = (run.execution_binding || {
    provider: config.execution === 'docker' ? 'docker' : 'vercel',
    phase: 'provision',
  }) as ExecutionState;
  if (state.recoveryBlocked || state.phase === 'done' || (terminal(run.status) && !run.execution_binding))
    return { done: true, delaySeconds: 0 };
  const claim = id();
  const owns = await transaction(org, async (tx) => {
    // Admission froze configuration; the phase claim needs fresh controls, not
    // another download/hydration of the accepted prompt and attachments.
    const current = (
      await tx.query<
        Pick<
          NativeRunRow,
          | 'execution_binding'
          | 'status'
          | 'cancel_requested'
          | 'deadline'
          | 'model_error_request_id'
          | 'input_request'
          | 'lease_generation'
        >
      >(
        'SELECT execution_binding,status,cancel_requested,deadline,model_error_request_id,input_request,lease_generation FROM runs WHERE id=$1 FOR UPDATE',
        [runId],
      )
    ).rows[0];
    assert(current, 404, 'not_found', 'Run not found.');
    Object.assign(run, current);
    state = (current.execution_binding || state) as ExecutionState;
    if (state.lock && (state.lockExpires || 0) > Date.now()) return false;
    state = { ...state, lock: claim, lockExpires: Date.now() + 120_000 };
    await tx.query('UPDATE runs SET execution_binding=$2,heartbeat_at=now() WHERE id=$1', [
      runId,
      JSON.stringify(state),
    ]);
    return true;
  });
  if (!owns) return { done: false, delaySeconds: 5 };
  const phase = state.phase;
  const started = performance.now();
  const timings = (state.phaseTimings ??= {});
  const timing = (timings[phase] ??= { startedAt: Date.now(), activeMs: 0, attempts: 0 });
  // Ready work needs another durable step, not a timer. Only actual waits opt in below.
  let delaySeconds = 0;
  let committed = false;
  let canContinue = true;
  try {
    state.advances = (state.advances || 0) + 1;
    // Deadline/counter ceilings survive restarts and successful-but-stalled polls.
    // Cleanup/publication retain their own finite failure budget below.
    if (!['publish', 'close'].includes(state.phase)) {
      assert(
        state.advances <= MAX_RUN_ADVANCES &&
          (!run.deadline || Date.now() < run.deadline.getTime() + RUN_RECOVERY_MS),
        504,
        'execution_progress_exhausted',
        'Execution recovery exceeded its bounded progress budget.',
      );
      if (state.phase === 'poll')
        assert(
          !run.deadline || Date.now() < run.deadline.getTime() + 60_000,
          504,
          'cancellation_unconfirmed',
          'The runtime did not finish within its cancellation grace period.',
        );
    }
    if (['input', 'provision', 'hydrate', 'restore', 'restore_wait', 'launch'].includes(state.phase))
      assert(
        !run.cancel_requested && run.deadline!.getTime() > Date.now(),
        409,
        'run_stopped',
        'The run stopped before the native agent started.',
      );
    if (state.phase === 'input') {
      const offset = state.inputOffset || 0;
      const source = await transaction(org, (tx) =>
        readRestoreInventoryPage(
          tx,
          { organization: org, run: runId, worktree: run.worktree_id, session: run.session_id },
          offset,
          state.inputRevision,
        ),
      );
      state.inputRevision = source.revision;
      const guarded = guardedToolsRequired(run.config.permission_layers || []);
      const selected = source.files.filter(
        (file) =>
          isPersistentPath(run.config.harness, file.namespace, file.path) &&
          (!state.restoreNamespaces || state.restoreNamespaces.includes(file.namespace)) &&
          (file.namespace === 'home' ||
            !guarded ||
            (!file.git &&
              file.type === 'file' &&
              fileAllowed(run.config.permission_layers || [], 'read', file.path))),
      );
      const descriptions = await mapConcurrent(selected, 4, async (file) => {
        const chunks = await describeContent(file.key, file.sha256);
        return {
          chunks,
          entry: {
            namespace: file.namespace,
            path: file.path,
            type: file.type,
            size: Number(file.size_bytes),
            sha256: file.sha256,
            mode: file.mode ?? 0o644,
            modifiedAt: file.modified_at,
            chunks: chunks.map((c) => ({ hash: c.sha256, size: c.size })),
          } satisfies SnapshotEntry,
        };
      });
      const entries = descriptions.map((item) => item.entry);
      state.inputOffset = source.nextOffset;
      if (source.complete) state.phase = 'hydrate';
      await transaction(org, async (tx) => {
        const owned = await tx.query(
          `SELECT id FROM runs WHERE id=$1 AND execution_binding->>'lock'=$2 FOR UPDATE`,
          [runId, claim],
        );
        assert(owned.rowCount, 409, 'lease_lost', 'Restore preparation belongs to another controller step.');
        await objects(tx, org, runId, [
          ...descriptions.flatMap((item) =>
            item.chunks.map((chunk) => ({ kind: 'input_chunk', name: chunk.sha256, data: chunk })),
          ),
          ...(entries.length ? [{ kind: 'input_page', name: String(offset), data: { entries } }] : []),
        ]);
        if (source.complete)
          await tx.query("DELETE FROM execution_objects WHERE run_id=$1 AND kind='input_source'", [runId]);
        await tx.query(`UPDATE runs SET execution_binding=$2 WHERE id=$1`, [runId, JSON.stringify(state)]);
      });
    } else if (state.phase === 'provision') {
      assert(
        !run.cancel_requested && run.deadline!.getTime() > Date.now(),
        409,
        'run_stopped',
        'The run stopped before provisioning.',
      );
      state.machine = await provider.provision(`run-${runId}`, run.config.limits?.timeout_seconds || 900);
      // Persist the original VM binding before any subsequent provider operation can execute a command.
      await transaction(org, (tx) =>
        tx.query("UPDATE runs SET execution_binding=$2 WHERE id=$1 AND execution_binding->>'lock'=$3", [
          runId,
          JSON.stringify(state),
          claim,
        ]),
      );
      const session = await transaction(org, (tx) => resources.get(tx, 'sessions', run.session_id));
      const model = run.config.rate_card;
      assert(model, 503, 'model_unavailable', 'The configured model is unavailable.');
      const configuration: NativeConfiguration = {
        runId,
        harness: run.config.harness,
        model: run.config.model,
        provider: model.provider,
        prompt: run.config.prompt,
        attachments: run.config.attachments,
        instructions: run.config.instructions,
        harnessPromptMode: run.config.harness_prompt_mode,
        workspace: '/workspace',
        stateHome: '/agent-home',
        gatewayURL: `${config.origin}/runtime/runs/${runId}/model`,
        toolURL: `${config.origin}/runtime/runs/${runId}/mcp`,
        token: runtimeToken({
          organization: org,
          run: runId,
          lease: run.lease_generation,
          expires: run.deadline!.getTime(),
        }),
        deadline: run.deadline!.toISOString(),
        resumeId: session.native_session_id as string | undefined,
        toolGrants: Boolean(run.config.connection_grants?.length),
        permissions: run.config.permission_layers,
      };
      const prepared = await provider.prepare(state.machine, configuration);
      // Input pages are staged after preparation so they include only the namespaces this Host must restore.
      state.restoreNamespaces = prepared?.restoreNamespaces;
      state.phase = prepared?.reused ? 'launch' : 'input';
    } else if (state.phase === 'hydrate') {
      const objects = await pending<RestoreObject>(
        org,
        runId,
        ['input_chunk', 'input_page'],
        RESTORE_BATCH_OBJECTS,
      );
      const batch = await stageRestoreObjects(provider, state.machine!, objects);
      // A partial/uncertain write is retried under the same content-addressed paths.
      // Publish progress only after the whole provider batch has acknowledged success.
      await processed(org, batch);
      if (!objects.length) state.phase = 'restore';
    } else if (state.phase === 'restore') {
      await provider.restore(state.machine!);
      state.phase = 'restore_wait';
    } else if (state.phase === 'restore_wait') {
      const result = await provider.restored(state.machine!);
      assert(
        result !== 'failure',
        502,
        'restore_failed',
        'The worktree failed integrity verification during restore.',
      );
      if (result === 'success') state.phase = 'launch';
      else delaySeconds = 3;
    } else if (state.phase === 'launch') {
      assert(
        !run.cancel_requested && run.deadline!.getTime() > Date.now(),
        409,
        'run_stopped',
        'The run stopped before launch.',
      );
      await transaction(org, async (tx) => {
        await tx.query("UPDATE runs SET status='running' WHERE id=$1", [runId]);
        await emit(tx, org, runId, 'run.started', { simulated: false }, { id: 'lifecycle', sequence: 1 });
      });
      await provider.launch(state.machine!);
      state.phase = 'poll';
    } else if (state.phase === 'poll') {
      if (
        run.cancel_requested ||
        run.model_error_request_id ||
        state.questionDenied ||
        run.deadline!.getTime() <= Date.now()
      ) {
        state.cancelStartedAt ??= Date.now();
        assert(
          Date.now() - state.cancelStartedAt < 60_000,
          504,
          'cancellation_unconfirmed',
          'The runtime did not acknowledge cancellation within one minute.',
        );
        await provider.cancel(state.machine!);
      }
      if (run.input_request?.answer && !run.model_error_request_id && !state.questionDenied) {
        await provider.answer(state.machine!, run.input_request.id, run.input_request.answer);
        await transaction(org, (tx) =>
          tx.query("UPDATE runs SET status='running' WHERE id=$1 AND status='waiting_for_input'", [runId]),
        );
      }
      const result = await observeWorkerStep('native_probe', { organization_id: org, run_id: runId }, () =>
        (provider.waitForEvents ?? provider.probe).call(provider, state.machine!, state.eventOffset || 0),
      );
      // A quiet native wait yields its slot so a large active population does
      // not hold every control slot for the entire continuation quantum.
      canContinue = Boolean(result.events.length || result.result) && !result.input;
      observeRuntimeEvents(
        { organization_id: org, run_id: runId, lease_generation: run.lease_generation },
        result.events,
      );
      if (result.input && !questionsAllowed(run.config.permission_layers || [])) {
        state.questionDenied = true;
        await provider.cancel(state.machine!);
      }
      assert(
        Number.isSafeInteger(result.nextOffset) &&
          result.nextOffset >= (state.eventOffset || 0) &&
          (!result.events.length || result.nextOffset > (state.eventOffset || 0)),
        502,
        'runtime_cursor_stalled',
        'The runtime event cursor did not advance.',
      );
      await transaction(org, async (tx) => {
        const events = result.events
          .filter((e) =>
            [
              'output.delta',
              'reasoning.summary',
              'reasoning.started',
              'reasoning.delta',
              'reasoning.completed',
              'tool.started',
              'tool.completed',
              'runtime.started',
              'runtime.failed',
              'runtime.trace_truncated',
            ].includes(e.type),
          )
          .map((e) => ({
            type: e.type,
            data: e.data,
            producer: { id: `runtime:${run.lease_generation}`, sequence: e.sequence },
          }));
        await emitBatch(tx, org, runId, events, {
          currentRun: run,
          execution: { claim, offset: result.nextOffset },
        });
        if (
          result.input &&
          !state.questionDenied &&
          !run.model_error_request_id &&
          state.inputId !== result.input.id
        ) {
          // The gateway can fence spending while a native probe is in flight.
          const waiting = await tx.query(
            `UPDATE runs SET status='waiting_for_input',input_request=$2,
             execution_binding=jsonb_set(execution_binding,'{inputId}',to_jsonb($2::jsonb->>'id')) WHERE id=$1
             AND model_error_request_id IS NULL AND NOT cancel_requested RETURNING id`,
            [runId, JSON.stringify(result.input)],
          );
          if (waiting.rowCount) {
            await emit(tx, org, runId, 'input.requested', {
              input_request_id: result.input.id,
              ...result.input,
            });
            state.inputId = result.input.id;
          }
        }
      });
      state.eventOffset = result.nextOffset;
      // Drain all log pages before publishing a terminal event. Cursor continuity survives poll retries.
      if (result.result && !result.events.length) {
        state.result = result.result;
        state.phase = result.result.persistence === 'captured' ? 'index' : 'publish';
        if (result.result.persistence !== 'captured') {
          state.error = result.result.persistenceError || 'checkpoint_failed';
          state.preserve = true;
        }
        await transaction(org, async (tx) => {
          await tx.query("UPDATE runs SET status='persisting' WHERE id=$1", [runId]);
          await emit(tx, org, runId, 'run.persisting', {}, { id: 'lifecycle', sequence: 2 });
        });
      } else if (!result.result && !provider.waitForEvents) delaySeconds = 2;
    } else if (state.phase === 'index') {
      const page = await provider.snapshotPage(state.machine!, state.indexOffset || 0);
      assert(
        Number.isSafeInteger(page.totalBytes) &&
          page.totalBytes >= 0 &&
          page.totalBytes <= 10 * 1024 ** 3 &&
          Number.isSafeInteger(page.total) &&
          page.total >= 0 &&
          page.total <= 100_000,
        413,
        'checkpoint_storage_limit',
        'The worktree exceeds its configured persistence limit.',
      );
      assert(
        (state.indexOffset || 0) + page.entries.length <= page.total &&
          (page.entries.length > 0 || (state.indexOffset || 0) >= page.total),
        502,
        'checkpoint_cursor_stalled',
        'The runtime checkpoint page did not advance.',
      );
      await transaction(org, async (tx) => {
        const indexed: { kind: string; name: string; data: unknown }[] = [];
        for (const entry of page.entries) {
          if (!isPersistentPath(run.config.harness, entry.namespace, entry.path)) continue;
          indexed.push({ kind: 'output_entry', name: `${entry.namespace}/${entry.path}`, data: entry });
          for (const chunk of entry.chunks)
            indexed.push({ kind: 'output_chunk', name: chunk.hash, data: chunk });
        }
        await objects(tx, org, runId, indexed);
      });
      state.indexOffset = (state.indexOffset || 0) + page.entries.length;
      if (state.indexOffset >= page.total) state.phase = 'upload';
    } else if (state.phase === 'upload') {
      // The page controls SQL progress, while four refillable transfer slots
      // bound live chunk bytes (at most sixteen MiB). They are distinct limits.
      const chunks = await pending(org, runId, ['output_chunk'], 32);
      // Drain bounded concurrent transfers before releasing the phase lease, even on failure.
      await mapConcurrent(chunks, 4, async (item) => {
        const bytes = await observeWorkerStep(
          'checkpoint_read',
          { organization_id: org, run_id: runId },
          () => provider.chunk(state.machine!, item.name),
        );
        assert(
          sha256(bytes) === item.name && bytes.length === Number(item.data.size),
          502,
          'checkpoint_corrupt',
          'A runtime checkpoint chunk failed integrity verification.',
        );
        await observeWorkerStep('checkpoint_store', { organization_id: org, run_id: runId }, () =>
          saveContent(org, bytes),
        );
      });
      await processed(org, chunks);
      if (!chunks.length) state.phase = 'publish';
    } else if (state.phase === 'publish') {
      await publishCloudRun(org, runId, state);
      state.phase = 'close';
    } else if (state.phase === 'close') {
      if (state.machine) {
        const recovery = await provider.close(state.machine, Boolean(state.preserve));
        state.snapshotId = recovery.snapshotId;
      }
      if (!state.machine) await provider.cleanupUnbound?.();
      state.phase = 'done';
      await transaction(org, (tx) =>
        tx.query(
          "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='run' AND resource_id=$1",
          [runId],
        ),
      );
    }
    state.failures = 0;
  } catch (error) {
    if (error instanceof AppError && error.code === 'worker_starting') {
      return { done: false, delaySeconds: 3 };
    }
    state.failures = (state.failures || 0) + 1;
    const code = error instanceof AppError ? error.code : 'execution_transport_failed';
    if (['publish', 'close'].includes(state.phase) && state.failures >= MAX_RECOVERY_FAILURES) {
      // A failed settlement/stop is not permission to release money or writers.
      // Stop automatic retries while retaining the original binding and files.
      state.recoveryBlocked = true;
      await transaction(org, (tx) =>
        blockRunRecovery(tx, org, runId, {
          code: 'run_recovery_required',
          step: state.phase === 'close' ? 'cleanup' : state.publicationStep || 'finalization',
          cause: code,
          attempts: state.failures!,
          ...(state.error ? { original_failure_code: state.error } : {}),
        }),
      );
    } else if (
      state.failures >= 3 &&
      state.phase !== 'close' &&
      (state.phase !== 'publish' || !state.error)
    ) {
      state.error ||= code;
      state.preserve = Boolean(state.machine);
      // Freeze an uncertain execution before final accounting. Never restart the prompt to recover it.
      if (state.machine)
        await provider
          .close(state.machine, true)
          .then((r) => {
            state.snapshotId = r.snapshotId;
          })
          .catch(() => {});
      state.phase = 'publish';
      state.failures = 0;
    }
    delaySeconds = Math.min(60, 2 ** state.failures);
  } finally {
    timing.activeMs += Math.round(performance.now() - started);
    timing.attempts++;
    if (state.phase !== phase) timing.completedAt = Date.now();
    delete state.lock;
    delete state.lockExpires;
    // Reset successful-step recovery and renew the job in the same fenced commit.
    // A ready same-class continuation need not rediscover/reclaim this job.
    committed = await transaction(org, async (tx) =>
      Boolean(
        (
          await tx.query(
            `WITH updated AS (
          UPDATE runs SET execution_binding=$2::jsonb||jsonb_build_object('eventOffset',greatest(coalesce((execution_binding->>'eventOffset')::bigint,0),coalesce(($2::jsonb->>'eventOffset')::bigint,0))),heartbeat_at=now()
          WHERE id=$1 AND execution_binding->>'lock'=$3 RETURNING id
        ), renewed AS (
          UPDATE dispatch_jobs SET lease_until=now()+interval '5 minutes',failure_attempts=0,error=NULL
          WHERE kind='run' AND resource_id IN(SELECT id FROM updated) AND state IN('pending','running') AND $4::boolean
          RETURNING id
        ) SELECT id FROM updated`,
            [runId, JSON.stringify(state), claim, state.phase !== 'done' && !state.recoveryBlocked],
          )
        ).rowCount,
      ),
    );
  }
  if (!committed) return { done: false, delaySeconds: 5 };
  return {
    done: state.phase === 'done' || Boolean(state.recoveryBlocked),
    delaySeconds,
    nextDispatchClass: phaseDispatchClass[state.phase],
    canContinue,
  };
}

async function publishCloudRun(org: string, runId: string, state: ExecutionState) {
  // Track the actual failing operation: publication also settles billing, so
  // phase='publish' alone must not label every failure as lost files.
  state.publicationStep = 'finalization';
  const verified = !state.error && state.result?.persistence === 'captured';
  const publication = await storagePreparation(org, async (tx) => {
    const run = await getNativeRun(tx, runId);
    if (terminal(run.status)) return null;
    assert(
      (run.execution_binding as ExecutionState | null)?.lock === state.lock,
      409,
      'lease_lost',
      'Execution publication is owned by another controller step.',
    );
    const worktree = await resources.get(tx, 'worktrees', run.worktree_id);
    const objects = verified
      ? (
          await tx.query<{ data: SnapshotEntry }>(
            "SELECT data FROM execution_objects WHERE run_id=$1 AND kind='output_entry' ORDER BY name",
            [runId],
          )
        ).rows
      : [];
    await tx.query("UPDATE runs SET status='persisting' WHERE id=$1", [runId]);
    return { run, worktree, objects };
  });
  try {
    if (!publication.value) return;
    const { run: expectedRun, worktree: baseline } = publication.value;
    // Verification belongs to this GC-protected publication, not an earlier
    // upload phase. Its proof is reused only until this preparation expires.
    const objects = await mapConcurrent(publication.value.objects, 8, async ({ data }) => ({
      data: {
        ...data,
        record: {
          ...(await publication.verification.manifest(
            data.sha256,
            data.size,
            data.chunks.map((chunk) => ({
              key: `${org}/content/${chunk.hash}`,
              sha256: chunk.hash,
              size: chunk.size,
            })),
          )),
          path: data.path,
          type: data.type,
          mode: data.mode,
          modified_at: data.modifiedAt,
          git_ignored: data.path.startsWith('.'),
        } satisfies FileRecord,
      },
    }));
    let files: FileRecord[] = objects
      .filter((o) => o.data.namespace === 'workspace' && !o.data.path.split('/').includes('.git'))
      .map((o) => o.data.record);
    const gitFiles = objects
      .filter((o) => o.data.namespace === 'workspace' && o.data.path.split('/').includes('.git'))
      .map((o) => o.data.record);
    const home = objects.filter((o) => o.data.namespace === 'home').map((o) => o.data.record);
    const guarded = guardedToolsRequired(expectedRun.config.permission_layers || []);
    state.publicationStep = 'checkpoint';
    // A failed capture has no output snapshot, not an empty one. Validate only
    // verified changes; failure settlement must preserve the baseline instead
    // of repeatedly treating protected files as deleted.
    if (verified && guarded)
      files = permissionOutput(expectedRun.config.permission_layers || [], baseline.files || [], files);
    // Verified object bytes and Git preparation are independent from the short SQL
    // publication. The storage guard protects them while no connection is held.
    const preparedCheckpoint = verified
      ? await prepareCheckpoint(
          org,
          baseline,
          files,
          'Agent run',
          guarded ? baseline.git_files : gitFiles,
          [],
          publication.verification,
        )
      : null;
    state.publicationStep = 'billing';
    await settleOrphanModelRequests(org, runId);
    state.publicationStep = 'finalization';
    await transaction(org, async (tx) => {
      await lock(tx, `worktree:${expectedRun.worktree_id}`);
      if (expectedRun.config.worker_id) await lock(tx, `worker:${expectedRun.config.worker_id}`);
      await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [runId]);
      const run = await getNativeRun(tx, runId);
      if (terminal(run.status)) return;
      assert(
        run.lease_generation === expectedRun.lease_generation &&
          (run.execution_binding as ExecutionState | null)?.lock === state.lock,
        409,
        'lease_lost',
        'Execution ownership changed before publication.',
      );
      await publication.assertActive(tx);
      const ws = await resources.get(tx, 'worktrees', run.worktree_id);
      assert(
        ws.revision === baseline.revision,
        409,
        'publication_revision_changed',
        'Worktree state changed while preparing execution output.',
      );
      let checkpointId: string | undefined;
      let artifactIds: string[] = [];
      if (verified) {
        state.publicationStep = 'checkpoint';
        assert(
          preparedCheckpoint,
          500,
          'checkpoint_missing',
          'Verified execution requires prepared durable state.',
        );
        const cp = await saveCheckpoint(tx, principalFor(run), preparedCheckpoint);
        await resources.update(tx, 'checkpoints', cp.id, { run_id: runId });
        checkpointId = cp.id;
        artifactIds = await publishArtifacts(tx, run, ws.files || [], files);
        await resources.update(tx, 'worktrees', run.worktree_id, { ...checkpointState(cp), status: 'idle' });
        await resources.update(tx, 'sessions', run.session_id, {
          state_files: home,
          native_session_id: state.result?.resumeId,
        });
        await emit(tx, org, runId, 'checkpoint.created', { checkpoint_id: cp.id, verification: 'verified' });
      } else
        await resources.update(tx, 'worktrees', run.worktree_id, {
          status: state.machine ? 'degraded' : 'idle',
          recovery_run_id: state.machine ? runId : undefined,
        });
      state.publicationStep = 'billing';
      const elapsed = run.started_at
        ? Math.max(
            0,
            Math.min(
              run.config.limits?.timeout_seconds || 900,
              Math.ceil((Date.now() - run.started_at.getTime()) / 1000),
            ),
          )
        : 0;
      const compute = state.machine
        ? computeMaximum(elapsed, run.config.compute_rate_micro_usd_per_minute)
        : 0n;
      const cost = BigInt(run.cost_micro_usd) + compute;
      assert(
        cost <= BigInt(run.reservation_micro_usd),
        500,
        'accounting_bound_failed',
        'Run usage exceeded its held reservation.',
      );
      let status: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' =
        state.result?.outcome === 'success' && verified
          ? 'succeeded'
          : state.result?.outcome === 'cancelled'
            ? 'cancelled'
            : state.result?.outcome === 'timed_out'
              ? 'timed_out'
              : 'failed';
      if (run.cancel_requested && status === 'failed') status = 'cancelled';
      const controlFailure = run.model_error_request_id
        ? 'model_request_failed'
        : state.questionDenied
          ? 'questions_denied'
          : undefined;
      if (controlFailure) status = 'failed';
      const value: NativeRunRow['result'] = {
        output_text: state.result?.output || '',
        execution_outcome: controlFailure ? 'failure' : state.result?.outcome || 'failure',
        persistence_status: verified ? 'verified' : state.machine ? 'failed' : 'not_required',
        ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
        last_verified_checkpoint_id: ws.latest_checkpoint_id,
        failure_code: controlFailure || state.error || state.result?.failureCode,
        artifact_ids: artifactIds,
        sync_status: 'disabled',
      };
      await settle(tx, org, runId, BigInt(run.reservation_micro_usd), cost);
      state.publicationStep = 'finalization';
      await tx.query('UPDATE runs SET status=$2,result=$3,completed_at=now(),cost_micro_usd=$4 WHERE id=$1', [
        runId,
        status,
        JSON.stringify(value),
        cost.toString(),
      ]);
      const traceContext = await runTraceContext(tx, run);
      if (traceContext)
        afterCommit(tx, () =>
          recordTrace({
            context: traceContext,
            id: 'billing:compute',
            name: 'billing.compute',
            type: 'event',
            startedAt: run.started_at || run.created_at,
            endedAt: new Date(),
            chargedMicroUsd: compute.toString(),
            metadata: {
              elapsed_seconds: elapsed,
              charged_micro_usd: compute.toString(),
              rate_micro_usd_per_minute: run.config.compute_rate_micro_usd_per_minute,
              provider_cost_status: 'unavailable',
            },
          }),
        );
      if (verified && (await queueAutomaticSync(tx, principalFor(run), run.worktree_id, runId)))
        value.sync_status = 'pending';
      await emit(tx, org, runId, `run.${status}`, { ...value, status }, undefined, {
        ...run,
        status,
        result: value,
        completed_at: new Date(),
        cost_micro_usd: cost.toString(),
      });
      await tx.query(
        "INSERT INTO product_events(id,organization_id,user_id,name) VALUES($1,$2,$3,'run.completed')",
        [id(), org, run.config.user_id],
      );
    });
  } finally {
    await publication
      .dispose()
      .catch(() => console.warn(JSON.stringify({ code: 'publication_guard_cleanup_failed', run_id: runId })));
  }
}
