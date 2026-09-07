import { afterAll, it, expect } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import * as resources from '../../packages/core/src/resources';
import { createWorkspace } from '../../packages/core/src/files';
import { admitRun, getRun } from '../../packages/core/src/runs';
import { requireRunActor } from '../../packages/core/src/actor-authorization';

afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('requires current delegated authority before a side effect and preserves the accepted run on denial', async () => {
  const a = await fixtureAccount('Actor guard'),
    org = a.p.organizationId;
  const run = await transaction(org, async (tx) => {
    const project = await resources.create(tx, 'projects', org, { name: 'Authority fixture' });
    const created = await createWorkspace(tx, a.p, project.id, { name: 'main', branch: 'main' });
    const accepted = await admitRun(tx, a.p, {
      workspace_id: (created.result as { workspace_id: string }).workspace_id,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Never execute this fixture',
    });
    return getRun(tx, accepted.run_id);
  });
  await expect(transaction(org, (tx) => requireRunActor(tx, run))).resolves.toBeUndefined();
  expect(
    (
      await pool.query("UPDATE memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2", [
        org,
        a.p.userId,
      ])
    ).rowCount,
  ).toBe(1);
  await expect(transaction(org, (tx) => requireRunActor(tx, run))).rejects.toMatchObject({
    status: 403,
    code: 'authorization_revoked',
  });
  const retained = await transaction(org, (tx) => getRun(tx, run.id));
  expect(retained.status).toBe('queued');
  expect(retained.reservation_micro_usd).toBe(run.reservation_micro_usd);
});
