import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, expect, it } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { id } from '../../packages/core/src/crypto';
import { admitRun, cancelRun } from '../../packages/core/src/runs';
import { fixtureAccount } from '../fixtures/account';
import { claimRun } from '../../packages/core/src/engine';
import * as resources from '../../packages/core/src/resources';

// Reconstruct the pre-kind tables in a rollback-only schema in the disposable
// database. Existing fixture rows and the developer preview are never replaced.
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('upgrades a native row without changing its identity, context or reservation', async () => {
  expect(new URL(config.ownerDatabaseUrl).pathname).toMatch(/^\/platform_test_[a-f0-9]+$/);
  const account = await fixtureAccount('Decision migration fixture');
  const accepted = await transaction(account.p.organizationId, async (tx) => {
    const workspace = await resources.create(tx, 'workspaces', account.p.organizationId, {
      name: 'Native history',
    });
    return admitRun(tx, account.p, {
      workspace_id: workspace.id,
      prompt: 'Preserve native history',
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
    });
  });
  const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    const schema = `decision_upgrade_${id().replaceAll('-', '')}`;
    await owner.query(`CREATE SCHEMA ${schema}`);
    await owner.query(`SET LOCAL search_path TO ${schema},public`);
    for (const table of ['workspaces', 'worktrees', 'runs']) {
      await owner.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
      await owner.query(`INSERT INTO ${table} SELECT * FROM public.${table} WHERE organization_id=$1`, [
        account.p.organizationId,
      ]);
    }
    await owner.query(
      'ALTER TABLE workspaces RENAME TO projects; ALTER TABLE worktrees RENAME TO workspaces; ALTER TABLE workspaces RENAME COLUMN workspace_id TO project_id; ALTER TABLE runs RENAME COLUMN workspace_id TO project_id; ALTER TABLE runs RENAME COLUMN worktree_id TO workspace_id',
    );
    await owner.query('ALTER TABLE runs DROP CONSTRAINT IF EXISTS run_kind_shape, DROP COLUMN kind');
    await owner.query(
      'ALTER TABLE runs ALTER COLUMN workspace_id SET NOT NULL, ALTER COLUMN session_id SET NOT NULL',
    );
    // Recreate the historical projection, rather than asking CREATE OR REPLACE
    // to remove newer private columns. The outer transaction rolls this back.
    await owner.query('DROP VIEW reporting.scheduling_runs');
    const before = (await owner.query('SELECT * FROM runs WHERE id=$1', [accepted.run_id])).rows[0];
    for (const migration of [
      '035_explicit_inference.sql',
      '036_decision_evidence.sql',
      '037_bounded_decisions.sql',
      '038_decision_tasks.sql',
    ])
      await owner.query(await readFile(new URL(`../../packages/db/${migration}`, import.meta.url), 'utf8'));
    const after = (await owner.query('SELECT * FROM runs WHERE id=$1', [accepted.run_id])).rows[0];
    expect(after).toEqual({ ...before, kind: 'native_agent' });
    expect(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname LIKE 'decision_%' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity",
          [schema],
        )
      ).rows[0].n,
    ).toBe(8);
    await owner.query('SAVEPOINT invalid_shape');
    await expect(
      owner.query('UPDATE runs SET workspace_id=NULL WHERE id=$1', [accepted.run_id]),
    ).rejects.toMatchObject({ code: '23514' });
    await owner.query('ROLLBACK TO SAVEPOINT invalid_shape');
  } finally {
    await owner.query('ROLLBACK');
    await owner.end();
    // Do not leave an eligible fixture at the front of the shared scheduler.
    await transaction(account.p.organizationId, (tx) => cancelRun(tx, account.p, accepted.run_id));
    await claimRun(account.p.organizationId, accepted.run_id);
  }
});
