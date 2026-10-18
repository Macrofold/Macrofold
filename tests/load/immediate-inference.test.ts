import { fork, type ChildProcess } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { availableParallelism, freemem, loadavg, totalmem } from 'node:os';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { authPool, pool, transaction } from '../../packages/db';
import { config, isLocal } from '../../packages/core/src/config';
import { id, sha256 } from '../../packages/core/src/crypto';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { createKey } from '../../packages/core/src/keys';
import { credit } from '../../packages/core/src/ledger';
import { decisionExample } from '../../examples/decisions/contracts';
import { advanceInference } from '../../packages/core/src/inference-engine';
import { immediateInferencePolicy } from '../../packages/core/src/direct-inference';
import { getRun } from '../../packages/core/src/runs';
import { mapConcurrent } from '../../packages/core/src/concurrent';

const networkFetch = globalThis.fetch;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const distribution = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) =>
    Math.round((sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0) * 100) / 100;
  return { samples: values.length, p50_ms: at(0.5), p95_ms: at(0.95), p99_ms: at(0.99), max_ms: at(1) };
};
function setting(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}
const replicaCount = setting('IMMEDIATE_LOAD_REPLICAS', 2, 32);
const tenantCount = setting('IMMEDIATE_LOAD_TENANTS', 8, 10000);
const cohortSize = setting('IMMEDIATE_LOAD_COHORT', 64, 10000);
const rampSeconds = setting('IMMEDIATE_LOAD_STEP_SECONDS', 2, 900);
const baselineRoot = process.env.IMMEDIATE_LOAD_BASELINE_ROOT;
const report: Record<string, unknown> = {
  profile:
    'real loopback HTTP, independent Node API replicas, disposable PostgreSQL, synthetic Anthropic transport',
  baseline_source: baselineRoot ? 'separate HEAD export without .env' : null,
  replicas: replicaCount,
  tenants: tenantCount,
  cohort_target: cohortSize,
  step_seconds: rampSeconds,
  node: process.version,
  host: {
    platform: process.platform,
    architecture: process.arch,
    available_parallelism: availableParallelism(),
    total_memory_bytes: totalmem(),
    free_memory_bytes_at_import: freemem(),
    load_average_at_import: loadavg(),
    database_location: 'loopback; shared developer fixture infrastructure',
    file_descriptor_measurement: 'not instrumented; do not infer hosted resource headroom',
  },
  paid_calls: 0,
  hosted_acceptance: false,
  scope:
    'Short local correctness/calibration profile; sustained and hosted acceptance require the explicit larger settings.',
  source_revision: process.env.IMMEDIATE_SOURCE_REVISION ?? null,
  sql_measurement:
    'Submission-correlated completed-operation aggregates across owned pools, including retained background. Query duration sums are not wall-clock critical-path time. Historical fixture exports may use the prior driver-wide boundary.',
  fixture_domain_pool_per_replica: 32,
  baseline_worker_claim_delay_ms: baselineRoot
    ? Number(process.env.IMMEDIATE_LOAD_CLAIM_DELAY_MS ?? 250)
    : null,
};
const replicaMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), origin: z.string(), pid: z.number() }),
  z.object({
    type: z.literal('metrics'),
    pid: z.number(),
    node: z.string(),
    sql_queries: z.number(),
    sql_milliseconds: z.number(),
    metrics_boundary: z.literal('correlated-operation-aggregates').optional(),
    sql_query_mean_ms: z.number().optional(),
    sql_query_p95_ms: z.number().optional(),
    pool_acquisition_p95_ms: z.number().optional(),
    commits: z.number(),
    peak_rss_bytes: z.number(),
    peak_pool_busy: z.number(),
    peak_pool_waiting: z.number(),
    cpu_time_ms: z.number().optional(),
    measurement_ms: z.number().optional(),
    event_loop_p99_ms: z.number(),
    query_timings: z
      .array(z.object({ text: z.string(), count: z.number(), total_ms: z.number(), max_ms: z.number() }))
      .optional(),
    lock_statement_timings: z
      .array(
        z.object({
          kind: z.string(),
          count: z.number(),
          mean_ms: z.number(),
          p95_ms: z.number(),
          max_ms: z.number(),
        }),
      )
      .optional(),
  }),
  z.object({ type: z.literal('advanced'), run_id: z.string(), status: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
type Replica = {
  process: ChildProcess;
  origin: string;
  metrics: () => Promise<z.infer<typeof replicaMessage>[]>;
  advance: (organization: string, runId: string) => Promise<void>;
};
type Tenant = { organization: string; key: string };
const replicas: Replica[] = [],
  tenants: Tenant[] = [],
  stderr: string[] = [];
let providerDelay = 0,
  providerCalls = 0,
  activeProviders = 0,
  peakProviders = 0;
let holdProviders = false;
const held = new Set<ServerResponse>();
const answer = (response: ServerResponse) => {
  if (response.destroyed) return;
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: '"wait"' + ' '.repeat(1000) }],
    usage: { input_tokens: 100, output_tokens: 10 },
  });
  report.synthetic_native_response_bytes = Buffer.byteLength(body);
  response.writeHead(200, { 'content-type': 'application/json', 'request-id': id() });
  response.end(body);
};
const provider = createServer(async (request, response) => {
  let bytes = 0;
  for await (const part of request) bytes += Buffer.byteLength(part);
  report.synthetic_native_request_bytes = bytes;
  providerCalls++;
  activeProviders++;
  peakProviders = Math.max(peakProviders, activeProviders);
  let closed = false;
  response.once('close', () => {
    if (!closed) {
      closed = true;
      activeProviders--;
      held.delete(response);
    }
  });
  if (holdProviders) held.add(response);
  else {
    await pause(providerDelay);
    answer(response);
  }
});
async function until(check: () => Promise<boolean> | boolean, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Immediate fixture condition timed out');
    await pause(20);
  }
}
async function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill(signal);
  await exited;
}
async function startReplica(
  sourceRoot?: string,
  options: { persistenceAttemptMs?: number } = {},
): Promise<Replica> {
  const source = sourceRoot
    ? path.join(sourceRoot, 'tests/fixtures/immediate-inference-api.ts')
    : new URL('../fixtures/immediate-inference-api.ts', import.meta.url);
  const messages: z.infer<typeof replicaMessage>[] = [];
  const child = fork(source, [], {
    execArgv: ['--import', 'tsx'],
    cwd: sourceRoot,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: {
      ...process.env,
      PLATFORM_MODE: 'local',
      EXECUTION_PROVIDER: 'simulator',
      ALLOW_PAID_EXECUTION: 'false',
      APP_ORIGIN: 'http://localhost:3210',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      OPENROUTER_API_KEY: '',
      TYPESAFE_API_KEY: '',
      LANGFUSE_PUBLIC_KEY: '',
      LANGFUSE_SECRET_KEY: '',
      IMMEDIATE_FIXTURE_PROVIDER_ORIGIN: `http://127.0.0.1:${addressPort()}`,
      DATABASE_POOL_SIZE: '32',
      AUTH_DATABASE_POOL_SIZE: '4',
      CREDENTIAL_DATABASE_POOL_SIZE: '2',
      IMMEDIATE_INFERENCE_CONCURRENCY: String(Math.max(256, Math.ceil(cohortSize / replicaCount) + 32)),
      IMMEDIATE_INFERENCE_ADMISSION_CONCURRENCY: '8',
      LIGHTWEIGHT_CONCURRENT_RUN_LIMIT: String(cohortSize + 512),
      GLOBAL_CONCURRENT_RUN_LIMIT: String(cohortSize + 712),
      API_WRITE_RATE_LIMIT_PER_MINUTE: '1000000',
      API_READ_RATE_LIMIT_PER_MINUTE: '1000000',
      ...(options.persistenceAttemptMs === undefined
        ? {}
        : { IMMEDIATE_FIXTURE_PERSISTENCE_ATTEMPT_MS: String(options.persistenceAttemptMs) }),
    },
  });
  child.stderr?.on('data', (chunk) => {
    if (stderr.join('').length < 32768) stderr.push(String(chunk));
  });
  child.on('message', (value) => {
    const parsed = replicaMessage.safeParse(value);
    if (parsed.success) messages.push(parsed.data);
  });
  await until(() => messages.some((message) => message.type === 'ready') || child.exitCode !== null, 60000);
  const ready = messages.find((message) => message.type === 'ready');
  if (!ready || ready.type !== 'ready')
    throw new Error('API replica did not start: ' + stderr.join('').slice(-2000));
  const result = {
    process: child,
    origin: ready.origin,
    advance: async (organization: string, runId: string) => {
      const before = messages.length;
      child.send({ type: 'advance', organization, run_id: runId });
      await until(
        () =>
          messages
            .slice(before)
            .some(
              (message) =>
                (message.type === 'advanced' && message.run_id === runId) || message.type === 'error',
            ),
        150000,
      );
      const failure = messages.slice(before).find((message) => message.type === 'error');
      if (failure?.type === 'error') throw new Error(failure.message);
      const advanced = messages
        .slice(before)
        .find((message) => message.type === 'advanced' && message.run_id === runId);
      if (
        advanced?.type === 'advanced' &&
        !['succeeded', 'failed', 'cancelled', 'timed_out'].includes(advanced.status)
      )
        throw new Error(`Baseline dispatch did not finish: ${advanced.status}`);
    },
    metrics: async () => {
      const before = messages.length;
      child.send({ type: 'metrics', reset: true });
      await until(() => messages.slice(before).some((message) => message.type === 'metrics'));
      return messages.slice(before).filter((message) => message.type === 'metrics');
    },
  };
  replicas.push(result);
  return result;
}
function addressPort() {
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('Provider fixture has no address');
  return address.port;
}
function input(subject = id()) {
  const body = decisionExample(id(), 'triage');
  delete body.workspace_id;
  body.input = { subject_id: subject };
  body.context.items[0] = { ...body.context.items[0], status: 'known', value: 'x'.repeat(4096) };
  body.definition.limits.timeout_seconds = 120;
  return body;
}
const resultShape = z.object({
  run_id: z.string().optional(),
  status: z.string().optional(),
  error: z.object({ code: z.string() }).optional(),
  result: z
    .object({
      inference: z
        .object({
          outcome: z.string(),
          timings_ms: z.record(z.string(), z.number()).optional(),
          billing: z.object({ charged_micro_usd: z.string().nullable() }).optional(),
        })
        .optional(),
    })
    .optional(),
});
async function submit(
  index: number,
  body = input(),
  key = id(),
  replica = replicas[index % replicas.length],
  preferAsync = false,
) {
  const tenant = tenants[index % tenants.length],
    started = performance.now();
  let response = await networkFetch(replica.origin + '/v1/inferences', {
    method: 'POST',
    signal: AbortSignal.timeout(180000),
    headers: {
      authorization: `Bearer ${tenant.key}`,
      'content-type': 'application/json',
      'idempotency-key': key,
      ...(preferAsync ? { prefer: 'respond-async' } : {}),
    },
    body: JSON.stringify(body),
  });
  let value = resultShape.parse(await response.json());
  if (preferAsync && value.run_id && response.status === 202) {
    // Only the separate baseline export has queued admission. This deliberately
    // models its worker delay, keeping that delay distinct from SQL overhead.
    await pause(Number(process.env.IMMEDIATE_LOAD_CLAIM_DELAY_MS ?? 250));
    await replica.advance(tenant.organization, value.run_id);
    const runId = value.run_id;
    await until(async () => {
      response = await networkFetch(replica.origin + `/v1/runs/${runId}`, {
        headers: { authorization: `Bearer ${tenant.key}` },
      });
      const raw: unknown = await response.json();
      const parsed = resultShape.safeParse(raw);
      if (
        parsed.success &&
        parsed.data.status &&
        ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(parsed.data.status)
      ) {
        const saved = await networkFetch(replica.origin + `/v1/runs/${runId}/result`, {
          headers: { authorization: `Bearer ${tenant.key}` },
        });
        const savedValue: unknown = await saved.json();
        value = { ...parsed.data, result: resultShape.shape.result.parse(savedValue) };
        response = saved;
        return true;
      }
      return false;
    }, 150000);
  }
  return { status: response.status, value, elapsed: performance.now() - started };
}
async function accounting() {
  return mapConcurrent(tenants, 8, (tenant) =>
    transaction(tenant.organization, async (tx) => ({
      organization: tenant.organization,
      held: (
        await tx.query<{ reserved_micro_usd: string }>(
          'SELECT reserved_micro_usd FROM organizations WHERE id=$1',
          [tenant.organization],
        )
      ).rows[0].reserved_micro_usd,
      active: Number((await tx.query('SELECT count(*) AS n FROM runs WHERE completed_at IS NULL')).rows[0].n),
      usage: Number((await tx.query('SELECT count(*) AS n FROM model_usage')).rows[0].n),
      duplicate: Number(
        (
          await tx.query(
            'SELECT count(*) AS n FROM (SELECT request_id FROM model_usage GROUP BY request_id HAVING count(*)>1) d',
          )
        ).rows[0].n,
      ),
      unbalanced: Number(
        (
          await tx.query(
            'SELECT count(*) AS n FROM (SELECT journal_id FROM ledger GROUP BY journal_id HAVING sum(amount_micro_usd)<>0) j',
          )
        ).rows[0].n,
      ),
    })),
  );
}
async function recoverStoppedOwners() {
  const recovered: { run_id: string; deadline_accelerated: boolean; provisional: boolean }[] = [];
  // Exceptional receipts are valid recovery outcomes under overload. Once all
  // fixture provider sockets are closed, accelerate only missing-response owner
  // fences; preserve/account saved evidence through the real recovery service.
  await until(() => activeProviders === 0);
  for (const tenant of tenants) {
    const active = await transaction(tenant.organization, (tx) =>
      tx.query<{ id: string; state: string | null }>(
        `SELECT r.id,i.state FROM runs r LEFT JOIN decision_invocations i ON i.run_id=r.id
       WHERE r.completed_at IS NULL`,
      ),
    );
    for (const row of active.rows) {
      const accelerated = row.state !== 'responded';
      if (accelerated)
        await transaction(tenant.organization, (tx) =>
          tx.query("UPDATE runs SET deadline=now()-interval '31 seconds' WHERE id=$1", [row.id]),
        );
      await advanceInference(tenant.organization, row.id);
      const run = await transaction(tenant.organization, (tx) => getRun(tx, row.id));
      expect(run.completed_at).toBeTruthy();
      recovered.push({
        run_id: row.id,
        deadline_accelerated: accelerated,
        provisional: run.result.inference?.billing.provisional ?? false,
      });
    }
  }
  return recovered;
}
beforeAll(async () => {
  if (!isLocal() || config.allowPaid || !new URL(config.databaseUrl).pathname.startsWith('/platform_test_'))
    throw new Error('Load acceptance must use the disposable unpaid domain wrapper.');
  vi.stubGlobal('fetch', async () => {
    throw new Error('Parent recovery attempted an unexpected provider request');
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const owner = await fixtureAccount('Immediate load owner');
  // Reuse one verified fixture identity across organizations. Each key remains a
  // distinct principal with real membership/auth checks; setup is outside timing.
  await mapConcurrent(
    Array.from({ length: tenantCount }, (_, i) => i),
    8,
    async (index) => {
      const organization = index === 0 ? owner.p.organizationId : id();
      if (index) {
        await pool.query(
          "INSERT INTO organizations(id,name,plan) VALUES($1,'Immediate load tenant','scale')",
          [organization],
        );
        await transaction(organization, (tx) =>
          tx.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')", [
            organization,
            owner.p.userId,
          ]),
        );
      } else await pool.query("UPDATE organizations SET plan='scale' WHERE id=$1", [organization]);
      const key = await transaction(organization, async (tx) => {
        await credit(tx, organization, 1_000_000_000n, `immediate-load:${id()}`);
        return createKey(
          tx,
          { ...owner.p, organizationId: organization },
          { name: 'Immediate load', scopes: ['runs:write', 'runs:read'] },
        );
      });
      tenants[index] = { organization, key: key.secret };
    },
  );
  for (let i = 0; i < replicaCount; i++) await startReplica(baselineRoot);
}, 180000);
afterAll(async () => {
  holdProviders = false;
  for (const response of held) answer(response);
  held.clear();
  await Promise.all(replicas.map((replica) => stop(replica.process, 'SIGKILL')));
  for (const tenant of tenants) await retireFixtureRuns(tenant.organization);
  const closed = once(provider, 'close');
  provider.closeAllConnections();
  provider.close();
  await closed;
  vi.unstubAllGlobals();
  if (process.env.IMMEDIATE_REPORT_PATH)
    await writeFile(process.env.IMMEDIATE_REPORT_PATH, JSON.stringify(report, null, 2));
  await pool.end();
  await authPool.end();
});

