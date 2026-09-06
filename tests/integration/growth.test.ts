import { it, expect, afterAll } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { adminReport } from '../../packages/core/src/reports';
import { snapshotReports } from '../../packages/core/src/report-snapshots';
import * as resources from '../../packages/core/src/resources';
import { createWorkspace } from '../../packages/core/src/files';
import { admitRun } from '../../packages/core/src/runs';
import { executeRun } from '../../packages/core/src/engine';
import { credit } from '../../packages/core/src/ledger';
import { id } from '../../packages/core/src/crypto';
import { handleApi } from '../../packages/core/src/http';
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('separates simulated activation, matured cohorts, excluded accounts and immutable daily observations', async () => {
  const { p } = await fixtureAccount('Growth fixture');
  const created = new Date(Date.now() - 20 * 86400000),
    from = new Date(Date.now() - 30 * 86400000);
  await pool.query('UPDATE organizations SET created_at=$2 WHERE id=$1', [p.organizationId, created]);
  const admitted = await transaction(p.organizationId, async (tx) => {
    await credit(tx, p.organizationId, 20000000n, 'growth:' + id());
    const project = await resources.create(tx, 'projects', p.organizationId, { name: 'Growth' });
    const op = await createWorkspace(tx, p, project.id, { name: 'main', branch: 'main' });
    return admitRun(tx, p, {
      workspace_id: String((op.result as any).workspace_id),
      harness: 'codex',
      model: 'fixture-model',
      prompt: 'Local simulated activation fixture',
      billing_mode: 'managed',
    });
  });
  await executeRun(p.organizationId, admitted.run_id);
  const operator = { ...p, operator: true, scopes: ['metrics:read', 'operations:read'] };
  const query = new URLSearchParams({
    from: from.toISOString(),
    to: new Date(Date.now() + 1000).toISOString(),
    organization_id: p.organizationId,
  });
  const read = async () => {
    const r = (await adminReport('getGrowthMetrics', operator, query)) as any;
    return Object.fromEntries(r.metrics.map((m: any) => [m.name, m.value]));
  };
  expect(await read()).toMatchObject({
    accounts_activated: '0',
    users_verified: '1',
    cohort_eligible_7d: '1',
    cohort_activated_7d: '0',
  });
  // Only metadata is edited: no model provider is contacted by this cohort fixture.
  await transaction(p.organizationId, (tx) =>
    tx.query(
      `UPDATE runs SET config=jsonb_set(config,'{model}','"fixture-real-provider-observation"'),completed_at=$2 WHERE id=$1`,
      [admitted.run_id, new Date(created.getTime() + 86400000)],
    ),
  );
  expect(await read()).toMatchObject({
    accounts_activated: '1',
    cohort_activated_7d: '1',
    cohort_retained_week_1: '0',
  });
  await pool.query(
    `UPDATE organizations SET settings=settings||'{"analytics_excluded":true}'::jsonb WHERE id=$1`,
    [p.organizationId],
  );
  expect(await read()).toMatchObject({ accounts_total: '0', users_total: '0' });
  const at = new Date('2000-01-01T12:00:00Z');
  const [a, b] = await Promise.all([snapshotReports(at), snapshotReports(at)]);
  expect(a.reports_created + b.reports_created).toBe(1);
  expect((await snapshotReports(at)).reports_created).toBe(0);
  const saved = (await adminReport(
    'listReportSnapshots',
    operator,
    new URLSearchParams({ from: '1999-12-30', to: '2000-01-02' }),
  )) as any;
  expect(saved.data[0]).toMatchObject({ day: '1999-12-31', report: { definition_version: '2' } });
  await pool.query("DELETE FROM report_snapshots WHERE day='1999-12-31'");
});
it('keeps organization reports outside project-restricted keys and records completed request metadata', async () => {
  const { p, key } = await fixtureAccount('Restricted reporting');
  const project = await transaction(p.organizationId, (tx) =>
    resources.create(tx, 'projects', p.organizationId, { name: 'Only project' }),
  );
  await pool.query('UPDATE api_keys SET project_ids=$2 WHERE organization_id=$1', [
    p.organizationId,
    [project.id],
  ]);
  const response = await handleApi(
    new Request('http://localhost:3210/v1/usage', { headers: { Authorization: `Bearer ${key}` } }),
  );
  expect(response.status).toBe(403);
  const row = (
    await pool.query('SELECT * FROM api_requests WHERE request_id=$1', [response.headers.get('x-request-id')])
  ).rows[0];
  expect(row).toMatchObject({
    organization_id: p.organizationId,
    route: '/v1/usage',
    status: 403,
    principal_type: 'service',
  });
});
