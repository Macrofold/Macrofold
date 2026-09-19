import { releaseSandbox } from './sandboxes';
import { publishArtifacts } from './artifacts';
import { fileAllowed, guardedToolsRequired } from '../../contracts/permissions';
import { permissionOutput } from './agent-permissions';
import { queueAutomaticSync } from './git-jobs';
import { transaction, afterCommit, type Tx } from '../../db';
import { runTraceContext } from './run-tracing';
import { recordTrace } from './tracing';
import { id, sha256 } from './crypto';
import { assert, AppError } from './errors';
import { config } from './config';
import { claimRun, principalFor } from './engine';
import type { NativeRunRow } from './runs';
import { getRun, getNativeRun, requireNativeRun, terminal } from './runs';
import { emit } from './events';
import { settle } from './ledger';
import { computeMaximum } from './catalog';
import { runtimeToken } from './runtime-auth';
import * as resources from './resources';
import { checkpoint, checkpointState, type FileRecord } from './files';
import type { MachineBinding, MachineProvider, RuntimeProbe } from './ports';
import type { NativeConfiguration } from '../../runtime/src/types';
import type { SnapshotEntry } from '../../runtime/src/manifest';
import { isNativeAuthPath } from '../../runtime/src/auth-paths';
import { describeContent, saveChunkManifest, saveContent } from '../../providers/src/storage';
import { stageRestoreObjects, RESTORE_BATCH_OBJECTS, type RestoreObject } from './execution-hydration';
import { settleOrphanModelRequests } from './model-gateway';
import { queueRetryAt } from './queue-wait';

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
export type ExecutionState = {
  provider: 'vercel' | 'docker';
  phase: Phase;
  machine?: MachineBinding;
  inputOffset?: number;
  indexOffset?: number;
  eventOffset?: number;
  result?: NonNullable<RuntimeProbe['result']>;
  error?: string;
  inputId?: string;
  preserve?: boolean;
  snapshotId?: string;
  lock?: string;
  lockExpires?: number;
  failures?: number;
  /** Internal timings only; wall time includes orchestration waits and retries. */
  phaseTimings?: Partial<
    Record<Phase, { startedAt: number; completedAt?: number; activeMs: number; attempts: number }>
  >;
};
type ExecutionObject = { id: string; kind: string; name: string; data: Record<string, unknown> };
const object = async (tx: Tx, org: string, run: string, kind: string, name: string, data: unknown) =>
  tx.query(
    'INSERT INTO execution_objects(id,organization_id,run_id,kind,name,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id,kind,name) DO NOTHING',
    [id(), org, run, kind, name, JSON.stringify(data)],
  );
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
): Promise<{ done: boolean; delaySeconds: number; queued?: boolean }> {
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
    phase: 'input',
  }) as ExecutionState;
  if (state.phase === 'done' || (terminal(run.status) && !run.execution_binding))
    return { done: true, delaySeconds: 0 };
  const claim = id();
  const owns = await transaction(org, async (tx) => {
    await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [runId]);
    const current = await getNativeRun(tx, runId);
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
  try {
    if (['input', 'provision', 'hydrate', 'restore', 'restore_wait', 'launch'].includes(state.phase))
      assert(
        !run.cancel_requested && run.deadline!.getTime() > Date.now(),
        409,
        'run_stopped',
        'The run stopped before the native agent started.',
      );
    if (state.phase === 'input') {
      const source = await transaction(org, async (tx) => {
        const ws = await resources.get(tx, 'worktrees', run.worktree_id),
          session = await resources.get(tx, 'sessions', run.session_id);
        return [
          ...((ws.files || []) as FileRecord[])
            .filter(
              (f) =>
                !guardedToolsRequired(run.config.permission_layers || []) ||
                (f.type === 'file' && fileAllowed(run.config.permission_layers || [], 'read', f.path)),
            )
            .map((f) => ({ ...f, namespace: 'workspace' as const })),
          ...(
            (guardedToolsRequired(run.config.permission_layers || [])
              ? []
              : ws.git_files || []) as FileRecord[]
          ).map((f) => ({ ...f, namespace: 'workspace' as const })),
          ...((session.state_files || []) as FileRecord[]).map((f) => ({ ...f, namespace: 'home' as const })),
        ].filter((file) => !isNativeAuthPath(file.namespace, file.path));
      });
      const offset = state.inputOffset || 0;
      const entries: SnapshotEntry[] = [];
      for (const file of source.slice(offset, offset + 16)) {
        const chunks = await describeContent(file.key, file.sha256);
        for (const chunk of chunks)
          await transaction(org, (tx) => object(tx, org, runId, 'input_chunk', chunk.sha256, chunk));
        entries.push({
          namespace: file.namespace,
          path: file.path,
          type: file.type,
          size: Number(file.size_bytes),
          sha256: file.sha256,
          mode: file.mode || 0o644,
          modifiedAt: file.modified_at,
          chunks: chunks.map((c) => ({ hash: c.sha256, size: c.size })),
        });
      }
      if (entries.length)
        await transaction(org, (tx) => object(tx, org, runId, 'input_page', String(offset), { entries }));
      state.inputOffset = offset + entries.length;
      if (state.inputOffset >= source.length) state.phase = 'provision';
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
        ...(run.config.sandbox_id
          ? {
              warm: {
                sessionId: run.session_id,
                checkpointId: await transaction(
                  org,
                  async (tx) =>
                    (await resources.get(tx, 'worktrees', run.worktree_id)).latest_checkpoint_id ?? null,
                ),
                toolFingerprint: sha256(
                  JSON.stringify({
                    grants: run.config.connection_grants || [],
                    access: run.config.connection_access || [],
                  }),
                ),
              },
            }
          : {}),
        harness: run.config.harness,
        model: run.config.model,
        provider: model.provider,
        prompt: run.config.prompt,
        attachments: run.config.attachments,
        instructions: run.config.instructions,
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
      state.phase = prepared?.reused ? 'launch' : 'hydrate';
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
      if (run.cancel_requested || run.deadline!.getTime() <= Date.now())
        await provider.cancel(state.machine!);
      if (run.input_request?.answer) {
        await provider.answer(state.machine!, run.input_request.id, run.input_request.answer);
        await transaction(org, (tx) =>
          tx.query("UPDATE runs SET status='running' WHERE id=$1 AND status='waiting_for_input'", [runId]),
        );
      }
      const result = await provider.probe(state.machine!, state.eventOffset || 0);
      await transaction(org, async (tx) => {
        for (const e of result.events)
          if (
            [
              'output.delta',
              'reasoning.summary',
              'tool.started',
              'tool.completed',
              'runtime.started',
              'runtime.trace_truncated',
            ].includes(e.type)
          )
            await emit(tx, org, runId, e.type, e.data, {
              id: `runtime:${run.lease_generation}`,
              sequence: e.sequence,
            });
        if (result.input && state.inputId !== result.input.id) {
          await tx.query("UPDATE runs SET status='waiting_for_input',input_request=$2 WHERE id=$1", [
            runId,
            JSON.stringify(result.input),
          ]);
          await emit(tx, org, runId, 'input.requested', {
            input_request_id: result.input.id,
            ...result.input,
          });
          state.inputId = result.input.id;
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
      } else if (!result.result) delaySeconds = 2;
    } else if (state.phase === 'index') {
      const page = await provider.snapshotPage(state.machine!, state.indexOffset || 0);
      assert(
        page.totalBytes <= 10 * 1024 ** 3 && page.total <= 100_000,
        413,
        'checkpoint_storage_limit',
        'The worktree exceeds its configured persistence limit.',
      );
      await transaction(org, async (tx) => {
        for (const entry of page.entries) {
          if (isNativeAuthPath(entry.namespace, entry.path)) continue;
          await object(tx, org, runId, 'output_entry', `${entry.namespace}/${entry.path}`, entry);
          for (const chunk of entry.chunks) await object(tx, org, runId, 'output_chunk', chunk.hash, chunk);
        }
      });
      state.indexOffset = (state.indexOffset || 0) + page.entries.length;
      if (state.indexOffset >= page.total) state.phase = 'upload';
    } else if (state.phase === 'upload') {
      const chunks = await pending(org, runId, ['output_chunk']);
      for (const item of chunks) {
        const bytes = await provider.chunk(state.machine!, item.name);
        assert(
          sha256(bytes) === item.name && bytes.length === Number(item.data.size),
          502,
          'checkpoint_corrupt',
          'A runtime checkpoint chunk failed integrity verification.',
        );
        await saveContent(org, bytes);
        await processed(org, [item]);
      }
      if (!chunks.length) {
        const entries = await pending(org, runId, ['output_entry'], 8);
        for (const item of entries) {
          const entry = item.data as unknown as SnapshotEntry;
          const saved = await saveChunkManifest(
            org,
            entry.sha256,
            entry.size,
            entry.chunks.map((c) => ({ key: `${org}/content/${c.hash}`, sha256: c.hash, size: c.size })),
          );
          await transaction(org, (tx) =>
            tx.query('UPDATE execution_objects SET data=data||$2::jsonb,processed=true WHERE id=$1', [
              item.id,
              JSON.stringify({
                record: {
                  ...saved,
                  path: entry.path,
                  type: entry.type,
                  mode: entry.mode,
                  modified_at: entry.modifiedAt,
                  git_ignored: entry.path.startsWith('.'),
                },
              }),
            ]),
          );
        }
        if (!entries.length) state.phase = 'publish';
      }
    } else if (state.phase === 'publish') {
      await publishCloudRun(org, runId, state);
      state.phase = 'close';
    } else if (state.phase === 'close') {
      if (state.machine) {
        const recovery = await provider.close(state.machine, Boolean(state.preserve));
        state.snapshotId = recovery.snapshotId;
      }
      if (!state.machine && run.config.sandbox_id)
        await releaseSandbox(org, run.config.sandbox_id, runId, 0, true);
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
    if (error instanceof AppError && error.code === 'sandbox_starting') {
      return { done: false, delaySeconds: 3 };
    }
    state.failures = (state.failures || 0) + 1;
    const code = error instanceof AppError ? error.code : 'execution_transport_failed';
    if (state.failures >= 3 && state.phase !== 'close') {
      state.error = code;
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
    }
    delaySeconds = Math.min(60, 2 ** state.failures);
  } finally {
    timing.activeMs += Math.round(performance.now() - started);
    timing.attempts++;
    if (state.phase !== phase) timing.completedAt = Date.now();
    delete state.lock;
    delete state.lockExpires;
    await transaction(org, (tx) =>
      tx.query(
        "UPDATE runs SET execution_binding=$2,heartbeat_at=now() WHERE id=$1 AND execution_binding->>'lock'=$3",
        [runId, JSON.stringify(state), claim],
      ),
    );
    if (state.phase !== 'done')
      await transaction(org, (tx) =>
        tx.query(
          "UPDATE dispatch_jobs SET lease_until=now()+interval '5 minutes' WHERE kind='run' AND resource_id=$1",
          [runId],
        ),
      );
  }
  return { done: state.phase === 'done', delaySeconds };
}

async function publishCloudRun(org: string, runId: string, state: ExecutionState) {
  await transaction(org, (tx) =>
    tx.query(
      "UPDATE runs SET status='persisting' WHERE id=$1 AND status NOT IN ('succeeded','failed','cancelled','timed_out')",
      [runId],
    ),
  );
  // Requests without a final usage frame are conservatively settled from their held reservation.
  await settleOrphanModelRequests(org, runId);
  await transaction(org, async (tx) => {
    await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [runId]);
    const run = await getNativeRun(tx, runId);
    if (terminal(run.status)) return;
    const ws = await resources.get(tx, 'worktrees', run.worktree_id);
    const verified = !state.error && state.result?.persistence === 'captured';
    let checkpointId: string | undefined;
    let artifactIds: string[] = [];
    if (verified) {
      const objects = (
        await tx.query('SELECT data FROM execution_objects WHERE run_id=$1 AND kind=$2 AND processed', [
          runId,
          'output_entry',
        ])
      ).rows as { data: SnapshotEntry & { record: FileRecord } }[];
      let files = objects
        .filter((o) => o.data.namespace === 'workspace' && !o.data.path.split('/').includes('.git'))
        .map((o) => o.data.record);
      const gitFiles = objects
        .filter((o) => o.data.namespace === 'workspace' && o.data.path.split('/').includes('.git'))
        .map((o) => o.data.record);
      const home = objects.filter((o) => o.data.namespace === 'home').map((o) => o.data.record);
      if (guardedToolsRequired(run.config.permission_layers || []))
        files = permissionOutput(run.config.permission_layers || [], ws.files || [], files);
      // Every object was read back and hash-verified before reaching this transaction.
      const cp = await checkpoint(
        tx,
        principalFor(run),
        run.worktree_id,
        'Agent run',
        files,
        guardedToolsRequired(run.config.permission_layers || []) ? ws.git_files : gitFiles,
      );
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
    const value = {
      output_text: state.result?.output || '',
      execution_outcome: state.result?.outcome || 'failure',
      persistence_status: verified ? 'verified' : state.machine ? 'failed' : 'not_required',
      ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
      last_verified_checkpoint_id: ws.latest_checkpoint_id,
      failure_code: state.error || state.result?.failureCode,
      artifact_ids: artifactIds,
      sync_status: 'disabled',
    };
    await settle(tx, org, runId, BigInt(run.reservation_micro_usd), cost);
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
    await emit(tx, org, runId, `run.${status}`, { ...value, status });
    await tx.query(
      "INSERT INTO product_events(id,organization_id,user_id,name) VALUES($1,$2,$3,'run.completed')",
      [id(), org, run.config.user_id],
    );
  });
}