it('measures open-loop immediate arrival ramps without running a dispatch poller', async () => {
  const rates = (process.env.IMMEDIATE_LOAD_RATES ?? '4,8,16').split(',').map(Number);
  expect(rates.every((rate) => Number.isInteger(rate) && rate > 0 && rate <= 10000)).toBe(true);
  const measurements: unknown[] = [];
  for (let index = 0; index < replicas.length * 2; index++) {
    const warm = await submit(index, input(), id(), replicas[index % replicas.length], !!baselineRoot);
    expect(warm.value.status).toBe('succeeded');
  }
  const delays = (process.env.IMMEDIATE_LOAD_DELAYS ?? '0,300,500').split(',').map(Number);
  expect(delays.every((delay) => Number.isInteger(delay) && delay >= 0 && delay <= 60000)).toBe(true);
  for (const delay of delays)
    for (const rate of rates) {
      providerDelay = delay;
      await Promise.all(replicas.map((replica) => replica.metrics()));
      const initialProviderCalls = providerCalls,
        latencies: number[] = [],
        overhead: number[] = [],
        launchLateness: number[] = [];
      const errors: Record<string, number> = {};
      let succeeded = 0,
        rejected = 0,
        terminalFailed = 0,
        recovering = 0;
      const starts = performance.now(),
        pending = new Set<Promise<void>>();
      const offered = rate * rampSeconds;
      if (offered > 1000000) throw new Error('Fixture is bounded to one million requests per step.');
      for (let i = 0; i < rate * rampSeconds; i++) {
        const scheduled = starts + (i * 1000) / rate;
        if (scheduled > performance.now()) await pause(scheduled - performance.now());
        launchLateness.push(Math.max(0, performance.now() - scheduled));
        if (pending.size >= 20000)
          throw new Error('Load generator exceeded its bounded 20,000 in-flight envelope.');
        const task = submit(i, input(), id(), replicas[i % replicas.length], !!baselineRoot)
          .then((result) => {
            latencies.push(result.elapsed);
            if (result.status === 200 && result.value.status === 'succeeded') {
              succeeded++;
              const providerMs = result.value.result?.inference?.timings_ms?.provider;
              if (providerMs !== undefined) overhead.push(Math.max(0, result.elapsed - providerMs));
            } else {
              if (result.status >= 400) rejected++;
              else if (result.status === 202) recovering++;
              else terminalFailed++;
              const code =
                result.value.error?.code ?? result.value.result?.inference?.outcome ?? String(result.status);
              errors[code] = (errors[code] ?? 0) + 1;
            }
          })
          .finally(() => pending.delete(task));
        pending.add(task);
      }
      await Promise.all(pending);
      const measured = {
        delay_ms: delay,
        offered_rate: rate,
        offered,
        succeeded,
        rejected,
        terminal_failed: terminalFailed,
        recovering,
        provider_calls: providerCalls - initialProviderCalls,
        duration_ms: performance.now() - starts,
        client_total: distribution(latencies),
        client_minus_provider: distribution(overhead),
        generator_lateness: distribution(launchLateness),
        host_load_average: loadavg(),
        host_free_memory_bytes: freemem(),
        errors,
        replicas: (await Promise.all(replicas.map((replica) => replica.metrics()))).flat(),
      };
      measurements.push(measured);
      report.ramp = measurements;
      console.log(JSON.stringify({ immediate_ramp: measured }));
      const recovered = await recoverStoppedOwners();
      if (recovered.length) console.log(JSON.stringify({ immediate_recovered_after_overload: recovered }));
      const totals = await accounting();
      expect(
        totals.every(
          (value) =>
            value.active === 0 && value.held === '0' && value.duplicate === 0 && value.unbalanced === 0,
        ),
      ).toBe(true);
      expect(measured.provider_calls).toBeGreaterThanOrEqual(succeeded);
      expect(measured.provider_calls).toBeLessThanOrEqual(
        succeeded + terminalFailed + recovering + recovered.length,
      );
      if (rate === rates[0]) expect(errors).toEqual({});
    }
  report.ramp = measurements;
}, 900000);

