import { planFor } from './plans';
import type { Tx } from '../../db';
import { lock } from '../../db';
import { auth, requireScopes, type Principal } from './auth';
import { assert } from './errors';
import * as r from './resources';
import { seal, unseal, id } from './crypto';

export async function requestProjectDeletion(
  tx: Tx,
  p: Principal,
  projectId: string,
  input: { confirmation: string; password?: string },
  request: Request,
) {
  requireScopes(p, ['projects:delete']);
  assert(
    ['owner', 'admin'].includes(p.role),
    403,
    'organization_admin_required',
    'An owner or admin must schedule permanent deletion.',
  );
  await lock(tx, `project-deletion:${projectId}`);
  const project = await r.get(tx, 'projects', projectId, p);
  assert(
    input.confirmation === project.name,
    400,
    'confirmation_mismatch',
    'Type the exact project name to schedule deletion.',
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
  if (project.deletion_due_at) return project;
  await tx.query(
    "UPDATE runs SET cancel_requested=true WHERE project_id=$1 AND status IN ('queued','provisioning','running','waiting_for_input')",
    [projectId],
  );
  await tx.query('UPDATE organizations SET storage_due_at=now() WHERE id=$1', [p.organizationId]);
  return r.update(tx, 'projects', projectId, {
    archived: true,
    deletion_prior_archived: !!project.archived,
    deletion_requested_at: new Date().toISOString(),
    deletion_due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
}
export async function cancelProjectDeletion(tx: Tx, p: Principal, projectId: string) {
  requireScopes(p, ['projects:delete']);
  assert(
    ['owner', 'admin'].includes(p.role),
    403,
    'organization_admin_required',
    'An owner or admin must restore this project.',
  );
  await lock(tx, `project-deletion:${projectId}`);
  const project = await r.get(tx, 'projects', projectId, p);
  assert(project.deletion_due_at, 409, 'deletion_not_pending', 'This project has no pending deletion.');
  return r.update(tx, 'projects', projectId, {
    archived: !!project.deletion_prior_archived,
    deletion_requested_at: null,
    deletion_due_at: null,
  });
}
/** Content removal retains accounting/usage identifiers. Its caller holds the exclusive tenant
 * storage lock and has proved that no agent is active, so native publication cannot race removal. */
export async function purgeProjects(tx: Tx, at: Date) {
  const projects = (
    await tx.query(
      "SELECT id FROM projects WHERE coalesce(data->>'deleted','false')<>'true' AND (data->>'deletion_due_at')::timestamptz<=$1",
      [at],
    )
  ).rows;
  for (const project of projects) {
    const workspaceIds = (
      await tx.query('SELECT id FROM workspaces WHERE project_id=$1', [project.id])
    ).rows.map((v) => v.id);
    const runIds = (await tx.query('SELECT id FROM runs WHERE project_id=$1', [project.id])).rows.map(
      (v) => v.id,
    );
    const sessionIds = (
      await tx.query('SELECT id FROM sessions WHERE workspace_id=ANY($1::uuid[])', [workspaceIds])
    ).rows.map((v) => v.id);
    for (const table of ['checkpoints', 'artifacts', 'operations', 'transfers'] as const)
      await tx.query(
        `UPDATE ${table} SET data=jsonb_build_object('deleted',true,'project_id',$1::text,'purged_at',$2::timestamptz),revision=revision+1,updated_at=$2 WHERE data->>'project_id'=$1 OR data->>'workspace_id'=ANY($3::text[]) OR data->>'run_id'=ANY($4::text[])`,
        [project.id, at, workspaceIds, runIds],
      );
    await tx.query(
      "UPDATE workspaces SET data=jsonb_build_object('deleted',true,'status','deleting','purged_at',$2::timestamptz),revision=revision+1,updated_at=$2 WHERE project_id=$1",
      [project.id, at],
    );
    await tx.query(
      "UPDATE sessions SET data=jsonb_build_object('deleted',true,'project_id',$1::text,'purged_at',$2::timestamptz),revision=revision+1,updated_at=$2 WHERE workspace_id=ANY($3::uuid[])",
      [project.id, at, workspaceIds],
    );
    await redactRuns(tx, runIds, at);
    await tx.query('DELETE FROM execution_objects WHERE run_id=ANY($1::uuid[])', [runIds]);
    await tx.query('UPDATE runs SET execution_binding=NULL WHERE id=ANY($1::uuid[])', [runIds]);
    await redactCached(tx, new Set([project.id, ...workspaceIds, ...runIds, ...sessionIds]));
    await tx.query(
      "UPDATE projects SET data=jsonb_build_object('deleted',true,'archived',true,'name','Deleted project','purged_at',$2::timestamptz),revision=revision+1,updated_at=$2 WHERE id=$1",
      [project.id, at],
    );
  }
  return projects.length;
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
  if (!runIds.length) return;
  await tx.query(
    "DELETE FROM run_events WHERE run_id=ANY($1::uuid[]) AND type NOT IN ('run.succeeded','run.failed','run.cancelled','run.timed_out')",
    [runIds],
  );
  await tx.query(
    'UPDATE run_events SET data=\'{"content_expired":true}\'::jsonb WHERE run_id=ANY($1::uuid[])',
    [runIds],
  );
  await tx.query('UPDATE tool_invocations SET result_ciphertext=NULL WHERE run_id=ANY($1::uuid[])', [runIds]);
  await tx.query(
    `UPDATE runs SET config=(config-'instructions')||'{"prompt":"[Detailed content expired]"}'::jsonb,
    result=(result-'output_text')||jsonb_build_object('content_expired',true,'content_expired_at',$2::timestamptz),input_request=NULL WHERE id=ANY($1::uuid[])`,
    [runIds, at],
  );
}
export async function expireDetailedHistory(tx: Tx, plan: string, at: Date) {
  const cutoff = new Date(at.getTime() - planFor(plan).history_days * 86400000);
  const runs = (
    await tx.query(
      "SELECT id FROM runs WHERE completed_at<$1 AND status IN ('succeeded','failed','cancelled','timed_out') AND coalesce(result->>'content_expired','false')<>'true' ORDER BY completed_at LIMIT 100",
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
