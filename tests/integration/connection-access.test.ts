import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import * as r from '../../packages/core/src/resources';
import * as access from '../../packages/core/src/connection-access';
import { saveConnection } from '../../packages/core/src/connections';
import { createWorktree } from '../../packages/core/src/files';
import { admitRun, cancelRun, getNativeRun as getRun } from '../../packages/core/src/runs';
import { previewAccess, runtimeConnectionTools } from '../../packages/core/src/connection-access-resolution';
let a: Awaited<ReturnType<typeof fixtureAccount>>;
let sales: string, support: string, writer: string, researcher: string;
beforeAll(async () => {
  a = await fixtureAccount('Access policy');
  await transaction(a.p.organizationId, async (tx) => {
    sales = (await r.create(tx, 'workspaces', a.p.organizationId, { name: 'Sales' })).id;
    support = (await r.create(tx, 'workspaces', a.p.organizationId, { name: 'Support' })).id;
    writer = (
      await r.create(tx, 'agents', a.p.organizationId, {
        name: 'Writer',
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
      })
    ).id;
    researcher = (
      await r.create(tx, 'agents', a.p.organizationId, {
        name: 'Researcher',
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
      })
    ).id;
  });
});
afterEach(async () => {
  await transaction(a.p.organizationId, async (tx) => {
    const queued = await tx.query<{ id: string }>("SELECT id FROM runs WHERE status='queued'");
    for (const run of queued.rows) await cancelRun(tx, a.p, run.id);
  });
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
const tx = <T>(fn: Parameters<typeof transaction<T>>[1]) => transaction(a.p.organizationId, fn);
async function connection(name = 'Search') {
  return tx((t) => saveConnection(t, a.p, { name, kind: 'search', provider: 'brave', auth_method: 'none' }));
}
async function allow(id: string) {
  return tx((t) => access.patchAccess(t, a.p, id, { tools: ['web_search'] }, '"1"'));
}
it('starts denied and preserves credentials/name and the rule set across organization toggles', async () => {
  const c = await connection();
  expect(c.access_tools).toEqual([]);
  expect(c.access_organization_wide).toBe(false);
  await allow(c.id);
  const rule = await tx((t) =>
    access.saveRule(t, a.p, c.id, { scope: 'workspace_agent', workspace_id: sales, agent_id: writer }, '"2"'),
  );
  expect(rule.version).toBe('3');
  const on = await tx((t) => access.patchAccess(t, a.p, c.id, { organization_wide: true }, '"3"'));
  expect(on.rule_count).toBe(1);
  await tx((t) => saveConnection(t, a.p, { name: 'Renamed' }, c.id));
  expect((await tx((t) => r.get(t, 'connections', c.id))).access_version).toBe('4');
  const off = await tx((t) => access.patchAccess(t, a.p, c.id, { organization_wide: false }, '"4"'));
  expect(off.rule_count).toBe(1);
  expect(off.tools).toEqual(['web_search']);
});
it('SQL filtering uses exact pairs, wildcard browsing, and current authorized workspaces', async () => {
  const c = await connection('Paired');
  await allow(c.id);
  await tx((t) =>
    access.saveRule(t, a.p, c.id, { scope: 'workspace_agent', workspace_id: sales, agent_id: writer }, '"2"'),
  );
  await tx((t) =>
    access.saveRule(
      t,
      a.p,
      c.id,
      { scope: 'workspace_agent', workspace_id: support, agent_id: researcher },
      '"3"',
    ),
  );
  const list = async (context: accessContext) =>
    tx((t) => access.listContextConnections(t, a.p, new URLSearchParams(), context));
  expect((await list({ workspace_id: sales })).data.find((v) => v.id === c.id)?.access_match?.conditional).toBe(
    true,
  );
  expect((await list({ agent_id: researcher })).data.some((v) => v.id === c.id)).toBe(true);
  expect((await list({ workspace_id: sales, agent_id: researcher })).data.some((v) => v.id === c.id)).toBe(
    false,
  );
  expect(
    (await list({ workspace_id: sales, agent_id: writer })).data.find((v) => v.id === c.id)?.access_match
      ?.conditional,
  ).toBe(false);
  expect((await list({ workspace_id: sales, agent_id: null })).data.some((v) => v.id === c.id)).toBe(false);
  const restricted = { ...a.p, workspaceIds: [sales] };
  expect(
    (
      await tx((t) =>
        access.listContextConnections(t, restricted, new URLSearchParams(), { agent_id: researcher }),
      )
    ).data.some((v) => v.id === c.id),
  ).toBe(false);
});
type accessContext = Parameters<typeof access.listContextConnections>[3];
it('serializes revisions, rejects duplicate rules, and permits owner reductions after demotion', async () => {
  const c = await connection();
  const results = await Promise.allSettled([
    allow(c.id),
    tx((t) => access.patchAccess(t, a.p, c.id, { tools: [] }, '"1"')),
  ]);
  expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((v) => v.status === 'rejected')).toMatchObject({ reason: { code: 'stale_revision' } });
  const rule = await tx((t) => access.saveRule(t, a.p, c.id, { scope: 'workspace', workspace_id: sales }, '"2"'));
  await expect(
    tx((t) => access.saveRule(t, a.p, c.id, { scope: 'workspace', workspace_id: sales }, '"3"')),
  ).rejects.toMatchObject({ status: 409, code: 'duplicate_permission' });
  const member = { ...a.p, role: 'member' };
  await expect(
    tx((t) => access.patchAccess(t, member, c.id, { organization_wide: true }, '"3"')),
  ).rejects.toMatchObject({ status: 403 });
  expect((await tx((t) => access.deleteRule(t, member, c.id, rule.rule.id, '"3"'))).version).toBe('4');
});
it('requires write authority for every mutation without requiring the separate read scope', async () => {
  const c = await connection();
  const writer = { ...a.p, scopes: ['connections:write'] };
  await expect(tx((t) => access.ownedAccess(t, writer, c.id))).rejects.toMatchObject({ status: 403 });
  expect(
    (await tx((t) => access.patchAccess(t, writer, c.id, { tools: ['web_search'] }, '"1"'))).version,
  ).toBe('2');
  const saved = await tx((t) =>
    access.saveRule(t, writer, c.id, { scope: 'workspace', workspace_id: sales }, '"2"'),
  );
  const reader = { ...a.p, scopes: ['connections:read'] };
  const state = () =>
    tx(async (t) => ({
      connection: await r.get(t, 'connections', c.id),
      rules: await access.listRules(t, a.p, c.id, new URLSearchParams()),
      audit: (await t.query('SELECT * FROM organization_audit WHERE subject_id=$1 ORDER BY id', [c.id])).rows,
    }));
  const before = await state();
  const replacement = { scope: 'workspace' as const, workspace_id: support };
  for (const mutate of [
    () => tx((t) => access.patchAccess(t, reader, c.id, { tools: [] }, '"3"')),
    () => tx((t) => access.saveRule(t, reader, c.id, replacement, '"3"')),
    () => tx((t) => access.saveRule(t, reader, c.id, replacement, '"3"', saved.rule.id)),
    () => tx((t) => access.deleteRule(t, reader, c.id, saved.rule.id, '"3"')),
  ])
    await expect(mutate()).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  expect(await state()).toEqual(before);
  expect((await tx((t) => access.saveRule(t, writer, c.id, replacement, '"3"', saved.rule.id))).version).toBe(
    '4',
  );
  expect((await tx((t) => access.deleteRule(t, writer, c.id, saved.rule.id, '"4"'))).version).toBe('5');
});
it('keeps one-run exceptions out of session defaults and rechecks frozen authority', async () => {
  const c = await connection('One run');
  await allow(c.id);
  const ws = await tx((t) => createWorktree(t, a.p, sales, { name: 'exception-test' }));
  const admitted = await tx((t) =>
    admitRun(t, a.p, {
      worktree_id: ws.result.worktree_id!,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Only this run',
      connection_grants: [{ connection_id: c.id, tools: ['web_search'] }],
      connection_access_overrides: [{ connection_id: c.id, tools: ['web_search'] }],
    }),
  );
  await tx(async (t) => {
    const session = await r.get(t, 'sessions', admitted.session_id);
    expect(session.connection_grants).toBeUndefined();
    const run = await getRun(t, admitted.run_id);
    expect(run.config.connection_access[0]?.override?.authorized_by).toBe(a.p.userId);
    expect(await runtimeConnectionTools(t, run, await r.get(t, 'connections', c.id))).toEqual(['web_search']);
  });
  const preview = await tx((t) =>
    previewAccess(t, a.p, { session_id: admitted.session_id }, new URLSearchParams()),
  );
  expect(preview.data.some((v) => v.connection_id === c.id)).toBe(false);
  await tx((t) => access.patchAccess(t, a.p, c.id, { tools: [] }, '"2"'));
  await tx(async (t) =>
    expect(
      await runtimeConnectionTools(t, await getRun(t, admitted.run_id), await r.get(t, 'connections', c.id)),
    ).toEqual([]),
  );
});
