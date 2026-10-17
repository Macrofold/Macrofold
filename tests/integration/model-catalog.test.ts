import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authPool, credentialPool, pool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import {
  cachedModels,
  models,
  refreshModelCatalog,
  refreshExpiredOpenRouterCatalog,
  type CatalogCacheRow,
  type ModelCatalogSource,
} from '../../packages/core/src/model-catalog';
import { type DiscoveredModel, modelProviders } from '../../packages/core/src/model-policy';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { Macrofold } from '../../sdk/typescript/src/index';
import { handleApi } from '../../packages/core/src/http';
import { credit } from '../../packages/core/src/ledger';
import { getRun } from '../../packages/core/src/runs';
import { advanceCloudRun } from '../../packages/core/src/cloud-engine';
import { FaultMachine } from '../fixtures/cloud-machine';
import { runtimeToken } from '../../packages/core/src/runtime-auth';
import { handleModelRequest, settleOrphanModelRequests } from '../../packages/core/src/model-gateway';
import { id } from '../../packages/core/src/crypto';

const original = { ...config };
const routed = (price = '0.00000075'): DiscoveredModel[] => [
  {
    id: 'openai/gpt-5.4-mini',
    name: 'Routed fixture',
    tools: true,
    context_tokens: 128000,
    output_tokens: 8192,
    text: true,
    pricing: { prompt: price, completion: '0.0000045', request: '0' },
  },
];
function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
beforeEach(async () => {
  await pool.query(
    'UPDATE model_catalog_cache SET models=NULL,fetched_at=NULL,refresh_after=now(),refresh_token=NULL,last_error=NULL',
  );
});
afterEach(async () => {
  Object.assign(config, original);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Catalog metadata is shared across tenants; do not leak snapshots or due refreshes into other suites.
  await pool.query(
    "UPDATE model_catalog_cache SET models=NULL,fetched_at=NULL,refresh_after=now()+interval '1 day',refresh_token=NULL,last_error=NULL",
  );
});
afterAll(async () => {
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
});

it('reads built-in defaults without environment JSON or discovery and leaves simulation free', async () => {
  expect(await models()).toMatchObject([{ id: 'fixture-model', enabled: true, simulated: true }]);
  config.execution = 'docker';
  expect((await models()).filter((model) => model.enabled).map((model) => model.id)).toEqual([
    'gpt-5.4-mini',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ]);
  expect(
    (await pool.query('SELECT fetched_at FROM model_catalog_cache')).rows.every(
      (row) => row.fetched_at === null,
    ),
  ).toBe(true);
});

it('coordinates concurrent refreshers without holding a connection through discovery', async () => {
  const entered = barrier(),
    gate = barrier();
  const source = vi.fn<ModelCatalogSource>(async (provider) => {
    if (provider === 'openai') {
      entered.release();
      await gate.promise;
    }
    return provider === 'openrouter' ? routed() : [{ id: 'model', name: 'Fixture' }];
  });
  const first = refreshModelCatalog(source);
  await entered.promise;
  try {
    expect((await refreshModelCatalog(source)).model_catalog_refreshed).toBe(2);
  } finally {
    gate.release();
  }
  expect((await first).model_catalog_refreshed).toBe(1);
  for (const provider of modelProviders)
    expect(source.mock.calls.filter(([called]) => called === provider)).toHaveLength(1);
  expect((await refreshModelCatalog(source)).model_catalog_refreshed).toBe(0);
});

it('retains complete snapshots on failure, sanitizes errors, and retries only after backoff', async () => {
  await refreshModelCatalog(async (provider) => (provider === 'openrouter' ? routed() : []));
  await pool.query("UPDATE model_catalog_cache SET refresh_after=now() WHERE provider='openrouter'");
  const failing = vi.fn<ModelCatalogSource>(async () => {
    throw new Error('private-key-provider-error');
  });
  expect(await refreshModelCatalog(failing)).toEqual({ model_catalog_refreshed: 0, model_catalog_failed: 1 });
  const cached = (await pool.query("SELECT * FROM model_catalog_cache WHERE provider='openrouter'")).rows[0];
  expect(cached.models).toEqual(routed());
  expect(cached.last_error).toBe('discovery_failed');
  expect(cached.refresh_after.getTime()).toBeGreaterThan(Date.now() + 290000);
  await refreshModelCatalog(failing);
  expect(failing).toHaveBeenCalledTimes(1);
});

