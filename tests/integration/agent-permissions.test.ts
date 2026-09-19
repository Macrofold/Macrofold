import assert from 'node:assert/strict';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { Client } from '../../sdk/typescript/src/client';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { executeRun } from '../../packages/core/src/engine';
import { fileAllowed } from '../../packages/contracts/permissions';
import { getNativeRun as getRun } from '../../packages/core/src/runs';
import { harnessNames } from '../../packages/contracts/harnesses';
let account: Awaited<ReturnType<typeof fixtureAccount>>, client: Client;
beforeAll(async () => {
  account = await fixtureAccount('Agent permission tests');
  client = new Client({
    baseURL: config.origin,
    apiKey: account.key,
    retries: 0,
    fetch: (url, init) => handleApi(new Request(url, init)),
  });
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
async function fixture() {
  const workspace = await client.workspaces.create({
    name: 'Scoped files',
    permissions: { version: 1, files: { read: { exclude: ['**/*.env'] }, write: { include: ['docs/**'] } } },
  });
  assert(workspace.default_worktree_id);
  const worktreeId = workspace.default_worktree_id;
  for (const file of ['secret.env', 'docs/guide.md']) {
    const ws = await client.worktrees.get(worktreeId);
    await client.worktrees.writeFile(worktreeId, {
      path: file,
      content: Buffer.from(file),
      ifMatch: ws.revision,
    });
  }
  return { workspace, worktreeId };
}
it.each(harnessNames)(
  'admits %s with all three layers and preserves the session permission boundary',
  async (harness) => {
    const { workspace, worktreeId } = await fixture();
    await client.worktrees.update(worktreeId, {
      permissions: { version: 1, files: { write: { exclude: ['docs/private/**'] } } },
    });
    expect((await client.runs.list({ workspace_id: workspace.id })).data).toHaveLength(0);
    const run = await client.runs.create({
      worktree_id: worktreeId,
      harness,
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Test',
      permissions: { version: 1, files: { write: { include: ['**/*.md'] } } },
    });
    const row = await transaction(account.p.organizationId, (tx) => getRun(tx, run.run_id));
    expect(row.config.permission_layers).toHaveLength(3);
    expect(fileAllowed(row.config.permission_layers!, 'write', 'docs/guide.md')).toBe(true);
    for (const file of ['outside.md', 'docs/private/guide.md', 'docs/code.ts'])
      expect(fileAllowed(row.config.permission_layers!, 'write', file)).toBe(false);
    await expect(client.workspaces.update(workspace.id, { permissions: { version: 1 } })).rejects.toMatchObject({
      code: 'permissions_in_use',
    });
    await client.runs.cancel(run.run_id);
    await client.workspaces.update(workspace.id, { permissions: { version: 1 } });
    await expect(
      client.sessions.continueRun(run.session_id, { prompt: 'Continue', queue_if_busy: true }),
    ).rejects.toMatchObject({ code: 'session_permissions_changed' });
  },
);
it('does not hydrate excluded contents, preserves them and accepts only permitted output', async () => {
  const { worktreeId } = await fixture();
  const run = await client.runs.create({
    worktree_id: worktreeId,
    harness: 'pi',
    model: 'fixture-model',
    billing_mode: 'managed',
    prompt: 'Edit guide',
  });
  await executeRun(account.p.organizationId, run.run_id, {
    async execute(input) {
      expect(input.files.map((file) => file.path)).toEqual(['docs/guide.md']);
      return {
        output: 'Done',
        files: input.files.map((file) => ({ ...file, bytes: Buffer.from('updated') })),
        inputTokens: 0,
        outputTokens: 0,
        usageComplete: true,
      };
    },
  });
  expect((await client.runs.get(run.run_id)).status).toBe('succeeded');
  expect(Buffer.from(await client.worktrees.readFile(worktreeId, { path: 'secret.env' })).toString()).toBe(
    'secret.env',
  );
  expect(
    Buffer.from(await client.worktrees.readFile(worktreeId, { path: 'docs/guide.md' })).toString(),
  ).toBe('updated');
  const before = await client.worktrees.get(worktreeId);
  const denied = await client.runs.create({
    worktree_id: worktreeId,
    harness: 'pi',
    model: 'fixture-model',
    billing_mode: 'managed',
    prompt: 'Forbidden output',
  });
  await executeRun(account.p.organizationId, denied.run_id, {
    async execute(input) {
      return {
        output: 'Not allowed',
        files: [...input.files, { path: 'outside.txt', bytes: Buffer.from('denied') }],
        inputTokens: 0,
        outputTokens: 0,
        usageComplete: true,
      };
    },
  });
  expect((await client.runs.get(denied.run_id)).status).toBe('failed');
  expect((await client.worktrees.get(worktreeId)).latest_checkpoint_id).toBe(before.latest_checkpoint_id);
  expect((await client.worktrees.listFiles(worktreeId)).entries.map((file) => file.path)).not.toContain(
    'outside.txt',
  );
});