it.skipIf(!!baselineRoot)(
  'holds a configurable concurrent cohort across independent API replicas and reconciles every reservation',
  async () => {
    if (tenantCount * 500 < cohortSize)
      throw new Error('Cohort requires enough Scale fixture tenants; account ceilings remain enforced.');
    holdProviders = true;
    peakProviders = 0;
    const initialCalls = providerCalls,
      started = performance.now();
    const arrivalRate = setting('IMMEDIATE_LOAD_COHORT_RATE', 4, 10000);
    const holdMs = setting('IMMEDIATE_LOAD_HOLD_MS', 1000, 60000);
    if ((cohortSize / arrivalRate) * 1000 + holdMs > 100000)
      throw new Error(
        'Choose a cohort arrival rate/hold that fits the fixture 120-second execution deadline.',
      );
    const pending: Promise<Awaited<ReturnType<typeof submit>> | undefined>[] = [];
    let transportErrors = 0,
      refusals = 0,
      failure: unknown;
    let replicasAtPeak: z.infer<typeof replicaMessage>[] = [];
    try {
      for (let index = 0; index < cohortSize; index++) {
        if (refusals || transportErrors) break;
        const scheduled = started + (index * 1000) / arrivalRate;
        if (scheduled > performance.now()) await pause(scheduled - performance.now());
        pending.push(
          submit(index)
            .then((result) => {
              if (result.status !== 200 || result.value.status !== 'succeeded') refusals++;
              return result;
            })
            .catch(() => {
              transportErrors++;
              return undefined;
            }),
        );
      }
      await until(() => activeProviders === cohortSize || refusals > 0 || transportErrors > 0, 150000);
      if (!refusals && !transportErrors) await pause(holdMs);
      replicasAtPeak = (await Promise.all(replicas.map((replica) => replica.metrics()))).flat();
    } catch (error) {
      failure = error;
    } finally {
      holdProviders = false;
      for (const response of held) answer(response);
      held.clear();
    }
    const results = await Promise.all(pending);
    await recoverStoppedOwners();
    const totals = await accounting();
    const measured = {
      target: cohortSize,
      offered: pending.length,
      peak_in_flight: peakProviders,
      hold_ms: holdMs,
      duration_ms: performance.now() - started,
      provider_calls: providerCalls - initialCalls,
      refusals,
      transport_errors: transportErrors,
      replicas: replicasAtPeak,
      accounting: totals,
    };
    report.cohort = measured;
    console.log(JSON.stringify({ immediate_cohort: measured }));
    if (failure) throw failure;
    expect(
      results.filter((result) => !result || result.status !== 200 || result.value.status !== 'succeeded'),
    ).toEqual([]);
    expect(peakProviders).toBe(cohortSize);
    expect(providerCalls - initialCalls).toBe(cohortSize);
    expect(
      totals.every(
        (value) =>
          value.active === 0 && value.held === '0' && value.duplicate === 0 && value.unbalanced === 0,
      ),
    ).toBe(true);
  },
  900000,
);