it('recovers an expired claim and fences a late response from the replaced worker', async () => {
  await pool.query(
    "UPDATE model_catalog_cache SET refresh_after=now()+interval '1 day' WHERE provider<>'openrouter'",
  );
  const entered = barrier(),
    gate = barrier();
  const first = refreshModelCatalog(async () => {
    entered.release();
    await gate.promise;
    return routed();
  });
  await entered.promise;
  try {
    await pool.query(
      "UPDATE model_catalog_cache SET refresh_after=now()-interval '1 second' WHERE provider='openrouter'",
    );
    expect((await refreshModelCatalog(async () => routed('0.000002'))).model_catalog_refreshed).toBe(1);
  } finally {
    gate.release();
  }
  expect((await first).model_catalog_refreshed).toBe(0);
  expect(
    (await pool.query("SELECT models FROM model_catalog_cache WHERE provider='openrouter'")).rows[0].models,
  ).toEqual(routed('0.000002'));
});

it('disables stale dynamic prices and honors a complete empty provider response', async () => {
  config.execution = 'docker';
  await refreshModelCatalog(async (provider) => (provider === 'openrouter' ? routed() : []));
  expect((await models()).filter((model) => model.enabled).map((model) => model.id)).toEqual([
    'openai/gpt-5.4-mini',
  ]);
  const rows = (await pool.query<CatalogCacheRow>('SELECT * FROM model_catalog_cache')).rows;
  const snapshot = rows.find((row) => row.provider === 'openrouter')!;
  const enabledAt = (now: number) =>
    cachedModels(rows, now).find((model) => model.provider === 'openrouter')?.enabled;
  expect(enabledAt(snapshot.fetched_at!.getTime() + 86400000 - 1)).toBe(true);
  expect(enabledAt(snapshot.fetched_at!.getTime() + 86400000)).toBe(false);
  snapshot.fetched_at = null;
  expect(enabledAt(Date.now())).toBe(false);
  await pool.query(
    "UPDATE model_catalog_cache SET fetched_at=now()-interval '25 hours' WHERE provider='openrouter'",
  );
  expect((await models()).every((model) => !model.enabled)).toBe(true);
});

it('rejects duplicate or malformed snapshots instead of replacing the last complete catalog', async () => {
  await refreshModelCatalog(async (provider) => (provider === 'openrouter' ? routed() : []));
  await pool.query("UPDATE model_catalog_cache SET refresh_after=now() WHERE provider='openrouter'");
  expect((await refreshModelCatalog(async () => [...routed(), ...routed()])).model_catalog_failed).toBe(1);
  config.execution = 'docker';
  expect((await models()).find((model) => model.id === 'openai/gpt-5.4-mini')?.enabled).toBe(true);
});

it('leaves fresh pricing and the free simulator independent of metadata requests', async () => {
  const source = vi.fn<ModelCatalogSource>(async () => routed());
  await refreshExpiredOpenRouterCatalog(source);
  expect(source).not.toHaveBeenCalled();
  config.execution = 'docker';
  await refreshModelCatalog(async () => routed(), ['openrouter']);
  await refreshExpiredOpenRouterCatalog(source);
  expect(source).not.toHaveBeenCalled();
});

