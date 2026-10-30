import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { QueryResultRow } from 'pg';
import * as database from '../../packages/db';
import type { Tx, TransactionOptions } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { id } from '../../packages/core/src/crypto';
import { credit } from '../../packages/core/src/ledger';
import * as ledger from '../../packages/core/src/ledger';
import { handleApi } from '../../packages/core/src/http';
import { advanceInference } from '../../packages/core/src/inference-engine';
import { dispatchCloudPoller } from '../../packages/core/src/portable-dispatch';
import { cancelRun, getRun } from '../../packages/core/src/runs';
import { expireDetailedHistory } from '../../packages/core/src/deletion';
import * as gateway from '../../packages/core/src/model-gateway';
import * as tracing from '../../packages/core/src/tracing';
import { AppError } from '../../packages/core/src/errors';
import { storedContextReader } from '../../packages/core/src/context-artifacts';
import type { ExplicitContext } from '../../packages/core/src/decision';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { fixtureHttpApi } from '../fixtures/http-api';
import { inferenceCaptureStats, scheduleInferenceCapture } from '../../packages/core/src/inference-capture';
import * as capture from '../../packages/core/src/inference-capture';
import { storage } from '../../packages/providers/src/storage';

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
    vi.useRealTimers();
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

it('rejects over-quota admission without reserving money or invoking a provider', async () => {
  const identity = id();
  const fetch = vi.fn(async () => providerResponse());
  vi.stubGlobal('fetch', fetch);
  const read = () =>
    database.transaction(
      account.p.organizationId,
      async (tx) =>
        (
          await tx.query(
            `SELECT settings,balance_micro_usd,reserved_micro_usd,
            (SELECT count(*) FROM runs) AS runs FROM organizations WHERE id=$1`,
            [account.p.organizationId],
          )
        ).rows[0],
    );
  const before = await read();
  await database.transaction(account.p.organizationId, (tx) =>
    tx.query(`UPDATE organizations SET settings=settings||'{"storage_over_quota":true}'::jsonb WHERE id=$1`, [
      account.p.organizationId,
    ]),
  );
  try {
    const response = await post(identity);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('storage_quota_exceeded');
    expect(fetch).not.toHaveBeenCalled();
    expect(await read()).toEqual({
      ...before,
      settings: { ...before.settings, storage_over_quota: true },
    });
  } finally {
    await database.transaction(account.p.organizationId, (tx) =>
      tx.query('UPDATE organizations SET settings=$2 WHERE id=$1', [
        account.p.organizationId,
        before.settings,
      ]),
    );
  }
  const retry = await post(identity);
  expect(retry.status, await retry.clone().text()).toBe(200);
  expect(fetch).toHaveBeenCalledOnce();
});

it('rolls back reservation, Run, invocation and events when grouped admission fails', async () => {
  const identity = id();
  const read = () =>
    database.transaction(account.p.organizationId, async (tx) => ({
      wallet: (
        await tx.query('SELECT balance_micro_usd,reserved_micro_usd FROM organizations WHERE id=$1', [
          account.p.organizationId,
        ])
      ).rows[0],
      counts: (
        await tx.query(
          `SELECT
          (SELECT count(*) FROM runs) AS runs,
          (SELECT count(*) FROM gateway_requests) AS requests,
          (SELECT count(*) FROM decision_invocations) AS invocations,
          (SELECT count(*) FROM run_events) AS events,
          (SELECT count(*) FROM dispatch_jobs) AS jobs,
          (SELECT count(*) FROM idempotency WHERE key=$1) AS receipts`,
          [identity],
        )
      ).rows[0],
    }));
  const before = await read();
  const fetch = vi.fn(async () => providerResponse());
  vi.stubGlobal('fetch', fetch);
  const original = database.queryGroup;
  let injected = false;
  const fault = vi.spyOn(database, 'queryGroup').mockImplementation((tx, statements) => {
    if (!injected && statements.some(({ text }) => text.startsWith('INSERT INTO gateway_requests'))) {
      injected = true;
      // Real PostgreSQL failure after the writes: the pipeline must drain and
      // rollback the whole admission, not leave a debit or dispatchable intent.
      return original(tx, [...statements, { text: 'SELECT 1/0' }]);
    }
    return original(tx, statements);
  });
  const response = await post(identity);
  fault.mockRestore();
  expect(injected).toBe(true);
  expect(response.status).toBe(500);
  expect(fetch).not.toHaveBeenCalled();
  expect(await read()).toEqual(before);
  const retry = await post(identity);
  expect(retry.status, await retry.clone().text()).toBe(200);
  const accepted = await retry.json();
  expect(fetch).toHaveBeenCalledOnce();
  const events = await database.transaction(account.p.organizationId, (tx) =>
    tx.query<{ type: string; sequence: string }>(
      'SELECT type,sequence FROM run_events WHERE run_id=$1 ORDER BY sequence',
      [accepted.run_id],
    ),
  );
  expect(events.rows.slice(0, 2)).toEqual([
    { type: 'run.accepted', sequence: '1' },
    { type: 'inference.prepared', sequence: '2' },
  ]);
});

