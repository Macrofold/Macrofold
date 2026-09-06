import { it, expect, afterAll } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import * as r from '../../packages/core/src/resources';
import { createWorkspace, writeFile } from '../../packages/core/src/files';
import { admitRun } from '../../packages/core/src/runs';
import { executeRun } from '../../packages/core/src/engine';
import {
  requestProjectDeletion,
  cancelProjectDeletion,
  expireDetailedHistory,
} from '../../packages/core/src/deletion';
import { maintainStorage } from '../../packages/core/src/storage-maintenance';
import { credit } from '../../packages/core/src/ledger';
import { eventsAfter, streamEvents } from '../../packages/core/src/events';
import { storage } from '../../packages/providers/src/storage';
import { config } from '../../packages/core/src/config';
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('expires detailed content but retains terminal replay, then schedules, undoes and completes project deletion', async () => {
  const a = await fixtureAccount('Deletion owner'),
    org = a.p.organizationId;
  const setup = await transaction(org, async (tx) => {
    await credit(tx, org, 5000000n, 'fixture:funding');
    const project = await r.create(tx, 'projects', org, {
      name: 'Removal fixture',
      persistence: 'persistent',
      archived: false,
    });
    const operation = await createWorkspace(tx, a.p, project.id, { name: 'main' });
    const ws = await r.get(
      tx,
      'workspaces',
      String((operation.result as { workspace_id: string }).workspace_id),
    );
    await writeFile(tx, a.p, ws.id, 'private.txt', Buffer.from('private retained content'), ws.revision);
    const run = await admitRun(tx, a.p, {
      workspace_id: ws.id,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Keep files available.',
    });
    return { project, ws, run };
  });
  await executeRun(org, setup.run.run_id);
  await transaction(org, async (tx) => {
    await tx.query("UPDATE runs SET completed_at=now()-interval '31 days' WHERE id=$1", [setup.run.run_id]);
    expect(await expireDetailedHistory(tx, 'payg', new Date())).toBe(1);
    const result = (await tx.query('SELECT config,result FROM runs WHERE id=$1', [setup.run.run_id])).rows[0];
    expect(result.config.prompt).toBe('[Detailed content expired]');
    expect(result.result.content_expired).toBe(true);
    expect(result.result.output_text).toBeUndefined();
  });
  const events = await eventsAfter(org, setup.run.run_id, '0');
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe('run.succeeded');
  const stream = await new Response(
    await streamEvents(org, setup.run.run_id, '0', new AbortController().signal),
  ).text();
  expect(stream).toContain('run.succeeded');
  expect(stream).not.toContain('private retained content');
  const request = new Request(config.origin + '/v1/projects/' + setup.project.id + '/deletion', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + a.key },
  });
  await expect(
    transaction(org, (tx) =>
      requestProjectDeletion(
        tx,
        { ...a.p, role: 'member' },
        setup.project.id,
        { confirmation: setup.project.name as string },
        request,
      ),
    ),
  ).rejects.toMatchObject({ code: 'organization_admin_required' });
  await transaction(org, (tx) =>
    requestProjectDeletion(
      tx,
      a.p,
      setup.project.id,
      { confirmation: setup.project.name as string },
      request,
    ),
  );
  expect((await transaction(org, (tx) => r.get(tx, 'projects', setup.project.id))).archived).toBe(true);
  await transaction(org, (tx) => cancelProjectDeletion(tx, a.p, setup.project.id));
  expect((await transaction(org, (tx) => r.get(tx, 'projects', setup.project.id))).archived).toBe(false);
  await transaction(org, (tx) =>
    requestProjectDeletion(
      tx,
      a.p,
      setup.project.id,
      { confirmation: setup.project.name as string },
      request,
    ),
  );
  const at = new Date(Date.now() + 8 * 86400000);
  await maintainStorage(org, storage, at);
  await expect(transaction(org, (tx) => r.get(tx, 'projects', setup.project.id, a.p))).rejects.toMatchObject({
    code: 'not_found',
  });
  await transaction(org, async (tx) => {
    expect((await r.get(tx, 'workspaces', setup.ws.id)).files).toBeUndefined();
    expect((await tx.query('SELECT count(*) FROM ledger')).rows[0].count).not.toBe('0');
    expect((await tx.query('SELECT count(*) FROM runs WHERE id=$1', [setup.run.run_id])).rows[0].count).toBe(
      '1',
    );
  });
  expect(
    (await maintainStorage(org, storage, new Date(at.getTime() + 15 * 86400000))).deleted,
  ).toBeGreaterThan(0);
});
