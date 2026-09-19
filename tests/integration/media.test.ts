import { afterAll, afterEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { writeFixtureFile } from '../fixtures/file-mutation';
import * as resources from '../../packages/core/src/resources';
import { createWorktree } from '../../packages/core/src/files';
import { admitRun, cancelRun, getNativeRun as getRun } from '../../packages/core/src/runs';
import { executeRun } from '../../packages/core/src/engine';
import { expireDetailedHistory } from '../../packages/core/src/deletion';
import { readContent } from '../../packages/providers/src/storage';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';

const accounts: Awaited<ReturnType<typeof fixtureAccount>>[] = [];
afterEach(async () => {
  for (const account of accounts.splice(0))
    await transaction(account.p.organizationId, async (tx) => {
      for (const row of (await tx.query("SELECT id FROM runs WHERE status='queued'")).rows)
        await cancelRun(tx, account.p, row.id);
    });
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
async function setup() {
  const account = await fixtureAccount('Media fixture');
  accounts.push(account);
  const ws = await transaction(account.p.organizationId, async (tx) => {
    const workspace = await resources.create(tx, 'workspaces', account.p.organizationId, { name: 'Media' });
    const op = await createWorktree(tx, account.p, workspace.id, { name: 'main' });
    return resources.get(tx, 'worktrees', (op.result as { worktree_id: string }).worktree_id);
  });
  await writeFixtureFile(
    account.p,
    ws.id,
    'source.txt',
    Buffer.from('Uploaded document fixture'),
    ws.revision,
  );
  return {
    ...account,
    ws,
    input: {
      worktree_id: ws.id,
      harness: 'codex' as const,
      model: 'fixture-model',
      billing_mode: 'managed' as const,
      prompt: 'Return a document',
      attachments: ['source.txt'],
    },
  };
}
it('rejects invalid attachment admission atomically and freezes the authorized original hash', async () => {
  const a = await setup(),
    org = a.p.organizationId;
  for (const [principal, attachments, code] of [
    [a.p, ['missing.pdf'], 'attachment_not_found'],
    [{ ...a.p, scopes: ['runs:write'] }, ['source.txt'], 'forbidden'],
  ] as const) {
    await expect(
      transaction(org, (tx) =>
        admitRun(
          tx,
          { ...principal, scopes: [...principal.scopes] },
          { ...a.input, attachments: [...attachments] },
        ),
      ),
    ).rejects.toMatchObject({ code });
    expect((await transaction(org, (tx) => tx.query('SELECT id FROM runs'))).rowCount).toBe(0);
    expect((await transaction(org, (tx) => tx.query('SELECT id FROM sessions'))).rowCount).toBe(0);
  }
  const accepted = await transaction(org, (tx) => admitRun(tx, a.p, a.input));
  const run = await transaction(org, (tx) => getRun(tx, accepted.run_id));
  expect(run.config.attachments).toEqual([
    expect.objectContaining({
      path: 'source.txt',
      media_type: 'text/plain',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }),
  ]);
  const foreign = await fixtureAccount('Foreign media owner');
  await expect(
    transaction(foreign.p.organizationId, (tx) => admitRun(tx, foreign.p, a.input)),
  ).rejects.toMatchObject({ status: 404 });
});
it('publishes immutable binary deliverables after verification, isolates downloads, and expires artifact history', async () => {
  const a = await setup(),
    org = a.p.organizationId;
  const pdf = await readFile('tests/fixtures/media/document.pdf');
  const accepted = await transaction(org, (tx) => admitRun(tx, a.p, a.input));
  await executeRun(org, accepted.run_id, {
    async execute(request) {
      return {
        output: 'Saved the PDF.',
        inputTokens: 0,
        outputTokens: 0,
        usageComplete: true,
        files: [
          ...request.files,
          { path: 'outputs/report.pdf', bytes: pdf },
          { path: 'outputs/.private.txt', bytes: Buffer.from('private fixture') },
        ],
      };
    },
  });
  const run = await transaction(org, (tx) => getRun(tx, accepted.run_id));
  expect(run.status).toBe('succeeded');
  expect(run.result.artifact_ids).toHaveLength(1);
  const artifact = await transaction(org, (tx) =>
    resources.get(tx, 'artifacts', run.result.artifact_ids![0], a.p),
  );
  expect(artifact).toMatchObject({ name: 'outputs/report.pdf', media_type: 'application/pdf' });
  expect(await readContent(artifact.key, artifact.sha256)).toEqual(pdf);
  const ws = await transaction(org, (tx) => resources.get(tx, 'worktrees', a.ws.id));
  await writeFixtureFile(a.p, ws.id, 'outputs/report.pdf', Buffer.from('new version'), ws.revision);
  expect(await readContent(artifact.key, artifact.sha256)).toEqual(pdf);
  const download = (key: string) =>
    handleApi(
      new Request(`${config.origin}/v1/artifacts/${artifact.id}/download`, {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
  expect((await download(a.key)).status).toBe(200);
  const foreign = await fixtureAccount('Foreign download');
  expect((await download(foreign.key)).status).toBe(404);
  await transaction(org, async (tx) => {
    await tx.query("UPDATE runs SET completed_at=now()-interval '31 days' WHERE id=$1", [run.id]);
    await expireDetailedHistory(tx, 'payg', new Date());
    expect((await getRun(tx, run.id)).config.attachments).toBeUndefined();
    await expect(resources.get(tx, 'artifacts', artifact.id, a.p)).rejects.toMatchObject({ status: 404 });
    expect(
      (await resources.get(tx, 'worktrees', ws.id)).files?.find(
        (entry) => entry.path === 'outputs/report.pdf',
      ),
    ).toBeDefined();
  });
});