it.skipIf(!!baselineRoot)(
  'observes API-key revocation across independent replicas without cancellation flags or provider retries',
  async () => {
    const pair = replicas.slice(0, 2);
    expect(pair).toHaveLength(2);
    const tenant = tenants[0];
    // Warm both processes before holding their calls. No real provider is reachable.
    for (const replica of pair)
      expect((await submit(0, input(), id(), replica)).value.status).toBe('succeeded');
    const calls = pair.map((replica) => ({ replica, body: input(), identity: id() }));
    const initialCalls = providerCalls;
    const previousHold = holdProviders;
    const transportAbortMs: number[] = [];
    let completed = 0;
    holdProviders = true;
    const pending = calls.map(({ replica, body, identity }) =>
      submit(0, body, identity, replica).finally(() => {
        completed++;
      }),
    );
    const completion = Promise.all(pending);
    // Observe early rejection immediately while waiting at the provider barrier.
    void completion.catch(() => {});
    try {
      await until(() => providerCalls >= initialCalls + pair.length || completed > 0);
      expect(providerCalls - initialCalls).toBe(pair.length);
      expect(held.size).toBe(pair.length);
      const started = performance.now();
      for (const response of held)
        response.once('close', () => transportAbortMs.push(performance.now() - started));
      // Deliberately bypass dependent-Run cancellation: each API process must
      // discover current key authority through its own shared SQL observer.
      const revoked = await pool.query(
        'UPDATE api_keys SET revoked_at=now() WHERE organization_id=$1 AND key_hash=$2 RETURNING id',
        [tenant.organization, sha256(tenant.key)],
      );
      expect(revoked.rowCount).toBe(1);
      const commitMs = performance.now() - started;
      // The observer has a two-second fail-closed bound. Allow 500ms here for
      // loopback socket-close delivery/scheduling; HTTP accounting has its own C.
      await until(() => held.size === 0 && activeProviders === 0, 2500);
      const closedMs = performance.now() - started;
      await until(
        () => completed === pair.length,
        immediateInferencePolicy.completionMs + immediateInferencePolicy.deliveryMs,
      );
      const results = await completion;
      const finalizedMs = performance.now() - started;
      const runs = await transaction(tenant.organization, async (tx) =>
        Promise.all(
          results.map(({ value }) => {
            if (!value.run_id) throw new Error('Revoked invocation lost its durable identity.');
            return getRun(tx, value.run_id);
          }),
        ),
      );
      for (const [index, run] of runs.entries()) {
        expect(results[index].status).toBe(200);
        expect(results[index].value.status).toBe('failed');
        expect(run.status).toBe('failed');
        expect(run.cancel_requested).toBe(false);
        expect(run.result.inference).toMatchObject({
          outcome: 'failed',
          reason_code: 'authorization_revoked',
        });
        expect(run.result.inference).not.toHaveProperty('value');
      }
      expect(transportAbortMs).toHaveLength(pair.length);
      expect(providerCalls - initialCalls).toBe(pair.length);
      await pool.query('UPDATE api_keys SET revoked_at=NULL WHERE organization_id=$1 AND key_hash=$2', [
        tenant.organization,
        sha256(tenant.key),
      ]);
      // Restored authority permits replay, never resurrection or a second dispatch.
      for (const [index, call] of calls.entries()) {
        const replay = await submit(0, call.body, call.identity, pair[1 - index]);
        expect(replay.status).toBe(200);
        expect(replay.value).toMatchObject({ run_id: runs[index].id, status: 'failed' });
      }
      const totals = await accounting();
      expect(providerCalls - initialCalls).toBe(pair.length);
      expect(
        totals.every(
          (value) =>
            value.active === 0 && value.held === '0' && value.duplicate === 0 && value.unbalanced === 0,
        ),
      ).toBe(true);
      const measured = {
        replicas: pair.length,
        requests: pair.length,
        direct_key_revocation: true,
        cancellation_flags_set: false,
        revocation_commit_ms: commitMs,
        transport_abort: distribution(transportAbortMs),
        all_transports_closed_ms: closedMs,
        terminal_receipts_ms: finalizedMs,
        provider_calls: providerCalls - initialCalls,
        terminal_statuses: runs.map((run) => run.status),
        outcomes: runs.map((run) => run.result.inference?.outcome),
        restored_key_replays: pair.length,
        accounting: totals,
      };
      report.revocation = measured;
      console.log(JSON.stringify({ immediate_revocation: measured }));
    } finally {
      holdProviders = previousHold;
      for (const response of held) response.destroy();
      held.clear();
      await Promise.allSettled(pending);
      await pool.query('UPDATE api_keys SET revoked_at=NULL WHERE organization_id=$1 AND key_hash=$2', [
        tenant.organization,
        sha256(tenant.key),
      ]);
      await recoverStoppedOwners();
    }
  },
  120000,
);

