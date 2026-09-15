import { beforeAll, afterAll, it, expect } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { handleApi } from '../../packages/core/src/http';
import { id } from '../../packages/core/src/crypto';
import { createKey } from '../../packages/core/src/keys';
import * as r from '../../packages/core/src/resources';
import * as access from '../../packages/core/src/connection-access';
import { admitConnections, previewAccess } from '../../packages/core/src/connection-access-resolution';
let a: Awaited<ReturnType<typeof fixtureAccount>>, b: typeof a;
let project: string, agent: string;
beforeAll(async () => {
  a = await fixtureAccount('Access HTTP owner');
  b = await fixtureAccount('Foreign owner');
  await transaction(a.p.organizationId, async (tx) => {
    project = (await r.create(tx, 'projects', a.p.organizationId, { name: 'Access project' })).id;
    agent = (
      await r.create(tx, 'agents', a.p.organizationId, {
        name: 'Access preset',
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
      })
    ).id;
  });
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
const tx = <T>(fn: Parameters<typeof transaction<T>>[1]) => transaction(a.p.organizationId, fn);
async function http(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  key = a.key,
) {
  return handleApi(
    new Request(config.origin + path, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': id(),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
async function connection() {
  const response = await http('POST', '/v1/connections', {
    name: 'Access fixture',
    kind: 'search',
    provider: 'brave',
    auth_method: 'none',
  });
  expect(response.status).toBe(201);
  return (await response.json()).id as string;
}
it('requires strict shapes and quoted revisions, and replays ETags without a second mutation', async () => {
  const c = await connection(),
    path = `/v1/connections/${c}/access`;
  for (const body of [
    {},
    { tools: null },
    { organization_wide: null },
    { tools: [], subject_type: 'organization' },
  ]) {
    expect((await http('PATCH', path, body, { 'If-Match': '"1"' })).status).toBe(400);
  }
  for (const header of [{}, { 'If-Match': '1' }] as Record<string, string>[])
    expect((await http('PATCH', path, { tools: [] }, header)).status).toBe(400);
  const headers = { 'If-Match': '"1"', 'Idempotency-Key': id() };
  const saved = await http('PATCH', path, { tools: ['web_search'] }, headers);
  expect(saved.status).toBe(200);
  expect(saved.headers.get('etag')).toBe('"2"');
  const replay = await http('PATCH', path, { tools: ['web_search'] }, headers);
  expect(replay.headers.get('etag')).toBe('"2"');
  expect(await replay.json()).toEqual(await saved.json());
  expect((await http('PATCH', path, { tools: [] }, { 'If-Match': '"1"' })).status).toBe(412);
  for (const body of [
    { scope: 'project', project_id: project, agent_id: agent },
    { scope: 'agent', agent_id: agent, project_id: project },
    { scope: 'project_agent', project_id: project },
    { scope: 'run', run_id: id() },
  ])
    expect((await http('POST', path + '/rules', body, { 'If-Match': '"2"' })).status).toBe(400);
  const rule = await http(
    'POST',
    path + '/rules',
    { scope: 'project_agent', project_id: project, agent_id: agent },
    { 'If-Match': '"2"' },
  );
  expect(rule.status).toBe(201);
  expect(rule.headers.get('etag')).toBe('"3"');
  const result = await rule.json();
  expect(
    (
      await http(
        'POST',
        path + '/rules',
        { scope: 'project_agent', project_id: project, agent_id: agent },
        { 'If-Match': '"3"' },
      )
    ).status,
  ).toBe(409);
  const removed = await http('DELETE', path + '/rules/' + result.rule.id, undefined, { 'If-Match': '"3"' });
  expect(removed.status).toBe(200);
  expect(removed.headers.get('etag')).toBe('"4"');
  expect(await removed.json()).toEqual({ id: result.rule.id, version: '4' });
});
it('separates owner management from scoped browsing and never widens a restricted grant', async () => {
  const c = await connection(),
    path = `/v1/connections/${c}/access`;
  const scoped = await tx((t) =>
    createKey(t, a.p, {
      name: 'Restricted access',
      scopes: ['connections:read', 'connections:write'],
      project_id: project,
    }),
  );
  expect(
    (await http('PATCH', path, { organization_wide: true }, { 'If-Match': '"1"' }, scoped.secret)).status,
  ).toBe(403);
  expect(
    (
      await http(
        'POST',
        path + '/rules',
        { scope: 'agent', agent_id: agent },
        { 'If-Match': '"1"' },
        scoped.secret,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await http(
        'POST',
        path + '/rules',
        { scope: 'project', project_id: project },
        { 'If-Match': '"1"' },
        scoped.secret,
      )
    ).status,
  ).toBe(201);
  expect((await http('GET', path, undefined, {}, b.key)).status).toBe(404);
  const viewer = await tx((t) =>
    createKey(t, a.p, { name: 'Read only', scopes: ['connections:read', 'projects:read', 'runs:read'] }),
  );
  expect((await http('GET', path, undefined, {}, viewer.secret)).status).toBe(200);
  expect((await http('PATCH', path, { tools: [] }, { 'If-Match': '"2"' }, viewer.secret)).status).toBe(403);
  const preview = await http(
    'POST',
    '/v1/connection-access/resolve',
    { project_id: project, connection_access_overrides: [{ connection_id: c, tools: [] }] },
    {},
    viewer.secret,
  );
  expect(preview.status).toBe(200);
  expect(
    (await preview.json()).data.find((v: { connection_id: string }) => v.connection_id === c),
  ).toMatchObject({ can_override: false, rejection_codes: expect.arrayContaining(['override_forbidden']) });
});
it('expands only on request, preserves parent revision, rejects ambiguous query scalars, and checks expansion scopes', async () => {
  const parent = await (await http('GET', `/v1/projects/${project}`)).json();
  expect(parent.connections).toBeUndefined();
  const expanded = await (
    await http('GET', `/v1/projects/${project}?include_connections=true&agent_id=${agent}`)
  ).json();
  expect(expanded.connections.data).toBeInstanceOf(Array);
  expect(expanded.revision).toBe(parent.revision);
  expect((await http('GET', `/v1/projects/${project}?agent_id=${agent}`)).status).toBe(400);
  expect((await http('GET', `/v1/connections?project_id=${project}&project_id=${project}`)).status).toBe(400);
  const key = await tx((t) => createKey(t, a.p, { name: 'Project only', scopes: ['projects:read'] }));
  expect((await http('GET', `/v1/projects/${project}`, undefined, {}, key.secret)).status).toBe(200);
  expect(
    (await http('GET', `/v1/projects/${project}?include_connections=true`, undefined, {}, key.secret)).status,
  ).toBe(403);
});
it.each([
  { kind: 'model', provider: 'openai', auth_method: 'api_key', secret: 'disposable-model-key' },
  { kind: 'claude_subscription', provider: 'anthropic', auth_method: 'claude_code' },
])('never offers a tool-access exception for an owned $kind connection', async (input) => {
  const created = await http('POST', '/v1/connections', { name: 'Unsupported tool exception', ...input });
  expect(created.status).toBe(201);
  const connectionId = (await created.json()).id;
  const preview = await http('POST', '/v1/connection-access/resolve', {
    project_id: project,
    connection_grants: [{ connection_id: connectionId, tools: [] }],
    connection_access_overrides: [{ connection_id: connectionId, tools: [] }],
  });
  expect(preview.status).toBe(200);
  expect((await preview.json()).data).toEqual([
    expect.objectContaining({
      connection_id: connectionId,
      name: 'Unsupported tool exception',
      ready: false,
      can_override: false,
      tools: [],
      rejection_codes: expect.arrayContaining(['connection_access_unsupported', 'override_forbidden']),
    }),
  ]);
});
it('paginates rules with bound filters, retains unavailable targets, and enforces tenant foreign keys', async () => {
  const c = await connection();
  await tx(async (t) => {
    await access.saveRule(t, a.p, c, { scope: 'project', project_id: project }, '"1"');
    await access.saveRule(t, a.p, c, { scope: 'agent', agent_id: agent }, '"2"');
    await access.saveRule(t, a.p, c, { scope: 'project_agent', project_id: project, agent_id: agent }, '"3"');
  });
  const expanded = await (
    await http('GET', `/v1/projects/${project}?include_connections=true&agent_id=${agent}`)
  ).json();
  const summary = expanded.connections.data.find((item: { id: string }) => item.id === c).access_match;
  expect(summary.conditional).toBe(false);
  expect(summary.matching_rules).toHaveLength(3);
  expect(summary.matching_rules.find((rule: { scope: string }) => rule.scope === 'project_agent')).toEqual({
    rule_id: expect.any(String),
    scope: 'project_agent',
    project_id: project,
    agent_id: agent,
    project_name: 'Access project',
    agent_name: 'Access preset',
  });
  const first = await tx((t) =>
    access.listRules(t, a.p, c, new URLSearchParams({ limit: '1', sort: 'project' })),
  );
  const second = await tx((t) =>
    access.listRules(
      t,
      a.p,
      c,
      new URLSearchParams({ limit: '1', sort: 'project', cursor: first.next_cursor! }),
    ),
  );
  expect(first.data[0].id).not.toBe(second.data[0].id);
  await expect(
    tx((t) =>
      access.listRules(
        t,
        a.p,
        c,
        new URLSearchParams({ limit: '1', sort: 'agent', cursor: first.next_cursor! }),
      ),
    ),
  ).rejects.toMatchObject({ code: 'invalid_cursor' });
  const temporary = await tx((t) => r.create(t, 'projects', a.p.organizationId, { name: 'Gone' }));
  const rule = await tx((t) =>
    access.saveRule(t, a.p, c, { scope: 'project', project_id: temporary.id }, '"4"'),
  );
  await tx((t) => r.update(t, 'projects', temporary.id, { deleted: true }));
  const rules = await tx((t) => access.listRules(t, a.p, c, new URLSearchParams()));
  expect(rules.data.find((v) => v.id === rule.rule.id)).toMatchObject({
    project_id: temporary.id,
    project_name: null,
    unavailable: true,
  });
  await tx((t) => r.remove(t, 'projects', temporary.id));
  expect(
    (await tx((t) => access.listRules(t, a.p, c, new URLSearchParams()))).data.some(
      (v) => v.id === rule.rule.id,
    ),
  ).toBe(false);
  const foreign = await transaction(b.p.organizationId, (t) =>
    r.create(t, 'projects', b.p.organizationId, { name: 'Private' }),
  );
  await expect(
    tx((t) =>
      t.query(
        'INSERT INTO connection_access_rules(id,organization_id,connection_id,scope,project_id,created_by) VALUES($1,$2,$3,$4,$5,$6)',
        [id(), a.p.organizationId, c, 'project', foreign.id, a.p.userId],
      ),
    ),
  ).rejects.toMatchObject({ code: '23503' });
  expect(
    (
      await transaction(b.p.organizationId, (t) =>
        t.query('SELECT id FROM connection_access_rules WHERE connection_id=$1', [c]),
      )
    ).rows,
  ).toEqual([]);
});
it('uses default inheritance, explicit empty selection, auto exceptions, and per-item missing results', async () => {
  const c = await connection();
  await tx((t) => access.patchAccess(t, a.p, c, { tools: ['web_search'] }, '"1"'));
  const context = { project_id: project, agent_id: null, permissions: [] };
  const exception = [{ connection_id: c, tools: ['web_search'] }];
  expect((await tx((t) => admitConnections(t, a.p, context, undefined, exception))).grants).toEqual(
    exception,
  );
  expect((await tx((t) => admitConnections(t, a.p, context, [], exception))).grants).toEqual([]);
  expect(
    (
      await tx((t) =>
        admitConnections(
          t,
          a.p,
          { ...context, defaults: [{ connection_id: id(), tools: ['missing'] }] },
          undefined,
        ),
      )
    ).grants,
  ).toEqual([]);
  const missing = id();
  const page = await tx((t) =>
    previewAccess(
      t,
      a.p,
      {
        project_id: project,
        connection_grants: [...exception, { connection_id: missing, tools: ['missing'] }],
      },
      new URLSearchParams({ limit: '1' }),
    ),
  );
  expect(page.data).toHaveLength(1);
  expect(page.next_cursor).toBeTruthy();
  const next = await tx((t) =>
    previewAccess(
      t,
      a.p,
      {
        project_id: project,
        connection_grants: [...exception, { connection_id: missing, tools: ['missing'] }],
      },
      new URLSearchParams({ limit: '1', cursor: page.next_cursor! }),
    ),
  );
  expect(next.data).toHaveLength(1);
  expect(next.data[0].connection_id).not.toBe(page.data[0].connection_id);
  const auto = await tx((t) =>
    previewAccess(
      t,
      a.p,
      { project_id: project, connection_access_overrides: exception },
      new URLSearchParams(),
    ),
  );
  expect(auto.data.find((v) => v.connection_id === c)).toMatchObject({
    source: 'run_override',
    tools: ['web_search'],
    ready: true,
  });
  const unknownException = await tx((t) =>
    previewAccess(
      t,
      a.p,
      {
        project_id: project,
        connection_access_overrides: [{ connection_id: missing, tools: ['web_search'] }],
      },
      new URLSearchParams(),
    ),
  );
  expect(unknownException.data.find((v) => v.connection_id === missing)).toMatchObject({
    ready: false,
    rejection_codes: ['connection_unavailable'],
  });
});
it('keeps preset omission, explicit none, and null reset distinct', async () => {
  const path = `/v1/agents/${agent}`;
  expect((await http('PATCH', path, { connection_grants: [] })).status).toBe(200);
  expect((await (await http('PATCH', path, { name: 'Renamed preset' })).json()).connection_grants).toEqual(
    [],
  );
  expect(
    (await (await http('PATCH', path, { connection_grants: null })).json()).connection_grants,
  ).toBeUndefined();
  expect(
    (await http('POST', '/v1/runs', { project_id: project, prompt: 'Fixture', connection_grants: null }))
      .status,
  ).toBe(400);
});
