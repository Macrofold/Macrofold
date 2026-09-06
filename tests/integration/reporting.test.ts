import { afterAll, describe, it, expect } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { auth, type Principal } from '../../packages/core/src/auth';
import { id, seal } from '../../packages/core/src/crypto';
import { config } from '../../packages/core/src/config';
import { adminReport, usageReport } from '../../packages/core/src/reports';
import { handleAdminMcp } from '../../packages/core/src/admin-mcp';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const operator: Principal = {
  id: id(),
  organizationId: '',
  role: 'operator',
  kind: 'operator',
  scopes: ['metrics:read', 'operations:read', 'accounts:read'],
  projectIds: [],
  operator: true,
};
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
describe('operator reporting and MCP', () => {
  it('counts rolling human activity independently of acquisition dates and keeps tenant request totals private', async () => {
    const org = id(),
      other = id(),
      users = [id(), id(), id()];
    await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)', [
      org,
      'Metrics test',
      other,
      'Other metrics',
    ]);
    for (const user of users) {
      await pool.query('INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [
        user,
        'Metrics person',
        `${user}@example.test`,
      ]);
      await pool.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'member')", [
        org,
        user,
      ]);
    }
    const to = new Date(),
      from = new Date(to.getTime() - 60 * 60 * 1000);
    await transaction(org, async (tx) => {
      for (let i = 0; i < 3; i++)
        await tx.query(
          "INSERT INTO actor_activity(id,organization_id,user_id,action,created_at) VALUES($1,$2,$3,'run.created',$4)",
          [id(), org, users[i], new Date(to.getTime() - [12 * 3600000, 3 * 86400000, 15 * 86400000][i])],
        );
    });
    await pool.query(
      "INSERT INTO api_requests(request_id,organization_id,method,route,principal_type,principal_id,status) VALUES($1,$2,'POST','/v1/runs','service',$3,202),($4,$5,'POST','/v1/runs','service',$6,202)",
      [id(), org, id(), id(), other, id()],
    );
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: new Date(to.getTime() + 1000).toISOString(),
      organization_id: org,
    });
    const report = (await adminReport('getGrowthMetrics', operator, query)) as {
      metrics: { name: string; value: string }[];
    };
    const values = Object.fromEntries(report.metrics.map((m) => [m.name, m.value]));
    expect(values).toMatchObject({
      human_dau: '1',
      human_wau: '2',
      human_mau: '3',
      users_total: '3',
      accounts_total: '1',
      active_service_principals: '1',
    });
    const usage = await transaction(org, (tx) => usageReport(tx, new URLSearchParams()));
    expect(usage.metrics.find((m) => m.name === 'requests')?.value).toBe('1');
    for (const group_by of ['day', 'hour', 'organization', 'model', 'provider', 'harness', 'billing_mode']) {
      const grouped = await transaction(org, (tx) => usageReport(tx, new URLSearchParams({ group_by })));
      expect(grouped.filters.group_by).toBe(group_by);
    }
    const policy = await transaction(null, async (tx) => ({
      raw: (await tx.query('SELECT count(*)::text AS n FROM actor_activity')).rows[0].n,
      reported: (
        await tx.query('SELECT count(*)::text AS n FROM reporting.activity WHERE organization_id=$1', [org])
      ).rows[0].n,
    }));
    expect(policy.raw).toBe('0');
    expect(policy.reported).toBe('3');
    expect(
      (await pool.query("SELECT pg_has_role(current_user,'platform_reporting','MEMBER') AS member")).rows[0]
        .member,
    ).toBe(false);
  });
  it('serves read-only tools with a separate operator audience and revocable service authorization', async () => {
    const clientId = `operator-fixture-${id()}`,
      secret = crypto.randomUUID() + crypto.randomUUID();
    await pool.query(
      `INSERT INTO auth."oauthClient"(id,"clientId","clientSecret",name,scopes,"redirectUris","tokenEndpointAuthMethod","applicationType","grantTypes","responseTypes",disabled,"skipConsent","createdAt","updatedAt") VALUES($1,$2,$3,'Operator fixture',$4,'[]','client_secret_post','web','["client_credentials"]','[]',false,false,now(),now())`,
      [id(), clientId, seal(secret), JSON.stringify(['metrics:read', 'operations:read'])],
    );
    await pool.query('UPDATE auth."oauthClient" SET "clientCredentialsScopes"=scopes WHERE "clientId"=$1', [
      clientId,
    ]);
    for (const suffix of ['/admin/mcp', '/admin/v1'])
      await pool.query(
        'INSERT INTO auth."oauthClientResource"(id,"clientId","resourceId","createdAt") VALUES($1,$2,$3,now())',
        [id(), clientId, config.origin + suffix],
      );
    await pool.query('INSERT INTO service_clients(client_id,scopes) VALUES($1,$2)', [
      clientId,
      ['metrics:read', 'operations:read'],
    ]);
    const issue = async (resource: string) =>
      await auth.api.oauth2Token({
        body: {
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: secret,
          scope: 'metrics:read operations:read',
          resource,
        },
      });
    const token = await issue(`${config.origin}/admin/mcp`);
    const mcp = new McpClient({ name: 'Operator fixture', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${config.origin}/admin/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } },
      fetch: async (url, init) => handleAdminMcp(new Request(url, init)),
    });
    try {
      await mcp.connect(transport);
      const tools = await mcp.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);
      expect(
        tools.tools.every(
          (t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false,
        ),
      ).toBe(true);
      const growthTool = tools.tools.find((t) => t.name.includes('growth'))!;
      expect(growthTool).toBeTruthy();
      const result = await mcp.callTool({ name: growthTool.name, arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toHaveProperty('metrics');
      expect(JSON.stringify(result)).not.toContain('@example.test');
      await pool.query('UPDATE service_clients SET enabled=false WHERE client_id=$1', [clientId]);
      await expect(mcp.listTools()).rejects.toThrow();
    } finally {
      await mcp.close();
    }
    const other = await issue(`${config.origin}/admin/v1`);
    const wrongAudience = await handleAdminMcp(
      new Request(`${config.origin}/admin/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${other.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(wrongAudience.status).toBe(401);
  });
});
