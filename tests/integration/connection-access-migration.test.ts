import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, expect, it } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { id, seal } from '../../packages/core/src/crypto';
import { admitRun } from '../../packages/core/src/runs';
import * as resources from '../../packages/core/src/resources';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';

let fixtureOrganization: string | undefined;
afterAll(async () => {
  // The accepted history Run is never executed; keep it from holding a later fair turn.
  if (fixtureOrganization) await retireFixtureRuns(fixtureOrganization);
  await pool.end();
  await authPool.end();
});

it('migrates explicit sharing and tool ceilings without touching credential identity or accepted history', async () => {
  // This test reconstructs the previous schema inside a rollback-only transaction.
  // Never allow its DDL against the developer preview or a deployed database.
  expect(new URL(config.ownerDatabaseUrl).pathname).toMatch(/^\/platform_test_[a-f0-9]+$/);
  const account = await fixtureAccount('Migration fixture');
  fixtureOrganization = account.p.organizationId;
  const accepted = await transaction(account.p.organizationId, async (tx) => {
    const workspace = await resources.create(tx, 'workspaces', account.p.organizationId, { name: 'History' });
    return admitRun(tx, account.p, {
      workspace_id: workspace.id,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Retain accepted history',
    });
  });
  const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    const runBefore = (await owner.query('SELECT config,result FROM runs WHERE id=$1', [accepted.run_id]))
      .rows[0];
    const sessionBefore = (await owner.query('SELECT data FROM sessions WHERE id=$1', [accepted.session_id]))
      .rows[0];
    await owner.query('ALTER TABLE workspaces RENAME TO projects');
    await owner.query('DROP TABLE connection_access_rules');
    await owner.query(
      'ALTER TABLE connections DROP COLUMN access_organization_wide, DROP COLUMN access_tools, DROP COLUMN access_version',
    );
    const variants = [
      { kind: 'composio', shared: true, subject_type: 'organization', tools: ['READ'] },
      { kind: 'mcp_remote', shared: true, subject_type: 'user', tools: ['read_file'] },
      { kind: 'search', shared: false, subject_type: 'user', tools: [] },
      { kind: 'provider_key', shared: false, subject_type: 'user', tools: [] },
      { kind: 'subscription', shared: false, subject_type: 'user', tools: [] },
    ];
    const fixtures = variants.map((variant) => ({
      id: id(),
      data: {
        kind: variant.kind,
        name: 'Preserved account',
        owner_subject_id: account.p.userId,
        external_account_id: 'fixture-account',
        identity_verified: true,
        status: 'healthy',
        secret_ciphertext: seal('disposable-credential'),
        shared: variant.shared,
        grants: { subject_type: variant.subject_type, subject_id: account.p.userId, tools: variant.tools },
      },
      variant,
    }));
    for (const fixture of fixtures)
      await owner.query('INSERT INTO connections(id,organization_id,data) VALUES($1,$2,$3)', [
        fixture.id,
        account.p.organizationId,
        fixture.data,
      ]);
    await owner.query(
      await readFile(new URL('../../packages/db/032_connection_access.sql', import.meta.url), 'utf8'),
    );
    for (const fixture of fixtures) {
      const row = (await owner.query('SELECT * FROM connections WHERE id=$1', [fixture.id])).rows[0];
      const { grants, shared, ...preserved } = fixture.data;
      expect(row.data).toEqual(preserved);
      expect(row.access_tools).toEqual(grants.tools);
      expect(row.access_organization_wide).toBe(grants.subject_type === 'organization');
      expect(row.access_version).toBe('1');
    }
    expect((await owner.query('SELECT * FROM connection_access_rules')).rowCount).toBe(0);
    expect(
      (await owner.query('SELECT config,result FROM runs WHERE id=$1', [accepted.run_id])).rows[0],
    ).toEqual(runBefore);
    expect(
      (await owner.query('SELECT data FROM sessions WHERE id=$1', [accepted.session_id])).rows[0],
    ).toEqual(sessionBefore);
  } finally {
    await owner.query('ROLLBACK');
    await owner.end();
  }
});
