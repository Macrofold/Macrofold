import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { pool, transaction, lock } from '../../db';
import { boundedBody } from './body';
import { assert } from './errors';
import { id, sha256, sameSecret } from './crypto';
import * as resources from './resources';
import { queueGitSync } from './git-jobs';
import { customerScopes, type Principal } from './auth';

const numericId = z.number().int().positive().safe().transform(String);
const payloadSchema = z.object({
  installation: z.object({ id: numericId }),
  action: z.string().max(80).optional(),
  repository: z.object({ id: numericId }).optional(),
  repositories_removed: z
    .array(z.object({ id: numericId }))
    .max(10000)
    .optional(),
  ref: z.string().max(1024).optional(),
  after: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional(),
  deleted: z.boolean().optional(),
});

/** Authenticate exact bytes before consulting cross-tenant routing. Commit receipts and fanout
 * together: a process crash can retry delivery without losing or repeating a queued pull. */
export async function githubWebhook(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  assert(secret, 503, 'github_not_configured', 'GitHub webhook verification is not configured.');
  const bytes = await boundedBody(request.body, 4 * 1024 * 1024);
  const expected = 'sha256=' + createHmac('sha256', secret).update(bytes).digest('hex');
  assert(
    sameSecret(request.headers.get('x-hub-signature-256') || '', expected),
    401,
    'invalid_signature',
    'Invalid GitHub signature.',
  );
  const delivery = z.uuid().safeParse(request.headers.get('x-github-delivery'));
  assert(delivery.success, 400, 'invalid_delivery', 'A GitHub delivery UUID is required.');
  const event = request.headers.get('x-github-event') || '';
  if (!['push', 'installation', 'installation_repositories'].includes(event))
    return Response.json({ ignored: true });
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    assert(false, 400, 'invalid_payload', 'Invalid webhook JSON.');
  }
  const parsed = payloadSchema.safeParse(json);
  assert(parsed.success, 400, 'invalid_payload', 'Invalid GitHub webhook payload.');
  const payload = parsed.data;
  if (event === 'push')
    assert(
      payload.repository && payload.ref && payload.after,
      400,
      'invalid_payload',
      'A push must identify the repository and ref.',
    );
  const hash = sha256(bytes);
  const result = await transaction(null, async (tx) => {
    await lock(tx, `github-installation:${payload.installation.id}`);
    const inserted = await tx.query(
      'INSERT INTO github_webhook_receipts(delivery_id,event,body_sha256) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING delivery_id',
      [delivery.data, event, hash],
    );
    if (!inserted.rowCount) {
      const existing = (
        await tx.query('SELECT event,body_sha256 FROM github_webhook_receipts WHERE delivery_id=$1', [
          delivery.data,
        ])
      ).rows[0];
      assert(
        existing.event === event && existing.body_sha256 === hash,
        409,
        'delivery_conflict',
        'This delivery ID already identifies another payload.',
      );
      return { duplicate: true };
    }
    const routes = await tx.query(
      'SELECT organization_id FROM github_webhook_routes WHERE installation_id=$1',
      [payload.installation.id],
    );
    for (const { organization_id: org } of routes.rows) {
      await tx.query("SELECT set_config('app.organization_id',$1,true)", [org]);
      const revokeAll = event === 'installation' && ['deleted', 'suspend'].includes(payload.action || '');
      const removed =
        event === 'installation_repositories' && payload.action === 'removed'
          ? (payload.repositories_removed || []).map((r) => r.id)
          : [];
      if (revokeAll || removed.length) {
        if (revokeAll)
          await tx.query('UPDATE github_installations SET active=false WHERE installation_id=$1', [
            payload.installation.id,
          ]);
        await tx.query(
          'DELETE FROM github_repository_grants WHERE installation_id=$1 AND ($2 OR repository_id=ANY($3::text[]))',
          [payload.installation.id, revokeAll, removed],
        );
        await tx.query(
          `UPDATE workspaces w SET data=w.data || jsonb_build_object('sync',jsonb_build_object('workspace_id',w.id,'status','blocked','error_code','github_access_revoked','updated_at',now())),revision=w.revision+1,updated_at=now()
          FROM projects p WHERE w.project_id=p.id AND p.data->'github'->>'installation_id'=$1 AND ($2 OR p.data->'github'->>'repository_id'=ANY($3::text[]))`,
          [payload.installation.id, revokeAll, removed],
        );
        continue;
      }
      // Added/unsuspended events never restore access. An owner must re-prove current permissions.
      if (event !== 'push' || !payload.ref!.startsWith('refs/heads/')) continue;
      const matches = await tx.query(
        `SELECT w.id,w.data FROM workspaces w JOIN projects p ON p.id=w.project_id
        WHERE p.data->'github'->>'installation_id'=$1 AND p.data->'github'->>'repository_id'=$2
        AND p.data->'github'->>'target_branch'=$3 AND COALESCE(p.data->>'archived','false')<>'true'
        AND COALESCE(w.data->>'deleted','false')<>'true'`,
        [payload.installation.id, payload.repository!.id, payload.ref!.slice(11)],
      );
      for (const ws of matches.rows) {
        if (ws.data.git_commit === payload.after) continue;
        await resources.update(tx, 'workspaces', ws.id, {
          remote_change: {
            ref: payload.ref,
            observed_commit: payload.after,
            deleted: payload.deleted || false,
            received_at: new Date().toISOString(),
          },
        });
        await tx.query(
          "INSERT INTO dispatch_jobs(id,organization_id,kind,resource_id) VALUES($1,$2,'github_pull',$3) ON CONFLICT(kind,resource_id) DO UPDATE SET state='pending',available_at=now()",
          [id(), org, ws.id],
        );
      }
    }
    return { accepted: true };
  });
  return Response.json(result);
}

