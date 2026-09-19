import { writeFixtureFile } from '../fixtures/file-mutation';
import { it, expect, afterAll } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import * as r from '../../packages/core/src/resources';
import { createWorktree } from '../../packages/core/src/files';
import { admitRun } from '../../packages/core/src/runs';
import { executeRun } from '../../packages/core/src/engine';
import {
  requestWorkspaceDeletion,
  cancelWorkspaceDeletion,
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
it('expires detailed content but retains terminal replay, then schedules, undoes and completes workspace deletion', async () => {
  const a = await fixtureAccount('Deletion owner'),
    org = a.p.organizationId;
  const setup = await transaction(org, async (tx) => {
    await credit(tx, org, 5000000n, 'fixture:funding');
    const workspace = await r.create(tx, 'workspaces', org, {
      name: 'Removal fixture',
      persistence: 'persistent',
      archived: false,
    });
    const operation = await createWorktree(tx, a.p, workspace.id, { name: 'main' });
    const ws = await r.get(
      tx,
      'worktrees',
      String((operation.result as { worktree_id: string }).worktree_id),
    );
    return { workspace, ws };
  });
  await writeFixtureFile(a.p, setup.ws.id, 'private.txt', Buffer.from('private retained content'), setup.ws.revision);
  const run = await transaction(org, async (tx) => {
    const { ws } = setup;
    const run = await admitRun(tx, a.p, {
      worktree_id: ws.id,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Keep files available.',
    });
    return run;
  });
  await executeRun(org, run.run_id);
  await transaction(org, async (tx) => {
    await tx.query("UPDATE runs SET completed_at=now()-interval '31 days' WHERE id=$1", [run.run_id]);
    expect(await expireDetailedHistory(tx, 'payg', new Date())).toBe(1);
    const result = (await tx.query('SELECT config,result FROM runs WHERE id=$1', [run.run_id])).rows[0];
    expect(result.config.prompt).toBe('[Detailed content expired]');
    expect(result.result.content_expired).toBe(true);
    expect(result.result.output_text).toBeUndefined();
  });
  const events = await eventsAfter(org, run.run_id, '0');
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe('run.succeeded');
  const stream = await new Response(
    await streamEvents(org, run.run_id, '0', new AbortController().signal),
  ).text();
  expect(stream).toContain('run.succeeded');
  expect(stream).not.toContain('private retained content');
  const request = new Request(config.origin + '/v1/workspaces/' + setup.workspace.id + '/deletion', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + a.key },
  });
  await expect(
    transaction(org, (tx) =>
      requestWorkspaceDeletion(
        tx,
        { ...a.p, role: 'member' },
        setup.workspace.id,
        { confirmation: setup.workspace.name as string },
        request,
      ),
    ),
  ).rejects.toMatchObject({ code: 'organization_admin_required' });
  await transaction(org, (tx) =>
    requestWorkspaceDeletion(
      tx,
      a.p,
      setup.workspace.id,
      { confirmation: setup.workspace.name as string },
      request,
    ),
  );
  expect((await transaction(org, (tx) => r.get(tx, 'workspaces', setup.workspace.id))).archived).toBe(true);
  await transaction(org, (tx) => cancelWorkspaceDeletion(tx, a.p, setup.workspace.id));
  expect((await transaction(org, (tx) => r.get(tx, 'workspaces', setup.workspace.id))).archived).toBe(false);
  await transaction(org, (tx) =>
    requestWorkspaceDeletion(
      tx,
      a.p,
      setup.workspace.id,
      { confirmation: setup.workspace.name as string },
      request,
    ),
  );
  const at = new Date(Date.now() + 8 * 86400000);
  await maintainStorage(org, storage, at);
  await expect(transaction(org, (tx) => r.get(tx, 'workspaces', setup.workspace.id, a.p))).rejects.toMatchObject({
    code: 'not_found',
  });
  await transaction(org, async (tx) => {
    expect((await r.get(tx, 'worktrees', setup.ws.id)).files).toBeUndefined();
    expect((await tx.query('SELECT count(*) FROM ledger')).rows[0].count).not.toBe('0');
    expect((await tx.query('SELECT count(*) FROM runs WHERE id=$1', [run.run_id])).rows[0].count).toBe(
      '1',
    );
  });
  expect(
    (await maintainStorage(org, storage, new Date(at.getTime() + 15 * 86400000))).deleted,
  ).toBeGreaterThan(0);
});
