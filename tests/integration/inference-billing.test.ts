import { afterAll, expect, it } from 'vitest';
import { pool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import { emptyUsage } from '../../packages/core/src/model-protocol';
import {
  inferenceBilling,
  inferenceUsage,
  settleModelRequest,
  settleModelRequestInTransaction,
} from '../../packages/core/src/model-gateway';
import type { RuntimeCapability } from '../../packages/core/src/runtime-auth';

const model = {
  id: 'fixture-accounted',
  name: 'Accounting fixture',
  provider: 'typesafe',
  harnesses: [],
  enabled: true,
  input_micro_usd_per_million: '1000000',
  output_micro_usd_per_million: '2000000',
};
const providerModel = { ...model, input_micro_usd_per_million: '500000' };
const completeUsage = {
  input: 10,
  output: 3,
  cached: 2,
  cacheWrite: 0,
  complete: true,
  providerReportedCostUsd: 0.00001234,
  upstreamInferenceCostUsd: 0.00001,
};
const fixtureOrganizations: string[] = [];
afterAll(async () => {
  for (const organization of fixtureOrganizations)
    await transaction(organization, (tx) =>
      tx.query("UPDATE runs SET status='cancelled',completed_at=now() WHERE completed_at IS NULL"),
    );
  await pool.end();
});
async function fixture(billingMode: 'managed' | 'byok' = 'managed') {
  const organization = id(),
    run = id(),
    request = id();
  fixtureOrganizations.push(organization);
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [organization, 'Settlement fixture']);
  await transaction(organization, async (tx) => {
    const workspace = await resources.create(tx, 'workspaces', organization, { name: 'Settlement fixture' });
    await tx.query(
      `INSERT INTO runs(id,organization_id,workspace_id,kind,status,config,model_reserved_micro_usd)
       VALUES($1,$2,$3,'inference','running',$4,1000)`,
      [run, organization, workspace.id, { executor_version: '1', definition: {}, context: {} }],
    );
    await tx.query(
      `INSERT INTO gateway_requests(id,organization_id,run_id,lease_generation,model,provider,billing_mode,status,reserved_micro_usd)
       VALUES($1,$2,$3,1,$4,$5,$6,'in_flight',1000)`,
      [request, organization, run, model.id, model.provider, billingMode],
    );
  });
  const cap: RuntimeCapability = {
    purpose: 'runtime',
    organization,
    run,
    lease: '1',
    expires: Date.now() + 60_000,
  };
  const state = () =>
    transaction(organization, async (tx) => ({
      run: (
        await tx.query(
          'SELECT cost_micro_usd,budget_used_micro_usd,model_reserved_micro_usd,result,status FROM runs WHERE id=$1',
          [run],
        )
      ).rows[0],
      request: (await tx.query('SELECT status,actual_micro_usd FROM gateway_requests WHERE id=$1', [request]))
        .rows[0],
      usage: (await tx.query('SELECT * FROM model_usage WHERE request_id=$1', [request])).rows,
      events: (await tx.query("SELECT type FROM run_events WHERE run_id=$1 AND type='usage.updated'", [run]))
        .rows,
    }));
  return { organization, run, request, cap, state };
}
it('rolls back model settlement with a failed enclosing finalization, then commits and replays it once', async () => {
  const f = await fixture();
  await expect(
    transaction(f.organization, async (tx) => {
      await settleModelRequestInTransaction(tx, f.cap, f.request, model, completeUsage, false, providerModel);
      await tx.query("UPDATE runs SET status='succeeded',result='{}' WHERE id=$1", [f.run]);
      throw new Error('Synthetic finalization failure');
    }),
  ).rejects.toThrow('Synthetic finalization failure');
  expect(await f.state()).toMatchObject({
    run: { status: 'running', cost_micro_usd: '0', model_reserved_micro_usd: '1000' },
    request: { status: 'in_flight', actual_micro_usd: null },
    usage: [],
    events: [],
  });
  const settled = await transaction(f.organization, async (tx) => {
    const billing = await settleModelRequestInTransaction(
      tx,
      f.cap,
      f.request,
      model,
      completeUsage,
      false,
      providerModel,
    );
    await tx.query("UPDATE runs SET status='succeeded',completed_at=now(),result=$2 WHERE id=$1", [
      f.run,
      { billing: inferenceBilling(billing, 'managed') },
    ]);
    return billing;
  });
  const replayed = await settleModelRequest(f.cap, f.request, model, emptyUsage(), false, providerModel);
  expect(replayed).toEqual(settled);
  expect(await f.state()).toMatchObject({
    run: {
      status: 'succeeded',
      cost_micro_usd: '16',
      budget_used_micro_usd: '16',
      model_reserved_micro_usd: '0',
    },
    request: { status: 'complete', actual_micro_usd: '16' },
    events: [{ type: 'usage.updated' }],
  });
  expect((await f.state()).usage).toHaveLength(1);
});
it('keeps BYOK customer charge zero while projecting budget, reported and estimated provider costs separately', async () => {
  const f = await fixture('byok');
  const settled = await settleModelRequest(f.cap, f.request, model, completeUsage, false, providerModel);
  expect(inferenceBilling(settled, 'byok')).toEqual({
    billing_mode: 'byok',
    charged_micro_usd: '0',
    budget_cost_micro_usd: '16',
    reserved_micro_usd: '1000',
    reported_micro_usd: '16',
    provisional: false,
    bound_breached: false,
    provider_cost_micro_usd: '11',
    provider_cost_status: 'estimated_from_usage',
    provider_reported_cost_usd: 0.00001234,
    provider_reported_cost_status: 'reported',
    upstream_inference_cost_usd: 0.00001,
  });
  expect((await f.state()).run.cost_micro_usd).toBe('0');
});
it('preserves independently known zero usage without releasing uncertain liability', async () => {
  const f = await fixture();
  const usage = { ...emptyUsage(), known: { output: true } };
  const settled = await settleModelRequest(f.cap, f.request, model, usage);
  expect(inferenceUsage(usage)).toEqual({
    input_tokens: null,
    output_tokens: '0',
    cached_input_tokens: null,
    cache_write_input_tokens: null,
    completeness: 'missing',
  });
  expect(inferenceBilling(settled, 'managed')).toMatchObject({
    charged_micro_usd: '1000',
    provisional: true,
  });
  expect((await f.state()).usage[0]).toMatchObject({
    input_tokens: null,
    output_tokens: '0',
    completeness: 'missing',
  });
});
it('does not settle a request using a different Run identity in the same tenant', async () => {
  const f = await fixture();
  expect(await settleModelRequest({ ...f.cap, run: id() }, f.request, model, completeUsage)).toBeUndefined();
  expect((await f.state()).request).toEqual({ status: 'in_flight', actual_micro_usd: null });
});
it('distinguishes proven uninvoked zero from an unreported provider outcome', () => {
  expect(inferenceUsage(emptyUsage(), true)).toMatchObject({
    input_tokens: '0',
    output_tokens: '0',
    completeness: 'complete',
  });
  expect(inferenceBilling(undefined, 'managed', true)).toMatchObject({
    charged_micro_usd: '0',
    budget_cost_micro_usd: '0',
    provisional: false,
  });
  expect(inferenceBilling(undefined, 'managed')).toMatchObject({
    charged_micro_usd: null,
    budget_cost_micro_usd: null,
    provisional: true,
  });
});