it('preserves response evidence through settlement failure and recovers without another provider request', async () => {
  const fetch = vi.fn(async () => providerResponse());
  vi.stubGlobal('fetch', fetch);
  const fault = vi
    .spyOn(gateway, 'settleModelRequestForCompletion')
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

it('rolls back the terminal event with failed wallet settlement and recovers both exactly once', async () => {
  const fetch = vi.fn(async () => providerResponse());
  vi.stubGlobal('fetch', fetch);
  const original = ledger.finishSettlement;
  const fault = vi.spyOn(ledger, 'finishSettlement').mockImplementation(async (...args) => {
    await original(...args);
    throw new AppError(503, 'fixture_settlement_failure', 'Fixture settlement interrupted.');
  });
  const response = await post();
  expect(response.status).toBe(202);
  const receipt = await response.json();
  expect(receipt.recovery_reason).toBe('finalization_pending');
  const failed = await facts(receipt.run_id);
  expect(failed.run.status).toBe('running');
  expect(failed.usage).toEqual([]);
  const publication = () =>
    database.transaction(account.p.organizationId, async (tx) => ({
      events: (
        await tx.query(
          "SELECT type FROM run_events WHERE run_id=$1 AND type IN ('run.succeeded','run.failed')",
          [receipt.run_id],
        )
      ).rows,
      financial: (
        await tx.query('SELECT reference FROM financial_events WHERE reference=$1', [`run:${receipt.run_id}`])
      ).rows,
      usage: (
        await tx.query("SELECT amount_micro_usd FROM ledger WHERE reference=$1 AND account='consumption'", [
          `run:${receipt.run_id}`,
        ])
      ).rows,
    }));
  expect(await publication()).toEqual({ events: [], financial: [], usage: [] });
  fault.mockRestore();
  await recoverThroughCloudPoller(receipt.run_id);
  expect((await facts(receipt.run_id)).run.status).toBe('succeeded');
  expect(await publication()).toEqual({
    events: [{ type: 'run.succeeded' }],
    financial: [{ reference: `run:${receipt.run_id}` }],
    usage: [{ amount_micro_usd: '150' }],
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('publishes a timely complete response when settlement crosses the execution deadline', async () => {
  const fetch = vi.fn(async () => providerResponse());
  vi.stubGlobal('fetch', fetch);
  const settle = gateway.settleModelRequestForCompletion;
  const delayed = vi
    .spyOn(gateway, 'settleModelRequestForCompletion')
    .mockImplementation(async (tx, ...args) => {
      // F has recorded the transport completion inside this same transaction.
      // Cross E in PostgreSQL rather than faking the JS clock.
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

it.each(['admission', 'completion'] as const)(
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

it.each(['transient', 'persistent'] as const)(
  'handles a %s control-read failure after HTTP streaming begins without redispatching inference',
  async (failure) => {
    enable();
    const networkFetch = globalThis.fetch;
    const server = await fixtureHttpApi({ retainBackground: true });
    const identity = id();
    const body = JSON.stringify({ ...input(), stream: true });
    const encoder = new TextEncoder();
    const frame = (event: object) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let providerSignal: AbortSignal | undefined;
    let providerFinished = false;
    const interrupted = () => {
      if (providerFinished) return;
      providerFinished = true;
      controller.error(providerSignal?.reason);
    };
    const finishProvider = () => {
      if (providerFinished || !controller) return;
      providerFinished = true;
      providerSignal?.removeEventListener('abort', interrupted);
      controller.enqueue(frame({ type: 'content_block_stop', index: 0 }));
      controller.enqueue(
        frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } }),
      );
      controller.enqueue(frame({ type: 'message_stop' }));
      controller.close();
    };
    const provider = vi.fn<typeof fetch>(async (url, options) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      if (!options?.signal) throw new Error('Provider transport omitted its cancellation signal.');
      providerSignal = options.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
            providerSignal?.addEventListener('abort', interrupted, { once: true });
            controller.enqueue(
              frame({
                type: 'message_start',
                message: {
                  id: 'control-stream-fixture',
                  model: 'claude-haiku-4-5-20251001',
                  content: [],
                  usage: { input_tokens: 100, output_tokens: 0 },
                },
              }),
            );
            controller.enqueue(
              frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
            );
            controller.enqueue(
              frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
            );
            controller.enqueue(frame({ type: 'message_delta', delta: {}, usage: { output_tokens: 4 } }));
            if (providerSignal?.aborted) interrupted();
          },
          cancel() {
            providerFinished = true;
            providerSignal?.removeEventListener('abort', interrupted);
          },
        }),
        { headers: { 'content-type': 'text/event-stream', 'request-id': 'control-stream-fixture' } },
      );
    });
    vi.stubGlobal('fetch', provider);
    let armFailure = false;
    let failedReads = 0;
    let announceFailure!: () => void;
    let announceRecovery!: () => void;
    const failedRead = new Promise<void>((resolve) => {
      announceFailure = resolve;
    });
    const recoveredRead = new Promise<void>((resolve) => {
      announceRecovery = resolve;
    });
    const original = database.boundedQuery;
    vi.spyOn(database, 'boundedQuery').mockImplementation(async function <Row extends QueryResultRow>(
      text: string,
      values: unknown[],
      options: { deadlineAtMs: number; statementTimeoutMs: number },
    ) {
      const controlRead = text.includes('FROM reporting.inference_control');
      if (controlRead && armFailure && (failure === 'persistent' || failedReads === 0)) {
        failedReads++;
        announceFailure();
        throw new database.DatabaseBudgetError('statement');
      }
      const result = await original<Row>(text, values, options);
      if (controlRead && failedReads) announceRecovery();
      return result;
    });
    const request = () =>
      networkFetch(`${server.origin}/v1/inferences`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${account.key}`,
          'content-type': 'application/json',
          'idempotency-key': identity,
        },
        body,
      });
    let text: Promise<string> | undefined;
    try {
      const response = await request();
      expect(response.status).toBe(200);
      const runId = response.headers.get('x-run-id');
      if (!runId || !response.body) throw new Error('The stream omitted its recoverable Run identity.');
      const reader = response.body.getReader();
      let announceOutput!: () => void;
      const firstOutput = new Promise<void>((resolve) => {
        announceOutput = resolve;
      });
      text = (async () => {
        const decoder = new TextDecoder();
        let received = '';
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            received += decoder.decode(part.value, { stream: true });
            if (!armFailure && received.includes('event: output.delta')) {
              // The real HTTP caller has received output before the injected
              // control failure, matching an interrupted paid provider stream.
              armFailure = true;
              announceOutput();
            }
          }
          return received + decoder.decode();
        } finally {
          reader.releaseLock();
        }
      })();
      await Promise.race([
        firstOutput,
        text.then(() => {
          throw new Error('Inference ended before the HTTP caller received output.');
        }),
      ]);
      await failedRead;
      if (failure === 'transient') {
        expect(providerSignal?.aborted).toBe(false);
        await recoveredRead;
        finishProvider();
      }
      const wire = await text;
      expect(wire).toContain('event: output.delta');
      expect(wire).toContain('"text":"Hello"');
      const saved = await facts(runId);
      expect(saved.invocations).toHaveLength(1);
      expect(saved.usage).toHaveLength(1);
      if (failure === 'transient') {
        expect(failedReads).toBe(1);
        expect(wire).toContain('event: run.succeeded');
        expect(saved.run.status).toBe('succeeded');
        expect(saved.run.result.inference).toMatchObject({
          outcome: 'value',
          provider_outcome: 'responded',
          usage: { input_tokens: '100', output_tokens: '10', completeness: 'complete' },
          billing: { charged_micro_usd: '150', provisional: false },
        });
        expect(saved.gateway).toEqual([{ status: 'complete' }]);
      } else {
        expect(failedReads).toBeGreaterThan(1);
        expect(providerSignal?.reason).toMatchObject({ code: 'inference_control_unavailable' });
        expect(wire).toContain('event: run.failed');
        expect(saved.run.status).toBe('failed');
        expect(saved.run.result.inference).toMatchObject({
          outcome: 'failed',
          reason_code: 'inference_control_unavailable',
          provider_outcome: 'uncertain',
          provider_request_id: 'control-stream-fixture',
          usage: { input_tokens: '100', output_tokens: '4', completeness: 'missing' },
          billing: { provisional: true },
        });
        expect(saved.gateway).toEqual([{ status: 'unknown' }]);
        expect(BigInt(saved.run.cost_micro_usd)).toBeGreaterThan(0n);
      }
      expect(saved.usage[0].cost_micro_usd).toBe(saved.run.cost_micro_usd);
      expect(provider).toHaveBeenCalledOnce();
      const replay = await request();
      expect(replay.status).toBe(200);
      expect(replay.headers.get('x-run-id')).toBe(runId);
      expect(await replay.text()).toContain(`event: run.${saved.run.status}`);
      expect(provider).toHaveBeenCalledOnce();
      expect((await facts(runId)).usage).toHaveLength(1);
    } finally {
      finishProvider();
      await text?.catch(() => {});
      await server.close();
    }
  },
);

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

it('keeps immediate input off admission and stores one response before optional capture', async () => {
  enable();
  const fetch = vi.fn(async () => providerResponse());
  vi.stubGlobal('fetch', fetch);
  const tasks: (() => Promise<void>)[] = [];
  const identity = id();
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
    (task) => {
      tasks.push(task);
    },
  );
  try {
    expect(response.status, await response.clone().text()).toBe(200);
    const receipt = await response.json();
    const stored = await database.transaction(account.p.organizationId, async (tx) => ({
      run: (
        await tx.query<{ config: Record<string, unknown>; result: Record<string, unknown> }>(
          'SELECT config,result FROM runs WHERE id=$1',
          [receipt.run_id],
        )
      ).rows[0],
      call: (
        await tx.query<{ body_ciphertext: string; response_ciphertext: string }>(
          'SELECT body_ciphertext,response_ciphertext FROM decision_invocations WHERE run_id=$1',
          [receipt.run_id],
        )
      ).rows[0],
    }));
    expect(stored.run.config).toMatchObject({ payload_kind: 'compact', execution_owner: 'request' });
    for (const field of ['input', 'context', 'definition', 'model_parameters'])
      expect(stored.run.config).not.toHaveProperty(field);
    expect(stored.call.body_ciphertext).toBe('');
    expect(stored.call.response_ciphertext).toEqual(expect.any(String));
    expect(stored.run.result).toHaveProperty('inference_output_id');
    expect(stored.run.result).not.toHaveProperty('inference.value');
    const saved = await facts(receipt.run_id);
    expect(saved.run.result.inference?.value).toEqual(receipt.result.inference.value);
    const replay = await post(identity);
    expect((await replay.json()).result.inference.value).toEqual(receipt.result.inference.value);
    expect(fetch).toHaveBeenCalledOnce();
  } finally {
    await Promise.all(tasks.map((task) => task()));
  }
});

it('recovers an exceptional checkpoint with no original input or provider credentials', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => providerResponse()),
  );
  const fault = vi
    .spyOn(gateway, 'settleModelRequestForCompletion')
    .mockRejectedValueOnce(new AppError(503, 'fixture_settlement_unavailable', 'Synthetic outage'));
  const response = await post();
  fault.mockRestore();
  const receipt = await response.json();
  expect(receipt.recovery_reason).toBe('finalization_pending');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  await recoverThroughCloudPoller(receipt.run_id);
  const stored = await facts(receipt.run_id);
  expect(stored.run.status).toBe('succeeded');
  expect(stored.run.config).toHaveProperty('payload_kind', 'compact');
  expect(stored.run.result.inference?.value).toBeDefined();
  expect(globalThis.fetch).toHaveBeenCalledOnce();
});

it('keeps only compact trace metadata after retention erases content', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => providerResponse()),
  );
  const response = await post();
  const receipt = await response.json();
  await Promise.allSettled(backgroundTasks);
  await database.transaction(account.p.organizationId, async (tx) => {
    await tx.query("UPDATE runs SET completed_at=now()-interval '400 days' WHERE id=$1", [receipt.run_id]);
    await expireDetailedHistory(tx, 'payg', new Date());
  });
  const write = vi.spyOn(storage, 'put');
  const trace = vi.fn();
  const tasks: (() => Promise<void>)[] = [];
  expect(
    scheduleInferenceCapture(
      { organizationId: account.p.organizationId, runId: receipt.run_id, bytes: 21 },
      (task) => {
        tasks.push(task);
      },
      trace,
    ),
  ).toBe(true);
  await Promise.all(tasks.map((task) => task()));
  expect(write).not.toHaveBeenCalled();
  expect(trace).toHaveBeenCalledExactlyOnceWith(false);
  expect(inferenceCaptureStats()).toMatchObject({ captures: 0, retainedBytes: 0 });
  const saved = await facts(receipt.run_id);
  expect(saved.run.result.content_expired).toBe(true);
  expect(saved.invocations[0].body_ciphertext).toBe('');
});

it('emits one compact observation when the captured Run no longer exists', async () => {
  const trace = vi.fn();
  const tasks: (() => Promise<void>)[] = [];
  scheduleInferenceCapture(
    { organizationId: account.p.organizationId, runId: id(), bytes: 1 },
    (task) => {
      tasks.push(task);
    },
    trace,
  );
  await Promise.all(tasks.map((task) => task()));
  expect(trace).toHaveBeenCalledExactlyOnceWith(false);
  expect(inferenceCaptureStats()).toMatchObject({ captures: 0, retainedBytes: 0 });
});

it('enqueues full content under its checked Run lock and never duplicates export after guard rollback', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => providerResponse()),
  );
  const receipt = await (await post()).json();
  await Promise.allSettled(backgroundTasks);
  const trace = vi.fn();
  const original = database.transaction;
  vi.spyOn(database, 'transaction').mockImplementation(
    async <T>(
      organization: string | null,
      operation: (tx: Tx) => Promise<T>,
      options?: TransactionOptions,
    ): Promise<T> =>
      original(
        organization,
        async (tx) => {
          await operation(tx);
          // The callback must already have enqueued while FOR SHARE is held,
          // before COMMIT releases the lock to a competing purge.
          expect(trace).toHaveBeenCalledExactlyOnceWith(true);
          throw new Error('Synthetic read-guard rollback after enqueue');
        },
        options,
      ),
  );
  const tasks: (() => Promise<void>)[] = [];
  scheduleInferenceCapture(
    { organizationId: account.p.organizationId, runId: receipt.run_id, bytes: 1 },
    (task) => {
      tasks.push(task);
    },
    trace,
  );
  await Promise.all(tasks.map((task) => task()));
  expect(trace).toHaveBeenCalledExactlyOnceWith(true);
  expect(inferenceCaptureStats()).toMatchObject({ captures: 0, retainedBytes: 0 });
});

it('routes recovery through compact trace capture when no retained host owns content export', async () => {
  vi.spyOn(tracing, 'tracingEnabled').mockReturnValue(true);
  const trace = vi.spyOn(tracing, 'recordTrace').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => providerResponse()),
  );
  const fault = vi
    .spyOn(gateway, 'settleModelRequestForCompletion')
    .mockRejectedValueOnce(new AppError(503, 'fixture_settlement_unavailable', 'Synthetic outage'));
  const receipt = await (await post()).json();
  fault.mockRestore();
  expect(receipt.recovery_reason).toBe('finalization_pending');
  await recoverThroughCloudPoller(receipt.run_id);
  expect(trace).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'decision.generate',
      input: undefined,
      output: undefined,
      usage: expect.objectContaining({ complete: true }),
      metadata: expect.objectContaining({ content_capture: 'omitted' }),
    }),
  );
});

it('bounds full trace retention and keeps compact cost/usage export when capture cannot run', async () => {
  const compact = vi.fn();
  const schedule = vi.fn();
  expect(
    scheduleInferenceCapture(
      { organizationId: account.p.organizationId, runId: id(), bytes: 1 },
      undefined,
      compact,
    ),
  ).toBe(false);
  expect(compact).toHaveBeenLastCalledWith(false);
  expect(
    scheduleInferenceCapture(
      { organizationId: account.p.organizationId, runId: id(), bytes: 33 * 1024 * 1024 },
      schedule,
      compact,
    ),
  ).toBe(false);
  expect(schedule).not.toHaveBeenCalled();
  const tasks: (() => Promise<void>)[] = [];
  for (let count = 0; count < 16; count++)
    expect(
      scheduleInferenceCapture(
        { organizationId: account.p.organizationId, runId: id(), bytes: 2 * 1024 * 1024 },
        (task) => {
          tasks.push(task);
        },
        compact,
      ),
    ).toBe(true);
  expect(inferenceCaptureStats()).toMatchObject({ captures: 16, retainedBytes: 32 * 1024 * 1024 });
  expect(
    scheduleInferenceCapture(
      { organizationId: account.p.organizationId, runId: id(), bytes: 1 },
      schedule,
      compact,
    ),
  ).toBe(false);
  await Promise.all(tasks.map((task) => task()));
  expect(inferenceCaptureStats()).toMatchObject({ captures: 0, retainedBytes: 0 });
});

it('rejects missing canonical response content rather than returning a successful empty value', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => providerResponse()),
  );
  const receipt = await (await post()).json();
  await database.transaction(account.p.organizationId, (tx) =>
    tx.query('UPDATE decision_invocations SET response_ciphertext=NULL WHERE run_id=$1', [receipt.run_id]),
  );
  await expect(facts(receipt.run_id)).rejects.toMatchObject({ code: 'inference_output_missing' });
});

it('does not count delayed background capture as provider generation time', async () => {
  enable();
  vi.spyOn(tracing, 'tracingEnabled').mockReturnValue(true);
  vi.spyOn(tracing, 'tracingContentEnabled').mockReturnValue(true);
  vi.stubEnv('TRACING_ENABLED', 'true');
  vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'synthetic');
  vi.stubEnv('LANGFUSE_SECRET_KEY', 'synthetic');
  vi.stubEnv('LANGFUSE_BASE_URL', 'https://example.invalid');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => providerResponse()),
  );
  const exported = vi.spyOn(tracing, 'recordTrace').mockImplementation(() => {});
  const tasks: (() => Promise<void>)[] = [];
  const response = await handleApi(
    new Request(`${config.origin}/v1/inferences`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${account.key}`,
        'content-type': 'application/json',
        'idempotency-key': id(),
      },
      body: JSON.stringify(input()),
    }),
    'rest',
    (task) => {
      tasks.push(task);
    },
  );
  expect(response.status).toBe(200);
  const receipt = await response.json();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 60_000);
  await Promise.all(tasks.map((task) => task()));
  const generation = exported.mock.calls.map(([value]) => value).find((value) => value.type === 'generation');
  if (!generation) throw new Error('The generation trace was not exported.');
  expect(generation.output).toMatchObject({
    value: receipt.result.inference.value,
    validated_receipt: {
      usage: receipt.result.inference.usage,
      billing: receipt.result.inference.billing,
    },
  });
  expect(generation.output).not.toHaveProperty('validated_receipt.value');
  // Date timestamps have integer milliseconds; receipt timing is monotonic/fractional.
  expect(
    Math.abs(
      generation.endedAt.getTime() -
        generation.startedAt.getTime() -
        receipt.result.inference.timings_ms.provider,
    ),
  ).toBeLessThanOrEqual(1);
});

it('exports metadata generations without content jobs or retention SQL', async () => {
  vi.spyOn(tracing, 'tracingEnabled').mockReturnValue(true);
  vi.spyOn(tracing, 'tracingContentEnabled').mockReturnValue(false);
  const exported = vi.spyOn(tracing, 'recordTrace').mockImplementation(() => {});
  const scheduled = vi.spyOn(capture, 'scheduleInferenceCapture');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => providerResponse()),
  );
  const response = await post();
  expect(response.status, await response.clone().text()).toBe(200);
  const receipt = await response.json();
  await Promise.allSettled(backgroundTasks);
  expect(scheduled).not.toHaveBeenCalled();
  expect(inferenceCaptureStats()).toMatchObject({ captures: 0, retainedBytes: 0 });
  const generations = exported.mock.calls
    .map(([value]) => value)
    .filter((value) => value.type === 'generation');
  expect(generations).toHaveLength(1);
  expect(generations[0]).toMatchObject({
    input: undefined,
    output: undefined,
    usage: { input: 100, output: 10, complete: true },
    chargedMicroUsd: receipt.result.inference.billing.charged_micro_usd,
    metadata: { content_capture: 'omitted' },
  });
});
