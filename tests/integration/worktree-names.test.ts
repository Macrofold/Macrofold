import assert from 'node:assert/strict';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pool, authPool, transaction, lock } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { Client } from '../../sdk/typescript/src/client';
import { withRepository } from '../../packages/providers/src/git-repository';
import * as resources from '../../packages/core/src/resources';
import { createWorkspace, type FileRecord } from '../../packages/core/src/files';

let account: Awaited<ReturnType<typeof fixtureAccount>>,
  foreign: Awaited<ReturnType<typeof fixtureAccount>>,
  client: Client;
const apiClient = (key: string) =>
  new Client({
    baseURL: config.origin,
    apiKey: key,
    retries: 0,
    fetch: (url, init) => handleApi(new Request(url, init)),
  });
beforeAll(async () => {
  account = await fixtureAccount('Worktree names');
  foreign = await fixtureAccount('Other worktrees');
  client = apiClient(account.key);
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
async function fixture() {
  const project = await client.projects.create({ name: 'Worktree fixture' });
  assert(project.default_workspace_id);
  return { project, main: await client.workspaces.get(project.default_workspace_id) };
}
async function create(projectId: string, input: Parameters<Client['projects']['createWorkspace']>[1] = {}) {
  const op = await client.projects.createWorkspace(projectId, input);
  assert(op.result?.workspace_id);
  return client.workspaces.get(op.result.workspace_id);
}

it('derives either missing field, preserves explicit pairs, and checks names case-insensitively', async () => {
  const { project } = await fixture();
  expect(await create(project.id, { name: 'Research ideas' })).toMatchObject({
    name: 'Research ideas',
    branch: 'Research-ideas',
  });
  expect(await create(project.id, { branch: 'feature/inbox' })).toMatchObject({
    name: 'feature/inbox',
    branch: 'feature/inbox',
  });
  const paired = await create(project.id, { name: 'Personal assistant', branch: 'feature/personal' });
  expect(paired).toMatchObject({ name: 'Personal assistant', branch: 'feature/personal' });
  await expect(
    create(project.id, { name: '  PERSONAL ASSISTANT ', branch: 'different' }),
  ).rejects.toMatchObject({ status: 409, code: 'name_exists' });
  await expect(client.workspaces.update(paired.id, { name: 'Research ideas' })).rejects.toMatchObject({
    status: 409,
    code: 'name_exists',
  });
  await expect(create(project.id, { branch: 'a/../b' })).rejects.toMatchObject({ status: 400 });
  await expect(create(project.id, { name: 'main' })).rejects.toMatchObject({ status: 409 });
});

it('allows independent worktrees on an existing branch and restores that branch’s saved files', async () => {
  const { project, main } = await fixture();
  await client.workspaces.writeFile(main.id, {
    path: 'main.txt',
    content: Buffer.from('main'),
    ifMatch: main.revision,
  });
  const feature = await create(project.id, { name: 'Feature', branch: 'feature' });
  await client.workspaces.writeFile(feature.id, {
    path: 'feature.txt',
    content: Buffer.from('feature only'),
    ifMatch: feature.revision,
  });
  const selected = await create(project.id, {
    name: 'Review feature',
    branch: 'feature',
    branch_mode: 'existing',
  });
  expect(Buffer.from(await client.workspaces.readFile(selected.id, { path: 'feature.txt' })).toString()).toBe(
    'feature only',
  );
  await expect(client.workspaces.readFile(main.id, { path: 'feature.txt' })).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    create(project.id, { name: 'Another', branch: 'feature', branch_mode: 'new' }),
  ).rejects.toMatchObject({ code: 'branch_exists' });
  await expect(
    create(project.id, { name: 'Missing', branch: 'missing', branch_mode: 'existing' }),
  ).rejects.toMatchObject({ code: 'git_ref_not_found' });
});

it('keeps blank identities until the first accepted run, then assigns a stable branch using the same ID', async () => {
  const { project } = await fixture();
  const first = await create(project.id),
    second = await create(project.id);
  expect(first).toMatchObject({ name: null, branch: null });
  expect(second).toMatchObject({ name: null, branch: null });
  await client.workspaces.writeFile(first.id, {
    path: 'before.txt',
    content: Buffer.from('before naming'),
    ifMatch: first.revision,
  });
  await expect(
    client.runs.create({
      workspace_id: first.id,
      prompt: 'Plan my week',
      harness: 'codex',
      model: 'invalid-model',
      billing_mode: 'managed',
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(await client.workspaces.get(first.id)).toMatchObject({ name: null, branch: null });
  const run = await client.runs.create({
    workspace_id: first.id,
    prompt: 'Plan my week',
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
  });
  expect(await client.workspaces.get(first.id)).toMatchObject({
    id: first.id,
    name: 'plan-my-week',
    branch: 'plan-my-week',
  });
  await client.runs.cancel(run.run_id);
  const next = await client.runs.create({
    workspace_id: second.id,
    prompt: 'Plan my week',
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
  });
  expect(await client.workspaces.get(second.id)).toMatchObject({
    name: 'plan-my-week-2',
    branch: 'plan-my-week-2',
  });
  await client.runs.cancel(next.run_id);
  const data = await transaction(account.p.organizationId, (tx) =>
    resources.get(tx, 'workspaces', first.id, account.p),
  );
  await withRepository(data.git_files as FileRecord[], async (repo) => {
    await repo.select('plan-my-week', 'refs/heads/plan-my-week');
    expect([...(await repo.tree())].map(([path]) => path)).toContain('before.txt');
  });
});

it('authorizes branch discovery and validates availability without exposing another project', async () => {
  const { project } = await fixture();
  const options = await client.projects.getWorktreeOptions(project.id, { name: 'Fresh branch' });
  expect(options).toMatchObject({
    valid: true,
    name: 'Fresh branch',
    branch: 'Fresh-branch',
    branch_exists: false,
  });
  expect(options.branches.map((branch) => branch.name)).toContain('main');
  expect(await client.projects.getWorktreeOptions(project.id, { name: 'MAIN' })).toMatchObject({
    valid: false,
  });
  await expect(apiClient(foreign.key).projects.getWorktreeOptions(project.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(apiClient(foreign.key).projects.createWorkspace(project.id, {})).rejects.toMatchObject({
    status: 404,
  });
});

it('serializes competing names under the project lock and commits exactly one worktree', async () => {
  const { project } = await fixture();
  let release!: () => void, locked!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const owner = transaction(account.p.organizationId, async (tx) => {
    await lock(tx, `project-workspaces:${project.id}`);
    locked();
    await barrier;
    return createWorkspace(tx, account.p, project.id, { name: 'Concurrent task' });
  });
  await acquired;
  // Attach rejection handling before releasing the barrier.
  const contender = create(project.id, { name: 'CONCURRENT TASK', branch: 'other' }).then(
    () => ({ code: 'unexpected_success' }),
    (error: { code: string }) => error,
  );
  try {
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'",
            )
          ).rows[0].n,
      )
      .toBeGreaterThan(0);
  } finally {
    release();
  }
  await owner;
  expect(await contender).toMatchObject({ code: 'name_exists' });
  const rows = await client.projects.listWorkspaces(project.id);
  expect(rows.data.filter((row) => row.name?.toLowerCase() === 'concurrent task')).toHaveLength(1);
});

it.each([{ name: 'x'.repeat(152) }, { name: '✨' }, { branch: 'bad..branch' }, { branch: 'HEAD' }])(
  'rejects invalid identity %j without creating a worktree',
  async (input) => {
    const { project } = await fixture();
    await expect(create(project.id, input)).rejects.toMatchObject({ status: 400 });
    expect((await client.projects.listWorkspaces(project.id)).data).toHaveLength(1);
  },
);
