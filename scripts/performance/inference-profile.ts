import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { channel } from 'node:diagnostics_channel';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Session } from 'node:inspector/promises';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks';
import pg from 'pg';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { LangfuseTraceSink } from '../../packages/providers/src/langfuse';
import { configureTraceSink, flushTraces, shutdownTracing } from '../../packages/core/src/tracing';
import { decisionExample } from '../../examples/decisions/contracts';
import { pool, authPool, credentialPool, transaction } from '../../packages/db';
import { config, isLocal } from '../../packages/core/src/config';
import { credit } from '../../packages/core/src/ledger';
import { Client } from '../../sdk/typescript/src/index';
import { fixtureAccount } from '../../tests/fixtures/account';
import { fixtureHttpApi } from '../../tests/fixtures/http-api';

assert(process.env.INFERENCE_PROFILE_CHILD === '1' && isLocal() && !config.allowPaid);
assert(/^\/platform_test_[a-f0-9]+$/.test(new URL(config.databaseUrl).pathname));
assert(process.env.OPENROUTER_API_KEY === 'synthetic-inference-profile');
assert(process.env.ANTHROPIC_API_KEY === 'synthetic-inference-profile');
const modelMode = process.env.PROFILE_INFERENCE_MODEL ?? 'jev';
assert(modelMode === 'jev' || modelMode === 'anthropic' || modelMode === 'openrouter-chat');
const generative = modelMode !== 'jev';
const model =
  modelMode === 'jev'
    ? 'typesafe/jev-1.13'
    : modelMode === 'anthropic'
      ? 'claude-haiku-4-5-20251001'
      : 'openai/gpt-5.4-mini';
const provider = modelMode === 'anthropic' ? 'anthropic' : 'openrouter';
const endpoint =
  modelMode === 'jev'
    ? 'https://openrouter.ai/api/alpha/decisions'
    : modelMode === 'anthropic'
      ? 'https://api.anthropic.com/v1/messages'
      : 'https://openrouter.ai/api/v1/chat/completions';
const expectedValue = generative ? { decision: 'yes' } : 'yes';
const providerDelayMs = 20;
const originalExecution = config.execution;
const originalOrchestration = config.orchestration;
assert(process.env.TRACING_ENABLED === 'false');
const tracing = process.env.PROFILE_INFERENCE_TRACING === '1';
const calls = Number(process.env.PROFILE_INFERENCE_CALLS),
  bytes = Number(process.env.PROFILE_INFERENCE_CONTEXT_BYTES),
  rate = Number(process.env.PROFILE_INFERENCE_RATE ?? 0);
assert(Number.isSafeInteger(calls) && calls > 0 && calls <= 200);
assert(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 1_900_000);
assert(Number.isSafeInteger(rate) && rate >= 0 && rate <= 100);
const output = process.env.PROFILE_INFERENCE_OUTPUT;
assert(output && path.isAbsolute(output));
function sourceIdentity() {
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  const untracked = execFileSync(
    'git',
    [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      'apps',
      'packages',
      'scripts',
      'tests',
      'infra',
      'sdk',
    ],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .sort()
    .map((file) => {
      const content = readFileSync(file);
      return { path: file, bytes: content.length, sha256: hash(content) };
    });
  const identity = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    diff_sha256: hash(execFileSync('git', ['diff', '--'])),
    staged_diff_sha256: hash(execFileSync('git', ['diff', '--cached', '--'])),
    untracked,
  };
  return { ...identity, source_sha256: hash(JSON.stringify(identity)) };
}
// Capture before fixture activity; hashes and names identify new modules without
// copying source or customer content into the private performance report.
const source = sourceIdentity();
const statistics = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    mean_ms: values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0,
    min_ms: ordered[0] ?? 0,
    median_ms: values.length
      ? (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2
      : 0,
    p95_ms: ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0,
  };
};
/** Drain the actual official exporter without retaining its spans or encoded
 * content. This measures production OTLP serialization/transport without a
 * remote account or the unbounded heap of InMemorySpanExporter. */