/** Coalesce notifications into a current remote fetch, never replay the event's commit. A busy
 * workspace is deferred; the existing Git merge implementation preserves divergent local files. */
export async function dispatchGithubPulls() {
  const jobs = await pool.query(
    "SELECT organization_id,resource_id FROM dispatch_jobs WHERE kind='github_pull' AND state<>'done' AND available_at<=now() ORDER BY available_at LIMIT 5",
  );
  for (const job of jobs.rows) {
    try {
      await transaction(job.organization_id, async (tx) => {
        const acquired = (
          await tx.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok', [
            `workspace:${job.resource_id}`,
          ])
        ).rows[0].ok;
        if (!acquired) return;
        await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [job.resource_id]);
        // Lock the row so a newly arriving notification cannot be marked done by this sweep.
        const pending = await tx.query(
          "SELECT 1 FROM dispatch_jobs WHERE kind='github_pull' AND resource_id=$1 AND state<>'done' FOR UPDATE",
          [job.resource_id],
        );
        if (!pending.rowCount) return;
        const ws = await resources.get(tx, 'workspaces', job.resource_id);
        const project = await resources.get(tx, 'projects', String(ws.project_id));
        const target = project.github as
          { installation_id: string; repository_id: string; auto_pull?: boolean } | undefined;
        const change = ws.remote_change as { deleted: boolean } | undefined;
        if (target?.auto_pull && !change?.deleted && !ws.deleted && !project.archived) {
          const actor = (
            await tx.query(
              `SELECT g.granted_by,m.role FROM github_repository_grants g JOIN memberships m ON m.organization_id=g.organization_id AND m.user_id=g.granted_by
            JOIN github_installations i ON i.organization_id=g.organization_id AND i.installation_id=g.installation_id AND i.active
            WHERE g.installation_id=$1 AND g.repository_id=$2 AND m.role IN ('owner','admin','member')`,
              [target.installation_id, target.repository_id],
            )
          ).rows[0];
          if (actor) {
            const active = await tx.query(
              "SELECT 1 FROM runs WHERE workspace_id=$1 AND status IN ('provisioning','running','waiting_for_input','persisting')",
              [ws.id],
            );
            if (active.rowCount) {
              await tx.query(
                "UPDATE dispatch_jobs SET available_at=now()+interval '30 seconds' WHERE kind='github_pull' AND resource_id=$1",
                [ws.id],
              );
              return;
            }
            const p: Principal = {
              id: actor.granted_by,
              userId: actor.granted_by,
              organizationId: job.organization_id,
              role: actor.role,
              kind: 'user',
              operator: false,
              scopes: customerScopes,
              projectIds: [],
            };
            const op = await queueGitSync(tx, p, ws.id, 'pull');
            await resources.update(tx, 'operations', op.id, { github_notification: true });
          }
        }
        await tx.query("UPDATE dispatch_jobs SET state='done' WHERE kind='github_pull' AND resource_id=$1", [
          job.resource_id,
        ]);
      });
    } catch {
      await pool.query(
        "UPDATE dispatch_jobs SET attempts=attempts+1,available_at=now()+interval '5 minutes',error='github_pull_dispatch_failed' WHERE kind='github_pull' AND resource_id=$1",
        [job.resource_id],
      );
    }
  }
  return { github_notifications: jobs.rowCount || 0 };
}
