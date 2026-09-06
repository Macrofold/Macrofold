import { it, expect, beforeAll, afterAll } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { customerScopes, type Principal } from '../../packages/core/src/auth';
import { id, seal } from '../../packages/core/src/crypto';
import { authorizeRepository } from '../../packages/core/src/github-auth';
import * as resources from '../../packages/core/src/resources';
import { createWorkspace, writeFile } from '../../packages/core/src/files';
import { queueGitSync, executeGitJob } from '../../packages/core/src/git-jobs';
import { gitServer } from '../fixtures/git-server';
import { createKey } from '../../packages/core/src/keys';
let p: Principal;
beforeAll(async () => {
  const org = id(),
    user = id();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [org, 'Git integration fixture']);
  await pool.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
    user,
    'Git fixture',
    user + '@example.test',
  ]);
  await pool.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')", [
    org,
    user,
  ]);
  p = {
    id: user,
    userId: user,
    organizationId: org,
    kind: 'user',
    role: 'owner',
    operator: false,
    scopes: customerScopes,
    projectIds: [],
  };
  await transaction(org, (tx) =>
    tx.query(
      "INSERT INTO github_user_links(organization_id,user_id,token_ciphertext,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [org, user, seal({ token: 'fixture-user-token' })],
    ),
  );
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('checks repository write access and exact installation membership before binding a tenant', async () => {
  const repository = {
    id: 1,
    full_name: 'fixture/repo',
    default_branch: 'main',
    owner: { login: 'fixture' },
    permissions: { push: true },
  };
  const transport: typeof fetch = async (input) =>
    Response.json(
      String(input).includes('/user/installations/')
        ? { total_count: 1, repositories: [repository] }
        : repository,
    );
  await transaction(p.organizationId, async (tx) => {
    await authorizeRepository(
      tx,
      p,
      { installation_id: '123', repository_id: '1', target_branch: 'main' },
      transport,
    );
    expect(
      (await tx.query('SELECT repository_id FROM github_repository_grants')).rows.map((r) => r.repository_id),
    ).toEqual(['1']);
  });
  const readonly: typeof fetch = async () =>
    Response.json({ ...repository, permissions: { push: false, admin: false } });
  await expect(
    transaction(p.organizationId, (tx) =>
      authorizeRepository(
        tx,
        p,
        { installation_id: '123', repository_id: '1', target_branch: 'main' },
        readonly,
      ),
    ),
  ).rejects.toMatchObject({ code: 'github_write_required' });
  const forged: typeof fetch = async (input) =>
    Response.json(
      String(input).includes('/user/installations/') ? { total_count: 0, repositories: [] } : repository,
    );
  await expect(
    transaction(p.organizationId, (tx) =>
      authorizeRepository(
        tx,
        p,
        { installation_id: '999', repository_id: '1', target_branch: 'main' },
        forged,
      ),
    ),
  ).rejects.toMatchObject({ code: 'installation_not_authorized' });
  const other = id();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [other, 'Other Git tenant']);
  expect((await transaction(other, (tx) => tx.query('SELECT * FROM github_user_links'))).rowCount).toBe(0);
  expect(
    (await transaction(other, (tx) => tx.query('SELECT * FROM github_repository_grants'))).rowCount,
  ).toBe(0);
});
it('executes a queued sync against real Git HTTP, persists history and denies a revoked initiating key', async () => {
  const server = await gitServer();
  const host = {
    remote: async () => server.remote,
    pullRequest: async () => {
      throw new Error('not requested');
    },
  };
  try {
    const ws = await transaction(p.organizationId, async (tx) => {
      const project = await resources.create(tx, 'projects', p.organizationId, {
        name: 'Sync job',
        github: { installation_id: '123', repository_id: '1', target_branch: 'main' },
      });
      const op = await createWorkspace(tx, p, project.id, { name: 'main' });
      return resources.get(tx, 'workspaces', String((op.result as Record<string, unknown>).workspace_id));
    });
    const operation = await transaction(p.organizationId, (tx) => queueGitSync(tx, p, ws.id, 'pull'));
    await executeGitJob(p.organizationId, operation.id, host);
    const imported = await transaction(p.organizationId, async (tx) => {
      expect((await resources.get(tx, 'operations', operation.id)).status).toBe('succeeded');
      const result = await resources.get(tx, 'workspaces', ws.id);
      expect(result.git_status).toBe('ready');
      expect(result.git_commit).toMatch(/^[0-9a-f]{40}$/);
      expect((result.files as { path: string }[]).map((f) => f.path)).toContain('README.md');
      return result;
    });
    await transaction(p.organizationId, (tx) =>
      writeFile(tx, p, ws.id, 'README.md', Buffer.from('dashboard edit\n'), imported.revision),
    );
    const key = await transaction(p.organizationId, (tx) =>
      createKey(tx, p, { name: 'Revocable Git fixture', scopes: customerScopes }),
    );
    const queued = await transaction(p.organizationId, (tx) =>
      queueGitSync(tx, { ...p, id: String(key.id), kind: 'api_key' }, ws.id, 'push'),
    );
    await pool.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [key.id]);
    await executeGitJob(p.organizationId, queued.id, host);
    await transaction(p.organizationId, async (tx) => {
      const denied = await resources.get(tx, 'operations', queued.id);
      expect(denied.status).toBe('failed');
      expect(denied.error).toMatchObject({ code: 'authorization_revoked' });
    });
    expect((await server.command(['--git-dir=../repo.git', 'show', 'main:README.md'])).stdout).toBe(
      'initial\n',
    );
  } finally {
    await server.close();
  }
}, 30000);
it('queues automatic synchronization only after run persistence and reports its independent outcome', async () => {
  const { credit } = await import('../../packages/core/src/ledger');
  const { handleApi } = await import('../../packages/core/src/http');
  const { executeRun } = await import('../../packages/core/src/engine');
  const { getRun } = await import('../../packages/core/src/runs');
  const { config } = await import('../../packages/core/src/config');
  const server = await gitServer(),
    host = {
      remote: async () => server.remote,
      pullRequest: async () => {
        throw new Error('not requested');
      },
    };
  try {
    const ws = await transaction(p.organizationId, async (tx) => {
      await credit(tx, p.organizationId, 10000000n, 'git-auto-fixture-' + id());
      const project = await resources.create(tx, 'projects', p.organizationId, {
        name: 'Automatic synchronization',
        github: { installation_id: '123', repository_id: '1', target_branch: 'main', auto_sync: true },
      });
      const op = await createWorkspace(tx, p, project.id, { name: 'main' });
      return resources.get(tx, 'workspaces', String((op.result as Record<string, unknown>).workspace_id));
    });
    const initial = await transaction(p.organizationId, (tx) => queueGitSync(tx, p, ws.id, 'pull'));
    await executeGitJob(p.organizationId, initial.id, host);
    const key = await transaction(p.organizationId, (tx) =>
      createKey(tx, p, { name: 'Auto sync fixture', scopes: customerScopes }),
    );
    const response = await handleApi(
      new Request(config.origin + '/v1/runs', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key.secret}`,
          'content-type': 'application/json',
          'idempotency-key': id(),
        },
        body: JSON.stringify({
          workspace_id: ws.id,
          prompt: 'Save a progress note',
          harness: 'codex',
          model: 'fixture-model',
          billing_mode: 'managed',
        }),
      }),
    );
    const run = await response.json();
    expect(response.status, JSON.stringify(run)).toBe(202);
    await executeRun(p.organizationId, run.run_id);
    const job = await transaction(p.organizationId, async (tx) => {
      expect((await getRun(tx, run.run_id)).result).toMatchObject({
        persistence_status: 'verified',
        sync_status: 'pending',
      });
      return (await resources.list(tx, 'operations', p, new URLSearchParams(), { source_run_id: run.run_id }))
        .data[0];
    });
    expect(job).toBeTruthy();
    await executeGitJob(p.organizationId, job.id, host);
    await transaction(p.organizationId, async (tx) => {
      expect((await getRun(tx, run.run_id)).result).toMatchObject({
        persistence_status: 'verified',
        sync_status: 'synced',
      });
    });
    expect(
      Number((await server.command(['--git-dir=../repo.git', 'rev-list', '--count', 'main'])).stdout.trim()),
    ).toBeGreaterThan(1);
  } finally {
    await server.close();
  }
}, 30000);