it('cancels request-owned discovery without retaining its full maintenance lease or saving a late snapshot', async () => {
  config.execution = 'docker';
  const entered = barrier();
  const abort = new AbortController();
  const deadlineAtMs = Date.now() + 2000;
  const reason = new Error('Synthetic catalog preparation deadline');
  const source: ModelCatalogSource = async (_provider, options) => {
    if (!options?.signal) throw new Error('Discovery must receive its request signal.');
    const signal = options.signal;
    entered.release();
    return new Promise<DiscoveredModel[]>((_resolve, reject) => {
      const stop = () => reject(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
    });
  };
  const pending = refreshExpiredOpenRouterCatalog(source, { deadlineAtMs, signal: abort.signal });
  const rejected = expect(pending).rejects.toBe(reason);
  await entered.promise;
  abort.abort(reason);
  await rejected;
  const row = (
    await pool.query<CatalogCacheRow>("SELECT * FROM model_catalog_cache WHERE provider='openrouter'")
  ).rows[0];
  expect(row.fetched_at).toBeNull();
  expect(row.models).toBeNull();
  expect(row.refresh_after.getTime()).toBeLessThanOrEqual(deadlineAtMs);
  expect(row.last_error).toBeNull();
});

it.each(['missing', 'expired', 'failed'] as const)(
  'repairs %s inference pricing without a worker, preserving failure backoff and admission checks',
  async (state) => {
    const account = await fixtureAccount('Direct inference catalog');
    const client = new Macrofold({
      apiKey: account.key,
      baseURL: config.origin,
      retries: 0,
      fetch: async (url, init) => handleApi(new Request(url, init)),
    });
    await transaction(account.p.organizationId, (tx) =>
      credit(tx, account.p.organizationId, 1000000n, `catalog:${id()}`),
    );
    Object.assign(config, { execution: 'docker', allowPaid: true });
    vi.stubEnv('OPENROUTER_API_KEY', 'fixture-only');
    if (state !== 'missing') {
      await refreshModelCatalog(async () => routed(), ['openrouter']);
      await pool.query(
        "UPDATE model_catalog_cache SET fetched_at=now()-interval '25 hours',refresh_after=now() WHERE provider='openrouter'",
      );
    }
    expect((await models()).find((m) => m.provider === 'openrouter')?.enabled).toBe(false);
    const metadata = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://openrouter.ai/api/v1/models');
      expect(init?.headers).toEqual({});
      if (state === 'failed') return new Response('upstream unavailable', { status: 503 });
      return Response.json({
        data: routed('0.000002').map((m) => ({
          id: m.id,
          name: m.name,
          pricing: m.pricing,
          context_length: m.context_tokens,
          top_provider: { max_completion_tokens: m.output_tokens },
          supported_parameters: ['tools'],
          architecture: { input_modalities: ['text'], output_modalities: ['text'] },
        })),
      });
    });
    const inference = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-only');
      return Response.json({
        id: 'catalog-inference-fixture',
        model: routed()[0].id,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Synthetic catalog reply.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      });
    });
    vi.stubGlobal('fetch', (url: Parameters<typeof fetch>[0], init?: RequestInit) =>
      String(url) === 'https://openrouter.ai/api/v1/models' ? metadata(url, init) : inference(url, init),
    );
    const submit = () =>
      handleApi(
        new Request(`${config.origin}/v1/inferences`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${account.key}`,
            'content-type': 'application/json',
            'idempotency-key': id(),
          },
          body: JSON.stringify({
            model_binding: {
              provider: 'openrouter',
              model: routed()[0].id,
              billing_mode: 'managed',
            },
            input: {
              messages: [{ role: 'user', content: 'Synthetic catalog check.' }],
              max_tokens: 32,
            },
            limits: { max_cost_micro_usd: '20000', max_output_tokens: 32, timeout_seconds: 20 },
          }),
        }),
      );
    try {
      // A second submission reuses fresh metadata or honors the failed refresh's backoff.
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await submit();
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(state === 'failed' ? 400 : 200);
        if (state === 'failed') {
          expect(body).toMatchObject({ error: { code: 'decision_model_unavailable' } });
        } else {
          const run = await transaction(account.p.organizationId, (tx) => getRun(tx, body.run_id));
          expect(body).toMatchObject({ status: 'succeeded', result: { inference: { outcome: 'value' } } });
          expect(run.config.rate_card).toMatchObject({ input_micro_usd_per_million: '2000000' });
        }
      }
      expect(metadata).toHaveBeenCalledTimes(1);
      expect(inference).toHaveBeenCalledTimes(state === 'failed' ? 0 : 2);
      expect((await client.billing.get()).reserved_micro_usd).toBe('0');
      if (state === 'failed') {
        const count = await transaction(account.p.organizationId, (tx) => tx.query('SELECT id FROM runs'));
        expect(count.rows).toHaveLength(0);
      }
    } finally {
      await retireFixtureRuns(account.p.organizationId);
    }
  },
);

it('freezes admitted prices through refresh, gateway settlement, cancellation, and persistence', async () => {
  const account = await fixtureAccount('Catalog prices');
  const client = new Macrofold({
    apiKey: account.key,
    baseURL: config.origin,
    retries: 0,
    fetch: async (url, init) => handleApi(new Request(url, init)),
  });
  await transaction(account.p.organizationId, (tx) =>
    credit(tx, account.p.organizationId, 10000000n, `catalog:${id()}`),
  );
  await refreshModelCatalog(async (provider) => (provider === 'openrouter' ? routed() : undefined));
  Object.assign(config, { execution: 'docker', orchestration: 'poller', allowPaid: true });
  vi.stubEnv('OPENROUTER_API_KEY', 'fixture-only');
  vi.stubEnv('COMPUTE_MICRO_USD_PER_MINUTE', '0');
  // Other suites retain synthetic active/background runs. Give this pricing journey
  // one free slot and interactive priority without bypassing the actual SQL scheduler.
  const active = (
    await pool.query(
      "SELECT count(*)::integer AS count FROM reporting.scheduling_runs WHERE status IN ('provisioning','running','waiting_for_input','persisting')",
    )
  ).rows[0].count;
  vi.stubEnv('GLOBAL_CONCURRENT_RUN_LIMIT', String(active + 1));
  const before = (await client.models.list()).data.find((model) => model.id === 'openai/gpt-5.4-mini');
  expect(before?.enabled).toBe(true);
  const workspace = await client.workspaces.create({ name: 'Rate snapshot' });
  const accepted = await client.runs.create({
    workspace_id: workspace.id,
    harness: 'opencode',
    model: 'openai/gpt-5.4-mini',
    billing_mode: 'managed',
    scheduling_class: 'interactive',
    prompt: 'Fixture',
    limits: { timeout_seconds: 60, max_cost_micro_usd: '2000000' },
  });
  await pool.query("UPDATE model_catalog_cache SET refresh_after=now() WHERE provider='openrouter'");
  await refreshModelCatalog(async () => routed('0.000003'));
  const after = (await client.models.list()).data.find((model) => model.id === 'openai/gpt-5.4-mini');
  expect(after).toMatchObject({ input_micro_usd_per_million: '3000000' });
  expect(after?.rate_card_version).not.toBe(before?.rate_card_version);
  const saved = () => transaction(account.p.organizationId, (tx) => getRun(tx, accepted.run_id));
  expect((await saved()).config.rate_card?.input_micro_usd_per_million).toBe('750000');
  const machine = new FaultMachine();
  for (let step = 0; step < 15; step++) {
    await advanceCloudRun(account.p.organizationId, accepted.run_id, machine);
    if ((await saved()).execution_binding?.phase === 'poll') break;
  }
  const run = await saved();
  expect(run.status).toBe('running');
  const capability = runtimeToken({
    organization: account.p.organizationId,
    run: run.id,
    lease: run.lease_generation,
    expires: Date.now() + 60000,
  });
  const request = () =>
    new Request(`${config.origin}/runtime/runs/${run.id}/model/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${capability}` },
      body: JSON.stringify({
        model: 'openai/gpt-5.4-mini',
        messages: [{ role: 'user', content: 'Fixture' }],
        max_tokens: 10,
      }),
    });
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-only');
    expect(JSON.parse(String(init?.body)).provider.max_price).toEqual({
      prompt: 0.75,
      completion: 4.5,
      request: 0,
    });
    return Response.json({ usage: { prompt_tokens: 100, completion_tokens: 10 }, choices: [] });
  });
  expect((await handleModelRequest(request(), run.id, 'v1/chat/completions', transport)).status).toBe(200);
  expect((await saved()).cost_micro_usd).toBe('120');
  await client.runs.cancel(run.id);
  for (let step = 0; step < 60; step++)
    if ((await advanceCloudRun(account.p.organizationId, run.id, machine)).done) break;
  expect(await client.runs.get(run.id)).toMatchObject({
    status: 'cancelled',
    persistence_status: 'verified',
    cost_micro_usd: '120',
  });
  expect((await client.billing.get()).reserved_micro_usd).toBe('0');
  expect(machine.starts).toBe(1);
  expect(transport).toHaveBeenCalledTimes(1);
  // Reconciliation must never obtain substitute prices for a missing accepted rate card.
  await transaction(account.p.organizationId, async (tx) => {
    await tx.query("UPDATE runs SET config=config-'rate_card' WHERE id=$1", [run.id]);
    await tx.query("UPDATE gateway_requests SET status='in_flight' WHERE run_id=$1", [run.id]);
  });
  await expect(settleOrphanModelRequests(account.p.organizationId, run.id)).rejects.toMatchObject({
    code: 'rate_card_unavailable',
  });
});
