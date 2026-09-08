import { queueAutomaticSync } from './git-jobs';
import { pool, transaction, lock } from '../../db';
import { config, isLocal } from './config';
import { id } from './crypto';
import { assert } from './errors';
import { emit } from './events';
import { getRun, terminal, type RunRow } from './runs';
import { settle } from './ledger';
import * as resources from './resources';
import { checkpointState, checkpoint, normalizePath, type FileRecord } from './files';
import { readContent, saveContent } from '../../providers/src/storage';
import { Simulator, type ExecutionProvider } from '../../providers/src/execution';
import { customerScopes, type Principal } from './auth';
import { getExecutionPolicy } from './plans';
import { schedulerTurn, recordTurn, pendingRunCandidates } from './scheduling';
import { actorAuthorized } from './actor-authorization';
import { queueRetryAt } from './queue-wait';

export function principalFor(row: RunRow): Principal {
  return {
    id: row.config.principal_id,
    userId: row.config.user_id,
    organizationId: row.organization_id,
    kind: row.config.principal_kind,
    role: 'member',
    scopes: customerScopes,
    projectIds: row.config.project_ids,
    operator: false,
    oauthTokenId: row.config.oauth_token_id,
  };
}
export async function claimRun(org: string, runId: string) {
  return transaction(org, async (tx) => {
    let run = await getRun(tx, runId);
    await lock(tx, `organization:${org}`);
    await lock(tx, `workspace:${run.workspace_id}`);
    run = await getRun(tx, runId);
    if (run.status !== 'queued') {
      // Old outbox entries must not starve newer work. An active execution is never replayed.
      await tx.query(
        "UPDATE dispatch_jobs SET state=$2,lease_until=CASE WHEN $2='running' THEN now()+interval '90 seconds' ELSE NULL END WHERE kind='run' AND resource_id=$1",
        [runId, terminal(run.status) ? 'done' : 'running'],
      );
      return null;
    }
    // Waiting is durable SQL state, never an unbounded Workflow sleep loop.
    await tx.query("UPDATE dispatch_jobs SET available_at=$2 WHERE kind='run' AND resource_id=$1", [
      runId,
      queueRetryAt(run, Date.now()),
    ]);
    const denied = !(await actorAuthorized(tx, run));
    const workspace = await resources.get(tx, 'workspaces', run.workspace_id),
      project = await resources.get(tx, 'projects', run.project_id);
    const unavailable =
      project.archived ||
      project.deleted ||
      workspace.deleted ||
      ['deleting', 'degraded', 'restoring'].includes(String(workspace.status));
    const policy = await getExecutionPolicy(tx, org);
    const timeoutUnavailable = (run.config.limits?.timeout_seconds || 900) > policy.max_timeout_seconds;
    if (
      run.cancel_requested ||
      run.queue_expires_at.getTime() <= Date.now() ||
      denied ||
      unavailable ||
      timeoutUnavailable
    ) {
      // Deletion and billing controls cancel queued rows without invoking the public
      // cancel handler. Honor that flag before provisioning or any native side effect.
      const status = run.cancel_requested ? 'cancelled' : 'failed';
      const code = run.cancel_requested
        ? 'cancelled'
        : denied
          ? 'authorization_revoked'
          : unavailable
            ? 'workspace_unavailable'
            : timeoutUnavailable
              ? 'execution_limit_changed'
              : 'queue_expired';
      await tx.query('UPDATE runs SET status=$3,completed_at=now(),result=$2 WHERE id=$1', [
        runId,
        JSON.stringify({
          execution_outcome: run.cancel_requested ? 'cancelled' : 'failure',
          persistence_status: 'not_required',
          failure_code: code,
        }),
        status,
      ]);
      await settle(tx, org, runId, BigInt(run.reservation_micro_usd), 0n);
      await emit(tx, org, runId, `run.${status}`, { status, code });
      await tx.query(
        "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='run' AND resource_id=$1",
        [runId],
      );
      return null;
    }
    // A simulator left running must never impersonate a newly admitted native execution.
    // Cancellation and queue expiry above still settle work even under the wrong local profile.
    if (run.config.execution_provider && run.config.execution_provider !== config.execution) return null;
    // Capacity and weighted turns commit together under the existing global lock.
    // A Workflow retry for a specific run must obey the same scheduler as a poller.
    await lock(tx, 'capacity:global');
    const turn = await schedulerTurn(tx);
    if (!turn || turn.id !== runId) return null;
    await recordTurn(tx, org, turn);
    await tx.query(
      "UPDATE runs SET status='provisioning',started_at=now(),heartbeat_at=now(),lease_generation=lease_generation+1,deadline=now()+($2::integer*interval '1 second') WHERE id=$1",
      [runId, run.config.limits?.timeout_seconds || 900],
    );
    await resources.update(tx, 'workspaces', run.workspace_id, { status: 'busy' });
    await emit(tx, org, runId, 'run.provisioning', {});
    await tx.query(
      "UPDATE dispatch_jobs SET state='running',lease_until=now()+interval '90 seconds',attempts=attempts+1 WHERE resource_id=$1",
      [runId],
    );
    return getRun(tx, runId);
  });
}