it.skipIf(!!baselineRoot)(
  'recovers after actual API process death at dispatch and after an exceptional response checkpoint without redispatch',
  async () => {
    const tenant = tenants[0],
      faults: unknown[] = [];
    for (const boundary of ['dispatch', 'checkpoint'] as const) {
      const replica = await startReplica(
          undefined,
          boundary === 'checkpoint' ? { persistenceAttemptMs: 200 } : {},
        ),
        subject = `crash-${id()}`,
        identity = id(),
        body = input(subject);
      body.definition.limits.timeout_seconds = 5;
      holdProviders = true;
      const before = providerCalls;
      let admission: Awaited<ReturnType<typeof submit>> | undefined;
      const pending = submit(0, body, identity, replica)
        .then((result) => (admission = result))
        .catch(() => undefined);
      let release = () => {};
      let locked: Promise<unknown> | undefined;
      try {
        await until(() => providerCalls === before + 1 || admission !== undefined);
        if (admission)
          throw new Error(
            `Crash fixture was not admitted: ${admission.status} ${admission.value.error?.code}`,
          );
        // Compact admission deliberately saves no prompt to query by. Resolve
        // the existing identity through the same public replay a caller uses.
        const replayed = await submit(0, body, identity, replicas[0]);
        expect(replayed.status).toBe(202);
        expect(replayed.value.run_id).toBeTruthy();
        const call = await transaction(
          tenant.organization,
          async (tx) =>
            (
              await tx.query<{ id: string; run_id: string; deadline: Date }>(
                `SELECT i.id,i.run_id,r.deadline FROM decision_invocations i JOIN runs r ON r.id=i.run_id WHERE r.id=$1`,
                [replayed.value.run_id],
              )
            ).rows[0],
        );
        expect(call).toBeDefined();
        if (boundary === 'checkpoint') {
          let acquired = () => {};
          const ready = new Promise<void>((resolve) => {
            acquired = resolve;
          });
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          // Hold the actual settlement row: F must roll back after its bounded
          // attempts, then save the same validated evidence exceptionally.
          locked = transaction(tenant.organization, async (tx) => {
            await tx.query('SELECT id FROM gateway_requests WHERE id=$1 FOR UPDATE', [call.id]);
            acquired();
            await gate;
          });
          await ready;
          holdProviders = false;
          for (const response of held) answer(response);
          held.clear();
          await until(async () =>
            Boolean(
              (
                await transaction(tenant.organization, (tx) =>
                  tx.query(
                    "SELECT 1 FROM decision_invocations WHERE id=$1 AND state='responded' AND response_ciphertext IS NOT NULL",
                    [call.id],
                  ),
                )
              ).rowCount,
            ),
          );
        }
        await stop(replica.process, 'SIGKILL');
        release();
        await locked;
        await pending;
        holdProviders = false;
        for (const response of held) response.destroy();
        held.clear();
        // Keep both the real completion timestamp and deadline intact. Recovery
        // must wait E+C after process loss unless the live owner handed off.
        await pause(
          Math.max(0, call.deadline.getTime() + immediateInferencePolicy.completionMs + 100 - Date.now()),
        );
        // Same domain recovery owner in a different process lifetime; closed parent
        // transport rejects any accidental attempt to invoke a provider again.
        await advanceInference(tenant.organization, call.run_id);
        const recovered = await transaction(tenant.organization, (tx) => getRun(tx, call.run_id));
        expect(recovered.completed_at).toBeTruthy();
        expect(recovered.result.inference?.outcome).toBe(boundary === 'checkpoint' ? 'value' : 'uncertain');
        if (boundary === 'checkpoint') expect(recovered.result.inference?.value).toBe('wait');
        expect(providerCalls).toBe(before + 1);
        const replay = await submit(0, body, identity, replicas[0]);
        expect(replay.status).toBe(200);
        expect(replay.value.run_id).toBe(call.run_id);
        expect(providerCalls).toBe(before + 1);
        faults.push({
          boundary,
          terminal_status: recovered.status,
          outcome: recovered.result.inference?.outcome,
          provider_calls: 1,
        });
        report.crashes = faults;
      } finally {
        release();
        await locked?.catch(() => {});
        await stop(replica.process, 'SIGKILL');
        holdProviders = false;
        for (const response of held) response.destroy();
        held.clear();
        await pending;
      }
    }
    report.crashes = faults;
    expect((await accounting()).every((value) => value.active === 0 && value.held === '0')).toBe(true);
  },
  180000,
);
