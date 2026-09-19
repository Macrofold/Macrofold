import { planFor } from './plans';
import type { Tx } from '../../db';
import { lock } from '../../db';
import { auth, requireScopes, type Principal } from './auth';
import { assert } from './errors';
import * as r from './resources';
import { seal, unseal, id } from './crypto';

export async function requestWorkspaceDeletion(
  tx: Tx,
  p: Principal,
  workspaceId: string,
  input: { confirmation: string; password?: string },
  request: Request,
) {
  requireScopes(p, ['workspaces:delete']);
  assert(
    ['owner', 'admin'].includes(p.role),
    403,
    'organization_admin_required',
    'An owner or admin must schedule permanent deletion.',
  );
  await lock(tx, `workspace-deletion:${workspaceId}`);
  const workspace = await r.get(tx, 'workspaces', workspaceId, p);
  assert(
    input.confirmation === workspace.name,
    400,
    'confirmation_mismatch',
    'Type the exact workspace name to schedule deletion.',
  );
  if (!request.headers.has('authorization')) {
    const session = await auth.api.getSession({ headers: request.headers });
    assert(session, 401, 'unauthenticated', 'Sign in again.');
    if (Date.now() - new Date(session.session.createdAt).getTime() > 15 * 60000) {
      assert(
        input.password,
        409,
        'recent_authentication_required',
        'Confirm your password, or sign out and sign in again, before scheduling deletion.',
      );
      let valid = false;
      try {
        valid = (
          await auth.api.verifyPassword({ headers: request.headers, body: { password: input.password } })
        ).status;
      } catch {
        /* Report a stable error without exposing authentication internals. */
      }
      assert(valid, 403, 'invalid_password', 'Password verification failed.');
    }
  }
  if (workspace.deletion_due_at) return workspace;
  await tx.query('UPDATE triggers SET enabled=false,updated_at=now() WHERE workspace_id=$1', [workspaceId]);
  await tx.query(
    "UPDATE runs SET cancel_requested=true WHERE workspace_id=$1 AND status IN ('queued','provisioning','running','waiting_for_input')",
    [workspaceId],
  );
  await tx.query('UPDATE organizations SET storage_due_at=now() WHERE id=$1', [p.organizationId]);
  return r.update(tx, 'workspaces', workspaceId, {
    archived: true,
    deletion_prior_archived: !!workspace.archived,
    deletion_requested_at: new Date().toISOString(),
    deletion_due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
}
export async function cancelWorkspaceDeletion(tx: Tx, p: Principal, workspaceId: string) {
  requireScopes(p, ['workspaces:delete']);
  assert(
    ['owner', 'admin'].includes(p.role),
    403,
    'organization_admin_required',
    'An owner or admin must restore this workspace.',
  );
  await lock(tx, `workspace-deletion:${workspaceId}`);
  const workspace = await r.get(tx, 'workspaces', workspaceId, p);
  assert(workspace.deletion_due_at, 409, 'deletion_not_pending', 'This workspace has no pending deletion.');
  return r.update(tx, 'workspaces', workspaceId, {
    archived: !!workspace.deletion_prior_archived,
    deletion_requested_at: null,
    deletion_due_at: null,
  });
}
/** Content removal retains accounting/usage identifiers. Its caller holds the exclusive tenant
 * storage lock and has proved that no agent is active, so native publication cannot race removal. */
export async function purgeWorkspaces(tx: Tx, at: Date) {
  const workspaces = (
    await tx.query(
      "SELECT id FROM workspaces WHERE coalesce(data->>'deleted','false')<>'true' AND (data->>'deletion_due_at')::timestamptz<=$1",
      [at],
    )
  ).rows;
  for (const workspace of workspaces) {
    const triggerIds = (await tx.query('SELECT id FROM triggers WHERE workspace_id=$1', [workspace.id])).rows.map(
      (v) => v.id,
    );
    await tx.query(
      "UPDATE triggers SET enabled=false,deleted_at=$2,prompt='[Deleted workspace]',secret_hash=NULL WHERE workspace_id=$1",
      [workspace.id, at],
    );
    await tx.query('DELETE FROM trigger_routes WHERE id=ANY($1::uuid[])', [triggerIds]);
    await tx.query(
      "UPDATE trigger_deliveries SET prompt_ciphertext='',status=CASE WHEN status='pending' THEN 'failed' ELSE status END,error_code='workspace_deleted' WHERE trigger_id=ANY($1::uuid[])",
      [triggerIds],
    );
    await tx.query(
      "UPDATE dispatch_jobs SET state='done',lease_until=NULL WHERE (kind='trigger_schedule' AND resource_id=ANY($1::uuid[])) OR (kind='trigger' AND resource_id IN (SELECT id FROM trigger_deliveries WHERE trigger_id=ANY($1::uuid[])))",
      [triggerIds],
    );
    const worktreeIds = (
      await tx.query('SELECT id FROM worktrees WHERE workspace_id=$1', [workspace.id])
    ).rows.map((v) => v.id);
    const runIds = (await tx.query('SELECT id FROM runs WHERE workspace_id=$1', [workspace.id])).rows.map(
      (v) => v.id,
    );
    const sessionIds = (
      await tx.query('SELECT id FROM sessions WHERE worktree_id=ANY($1::uuid[])', [worktreeIds])
    ).rows.map((v) => v.id);
    for (const table of ['checkpoints', 'artifacts', 'operations', 'transfers'] as const)
      await tx.query(
        `UPDATE ${table} SET data=jsonb_build_object('deleted',true,'workspace_id',$1::text,'purged_at',$2::timestamptz),revision=revision+1,updated_at=$2 WHERE data->>'workspace_id'=$1 OR data->>'worktree_id'=ANY($3::text[]) OR data->>'run_id'=ANY($4::text[])`,
        [workspace.id, at, worktreeIds, runIds],
      );
    await tx.query(
      "UPDATE worktrees SET data=jsonb_build_object('deleted',true,'status','deleting','purged_at',$2::timestamptz),revision=revision+1,updated_at=$2 WHERE workspace_id=$1",
      [workspace.id, at],
    );
    await tx.query(
      "UPDATE sessions SET data=jsonb_build_object('deleted',true,'workspace_id',$1::text,'purged_at',$2::timestamptz),revision=revision+1,updated_at=$2 WHERE worktree_id=ANY($3::uuid[])",
      [workspace.id, at, worktreeIds],
    );
    await tx.query("UPDATE decision_definitions SET definition='{}',withdrawn_at=$2 WHERE workspace_id=$1",[workspace.id,at]);
    await tx.query("UPDATE decision_tasks SET status='closed',close_requested=true,recipe='{}' WHERE workspace_id=$1",[workspace.id]);
    await tx.query('DELETE FROM decision_task_evidence WHERE task_id IN (SELECT id FROM decision_tasks WHERE workspace_id=$1)',[workspace.id]);
    await tx.query("UPDATE decision_task_wakes SET input_ciphertext='' WHERE task_id IN (SELECT id FROM decision_tasks WHERE workspace_id=$1)",[workspace.id]);
    await tx.query("UPDATE decision_task_outcomes SET receipt='{}' WHERE task_id IN (SELECT id FROM decision_tasks WHERE workspace_id=$1)",[workspace.id]);
    await redactRuns(tx, runIds, at);
    await tx.query('DELETE FROM execution_objects WHERE run_id=ANY($1::uuid[])', [runIds]);
    await tx.query('UPDATE runs SET execution_binding=NULL WHERE id=ANY($1::uuid[])', [runIds]);
    await redactCached(tx, new Set([workspace.id, ...worktreeIds, ...runIds, ...sessionIds, ...triggerIds]));
    await tx.query(
      "UPDATE workspaces SET data=jsonb_build_object('deleted',true,'archived',true,'name','Deleted workspace','purged_at',$2::timestamptz),revision=revision+1,updated_at=$2 WHERE id=$1",
      [workspace.id, at],
    );
  }
  return workspaces.length;
}
async function redactCached(tx: Tx, identifiers: Set<string>) {
  if (!identifiers.size) return;
  const contains = (value: unknown): boolean =>
    typeof value === 'string'
      ? identifiers.has(value)
      : !!value && typeof value === 'object'
        ? Object.values(value).some(contains)
        : false;
  // Retain the fingerprint so replay cannot repeat an old mutation after content removal.
  const cached = (
    await tx.query('SELECT ctid::text AS locator,response_ciphertext FROM idempotency FOR UPDATE')
  ).rows;
  for (const row of cached)
    if (contains(unseal(row.response_ciphertext)))
      await tx.query('UPDATE idempotency SET response_ciphertext=$2,status=410 WHERE ctid=$1::tid', [
        row.locator,
        seal({
          error: {
            code: 'content_expired',
            message: 'The referenced content was deleted or expired.',
            request_id: id(),
          },
        }),
      ]);
}
async function redactRuns(tx: Tx, runIds: string[], at: Date) {
  await tx.query("UPDATE trigger_deliveries SET prompt_ciphertext='' WHERE run_id=ANY($1::uuid[])", [runIds]);
  if (!runIds.length) return;
  await tx.query(
    "DELETE FROM run_events WHERE run_id=ANY($1::uuid[]) AND type NOT IN ('run.succeeded','run.failed','run.cancelled','run.timed_out')",
    [runIds],
  );
  await tx.query(
    'UPDATE run_events SET data=\'{"content_expired":true}\'::jsonb WHERE run_id=ANY($1::uuid[])',
    [runIds],
  );
  await tx.query('DELETE FROM decision_tool_steps WHERE run_id=ANY($1::uuid[])',[runIds]);
  await tx.query("UPDATE decision_invocations SET body_ciphertext='',response_ciphertext=NULL WHERE run_id=ANY($1::uuid[])", [runIds]);
  await tx.query('UPDATE tool_invocations SET result_ciphertext=NULL WHERE run_id=ANY($1::uuid[])', [runIds]);
  await tx.query(
    "UPDATE artifacts SET data=jsonb_build_object('deleted',true,'run_id',data->>'run_id','expired_at',$2::timestamptz),revision=revision+1,updated_at=$2 WHERE data->>'run_id'=ANY($1::text[]) AND coalesce(data->>'retention','diagnostic')<>'published'",
    [runIds, at],
  );
  await tx.query(
    `UPDATE runs SET config=(config-'instructions'-'attachments'-'input')||CASE WHEN kind='native_agent' THEN '{}'::jsonb ELSE '{"definition":{},"context":{}}'::jsonb END||'{"prompt":"[Detailed content expired]"}'::jsonb,
    result=(result-'output_text'-'inference')||jsonb_build_object('content_expired',true,'content_expired_at',$2::timestamptz),input_request=NULL WHERE id=ANY($1::uuid[])`,
    [runIds, at],
  );
}
export async function expireDetailedHistory(tx: Tx, plan: string, at: Date) {
  const cutoff = new Date(at.getTime() - planFor(plan).history_days * 86400000);
  const runs = (
    await tx.query(
      "SELECT id FROM runs WHERE completed_at<$1 AND status IN ('succeeded','failed','cancelled','timed_out') AND coalesce(result->>'content_expired','false')<>'true' AND NOT EXISTS(SELECT 1 FROM decision_task_runs tr JOIN decision_tasks t ON t.id=tr.task_id WHERE tr.run_id=runs.id AND tr.wake_id=t.latest_wake_id AND t.status IN ('running','needs_investigation','publishing') AND t.evidence_expires_at>now()) ORDER BY completed_at LIMIT 100",
      [cutoff],
    )
  ).rows;
  await redactRuns(
    tx,
    runs.map((v) => v.id),
    at,
  );
  await redactCached(tx, new Set(runs.map((v) => v.id)));
  return runs.length;
}
