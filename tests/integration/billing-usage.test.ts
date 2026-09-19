import { afterAll, beforeAll, expect, it } from 'vitest';
import { authPool, pool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { fixtureHttpApi } from '../fixtures/http-api';
import { ensureCustomerAgent } from '../../packages/core/src/customer-agents';
import { admitRun, getRun } from '../../packages/core/src/runs';
import { credit, reserve, settle } from '../../packages/core/src/ledger';
import { createKey } from '../../packages/core/src/keys';
import { id } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import type { components } from '../../packages/contracts/api';
import { Macrofold } from '../../sdk/typescript/src/index';

type Page = components['schemas']['BillingUsagePage'];
let api: Awaited<ReturnType<typeof fixtureHttpApi>>;
let account: Awaited<ReturnType<typeof fixtureAccount>>;
let foreign: Awaited<ReturnType<typeof fixtureAccount>>;
let workspace: string, worktree: string, run: string, missing: string, byok: string;
const window = { from: '2020-01-01T00:00:00Z', to: '2040-01-01T00:00:00Z' };
async function read(filters: Record<string, string> = {}, key = account.key) {
  return fetch(`${api.origin}/v1/billing/usage?${new URLSearchParams({ ...window, ...filters })}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
}
async function page(filters: Record<string, string> = {}): Promise<Page> {
  const response = await read(filters);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body;
}
beforeAll(async () => {
  api = await fixtureHttpApi();
  account = await fixtureAccount('Billing detail');
  foreign = await fixtureAccount('Other billing tenant');
  const p = account.p;
  await transaction(p.organizationId, async (tx) => {
    await credit(tx, p.organizationId, 10000000n, `fixture:${id()}`);
    const binding = await ensureCustomerAgent(tx, p, 'billing-customer', {
      key: 'assistant',
      name: 'Billing assistant',
      configuration: {
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
        limits: { max_cost_micro_usd: '2000000', timeout_seconds: 900 },
      },
    });
    workspace = binding.workspace_id;
    worktree = binding.worktree_id;
    run = (
      await admitRun(tx, p, {
        worktree_id: worktree,
        agent_id: binding.agent_id,
        prompt: 'PRIVATE billing fixture prompt',
      })
    ).run_id;
    const connection = await resources.create(tx, 'connections', p.organizationId, {
      name: 'Billing tool',
      kind: 'mcp_remote',
    });
    for (const [amount, completeness, details, at] of [
      [
        '100',
        'complete',
        {
          cached_tokens: 20,
          cache_write_tokens: 5,
          reported_micro_usd: '100',
          provider_cost_micro_usd: '70',
          provider_cost_status: 'estimated_from_usage',
        },
        '2026-09-18T12:00:00Z',
      ],
      ['60', 'missing', { provisional: true, bound_breached: false }, '2026-09-19T12:00:00Z'],
    ] as const) {
      const usageId = id();
      if (completeness === 'missing') missing = usageId;
      await tx.query(
        `INSERT INTO model_usage(id,organization_id,run_id,request_id,provider,model,billing_mode,input_tokens,output_tokens,cost_micro_usd,completeness,usage_details,created_at)
        VALUES($1::uuid,$2,$3,$1::text,'openrouter','typesafe/jev-1.13','managed',$4,$5,$6,$7,$8,$9)`,
        [
          usageId,
          p.organizationId,
          run,
          completeness === 'complete' ? '100' : null,
          completeness === 'complete' ? '10' : null,
          amount,
          completeness,
          JSON.stringify(details),
          at,
        ],
      );
    }
    await tx.query(
      `INSERT INTO tool_invocations(id,organization_id,run_id,connection_id,call_key,fingerprint,tool_name,status,cost_micro_usd)
      VALUES($1,$2,$3,$4,'one','fixture','search','complete',20)`,
      [id(), p.organizationId, run, connection.id],
    );
    // Simulator admission is free. Add a matching reservation for these
    // synthetic managed usage/compute facts before exercising real settlement.
    await reserve(tx, p.organizationId, 260n);
    await tx.query('UPDATE runs SET reservation_micro_usd=260 WHERE id=$1', [run]);
    await settle(tx, p.organizationId, run, 260n, 260n);
    await tx.query("UPDATE runs SET status='succeeded',completed_at=now(),cost_micro_usd=260 WHERE id=$1", [
      run,
    ]);
    const second = await admitRun(tx, p, {
      workspace_id: workspace,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'PRIVATE second',
    });
    byok = second.run_id;
    await tx.query(`UPDATE runs SET config=jsonb_set(config,'{billing_mode}','"byok"') WHERE id=$1`, [byok]);
    await tx.query(
      `INSERT INTO model_usage(id,organization_id,run_id,request_id,provider,model,billing_mode,input_tokens,output_tokens,cost_micro_usd,completeness,usage_details)
      VALUES($1::uuid,$2,$3,$1::text,'openrouter','typesafe/jev-1.13','byok',120,30,150,'complete','{"provider_cost_micro_usd":"90","provider_cost_status":"estimated_from_usage"}')`,
      [id(), p.organizationId, byok],
    );
    await settle(tx, p.organizationId, byok, BigInt((await getRun(tx, byok)).reservation_micro_usd), 0n);
    await tx.query("UPDATE runs SET status='succeeded',completed_at=now() WHERE id=$1", [byok]);
    // Financial fixtures must not remain eligible for another suite's scheduler.
    await tx.query("UPDATE dispatch_jobs SET state='done' WHERE organization_id=$1", [p.organizationId]);
    await tx.query(
      `INSERT INTO storage_usage(id,organization_id,observed_at,physical_bytes,object_count,charged_micro_usd) VALUES($1,$2,now(),1234,2,5)`,
      [id(), p.organizationId],
    );
  });
});
afterAll(async () => {
  await api?.close();
  await pool.end();
  await authPool.end();
});

it('returns exact disjoint charges and detailed tokens through the actual HTTP API and typed SDK', async () => {
  const client = new Macrofold({ baseURL: api.origin, apiKey: account.key });
  const result = await client.billing.listUsage(window);
  expect(result.currency).toBe('USD');
  expect(result.next_cursor).toBeNull();
  expect(result.data).toHaveLength(6);
  expect(result.data.reduce((sum, row) => sum + BigInt(row.charged_micro_usd || '0'), 0n)).toBe(265n);
  expect(result.data.find((r) => r.kind === 'compute')).toMatchObject({
    run_id: run,
    charged_micro_usd: '80',
  });
  expect(result.data.find((r) => r.kind === 'model' && r.charged_micro_usd === '100')).toMatchObject({
    workspace_id: workspace,
    worktree_id: worktree,
    customer_id: 'billing-customer',
    agent_key: 'assistant',
    model_usage: {
      input_tokens: '100',
      output_tokens: '10',
      cached_input_tokens: '20',
      cache_write_input_tokens: '5',
      provisional: false,
      provider_cost_micro_usd: '70',
    },
  });
  expect(result.data.find((r) => r.id === missing)?.model_usage).toMatchObject({
    input_tokens: null,
    output_tokens: null,
    cached_input_tokens: null,
    provisional: true,
  });
  expect(result.data.find((r) => r.run_id === byok)).toMatchObject({
    charged_micro_usd: '0',
    billing_mode: 'byok',
    model_usage: { budget_cost_micro_usd: '150', provider_cost_micro_usd: '90' },
  });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('paginates without duplicates and filters time with inclusive start and exclusive end', async () => {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const result = await page({ limit: '2', ...(cursor ? { cursor } : {}) });
    ids.push(...result.data.map((r) => r.id));
    cursor = result.next_cursor;
  } while (cursor);
  expect(ids).toHaveLength(6);
  expect(new Set(ids).size).toBe(6);
  const result = await page({
    from: '2026-09-18T08:00:00-04:00',
    to: '2026-09-19T12:00:00Z',
    kind: 'model',
    run_id: run,
  });
  expect(result.data).toHaveLength(1);
  expect(result.data[0].charged_micro_usd).toBe('100');
  expect(
    (await page({ from: '2026-09-18T12:00:00.000001Z', to: '2026-09-18T12:00:00.000002Z', kind: 'model' }))
      .data,
  ).toEqual([]);
});
it('combines exact filters without attributing organization storage to a customer or model', async () => {
  expect((await page({ workspace_id: workspace })).data).toHaveLength(5);
  expect(
    (
      await page({
        worktree_id: worktree,
        customer_id: 'billing-customer',
        agent_key: 'assistant',
        run_id: run,
      })
    ).data,
  ).toHaveLength(4);
  expect(
    (await page({ billing_mode: 'byok', provider: 'openrouter', model: 'typesafe/jev-1.13' })).data,
  ).toHaveLength(1);
  expect((await page({ kind: 'storage' })).data[0]).toMatchObject({
    run_id: null,
    storage: { physical_bytes: '1234', object_count: '2' },
  });
  expect((await page({ kind: 'storage', workspace_id: workspace })).data).toEqual([]);
  expect((await page({ customer_id: 'unrelated' })).data).toEqual([]);
  expect((await page({ session_id: id() })).data).toEqual([]);
});
it('enforces tenant, scope, revocation and workspace restrictions at the transport boundary', async () => {
  const other = await read({ run_id: run }, foreign.key);
  expect(other.status).toBe(200);
  expect((await other.json()).data).toEqual([]);
  for (const options of [{ scopes: ['workspaces:read'] }, { scopes: ['usage:read'], workspace_id: workspace }]) {
    const key = await transaction(account.p.organizationId, (tx) =>
      createKey(tx, account.p, { name: 'Restricted billing', ...options }),
    );
    expect((await read({}, key.secret)).status).toBe(403);
  }
  expect((await fetch(`${api.origin}/v1/billing/usage?${new URLSearchParams(window)}`)).status).toBe(401);
  const key = await transaction(account.p.organizationId, (tx) =>
    createKey(tx, account.p, { name: 'Revoked billing', scopes: ['usage:read'] }),
  );
  expect((await read({}, key.secret)).status).toBe(200);
  await transaction(account.p.organizationId, (tx) =>
    tx.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [key.id]),
  );
  expect((await read({}, key.secret)).status).toBe(401);
});
it.each<Record<string, string>>([
  { from: '' },
  { from: 'not-a-date' },
  { from: window.to },
  { to: window.from },
  { from: '2026-09-18T12:00:00.000002Z', to: '2026-09-18T12:00:00.000001Z' },
  { limit: '101' },
  { cursor: 'invalid' },
  { kind: 'invoice' },
  { workspace_id: 'invalid' },
])('rejects invalid billing queries %j', async (filters) => {
  expect((await read(filters)).status).toBe(400);
});