/** Claims serialize writers. A crashed execution is never silently re-run. */
export async function executeRun(org: string, runId: string, provider?: ExecutionProvider) {
  const run = await claimRun(org, runId);
  if (!run) return false;
  const p = principalFor(run);
  const abort = new AbortController();
  let stopped = false;
  const heartbeat = setInterval(() => {
    void transaction(org, async (tx) => {
      const current = await getRun(tx, runId);
      if (
        current.lease_generation !== run.lease_generation ||
        current.cancel_requested ||
        Date.now() > (current.deadline?.getTime() || Infinity)
      )
        abort.abort(new Error(current.cancel_requested ? 'cancelled' : 'timed_out'));
      await tx.query('UPDATE runs SET heartbeat_at=now() WHERE id=$1 AND lease_generation=$2', [
        runId,
        run.lease_generation,
      ]);
    }).catch(() => abort.abort(new Error('heartbeat_failed')));
  }, 1000);
  try {
    const ws = await transaction(org, (tx) => resources.get(tx, 'workspaces', run.workspace_id));
    const session = await transaction(org, (tx) => resources.get(tx, 'sessions', run.session_id));
    const files = await Promise.all(
      ((ws.files || []) as FileRecord[]).map(async (f) => ({
        path: f.path,
        bytes: await readContent(f.key, f.sha256),
        mode: f.mode,
      })),
    );
    if (!provider) {
      assert(
        isLocal() && config.execution === 'simulator',
        503,
        'provider_unavailable',
        'Execution provider is not configured.',
      );
      provider = new Simulator();
    }
    await transaction(org, async (tx) => {
      await tx.query("UPDATE runs SET status='running' WHERE id=$1", [runId]);
      await emit(tx, org, runId, 'run.started', { simulated: provider instanceof Simulator });
    });
    const result = await provider.execute(
      {
        runId,
        organizationId: org,
        sessionId: run.session_id,
        harness: run.config.harness,
        model: run.config.model,
        prompt: run.config.prompt,
        instructions: run.config.instructions,
        files,
        timeoutSeconds: run.config.limits?.timeout_seconds || 900,
        resumeState: session.resume_state as string | undefined,
        signal: abort.signal,
      },
      async (event) => {
        if (abort.signal.aborted) throw abort.signal.reason;
        await transaction(org, async (tx) => {
          const current = await getRun(tx, runId);
          assert(
            current.lease_generation === run.lease_generation && !terminal(current.status),
            409,
            'lease_lost',
            'Execution lease is no longer active.',
          );
          await emit(tx, org, runId, event.type, event.data);
        });
      },
    );
    if (abort.signal.aborted) throw abort.signal.reason;
    await transaction(org, async (tx) => {
      await tx.query("UPDATE runs SET status='persisting' WHERE id=$1 AND lease_generation=$2", [
        runId,
        run.lease_generation,
      ]);
      await emit(tx, org, runId, 'run.persisting', {});
    });
    const saved: FileRecord[] = [];
    for (const file of result.files) {
      normalizePath(file.path);
      assert(
        file.bytes.length <= 25 * 1024 * 1024,
        413,
        'file_too_large',
        'An output file exceeds the configured limit.',
      );
      saved.push({
        ...(await saveContent(org, file.bytes)),
        path: file.path,
        type: 'file',
        modified_at: new Date().toISOString(),
        git_ignored: file.path.startsWith('.'),
        mode: file.mode,
      });
    }
    await transaction(org, async (tx) => {
      await lock(tx, `workspace:${run.workspace_id}`);
      const current = await getRun(tx, runId);
      assert(
        current.lease_generation === run.lease_generation && !terminal(current.status),
        409,
        'lease_lost',
        'Execution lease was lost before publication.',
      );
      const cp = await checkpoint(tx, p, run.workspace_id, 'Run completed', saved);
      await resources.update(tx, 'checkpoints', cp.id, { run_id: runId });
      await resources.update(tx, 'workspaces', run.workspace_id, {
        ...checkpointState(cp),
        status: 'idle',
      });
      await resources.update(tx, 'sessions', run.session_id, { resume_state: result.resumeState });
      const value = {
        output_text: result.output,
        execution_outcome: 'success',
        persistence_status: 'verified',
        checkpoint_id: cp.id,
        artifact_ids: [],
        sync_status: 'disabled',
      };
      await tx.query("UPDATE runs SET status='succeeded',completed_at=now(),result=$2 WHERE id=$1", [
        runId,
        JSON.stringify(value),
      ]);
      await tx.query(
        'INSERT INTO model_usage(id,organization_id,run_id,request_id,provider,model,billing_mode,input_tokens,output_tokens,cost_micro_usd,completeness) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(request_id) DO NOTHING',
        [
          id(),
          org,
          runId,
          `run:${runId}:summary`,
          provider instanceof Simulator ? 'fixture' : 'harness',
          run.config.model,
          run.config.billing_mode,
          result.inputTokens,
          result.outputTokens,
          provider instanceof Simulator ? '0' : null,
          result.usageComplete ? 'complete' : 'missing',
        ],
      );
      await settle(tx, org, runId, BigInt(run.reservation_micro_usd), BigInt(current.cost_micro_usd));
      await emit(tx, org, runId, 'checkpoint.created', { checkpoint_id: cp.id, verification: 'verified' });
      if (await queueAutomaticSync(tx, p, run.workspace_id, runId)) value.sync_status = 'pending';
      await emit(tx, org, runId, 'run.succeeded', { ...value, status: 'succeeded' });
      await tx.query("UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE resource_id=$1", [runId]);
      await tx.query(
        "INSERT INTO product_events(id,organization_id,user_id,name) VALUES($1,$2,$3,'run.completed')",
        [id(), org, run.config.user_id],
      );
    });
    stopped = true;
    return true;
  } catch (error) {
    await transaction(org, async (tx) => {
      const current = await getRun(tx, runId);
      if (terminal(current.status) || current.lease_generation !== run.lease_generation) return;
      const reason = abort.signal.reason instanceof Error ? abort.signal.reason.message : '';
      const status = reason === 'cancelled' ? 'cancelled' : reason === 'timed_out' ? 'timed_out' : 'failed';
      const failure =
        error instanceof Error && 'code' in error
          ? String(error.code)
          : status === 'failed'
            ? 'execution_failed'
            : status;
      await resources.update(tx, 'workspaces', run.workspace_id, { status: 'idle' });
      await tx.query('UPDATE runs SET status=$2,completed_at=now(),result=$3 WHERE id=$1', [
        runId,
        status,
        JSON.stringify({
          execution_outcome: status === 'failed' ? 'failure' : status,
          persistence_status: 'verified',
          failure_code: failure,
          checkpoint_id: (await resources.get(tx, 'workspaces', run.workspace_id)).latest_checkpoint_id,
        }),
      ]);
      await settle(tx, org, runId, BigInt(current.reservation_micro_usd), BigInt(current.cost_micro_usd));
      await emit(tx, org, runId, `run.${status}`, {
        status,
        code: failure,
        message:
          status === 'failed'
            ? 'Execution stopped. The last verified checkpoint remains available.'
            : 'Execution stopped.',
      });
      await tx.query("UPDATE dispatch_jobs SET state='done',lease_until=NULL,error=$2 WHERE resource_id=$1", [
        runId,
        failure,
      ]);
    });
    stopped = true;
    return true;
  } finally {
    clearInterval(heartbeat);
    if (!stopped) abort.abort();
  }
}
export const pendingRuns = pendingRunCandidates;

