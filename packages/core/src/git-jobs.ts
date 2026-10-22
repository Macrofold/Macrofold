import { mapConcurrent } from './concurrent';
import { dispatchFailed, dispatchSucceeded } from './dispatch-failures';
import { isSimulated } from './config';
import { pool, transaction, type Tx } from '../../db';
import { type Principal, requireScopes } from './auth';
import { actorAuthorized } from './actor-authorization';
import { assert } from './errors';
import { id } from './crypto';
import * as resources from './resources';
import { ensureWritable, checkpoint, checkpointState, type FileRecord } from './files';
import { GitHubHost, type RepositoryHost } from '../../providers/src/github';
import { synchronizeGit } from '../../providers/src/git-sync';
import { enqueueWebhook, dispatchWebhooks } from './webhooks';
import { dispatchConnectionCleanup } from './connection-cleanup';
import { MaintenanceDispatcher, type MaintenanceTask } from './maintenance-dispatch';
export type SyncMode = 'push' | 'pull' | 'pull_request';
export async function queueGitSync(
  tx: Tx,
  p: Principal,
  worktreeId: string,
  mode: SyncMode = 'push',
  sourceRunId?: string,
) {
  requireScopes(p, ['files:write']);
  const ws = await resources.get(tx, 'worktrees', worktreeId, p);
  const workspace = await resources.get(tx, 'workspaces', String(ws.workspace_id), p);
  assert(workspace.github, 409, 'git_not_connected', 'Connect a GitHub repository to enable sync.');
  await ensureWritable(tx, worktreeId, sourceRunId);
  const op = await resources.operation(tx, p, 'git_sync', { worktree_id: worktreeId }, 'queued');
  await resources.update(tx, 'operations', op.id, {
    mode,
    source_run_id: sourceRunId,
    actor: {
      id: p.id,
      userId: p.userId,
      kind: p.kind,
      oauthTokenId: p.oauthTokenId,
      workspaceIds: p.workspaceIds,
    },
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  });
  await resources.update(tx, 'worktrees', worktreeId, {
    sync: { worktree_id: worktreeId, status: 'pending', updated_at: new Date().toISOString() },
  });
  await tx.query(
    "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'operation',$3)",
    [id(), p.organizationId, op.id],
  );
  return op;
}
/** Git pushes are conditional ref updates. Recovery fetches the remote again and never uses force.
 * A DB advisory lock serializes sync with native admission and editor writes throughout this bounded job. */