async function traceCollector() {
  const counters = { exports: 0, bytes: 0, rejected: 0, peak_active: 0 };
  let active = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/traces' || active >= 8) {
      counters.rejected++;
      request.resume();
      response.writeHead(503).end();
      return;
    }
    active++;
    counters.peak_active = Math.max(counters.peak_active, active);
    let bytes = 0,
      rejected = false;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      counters.bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024 && !rejected) {
        rejected = true;
        counters.rejected++;
        response.writeHead(413).end();
        request.destroy();
      }
    });
    request.once('end', () => {
      if (rejected) return;
      counters.exports++;
      // Empty ExportTraceServiceResponse is valid in both encodings. The
      // production HTTP exporter installed here sends OTLP/JSON.
      response
        .writeHead(200, {
          'content-type':
            request.headers['content-type'] === 'application/x-protobuf'
              ? 'application/x-protobuf'
              : 'application/json',
        })
        .end();
    });
    request.once('close', () => {
      active--;
    });
    request.once('error', () => {
      if (!rejected) {
        rejected = true;
        counters.rejected++;
      }
      response.destroy();
    });
  });
  server.requestTimeout = server.headersTimeout = 5000;
  server.maxConnections = 8;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}/v1/traces`,
    stats: () => ({ ...counters }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

type Window = { index: number; start: number; end: number };
type Timing = { request: number; stage: string; duration_ms: number };
type SQL = { start: number; duration: number; shape: string; parameterBytes: number };
const windows: Window[] = [],
  stages: Timing[] = [],
  handlers = new Map<number, number>(),
  sql: SQL[] = [],
  upstream: number[] = [],
  queryGroups: { statements: number; started: number; ended: number }[] = [],
  checkout: { start: number; duration: number }[] = [];
let active = -1,
  providerCalls = 0;
const timings = channel('macrofold.inference.timing');
const databaseGroups = channel('macrofold.database.group');
const onGroup = (message: unknown) => {
  if (
    message &&
    typeof message === 'object' &&
    'statements' in message &&
    'started' in message &&
    'ended' in message &&
    typeof message.statements === 'number' &&
    typeof message.started === 'number' &&
    typeof message.ended === 'number'
  )
    queryGroups.push({ statements: message.statements, started: message.started, ended: message.ended });
};
const onTiming = (message: unknown) => {
  if (
    active >= 0 &&
    message &&
    typeof message === 'object' &&
    'stage' in message &&
    'durationMs' in message &&
    typeof message.stage === 'string' &&
    typeof message.durationMs === 'number'
  ) {
    stages.push({ request: active, stage: message.stage, duration_ms: message.durationMs });
    if (message.stage === 'http.total') handlers.set(active, message.durationMs);
  }
};
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    const details = 'detail' in entry ? entry.detail : undefined;
    if (!Array.isArray(details)) continue;
    if (entry.name === 'connect') {
      if (!details.some((value) => typeof value === 'function'))
        checkout.push({ start: entry.startTime, duration: entry.duration });
      continue;
    }
    const first: unknown = details[0];
    const text =
      typeof first === 'string'
        ? first
        : first && typeof first === 'object' && 'text' in first && typeof first.text === 'string'
          ? first.text
          : '';
    if (text)
      sql.push({
        start: entry.startTime,
        duration: entry.duration,
        parameterBytes: (() => {
          const values = typeof first === 'object' && first && 'values' in first ? first.values : details[1];
          return Array.isArray(values)
            ? values.reduce(
                (sum, value: unknown) =>
                  sum +
                  (value === null || value === undefined
                    ? 0
                    : typeof value === 'string'
                      ? Buffer.byteLength(value)
                      : Buffer.isBuffer(value)
                        ? value.length
                        : Buffer.byteLength(JSON.stringify(value))),
                0,
              )
            : 0;
        })(),
        shape: text
          .replace(/'(?:''|[^'])*'/g, "'?'")
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 600),
      });
  }
});
const query = pg.Client.prototype.query,
  connect = pg.Pool.prototype.connect;
const fetchOriginal = globalThis.fetch;
const lag = monitorEventLoopDelay({ resolution: 10 });
const cpu = process.env.PROFILE_INFERENCE_CPU === '1' ? new Session() : undefined;
const collector = tracing ? await traceCollector() : undefined;
const api = await fixtureHttpApi({ retainBackground: true });
let apiClosed = false;
async function closeApi() {
  if (apiClosed) return;
  apiClosed = true;
  await api.close();
}
try {
  // Install before constructing the SDK. Every non-loopback request terminates
  // here; no developer credential, upstream request, retry, or worker is used.
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === api.origin) return fetchOriginal(input, init);
    assert.equal(url.href, endpoint);
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init.headers);
    assert.equal(
      headers.get(provider === 'anthropic' ? 'x-api-key' : 'authorization'),
      provider === 'anthropic' ? 'synthetic-inference-profile' : 'Bearer synthetic-inference-profile',
    );
    if (provider === 'anthropic') assert.equal(headers.get('anthropic-version'), '2023-06-01');
    assert(++providerCalls <= calls + 2);
    const began = performance.now();
    await new Promise((resolve) => setTimeout(resolve, providerDelayMs));
    const inputTokens = Math.ceil(bytes / 6) + 723;
    const identity = { id: `synthetic-${providerCalls}`, model };
    const response = Response.json(
      modelMode === 'jev'
        ? {
            ...identity,
            answers: { decision: { type: 'choice', choice: 'yes' } },
            usage: { input_tokens: inputTokens, output_tokens: 31 },
          }
        : modelMode === 'anthropic'
          ? {
              ...identity,
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: JSON.stringify(expectedValue) }],
              stop_reason: 'end_turn',
              usage: { input_tokens: inputTokens, output_tokens: 31 },
            }
          : {
              ...identity,
              object: 'chat.completion',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: JSON.stringify(expectedValue) },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: inputTokens, completion_tokens: 31, cost: 0.001 },
            },
    );
    upstream.push(performance.now() - began);
    return response;
  };
  // Chat inference must exercise real dynamic catalogue policy, not the
  // simulator's fixture-model shortcut. Only this isolated child changes mode,
  // after installing the closed transport; no worker/container is started.
  if (modelMode === 'openrouter-chat') {
    config.execution = 'docker';
    config.orchestration = 'poller';
    await pool.query(
      "UPDATE model_catalog_cache SET models=$1,fetched_at=clock_timestamp(),refresh_after=now()+interval '1 day' WHERE provider='openrouter'",
      [
        JSON.stringify([
          {
            id: model,
            name: 'Synthetic GPT via OpenRouter',
            tools: true,
            text: true,
            context_tokens: 128000,
            output_tokens: 8192,
            pricing: { prompt: '0.00000075', completion: '0.0000045', request: '0' },
          },
        ]),
      ],
    );
  }
  if (collector) {
    configureTraceSink(
      new LangfuseTraceSink({
        exporter: new OTLPTraceExporter({ url: collector.url, timeoutMillis: 3000 }),
      }),
    );
    process.env.TRACING_ENABLED = 'true';
  }
  config.allowPaid = true;
  const account = await fixtureAccount('Synthetic inference profile');
  await transaction(account.p.organizationId, (tx) =>
    credit(tx, account.p.organizationId, 100_000_000n, 'synthetic-inference-profile'),
  );
  const body = decisionExample('unused', 'triage');
  delete body.workspace_id;
  body.definition.question = generative
    ? { kind: 'json' }
    : { kind: 'choice', criteria: { yes: 'Contains hello', no: 'Does not' } };
  body.definition.output_schema = generative
    ? {
        type: 'object',
        properties: { decision: { type: 'string', enum: ['yes', 'no'] } },
        required: ['decision'],
        additionalProperties: false,
      }
    : { type: 'string', enum: ['yes', 'no'] };
  body.definition.unknown_values = [];
  body.definition.allowed_models = [{ provider, model }];
  body.definition.limits = {
    // The synthetic reservation covers the real generative rate-card bound for
    // up to 1.9 MB of evidence. Nothing is sent to a paid account.
    max_cost_micro_usd: generative ? '5000000' : '100000',
    max_output_tokens: 256,
    timeout_seconds: 120,
  };
  body.model_binding = { provider, model, billing_mode: 'managed' };
  body.context.items[0] = {
    ...body.context.items[0],
    status: 'known',
    value: 'hello '.repeat(Math.ceil(bytes / 6)).slice(0, bytes),
  };
  const client = new Client({ baseURL: api.origin, apiKey: account.key, retries: 0 });
  const samples: {
    index: number;
    e2e_ms: number;
    provider_ms: number;
    adapter_ms: number;
    overhead_ms: number;
    handler_ms: number;
    handler_overhead_ms: number;
    arrival_lag_ms: number;
    intended_start_ms: number;
    submitted_start_ms: number;
    submitted_request_ms: number;
  }[] = [];
  timings.subscribe(onTiming);
  databaseGroups.subscribe(onGroup);
  pg.Client.prototype.query = performance.timerify(query);
  pg.Pool.prototype.connect = performance.timerify(connect);
  observer.observe({ entryTypes: ['function'] });
  lag.enable();
  if (cpu) {
    cpu.connect();
    await cpu.post('Profiler.enable');
    await cpu.post('Profiler.start');
  }
  const startedHost = { load: os.loadavg(), free_memory_bytes: os.freemem() };
  let cohortStarted = 0;
  for (let index = -2; index < calls; index++) {
    if (index === 0) cohortStarted = performance.now();
    // Fixed intended arrivals, not a delay after each response. A slow prior
    // response queues the next single-flight call; never drop/reschedule it or
    // hide its arrival lag from conservative end-to-end latency.
    const intended = index >= 0 && rate ? cohortStarted + (index * 1000) / rate : undefined;
    if (intended !== undefined) {
      while (performance.now() < intended)
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, intended - performance.now())));
    }
    active = index;
    const started = performance.now(),
      before = providerCalls;
    const receipt = await client.inferences.create(body, { idempotencyKey: `profile-${index}` });
    const completed = performance.now();
    assert.equal(receipt.status, 'succeeded');
    assert.deepEqual(receipt.result?.inference?.value, expectedValue);
    assert.equal(providerCalls - before, 1);
    if (index < 0) continue;
    const adapterMs = receipt.result?.inference?.timings_ms?.provider;
    assert(typeof adapterMs === 'number');
    // Exclude only the upstream wait. Request serialization and response
    // normalization are application overhead, even inside the provider port.
    const providerMs = upstream[before],
      handlerMs = handlers.get(index);
    assert(typeof providerMs === 'number');
    assert(typeof handlerMs === 'number');
    const arrival = intended ?? started;
    windows.push({ index, start: started, end: completed });
    samples.push({
      index,
      e2e_ms: completed - arrival,
      provider_ms: providerMs,
      adapter_ms: adapterMs,
      overhead_ms: completed - arrival - providerMs,
      handler_ms: handlerMs,
      handler_overhead_ms: handlerMs - providerMs,
      arrival_lag_ms: started - arrival,
      intended_start_ms: arrival - cohortStarted,
      submitted_start_ms: started - cohortStarted,
      submitted_request_ms: completed - started,
    });
  }
  active = -1;
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (cpu) {
    const { profile } = await cpu.post('Profiler.stop');
    await writeFile(path.join(output, 'cpu.cpuprofile'), JSON.stringify(profile), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  // Outside measured windows: finish retained capture callbacks and export
  // remaining batches, then verify durable accounting rather than just HTTP.
  await closeApi();
  if (tracing) await flushTraces();
  const financial = await transaction(
    account.p.organizationId,
    async (tx) =>
      (
        await tx.query<{
          runs: number;
          succeeded: number;
          invalid_invocations: number;
          invalid_usage: number;
          model_held: string;
          wallet_held: string;
          wallet_matches_cost: boolean;
          in_flight: number;
        }>(
          `SELECT count(*)::integer AS runs,
       count(*) FILTER(WHERE status='succeeded')::integer AS succeeded,
       count(*) FILTER(WHERE (SELECT count(*) FROM decision_invocations i WHERE i.run_id=r.id)<>1)::integer AS invalid_invocations,
       count(*) FILTER(WHERE (SELECT count(*) FROM model_usage u WHERE u.run_id=r.id)<>1)::integer AS invalid_usage,
       coalesce(sum(model_reserved_micro_usd),0)::text AS model_held,
       (SELECT reserved_micro_usd::text FROM organizations WHERE id=$1) AS wallet_held,
       (SELECT balance_micro_usd FROM organizations WHERE id=$1)=$2::bigint-coalesce(sum(cost_micro_usd),0) AS wallet_matches_cost,
       (SELECT count(*)::integer FROM gateway_requests WHERE organization_id=$1 AND status='in_flight') AS in_flight
       FROM runs r WHERE organization_id=$1`,
          [account.p.organizationId, '100000000'],
        )
      ).rows[0],
  );
  assert.equal(financial.runs, calls + 2);
  assert.equal(financial.succeeded, calls + 2);
  assert.equal(financial.invalid_invocations, 0);
  assert.equal(financial.invalid_usage, 0);
  assert.equal(financial.model_held, '0');
  assert.equal(financial.wallet_held, '0');
  assert.equal(financial.in_flight, 0);
  assert.equal(financial.wallet_matches_cost, true);
  const traceExport = collector?.stats();
  if (traceExport) {
    assert(traceExport.exports > 0 && traceExport.bytes > 0);
    assert.equal(traceExport.rejected, 0);
  }
  const groups = new Map<string, number[]>();
  for (const item of sql)
    if (windows.some((w) => item.start >= w.start && item.start <= w.end)) {
      const group = groups.get(item.shape) || [];
      group.push(item.duration);
      groups.set(item.shape, group);
    }
  const report = {
    at: new Date().toISOString(),
    node: process.version,
    source,
    synthetic_provider: true,
    model_mode: modelMode,
    model_binding: body.model_binding,
    input_shape: 'explicit-context-typed',
    synthetic_provider_delay_ms: providerDelayMs,
    tracing_enabled: tracing,
    trace_export: tracing ? 'official-sdk-otlp-http-loopback-drain' : 'disabled',
    trace_export_encoding: tracing ? 'otlp-http/json' : null,
    trace_export_totals: traceExport ?? null,
    financial_verification: financial,
    paid_calls: 0,
    warmups: 2,
    provider_calls: providerCalls,
    arrival_rate: {
      generator: rate ? 'single-flight-fixed-intended-cadence' : 'single-flight-back-to-back',
      intended_requests_per_second: rate || null,
      actual_submissions_per_second:
        samples.length > 1
          ? ((samples.length - 1) * 1000) /
            (samples[samples.length - 1].submitted_start_ms - samples[0].submitted_start_ms)
          : null,
      arrival_lag: statistics(samples.map((sample) => sample.arrival_lag_ms)),
    },
    context_bytes: bytes,
    request_bytes: Buffer.byteLength(JSON.stringify(body)),
    host: {
      started: startedHost,
      finished: { load: os.loadavg(), free_memory_bytes: os.freemem() },
      cpus: os.availableParallelism(),
      event_loop_p99_ms: lag.percentile(99) / 1e6,
    },
    overhead: statistics(samples.map((sample) => sample.overhead_ms)),
    handler_overhead: statistics(samples.map((sample) => sample.handler_overhead_ms)),
    handler: statistics(samples.map((sample) => sample.handler_ms)),
    end_to_end: statistics(samples.map((sample) => sample.e2e_ms)),
    provider_wait: statistics(samples.map((sample) => sample.provider_ms)),
    samples,
    database: windows.map((window) => {
      const statements = sql.filter((item) => item.start >= window.start && item.start <= window.end);
      const groups = queryGroups.filter((item) => item.started >= window.start && item.started <= window.end);
      return {
        index: window.index,
        statements: statements.length,
        wait_groups:
          statements.length - groups.reduce((sum, item) => sum + item.statements, 0) + groups.length,
        commits: statements.filter((item) => item.shape === 'COMMIT').length,
        parameter_bytes: statements.reduce((sum, item) => sum + item.parameterBytes, 0),
      };
    }),
    stages,
    pool_acquisition: statistics(
      checkout
        .filter((item) => windows.some((w) => item.start >= w.start && item.start <= w.end))
        .map((item) => item.duration),
    ),
    sql: [...groups]
      .map(([statement, durations]) => ({
        statement,
        ...statistics(durations),
        total_ms: durations.reduce((sum, n) => sum + n, 0),
      }))
      .sort((a, b) => b.total_ms - a.total_ms),
  };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      model_mode: modelMode,
      overhead: report.overhead,
      handler_overhead: report.handler_overhead,
      arrival_rate: report.arrival_rate,
      end_to_end: report.end_to_end,
      provider_wait: report.provider_wait,
      paid_calls: 0,
    }),
  );
} finally {
  config.allowPaid = false;
  config.execution = originalExecution;
  config.orchestration = originalOrchestration;
  globalThis.fetch = fetchOriginal;
  pg.Client.prototype.query = query;
  pg.Pool.prototype.connect = connect;
  observer.disconnect();
  timings.unsubscribe(onTiming);
  databaseGroups.unsubscribe(onGroup);
  lag.disable();
  cpu?.disconnect();
  try {
    await closeApi();
    if (tracing) await shutdownTracing();
  } finally {
    await collector?.close();
    await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
  }
}