/** Deadlines are swept independently of capacity and dispatch leases. A local
 * simulator lost with its worker is failed and fenced; its prompt is never replayed.
 * Cloud executions recover through their durable machine state instead. */
export async function maintainRuns() {
  const expired = await pool.query(`SELECT organization_id,id FROM reporting.scheduling_runs
    WHERE status='queued' AND (queue_expires_at<=now() OR cancel_requested OR unavailable)
    ORDER BY queue_expires_at,id LIMIT 100`);
  for (const row of expired.rows) await claimRun(row.organization_id, row.id);
  let abandoned = 0;
  if (isLocal() && config.execution === 'simulator') {
    const stale = await pool.query(`SELECT organization_id,id FROM reporting.runs
      WHERE status IN ('provisioning','running','waiting_for_input','persisting')
      AND heartbeat_at<now()-interval '90 seconds' LIMIT 100`);
    for (const row of stale.rows)
      await transaction(row.organization_id, async (tx) => {
        let run = await getRun(tx, row.id);
        await lock(tx, `workspace:${run.workspace_id}`);
        await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [row.id]);
        run = await getRun(tx, row.id);
        if (terminal(run.status) || !run.heartbeat_at || Date.now() - run.heartbeat_at.getTime() <= 90000)
          return;
        await tx.query(
          `UPDATE runs SET status='failed',completed_at=now(),lease_generation=lease_generation+1,
        result=result||$2::jsonb WHERE id=$1`,
          [
            row.id,
            JSON.stringify({
              execution_outcome: 'failure',
              failure_code: 'worker_lost',
              persistence_status: 'failed',
              last_verified_checkpoint_retained: true,
            }),
          ],
        );
        await settle(
          tx,
          row.organization_id,
          row.id,
          BigInt(run.reservation_micro_usd),
          BigInt(run.cost_micro_usd),
        );
        await resources.update(tx, 'workspaces', run.workspace_id, { status: 'idle' });
        await emit(tx, row.organization_id, row.id, 'run.failed', { status: 'failed', code: 'worker_lost' });
        await tx.query(
          "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='run' AND resource_id=$1",
          [row.id],
        );
        abandoned++;
      });
  }
  return { queue_cleanup_checked: expired.rowCount || 0, abandoned_simulations: abandoned };
}
