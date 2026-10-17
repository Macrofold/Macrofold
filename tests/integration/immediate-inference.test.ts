import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import * as database from '../../packages/db';
import type { Tx, TransactionOptions } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { id } from '../../packages/core/src/crypto';
import { credit } from '../../packages/core/src/ledger';
import { handleApi } from '../../packages/core/src/http';
import { advanceInference } from '../../packages/core/src/inference-engine';
import { dispatchCloudPoller } from '../../packages/core/src/portable-dispatch';
import { cancelRun, getRun } from '../../packages/core/src/runs';
import { expireDetailedHistory } from '../../packages/core/src/deletion';
import * as gateway from '../../packages/core/src/model-gateway';
import { AppError } from '../../packages/core/src/errors';
import { storedContextReader } from '../../packages/core/src/context-artifacts';
import type { ExplicitContext } from '../../packages/core/src/decision';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { fixtureHttpApi } from '../fixtures/http-api';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
const originalPaid = config.allowPaid;
const backgroundTasks = new Set<Promise<void>>();
beforeAll(async () => {
  account = await fixtureAccount('Immediate inference fault fixture');
  await database.transaction(account.p.organizationId, (tx) =>
    credit(tx, account.p.organizationId, 10_000_000n, `fault-fixture:${id()}`),
  );
});
afterEach(async () => {
  try {
    await Promise.allSettled(backgroundTasks);
    backgroundTasks.clear();
    vi.restoreAllMocks();
    const active = await database.transaction(account.p.organizationId, async (tx) => {
      const rows = (
        await tx.query<{ id: string }>(
          "SELECT id FROM runs WHERE status IN ('running','provisioning','persisting')",
        )
      ).rows;
      await tx.query(
        "UPDATE runs SET cancel_requested=true,deadline=now()-interval '31 seconds' WHERE id=ANY($1::uuid[])",
        [rows.map((row) => row.id)],
      );
      return rows;
    });
    for (const run of active) await advanceInference(account.p.organizationId, run.id);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    config.allowPaid = originalPaid;
    await retireFixtureRuns(account.p.organizationId);
  }
});
afterAll(async () => {
  await Promise.all([database.pool.end(), database.authPool.end(), database.credentialPool.end()]);
});

