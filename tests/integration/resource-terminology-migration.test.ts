import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, expect, it } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { id } from '../../packages/core/src/crypto';
import { fixtureAccount } from '../fixtures/account';
import { createWorkspace } from '../../packages/core/src/workspaces';

afterAll(async () => {
  await pool.end();
  await authPool.end();
});

it('preserves workspace/checkouts, file bytes and key restrictions through the breaking rename', async () => {
  expect(new URL(config.ownerDatabaseUrl).pathname).toMatch(/^\/platform_test_[a-f0-9]+$/);
  const account = await fixtureAccount('Terminology upgrade');
  const workspace = await transaction(account.p.organizationId, (tx) =>
    createWorkspace(tx, account.p, { name: 'Saved files' }),
  );
  const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    // Reconstruct only the changed schema boundary, under a rollback-only owner transaction.
    await owner.query(
      'ALTER TABLE workspaces RENAME TO projects; ALTER TABLE worktrees RENAME TO workspaces',
    );
    for (const [from, to] of [
      ['workspace_id', 'project_id'],
      ['workspace_ids', 'project_ids'],
      ['worktree_id', 'workspace_id'],
    ]) {
      const columns = await owner.query<{ table_schema: string; table_name: string }>(
        "SELECT table_schema,table_name FROM information_schema.columns WHERE table_schema IN ('public','reporting') AND column_name=$1",
        [from],
      );
      for (const c of columns.rows)
        await owner.query(
          `ALTER ${c.table_schema === 'reporting' ? 'VIEW' : 'TABLE'} "${c.table_schema}"."${c.table_name}" RENAME COLUMN ${from} TO ${to}`,
        );
    }
    await owner.query(
      'ALTER TABLE connection_access_rules DROP CONSTRAINT connection_access_rules_scope_check, DROP CONSTRAINT connection_access_rules_check',
    );
    await owner.query(
      'DROP INDEX connection_access_workspace_unique; DROP INDEX connection_access_pair_unique',
    );
    await owner.query(
      "UPDATE connection_access_rules SET scope=CASE scope WHEN 'workspace' THEN 'project' WHEN 'workspace_agent' THEN 'project_agent' ELSE scope END",
    );
    await owner.query(
      "ALTER TABLE connection_access_rules ADD CONSTRAINT connection_access_rules_scope_check CHECK(scope IN ('project','agent','project_agent')), ADD CONSTRAINT connection_access_rules_check CHECK(true)",
    );
    await owner.query(
      "CREATE UNIQUE INDEX connection_access_project_unique ON connection_access_rules(connection_id,project_id) WHERE scope='project'; CREATE UNIQUE INDEX connection_access_pair_unique ON connection_access_rules(connection_id,project_id,agent_id) WHERE scope='project_agent'",
    );
    const checkout = String(workspace.default_worktree_id);
    const content = { project_id: 'customer-owned-key', workspace_id: 'customer-owned-value' };
    await owner.query('UPDATE projects SET data=$2 WHERE id=$1', [
      workspace.id,
      { name: 'Saved files', default_workspace_id: checkout },
    ]);
    await owner.query('UPDATE workspaces SET data=data || $2::jsonb WHERE id=$1', [
      checkout,
      { project_id: workspace.id, files: [{ path: 'data.json', content }] },
    ]);
    const key = id();
    await owner.query(
      'INSERT INTO api_keys(id,organization_id,user_id,name,key_hash,prefix,scopes,project_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        key,
        account.p.organizationId,
        account.p.userId,
        'Restricted',
        id(),
        'fixture',
        ['projects:read', 'files:write'],
        [workspace.id],
      ],
    );
    await owner.query('UPDATE auth."oauthClient" SET scopes=\'["projects:read","runs:write"]\'::jsonb');
    await owner.query(
      await readFile(new URL('../../packages/db/041_workspace_worktree_names.sql', import.meta.url), 'utf8'),
    );
    expect(
      (await owner.query('SELECT scopes FROM auth.\"oauthClient\"')).rows.every(
        (row) => JSON.stringify(row.scopes) === '[\"workspaces:read\",\"runs:write\"]',
      ),
    ).toBe(true);
    expect(
      (await owner.query('SELECT data FROM workspaces WHERE id=$1', [workspace.id])).rows[0].data,
    ).toEqual({ name: 'Saved files', default_worktree_id: checkout });
    const saved = (await owner.query('SELECT workspace_id,data FROM worktrees WHERE id=$1', [checkout]))
      .rows[0];
    expect(saved.workspace_id).toBe(workspace.id);
    expect(saved.data.workspace_id).toBe(workspace.id);
    expect(saved.data.files[0].content).toEqual(content);
    expect(
      (await owner.query('SELECT scopes,workspace_ids FROM api_keys WHERE id=$1', [key])).rows[0],
    ).toEqual({ scopes: ['workspaces:read', 'files:write'], workspace_ids: [workspace.id] });
    expect((await owner.query("SELECT to_regclass('public.projects') AS old")).rows[0].old).toBeNull();
  } finally {
    await owner.query('ROLLBACK');
    await owner.end();
  }
});
