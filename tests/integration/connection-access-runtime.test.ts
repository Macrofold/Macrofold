import { afterAll, afterEach, expect, it } from 'vitest';
import { authPool, pool, transaction } from '../../packages/db';
import { identify } from '../../packages/core/src/auth';
import { fixtureAccount } from '../fixtures/account';
import * as r from '../../packages/core/src/resources';
import * as access from '../../packages/core/src/connection-access';
import { saveConnection } from '../../packages/core/src/connections';
import { admitConnections, runtimeConnectionTools } from '../../packages/core/src/connection-access-resolution';
import { admitRun, cancelRun, getRun } from '../../packages/core/src/runs';
import { id } from '../../packages/core/src/crypto';

const accounts: Awaited<ReturnType<typeof fixtureAccount>>[] = [];
afterEach(async () => {
  for (const account of accounts.splice(0))
    await transaction(account.p.organizationId, async (tx) => {
      const queued = await tx.query<{ id: string }>("SELECT id FROM runs WHERE status='queued'");
      for (const run of queued.rows) await cancelRun(tx, account.p, run.id);
    });
});
afterAll(async () => { await pool.end(); await authPool.end(); });
async function setup() {
  const a = await fixtureAccount('Runtime access');
  accounts.push(a);
  const state = await transaction(a.p.organizationId, async (tx) => {
    const project = await r.create(tx, 'projects', a.p.organizationId, { name: 'Policy project' });
    const agent = await r.create(tx, 'agents', a.p.organizationId, { name: 'Policy preset', harness: 'codex', model: 'fixture-model', billing_mode: 'managed' });
    const connection = await saveConnection(tx, a.p, { name: 'Bound search', kind: 'search', provider: 'brave', auth_method: 'none' });
    await access.patchAccess(tx, a.p, connection.id, { tools: ['web_search'] }, '"1"');
    return { project, agent, connection };
  });
  return { a, ...state, tx: <T>(fn: Parameters<typeof transaction<T>>[1]) => transaction(a.p.organizationId, fn) };
}

it('allows replacement rules without expanding the accepted maximum and keeps preset origin through deletion', async () => {
  const f = await setup();
  const first = await f.tx((tx) => access.saveRule(tx, f.a.p, f.connection.id, { scope: 'project_agent', project_id: f.project.id, agent_id: f.agent.id }, '"2"'));
  const accepted = await f.tx((tx) => admitRun(tx, f.a.p, { project_id: f.project.id, agent_id: f.agent.id, prompt: 'Freeze access' }));
  const currentTools = () => f.tx(async (tx) => runtimeConnectionTools(tx, await getRun(tx, accepted.run_id), await r.get(tx, 'connections', f.connection.id)));
  const replacement = await f.tx((tx) => access.saveRule(tx, f.a.p, f.connection.id, { scope: 'project', project_id: f.project.id }, '"3"'));
  await f.tx((tx) => access.deleteRule(tx, f.a.p, f.connection.id, first.rule.id, '"4"'));
  await f.tx(async (tx) => {
    await r.update(tx, 'agents', f.agent.id, { deleted: true });
    await tx.query("UPDATE connections SET access_tools=ARRAY['web_search','later_approved_tool'] WHERE id=$1", [f.connection.id]);
    const run = await getRun(tx, accepted.run_id);
    expect(run.config.agent_id).toBe(f.agent.id);
    expect(run.config.connection_access[0].rule_id).toBe(first.rule.id);
  });
  expect(await currentTools()).toEqual(['web_search']);
  await f.tx((tx) => access.deleteRule(tx, f.a.p, f.connection.id, replacement.rule.id, '"5"'));
  expect(await currentTools()).toEqual([]);
  await f.tx((tx) => access.patchAccess(tx, f.a.p, f.connection.id, { organization_wide: true }, '"6"'));
  expect(await currentTools()).toEqual(['web_search']);
  await f.tx((tx) => r.update(tx, 'connections', f.connection.id, { external_account_id: 'different-account' }));
  expect(await currentTools()).toEqual([]);
});

it('rechecks the issuing API key write scope and current owner membership for an exception', async () => {
  const f = await setup();
  const principal = await identify(new Request('http://localhost/v1/runs', { headers: { Authorization: `Bearer ${f.a.key}` } }));
  const accepted = await f.tx((tx) => admitRun(tx, principal, { project_id: f.project.id, harness: 'codex', model: 'fixture-model', billing_mode: 'managed', prompt: 'Scoped exception', connection_access_overrides: [{ connection_id: f.connection.id, tools: ['web_search'] }] }));
  const currentTools = () => f.tx(async (tx) => runtimeConnectionTools(tx, await getRun(tx, accepted.run_id), await r.get(tx, 'connections', f.connection.id)));
  expect(await currentTools()).toEqual(['web_search']);
  await f.tx((tx) => tx.query("UPDATE api_keys SET scopes=array_remove(scopes,'connections:write') WHERE id=$1", [principal.id]));
  expect(await currentTools()).toEqual([]);
  await f.tx((tx) => tx.query("UPDATE api_keys SET scopes=array_append(scopes,'connections:write') WHERE id=$1", [principal.id]));
  expect(await currentTools()).toEqual(['web_search']);
  await f.tx((tx) => tx.query('DELETE FROM memberships WHERE organization_id=$1 AND user_id=$2', [f.a.p.organizationId, f.a.p.userId]));
  expect(await currentTools()).toEqual([]);
});

it('resolves beyond the preview page and rejects an oversized automatic set without truncation', async () => {
  const f = await setup();
  const context = { project_id: f.project.id, agent_id: null, permissions: [] };
  const add = (count: number) => f.tx(async (tx) => {
    for (let index = 0; index < count; index++)
      await tx.query('INSERT INTO connections(id,organization_id,data,access_organization_wide,access_tools) VALUES($1,$2,$3,true,$4)', [id(), f.a.p.organizationId, { name: 'Eligible search', kind: 'search', status: 'healthy', owner_subject_id: f.a.p.userId }, ['web_search']]);
  });
  await add(30);
  expect((await f.tx((tx) => admitConnections(tx, f.a.p, context, undefined))).grants).toHaveLength(30);
  await add(71);
  await expect(f.tx((tx) => admitConnections(tx, f.a.p, context, undefined))).rejects.toMatchObject({ code: 'too_many_run_tools' });
  expect((await f.tx((tx) => admitConnections(tx, f.a.p, context, []))).grants).toEqual([]);
});