function input() {
  return {
    model_binding: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', billing_mode: 'managed' },
    input: { messages: [{ role: 'user', content: 'Reply with a greeting.' }] },
    limits: { max_cost_micro_usd: '50000', max_output_tokens: 32, timeout_seconds: 20 },
  };
}
function enable() {
  config.allowPaid = true;
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-immediate-key');
}
function retainBackground(task: () => Promise<void>) {
  const pending = Promise.resolve().then(task);
  backgroundTasks.add(pending);
  void pending.finally(() => backgroundTasks.delete(pending)).catch(() => {});
}
function providerResponse() {
  return Response.json(
    {
      id: 'fixture-provider-request',
      type: 'message',
      model: 'claude-haiku-4-5-20251001',
      content: [{ type: 'text', text: 'Hello from the fixture.' }],
      usage: { input_tokens: 100, output_tokens: 10 },
    },
    { headers: { 'request-id': 'fixture-provider-request' } },
  );
}
async function post(identity = id()) {
  enable();
  // These faults target admitted work. A contended fixture host can refuse the
  // one-second admission budget; retry only its explicit safe refusal, same key.
  for (let attempt = 0; ; attempt++) {
    const response = await handleApi(
      new Request(`${config.origin}/v1/inferences`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${account.key}`,
          'content-type': 'application/json',
          'idempotency-key': identity,
        },
        body: JSON.stringify(input()),
      }),
      'rest',
      retainBackground,
    );
    if (attempt >= 2 || response.status !== 503) return response;
    if ((await response.clone().json()).error?.code !== 'inference_admission_timeout') return response;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
async function facts(runId: string) {
  return database.transaction(account.p.organizationId, async (tx) => ({
    run: await getRun(tx, runId),
    invocations: (
      await tx.query<{
        state: string;
        body_ciphertext: string;
        response_ciphertext: string | null;
        provider_completed_at: Date | null;
      }>(
        'SELECT state,body_ciphertext,response_ciphertext,provider_completed_at FROM decision_invocations WHERE run_id=$1',
        [runId],
      )
    ).rows,
    gateway: (
      await tx.query<{ status: string }>('SELECT status FROM gateway_requests WHERE run_id=$1', [runId])
    ).rows,
    usage: (
      await tx.query<{
        input_tokens: string | null;
        output_tokens: string | null;
        cost_micro_usd: string | null;
      }>('SELECT input_tokens,output_tokens,cost_micro_usd FROM model_usage WHERE run_id=$1', [runId])
    ).rows,
  }));
}
async function onlyActiveRun() {
  const result = await database.transaction(account.p.organizationId, (tx) =>
    tx.query<{ id: string }>("SELECT id FROM runs WHERE status='running' ORDER BY created_at DESC LIMIT 1"),
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0].id;
}
function heldProvider() {
  let announce!: () => void, resolve!: (response: Response) => void;
  const started = new Promise<void>((done) => {
    announce = done;
  });
  const response = new Promise<Response>((done) => {
    resolve = done;
  });
  const fetch = vi.fn(async () => {
    announce();
    return response;
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, started, resolve };
}
async function waitForProvider(provider: ReturnType<typeof heldProvider>, pending: Promise<Response>) {
  const early = await Promise.race([provider.started, pending]);
  if (early)
    throw new Error(`Request finished before reaching the provider: ${early.status} ${await early.text()}`);
}

async function recoverThroughCloudPoller(runId: string, expireOwner = false) {
  await database.transaction(account.p.organizationId, async (tx) => {
    if (expireOwner)
      await tx.query("UPDATE runs SET deadline=now()-interval '31 seconds' WHERE id=$1", [runId]);
    await tx.query(
      "UPDATE dispatch_jobs SET available_at=now()-interval '1 second' WHERE kind='run' AND resource_id=$1",
      [runId],
    );
  });
  const machine = vi.fn(() => {
    throw new Error('Inference recovery must not construct native compute.');
  });
  const progress = await dispatchCloudPoller(machine, 1, account.p.organizationId);
  expect(progress).toMatchObject({ advanced: 1, failed: 0 });
  expect(machine).not.toHaveBeenCalled();
}

it('preserves response evidence through settlement failure and recovers without another provider request', async () => {
  const fetch = vi.fn(async () => providerResponse());
  vi.stubGlobal('fetch', fetch);
  const fault = vi
    .spyOn(gateway, 'settleModelRequestInTransaction')
    .mockRejectedValueOnce(
      new AppError(503, 'fixture_settlement_unavailable', 'Synthetic settlement outage'),
    );
  const response = await post();
  fault.mockRestore();
  expect(response.status, await response.clone().text()).toBe(202);
  const receipt = await response.json();
  expect(receipt.recovery_reason).toBe('finalization_pending');
  const before = await facts(receipt.run_id);
  expect(before.invocations).toHaveLength(1);
  expect(before.invocations[0]).toMatchObject({
    state: 'responded',
    response_ciphertext: expect.any(String),
    provider_completed_at: expect.any(Date),
  });
  expect(before.gateway).toEqual([{ status: 'in_flight' }]);
  expect(before.usage).toHaveLength(0);
  await recoverThroughCloudPoller(receipt.run_id);
  const after = await facts(receipt.run_id);
  expect(after.run.status).toBe('succeeded');
  expect(after.run.cost_micro_usd).toBe('150');
  expect(after.usage).toEqual([{ input_tokens: '100', output_tokens: '10', cost_micro_usd: '150' }]);
  expect(fetch).toHaveBeenCalledOnce();
  await advanceInference(account.p.organizationId, receipt.run_id);
  expect((await facts(receipt.run_id)).usage).toHaveLength(1);
});

it('publishes a timely complete response when settlement crosses the execution deadline', async () => {
  const fetch = vi.fn(async () => providerResponse());
  vi.stubGlobal('fetch', fetch);
  const settle = gateway.settleModelRequestInTransaction;
  const delayed = vi
    .spyOn(gateway, 'settleModelRequestInTransaction')
    .mockImplementation(async (tx, ...args) => {
      // B has already committed its completion timestamp. Make E just after that
      // timestamp, then cross E in PostgreSQL rather than faking the JS clock.
      await tx.query(
        `UPDATE runs SET deadline=i.provider_completed_at+interval '1 millisecond'
      FROM decision_invocations i WHERE runs.id=i.run_id AND i.id=$1`,
        [args[1]],
      );
      await tx.query('SELECT pg_sleep(0.01)');
      return settle(tx, ...args);
    });
  const response = await post();
  delayed.mockRestore();
  expect(response.status, await response.clone().text()).toBe(200);
  const receipt = await response.json();
  expect(receipt.status).toBe('succeeded');
  expect(receipt.result.inference.outcome).toBe('value');
  expect(receipt.result.inference.billing.charged_micro_usd).toBe('150');
  const saved = await facts(receipt.run_id);
  expect(saved.run.status).toBe('succeeded');
  expect(saved.usage).toHaveLength(1);
  expect(fetch).toHaveBeenCalledOnce();
});

it('lets a cancelled live owner preserve known usage before recovery finalizes it', async () => {
  const provider = heldProvider();
  const pending = post();
  try {
    await waitForProvider(provider, pending);
    const runId = await onlyActiveRun();
    await database.transaction(account.p.organizationId, (tx) => cancelRun(tx, account.p, runId));
    expect((await advanceInference(account.p.organizationId, runId)).done).toBe(false);
    expect((await facts(runId)).gateway).toEqual([{ status: 'in_flight' }]);
    provider.resolve(providerResponse());
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'cancelled',
      result: {
        inference: {
          outcome: 'failed',
          usage: { input_tokens: '100', output_tokens: '10' },
          billing: { charged_micro_usd: '150' },
        },
      },
    });
    const saved = await facts(runId);
    expect(saved.usage).toEqual([{ input_tokens: '100', output_tokens: '10', cost_micro_usd: '150' }]);
    expect(saved.run.result.inference).not.toHaveProperty('value');
    expect(provider.fetch).toHaveBeenCalledOnce();
  } finally {
    provider.resolve(providerResponse());
    await pending;
  }
});

it.each(['admission', 'response', 'completion'] as const)(
  'recovers a lost %s commit acknowledgment with the original identity',
  async (boundary) => {
    const fetch = vi.fn(async () => providerResponse());
    vi.stubGlobal('fetch', fetch);
    const original = database.transaction;
    let injected = false;
    const fault = vi.spyOn(database, 'transaction').mockImplementation(async function <T>(
      organization: string | null,
      fn: (tx: Tx) => Promise<T>,
      options?: TransactionOptions,
    ): Promise<T> {
      const result = await original(organization, fn, options);
      if (!injected && result && typeof result === 'object') {
        const matches =
          boundary === 'admission'
            ? 'body' in result && result.body && typeof result.body === 'object' && 'run_id' in result.body
            : boundary === 'response'
              ? 'state' in result && result.state === 'responded' && 'response_ciphertext' in result
              : 'run' in result &&
                'receipt' in result &&
                result.run &&
                typeof result.run === 'object' &&
                'status' in result.run &&
                result.run.status === 'succeeded';
        if (matches) {
          injected = true;
          throw new database.TransactionCommitUnknownError(new Error('Synthetic lost acknowledgment'));
        }
      }
      return result;
    });
    const identity = id();
    const response = await post(identity);
    fault.mockRestore();
    expect(injected).toBe(true);
    const receipt = await response.json();
    if (boundary === 'admission') {
      expect(response.status).toBe(202);
      expect(fetch).not.toHaveBeenCalled();
      const replay = await post(identity);
      expect(replay.status).toBe(202);
      expect((await replay.json()).run_id).toBe(receipt.run_id);
      expect(fetch).not.toHaveBeenCalled();
      await recoverThroughCloudPoller(receipt.run_id, true);
      expect((await facts(receipt.run_id)).run.status).toBe('timed_out');
      expect(fetch).not.toHaveBeenCalled();
    } else {
      expect(response.status).toBe(200);
      expect(receipt.status).toBe('succeeded');
      expect((await facts(receipt.run_id)).usage).toHaveLength(1);
      expect(fetch).toHaveBeenCalledOnce();
      expect((await post(identity)).status).toBe(200);
      expect(fetch).toHaveBeenCalledOnce();
    }
  },
);

it('retains the JSON producer and settled result after its HTTP caller disconnects', async () => {
  enable();
  const networkFetch = globalThis.fetch;
  const server = await fixtureHttpApi({ retainBackground: true });
  const provider = heldProvider();
  const abort = new AbortController();
  const pending = networkFetch(`${server.origin}/v1/inferences`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${account.key}`,
      'content-type': 'application/json',
      'idempotency-key': id(),
    },
    body: JSON.stringify(input()),
    signal: abort.signal,
  });
  try {
    await waitForProvider(provider, pending);
    const runId = await onlyActiveRun();
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    provider.resolve(providerResponse());
    await vi.waitFor(async () => expect((await facts(runId)).run.status).toBe('succeeded'), {
      timeout: 5000,
    });
    const saved = await facts(runId);
    expect(saved.run.result.inference).toMatchObject({
      outcome: 'value',
      usage: { input_tokens: '100', output_tokens: '10' },
      billing: { charged_micro_usd: '150' },
    });
    expect(saved.usage).toHaveLength(1);
    expect(provider.fetch).toHaveBeenCalledOnce();
  } finally {
    provider.resolve(providerResponse());
    await pending.catch(() => {});
    await server.close();
  }
});

