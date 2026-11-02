import { beforeAll, afterAll, expect, it } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { transaction, pool, authPool } from '../../packages/db';
import * as resources from '../../packages/core/src/resources';
import { createWorktree, worktreeFiles } from '../../packages/core/src/files';
import {
  prepareIntegrationInstall,
  listIntegrations,
  getIntegration,
  setIntegrationState,
  removeIntegration,
  prepareMemoryExport,
  prepareMemoryEdit,
  listIntegrationMemories,
} from '../../packages/core/src/agent-integrations';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
let workspace: string, worktree: string;
beforeAll(async () => {
  account = await fixtureAccount('Optional memory');
  await transaction(account.p.organizationId, async (tx) => {
    workspace = (
      await resources.create(tx, 'workspaces', account.p.organizationId, { name: 'Memory fixture' })
    ).id;
    worktree = String(
      (await createWorktree(tx, account.p, workspace, { name: 'Memory fixture' })).result.worktree_id,
    );
  });
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
const tx = <T>(fn: Parameters<typeof transaction<T>>[1]) => transaction(account.p.organizationId, fn);

it('installs once, preserves conditional file edits, exports and detaches without deleting notes', async () => {
  const prepared = await prepareIntegrationInstall(account.p, {
    workspace_id: workspace,
    worktree_id: worktree,
    pack_id: 'file-memory',
  });
  const installed = await tx((t) => prepared.commit(t, account.p)).finally(prepared.dispose);
  const listing = await tx((t) =>
    listIntegrations(t, account.p, new URLSearchParams({ workspace_id: workspace })),
  );
  expect(listing.data.map((item) => item.id)).toContain(installed.id);
  await expect(
    prepareIntegrationInstall(account.p, {
      workspace_id: workspace,
      worktree_id: worktree,
      pack_id: 'file-memory',
    }),
  ).rejects.toMatchObject({ code: 'integration_already_installed' });
  const notes = await tx((t) => listIntegrationMemories(t, account.p, installed.id, new URLSearchParams()));
  expect(notes.data.map((file) => file.path)).toEqual(['memory/README.md', 'profile.md', 'tasks.json']);
  const revision = notes.data[0].revision;
  const edit = await prepareMemoryEdit(
    account.p,
    installed.id,
    'profile.md',
    revision,
    '# Profile\n\nPrefers concise summaries.\n',
  );
  await tx((t) => edit.commit(t, account.p)).finally(edit.dispose);
  await expect(
    prepareMemoryEdit(account.p, installed.id, 'profile.md', revision, 'stale edit'),
  ).rejects.toMatchObject({ code: 'stale_revision' });
  const exported = await prepareMemoryExport(account.p, installed.id);
  const data = await tx((t) => exported.commit(t, account.p));
  expect(data.files.find((file) => file.path === 'profile.md')?.content).toContain('Prefers concise');
  expect(data.historical_data_included).toBe(false);
  const paused = await tx((t) =>
    setIntegrationState(t, account.p, installed.id, 'paused', installed.revision),
  );
  expect(paused.state).toBe('paused');
  await expect(
    tx((t) => setIntegrationState(t, account.p, installed.id, 'disabled', installed.revision)),
  ).rejects.toMatchObject({ code: 'stale_revision' });
  await tx((t) => removeIntegration(t, account.p, installed.id));
  expect(
    (await tx((t) => worktreeFiles(t, worktree, account.p))).files.some((file) => file.path === 'profile.md'),
  ).toBe(true);
  await expect(tx((t) => getIntegration(t, account.p, installed.id))).rejects.toMatchObject({
    code: 'not_found',
  });
});

it('rejects cross-workspace binding and pending service activation', async () => {
  const other = await tx((t) =>
    resources.create(t, 'workspaces', account.p.organizationId, { name: 'Other workspace' }),
  );
  await expect(
    prepareIntegrationInstall(account.p, {
      workspace_id: other.id,
      worktree_id: worktree,
      pack_id: 'file-memory',
    }),
  ).rejects.toMatchObject({ code: 'workspace_mismatch' });
  await expect(
    prepareIntegrationInstall(account.p, {
      workspace_id: workspace,
      worktree_id: worktree,
      pack_id: 'hindsight',
    }),
  ).rejects.toMatchObject({ code: 'integration_setup_required' });
  await expect(
    prepareIntegrationInstall(
      { ...account.p, workspaceIds: [other.id] },
      { workspace_id: workspace, worktree_id: worktree, pack_id: 'file-memory' },
    ),
  ).rejects.toMatchObject({ code: 'not_found' });
});

it('enforces tenant and scoped-workspace isolation on installed metadata', async () => {
  const prepared = await prepareIntegrationInstall(account.p, {
    workspace_id: workspace,
    worktree_id: worktree,
    pack_id: 'file-memory',
  });
  const installed = await tx((t) => prepared.commit(t, account.p)).finally(prepared.dispose);
  const other = await fixtureAccount('Different memory tenant');
  await expect(
    transaction(other.p.organizationId, (t) => getIntegration(t, other.p, installed.id)),
  ).rejects.toMatchObject({ code: 'not_found' });
  const hiddenWorkspace = await tx((t) =>
    resources.create(t, 'workspaces', account.p.organizationId, { name: 'Scoped workspace' }),
  );
  const restricted = { ...account.p, workspaceIds: [hiddenWorkspace.id] };
  expect((await tx((t) => listIntegrations(t, restricted, new URLSearchParams()))).data).toEqual([]);
  await expect(tx((t) => getIntegration(t, restricted, installed.id))).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(
    tx((t) =>
      setIntegrationState(
        t,
        { ...account.p, scopes: ['runs:read'] },
        installed.id,
        'disabled',
        installed.revision,
      ),
    ),
  ).rejects.toMatchObject({ code: 'forbidden' });
});