export async function executeGitJob(
  org: string,
  operationId: string,
  host: RepositoryHost = new GitHubHost(),
) {
  return transaction(org, async (tx) => {
    const acquired = await tx.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [
      `operation:${operationId}`,
    ]);
    if (!acquired.rows[0].locked) return;
    const op = await resources.get(tx, 'operations', operationId);
    if (op.status !== 'queued' || op.kind !== 'git_sync') {
      await tx.query(
        "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='operation' AND resource_id=$1",
        [operationId],
      );
      return;
    }
    if (Date.parse(String(op.expires_at)) <= Date.now()) {
      await resources.update(tx, 'operations', operationId, {
        status: 'failed',
        error: {
          code: 'operation_expired',
          message: 'This sync request expired. Request a new sync.',
          request_id: operationId,
          retryable: false,
        },
      });
      await tx.query(
        "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='operation' AND resource_id=$1",
        [operationId],
      );
      return;
    }
    await tx.query(
      "UPDATE dispatch_jobs SET available_at=now()+interval '30 seconds' WHERE kind='operation' AND resource_id=$1",
      [operationId],
    );
    const worktreeId = String((op.result as Record<string, unknown>).worktree_id);
    const writable = await tx.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [
      `worktree:${worktreeId}`,
    ]);
    if (!writable.rows[0].locked) return;
    const actor = op.actor as Pick<Principal, 'id' | 'userId' | 'kind' | 'oauthTokenId' | 'workspaceIds'>;
    const ws = await resources.get(tx, 'worktrees', worktreeId),
      workspace = await resources.get(tx, 'workspaces', String(ws.workspace_id));
    const p: Principal = {
      ...actor,
      organizationId: org,
      role: 'member',
      operator: false,
      scopes: ['files:write', 'files:read', 'workspaces:read'],
    };
    try {
      assert(
        Date.parse(String(op.expires_at)) > Date.now(),
        409,
        'operation_expired',
        'This sync request expired. Request a new sync.',
      );
      assert(
        await actorAuthorized(
          tx,
          {
            organization_id: org,
            workspace_id: String(ws.workspace_id),
            config: {
              user_id: actor.userId!,
              principal_id: actor.id,
              principal_kind: actor.kind,
              oauth_token_id: actor.oauthTokenId,
            },
          },
          op.source_run_id ? 'runs:write' : 'files:write',
        ),
        403,
        'authorization_revoked',
        'The initiating credential is no longer authorized.',
      );
      const active = await tx.query(
        "SELECT 1 FROM runs WHERE worktree_id=$1 AND status IN ('provisioning','running','waiting_for_input','persisting')",
        [worktreeId],
      );
      if (active.rowCount) return; // Keep the job queued; the next sweep follows the agent's persistence commit.
      const target = workspace.github as
        { installation_id: string; repository_id: string; target_branch: string } | undefined;
      assert(
        target && !workspace.archived,
        409,
        'git_not_connected',
        'The workspace is no longer connected.',
      );
      const installed = await tx.query(
        'SELECT 1 FROM github_installations i JOIN github_repository_grants g ON g.organization_id=i.organization_id AND g.installation_id=i.installation_id WHERE i.organization_id=$1 AND i.installation_id=$2 AND i.active AND g.repository_id=$3',
        [org, target.installation_id, target.repository_id],
      );
      assert(installed.rowCount, 403, 'github_installation_revoked', 'Reconnect this GitHub installation.');
      assert(
        !op.github_notification || (workspace.github as { auto_pull?: boolean }).auto_pull,
        409,
        'automatic_pull_disabled',
        'Automatic Git pull has been disabled.',
      );
      assert(
        !op.source_run_id || (workspace.github as { auto_sync?: boolean }).auto_sync,
        409,
        'automatic_sync_disabled',
        'Automatic Git sync has been disabled.',
      );
      assert(
        op.mode !== 'pull_request' || String(ws.branch) !== target.target_branch,
        409,
        'pull_request_branch_required',
        'Use an independent worktree branch to open a pull request.',
      );
      const remote = await host.remote(target.installation_id, target.repository_id);
      const result = await synchronizeGit(
        org,
        String(ws.branch),
        target.target_branch,
        op.mode as SyncMode,
        (ws.files || []) as FileRecord[],
        (ws.git_files || []) as FileRecord[],
        remote,
      );
      const state: import('./resource-models').ResourceModels['worktrees']['sync'] = {
        worktree_id: worktreeId,
        status: result.status,
        source_commit: result.source_commit,
        target_commit: result.target_commit,
        conflicting_paths: result.conflicting_paths,
        error_code: result.error_code,
        updated_at: new Date().toISOString(),
      };
      const cp = await checkpoint(tx, p, worktreeId, 'Git synchronization', result.files, result.git_files);
      await resources.update(tx, 'worktrees', worktreeId, { ...checkpointState(cp), sync: state });
      if (
        result.status === 'synced' &&
        op.mode === 'pull_request' &&
        String(ws.branch) !== target.target_branch
      )
        state.pull_request_url = await host.pullRequest(
          target.installation_id,
          target.repository_id,
          String(ws.branch),
          target.target_branch,
        );
      await resources.update(tx, 'worktrees', worktreeId, { sync: state });
      if (op.mode === 'pull' && result.status === 'synced')
        await resources.update(tx, 'worktrees', worktreeId, { remote_change: null });
      await resources.update(tx, 'operations', operationId, {
        status: 'succeeded',
        result: { worktree_id: worktreeId, checkpoint_id: cp.id, sync: state },
      });
    } catch (error) {
      // Provider messages may contain repository URLs or auth details. Persist stable codes only.
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String(error.code).slice(0, 100)
          : 'git_provider_error';
      await resources.update(tx, 'worktrees', worktreeId, {
        sync: {
          worktree_id: worktreeId,
          status: 'blocked',
          error_code: code,
          updated_at: new Date().toISOString(),
        },
      });
      await resources.update(tx, 'operations', operationId, {
        status: 'failed',
        error: {
          code,
          request_id: operationId,
          retryable: false,
          message:
            'Git sync stopped. Your files remain preserved. Check access, branch protection, and the remote branch before retrying.',
        },
      });
    }
    if (op.source_run_id) {
      const current = await resources.get(tx, 'worktrees', worktreeId);
      await tx.query("UPDATE runs SET result=jsonb_set(result,'{sync_status}',$2::jsonb) WHERE id=$1", [
        op.source_run_id,
        JSON.stringify((current.sync as { status: string }).status),
      ]);
    }
    const completed = await resources.get(tx, 'worktrees', worktreeId);
    await enqueueWebhook(
      tx,
      org,
      'git_sync.updated',
      { worktree_id: worktreeId, workspace_id: ws.workspace_id, sync: completed.sync },
      { workspaceId: String(ws.workspace_id) },
    );
    await tx.query(
      "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE kind='operation' AND resource_id=$1",
      [operationId],
    );
  });
}
async function dispatchGitJobs(host?: RepositoryHost) {
  const jobs = await pool.query(
    "SELECT organization_id,resource_id FROM dispatch_jobs WHERE kind='operation' AND state IN ('pending','running') AND available_at<=now() ORDER BY available_at LIMIT 16",
  );
  let processed = 0;
  const deadline = Date.now() + 20_000;
  await mapConcurrent(jobs.rows, 2, async (job) => {
    if (Date.now() >= deadline) return;
    processed++;
    try {
      await executeGitJob(job.organization_id, job.resource_id, host);
      await dispatchSucceeded(job.organization_id, 'operation', job.resource_id);
    } catch {
      // A malformed historical job must not starve new work or unrelated maintenance.
      await dispatchFailed(job.organization_id, 'operation', job.resource_id, 'operation_dispatch_failed');
    }
  });
  return { operations: processed };
}
export function maintenanceTasks(host?: RepositoryHost): MaintenanceTask[] {
  const tasks: [string, () => Promise<Record<string, number>>][] = [
    ['git', () => dispatchGitJobs(host)],
    [
      'workers',
      async () => ({ workers_checked: await (await import('./worker-reconciler')).dispatchWorkers() }),
    ],
    ['runs', async () => (await import('./engine')).maintainRuns()],
    ['model_deployments', async () => (await import('./model-deployment-reconciler')).dispatchModelDeployments()],
    ['decision_tasks', async () => (await import('./decision-task-engine')).dispatchDecisionTasks()],
    ['trigger_admission', async () => (await import('./trigger-dispatch')).dispatchTriggerAdmissions()],
    ['trigger_replies', async () => (await import('./trigger-dispatch')).dispatchTriggerReplies()],
    ['webhooks', dispatchWebhooks],
    ['analytics', async () => (await import('./analytics-export')).forwardProductEvents()],
    ['connections', dispatchConnectionCleanup],
    ['transfers', async () => (await import('./transfers')).cleanupTransfers()],
    ['github', async () => (await import('./github-webhooks')).dispatchGithubPulls()],
    ['finance', async () => (await import('./maintenance')).dispatchOrganizationMaintenance()],
    ['storage', async () => (await import('./storage-maintenance')).dispatchStorageMaintenance()],
    ['reports', async () => (await import('./report-snapshots')).snapshotReports()],
    [
      'models',
      async () => {
        if (isSimulated()) return { model_catalog_refreshed: 0 };
        const { refreshModelCatalog } = await import('./model-catalog');
        const { providerModelCatalog } = await import('../../providers/src/model-catalog');
        return refreshModelCatalog(providerModelCatalog());
      },
    ],
  ];
  return tasks.map(([name, run]) => ({
    name,
    run,
    intervalMs: ['workers', 'runs', 'decision_tasks', 'trigger_admission', 'trigger_replies'].includes(name)
      ? 2000
      : 15000,
    ...(name === 'decision_tasks'
      ? { drain: async () => (await import('./decision-task-wakes')).drainTaskProgress() }
      : {}),
    ...(name === 'transfers'
      ? { drain: async () => (await import('./model-staging-cleanup')).drainModelStagingCleanup() }
      : {}),
  }));
}
const maintenance = new MaintenanceDispatcher(maintenanceTasks());
export async function dispatchMaintenance(host?: RepositoryHost) {
  return host ? new MaintenanceDispatcher(maintenanceTasks(host)).sweep() : maintenance.sweep();
}

export async function queueAutomaticSync(tx: Tx, p: Principal, worktreeId: string, runId: string) {
  const ws = await resources.get(tx, 'worktrees', worktreeId),
    workspace = await resources.get(tx, 'workspaces', String(ws.workspace_id));
  const settings = workspace.github as { auto_sync?: boolean; sync_mode?: SyncMode } | undefined;
  if (!settings?.auto_sync) return false;
  await queueGitSync(tx, p, worktreeId, settings.sync_mode || 'push', runId);
  await tx.query(
    "UPDATE runs SET result=jsonb_set(result,'{sync_status}','\"pending\"'::jsonb) WHERE id=$1",
    [runId],
  );
  return true;
}