it('preserves the settled result when an unread stream exceeds its delivery buffer', async () => {
  enable();
  const frame = (event: object) => `data: ${JSON.stringify(event)}\n\n`;
  const deltas = 10_000;
  const wire = [
    frame({
      type: 'message_start',
      message: { id: 'buffer-fixture', content: [], usage: { input_tokens: 100 } },
    }),
    frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ...Array.from({ length: deltas }, () =>
      frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } }),
    ),
    frame({ type: 'content_block_stop', index: 0 }),
    frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } }),
    frame({ type: 'message_stop' }),
  ].join('');
  const fetch = vi.fn(async () => new Response(wire, { headers: { 'content-type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', fetch);
  const response = await handleApi(
    new Request(`${config.origin}/v1/inferences`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${account.key}`,
        'content-type': 'application/json',
        'idempotency-key': id(),
      },
      body: JSON.stringify({ ...input(), stream: true }),
    }),
    'rest',
    retainBackground,
  );
  expect(response.status).toBe(200);
  const runId = response.headers.get('x-run-id');
  if (!runId) throw new Error('Stream omitted its recoverable Run identity.');
  // Deliberately leave the reader idle while the retained producer finishes.
  await Promise.all([...backgroundTasks]);
  await expect(response.text()).rejects.toThrow();
  const saved = await facts(runId);
  expect(saved.run.status).toBe('succeeded');
  expect(saved.run.result.inference).toMatchObject({
    outcome: 'value',
    value: { content: [{ type: 'text', text: 'x'.repeat(deltas) }] },
    billing: { charged_micro_usd: '150' },
  });
  expect(saved.usage).toHaveLength(1);
  expect(fetch).toHaveBeenCalledOnce();
});

it.each(['complete', 'disconnect'] as const)(
  'bounds request-body readers and releases them on %s',
  async (end) => {
    enable();
    vi.stubEnv('IMMEDIATE_INFERENCE_CONCURRENCY', '1');
    const fetch = vi.fn(async () => providerResponse());
    vi.stubGlobal('fetch', fetch);
    let controller!: ReadableStreamDefaultController<Uint8Array>, reading!: () => void;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const requestBody = new ReadableStream<Uint8Array>(
      {
        start(value) {
          controller = value;
        },
        pull() {
          reading();
        },
      },
      { highWaterMark: 0 },
    );
    const abort = new AbortController();
    const options = {
      method: 'POST',
      duplex: 'half',
      body: requestBody,
      signal: abort.signal,
      headers: {
        authorization: `Bearer ${account.key}`,
        'content-type': 'application/json',
        'idempotency-key': id(),
      },
    };
    const pending = handleApi(
      new Request(`${config.origin}/v1/inferences`, options),
      'rest',
      retainBackground,
    );
    let first: Response;
    try {
      await Promise.race([
        started,
        pending.then((response) => {
          throw new Error(`First request was refused: ${response.status}`);
        }),
      ]);
      const refused = await post();
      expect(refused.status).toBe(503);
      expect(await refused.json()).toMatchObject({
        error: { code: 'inference_service_unavailable', details: { reason: 'local_capacity' } },
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (end === 'disconnect') abort.abort();
      else {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(input())));
        controller.close();
      }
      first = await pending;
    }
    if (end === 'disconnect') {
      expect(first.headers.get('x-run-id')).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      const replacement = await post();
      expect(replacement.status, await replacement.clone().text()).toBe(200);
    } else expect(first.status, await first.clone().text()).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it('does not let a fenced late owner restore purged evidence or replay paid work', async () => {
  const provider = heldProvider();
  const identity = id();
  const pending = post(identity);
  try {
    await waitForProvider(provider, pending);
    const runId = await onlyActiveRun();
    await recoverThroughCloudPoller(runId, true);
    expect((await facts(runId)).run.status).toBe('timed_out');
    await database.transaction(account.p.organizationId, async (tx) => {
      await tx.query("UPDATE runs SET completed_at=now()-interval '400 days' WHERE id=$1", [runId]);
      await expireDetailedHistory(tx, 'payg', new Date());
    });
    provider.resolve(providerResponse());
    await pending;
    const saved = await facts(runId);
    expect(saved.run.result.content_expired).toBe(true);
    expect(saved.run.result).not.toHaveProperty('inference');
    expect(saved.invocations).toEqual([
      { state: 'uncertain', body_ciphertext: '', response_ciphertext: null, provider_completed_at: null },
    ]);
    const replay = await post(identity);
    expect(replay.status).toBe(410);
    expect(await replay.json()).toMatchObject({ error: { code: 'content_expired' } });
    expect(provider.fetch).toHaveBeenCalledOnce();
  } finally {
    provider.resolve(providerResponse());
    await pending;
  }
});

it('aborts stalled context preparation before admission while preserving the full execution window', async () => {
  enable();
  const before = await database.transaction(account.p.organizationId, (tx) =>
    tx.query<{ n: number }>('SELECT count(*)::integer AS n FROM runs'),
  );
  const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected provider request'));
  vi.stubGlobal('fetch', transport);
  const read = vi
    .spyOn(storedContextReader, 'read')
    .mockImplementation(async (_p, _workspace, _ref, options) => {
      if (!options?.signal) throw new Error('Preparation must supply cancellation.');
      const signal = options.signal;
      return new Promise<ExplicitContext>((_resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    });
  const workspace = id();
  const response = await handleApi(
    new Request(`${config.origin}/v1/inferences`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${account.key}`,
        'content-type': 'application/json',
        'idempotency-key': id(),
      },
      body: JSON.stringify({
        ...input(),
        workspace_id: workspace,
        context: {
          artifact_id: id(),
          revision: 'fixture/1',
          audience: { kind: 'application_actor', id: workspace },
        },
      }),
    }),
    'rest',
    undefined,
    {
      // 56 seconds are reserved for A + caller's 20s + C + delivery. A stalled
      // read may use only the remaining 2s, never borrow the model's full window.
      hostDeadlineAtMs: Date.now() + 58_000,
    },
  );
  expect(response.status, await response.clone().text()).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: 'inference_host_budget_exhausted' } });
  expect(read).toHaveBeenCalledOnce();
  expect(transport).not.toHaveBeenCalled();
  expect(
    (
      await database.transaction(account.p.organizationId, (tx) =>
        tx.query<{ n: number }>('SELECT count(*)::integer AS n FROM runs'),
      )
    ).rows,
  ).toEqual(before.rows);
});
