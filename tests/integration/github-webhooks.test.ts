import { it, expect, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { pool, authPool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import { customerScopes, type Principal } from '../../packages/core/src/auth';
import { githubWebhook, dispatchGithubPulls } from '../../packages/core/src/github-webhooks';
import { queueGitSync, executeGitJob } from '../../packages/core/src/git-jobs';
import { createWorkspace } from '../../packages/core/src/files';
import * as r from '../../packages/core/src/resources';
import { gitServer } from '../fixtures/git-server';
process.env.GITHUB_WEBHOOK_SECRET = 'local-webhook-fixture-only';
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
function request(event: string, data: unknown, delivery = id(), valid = true) {
  const body = JSON.stringify(data);
  return new Request('http://localhost/webhooks/github', {
    method: 'POST',
    headers: {
      'x-github-event': event,
      'x-github-delivery': delivery,
      'x-hub-signature-256':
        'sha256=' +
        createHmac('sha256', valid ? process.env.GITHUB_WEBHOOK_SECRET! : 'wrong')
          .update(body)
          .digest('hex'),
    },
    body,
  });
}
it('verifies and deduplicates notifications, pulls real Git changes, and fences revoked repositories', async () => {
  const org = id(),
    user = id(),
    installation = String(Date.now());
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [org, 'Git webhook fixture']);
  await pool.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
    user,
    'Fixture',
    user + '@example.test',
  ]);
  await pool.query("INSERT INTO memberships VALUES($1,$2,'owner')", [org, user]);
  const p: Principal = {
    id: user,
    userId: user,
    organizationId: org,
    kind: 'user',
    role: 'owner',
    operator: false,
    scopes: customerScopes,
    projectIds: [],
  };
  const server = await gitServer();
  let calls = 0;
  const host = {
    remote: async () => {
      calls++;
      return server.remote;
    },
    pullRequest: async () => '',
  };
  try {
    const ws = await transaction(org, async (tx) => {
      await tx.query(
        'INSERT INTO github_installations(installation_id,organization_id,account_login) VALUES($1,$2,$3)',
        [installation, org, 'fixture'],
      );
      await tx.query('INSERT INTO github_webhook_routes VALUES($1,$2)', [installation, org]);
      await tx.query(
        "INSERT INTO github_repository_grants(organization_id,installation_id,repository_id,full_name,default_branch,granted_by) VALUES($1,$2,'1','fixture/repo','main',$3)",
        [org, installation, user],
      );
      const project = await r.create(tx, 'projects', org, {
        name: 'Webhook project',
        github: { installation_id: installation, repository_id: '1', target_branch: 'main', auto_pull: true },
      });
      const op = await createWorkspace(tx, p, project.id, { name: 'main' });
      return r.get(tx, 'workspaces', String((op.result as { workspace_id: string }).workspace_id));
    });
    const first = await transaction(org, (tx) => queueGitSync(tx, p, ws.id, 'pull'));
    await executeGitJob(org, first.id, host);
    await server.change('new remote content\n');
    const after = (await server.command(['rev-parse', 'HEAD'])).stdout.trim();
    const data = {
      installation: { id: Number(installation) },
      repository: { id: 1 },
      ref: 'refs/heads/main',
      after,
      deleted: false,
    };
    const delivery = id();
    await expect(githubWebhook(request('push', data, delivery, false))).rejects.toMatchObject({
      code: 'invalid_signature',
    });
    expect(
      (await pool.query('SELECT 1 FROM github_webhook_receipts WHERE delivery_id=$1', [delivery])).rowCount,
    ).toBe(0);
    expect((await githubWebhook(request('push', data, delivery))).status).toBe(200);
    expect(await (await githubWebhook(request('push', data, delivery))).json()).toEqual({ duplicate: true });
    await expect(
      githubWebhook(request('push', { ...data, after: 'a'.repeat(40) }, delivery)),
    ).rejects.toMatchObject({ code: 'delivery_conflict' });
    await dispatchGithubPulls();
    const operation = await transaction(
      org,
      async (tx) =>
        (
          await tx.query(
            "SELECT id FROM operations WHERE data->>'github_notification'='true' AND data->'result'->>'workspace_id'=$1",
            [ws.id],
          )
        ).rows[0],
    );
    expect(operation).toBeDefined();
    await executeGitJob(org, operation.id, host);
    await transaction(org, async (tx) => {
      const current = await r.get(tx, 'workspaces', ws.id);
      expect(current.git_commit).toBe(after);
      expect(current.remote_change).toBeNull();
      expect((await r.get(tx, 'operations', operation.id)).status).toBe('succeeded');
    });
    const queued = await transaction(org, (tx) => queueGitSync(tx, p, ws.id));
    const before = calls;
    await githubWebhook(
      request('installation_repositories', {
        installation: { id: Number(installation) },
        action: 'removed',
        repositories_removed: [{ id: 1 }],
      }),
    );
    await executeGitJob(org, queued.id, host);
    expect(calls).toBe(before);
    expect((await transaction(org, (tx) => r.get(tx, 'operations', queued.id))).status).toBe('failed');
    await githubWebhook(
      request('installation', { installation: { id: Number(installation) }, action: 'suspend' }),
    );
    await githubWebhook(
      request('installation', { installation: { id: Number(installation) }, action: 'unsuspend' }),
    );
    expect(
      (
        await transaction(org, (tx) =>
          tx.query('SELECT active FROM github_installations WHERE installation_id=$1', [installation]),
        )
      ).rows[0].active,
    ).toBe(false);
    expect(
      (
        await transaction(org, (tx) =>
          tx.query('SELECT 1 FROM github_repository_grants WHERE installation_id=$1', [installation]),
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await server.close();
  }
});
