import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { Session } from 'node:inspector/promises';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { LangfuseTraceSink } from '../../packages/providers/src/langfuse';
import {
  configureTraceSink,
  flushTraces,
  shutdownTracing,
  tracingContentEnabled,
} from '../../packages/core/src/tracing';
import { requestObservationPolicy } from '../../packages/core/src/request-observations';
import { decisionExample } from '../../examples/decisions/contracts';
import { pool, authPool, credentialPool, transaction } from '../../packages/db';
import { config, isLocal } from '../../packages/core/src/config';
import { credit } from '../../packages/core/src/ledger';
import { fixtureAccount } from '../../tests/fixtures/account';
import { fixtureHttpApi, fixtureRequestKey } from '../../tests/fixtures/http-api';
import { configurePerformance, capturePerformanceTicket } from '../../packages/core/src/performance';
import { observeDatabasePools } from '../../packages/db/diagnostics';
import type { PerformanceRecord } from '../../packages/contracts/performance';
import { PerformanceJsonlSink, privatePerformanceFile } from '../../packages/providers/src/performance-jsonl';
import type { PeerCommand, PeerReply } from './inference-peer';
import { fixtureCpuAffinity } from './fixture-affinity';

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
  warmupCount = Number(process.env.PROFILE_INFERENCE_WARMUPS ?? 2),
  bytes = Number(process.env.PROFILE_INFERENCE_CONTEXT_BYTES),
  rate = Number(process.env.PROFILE_INFERENCE_RATE ?? 0);
assert(Number.isSafeInteger(calls) && calls > 0 && calls <= 10000);
assert(Number.isSafeInteger(warmupCount) && warmupCount >= 0 && warmupCount <= 200);
assert(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 1_900_000);
assert(Number.isSafeInteger(rate) && rate >= 0 && rate <= 100);
const concurrency = Number(process.env.PROFILE_INFERENCE_CONCURRENCY ?? 1);
assert(Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 64);
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
// Auxiliary work is outside measured API-process CPU. Messages contain only
// synthetic fixture credentials/content and bounded per-call numeric results.
const peer = fork(fileURLToPath(new URL('./inference-peer.ts', import.meta.url)), [], {
  execArgv: ['--import', 'tsx'],
  env: { ...process.env, INFERENCE_PROFILE_PEER: '1' },
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  serialization: 'advanced',
});
function peerReply(timeoutMs = 30000): Promise<PeerReply> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      peer.removeListener('message', message);
      peer.removeListener('exit', exited);
      peer.removeListener('error', failed);
    };
    const failed = () => {
      cleanup();
      reject(new Error('Isolated inference peer failed.'));
    };
    const message = (reply: PeerReply) => {
      cleanup();
      if (reply.type === 'failed') reject(new Error('Isolated inference peer failed.'));
      else resolve(reply);
    };
    const exited = () => failed();
    const timer = setTimeout(failed, timeoutMs);
    peer.once('message', message);
    peer.once('exit', exited);
    peer.once('error', failed);
    if (peer.exitCode !== null || peer.signalCode !== null) failed();
  });
}
async function commandPeer(command: PeerCommand, timeoutMs?: number) {
  const reply = peerReply(timeoutMs);
  peer.send(command, (error) => {
    if (error) peer.emit('error', error);
  });
  return reply;
}
const ready = await peerReply();
assert.equal(ready.type, 'ready');
assert(ready.type === 'ready');
assert.equal(!!ready.traceURL, tracing);
const traceURL = ready.traceURL;
type Window = { index: number; runId: string };
const windows: Window[] = [];
const handlerSamples = new Map<
  string,
  { requestId: string | null; runId: string | null; durationMs: number }
>();
const upstream = new Map<string, number>();
const profiles: PerformanceRecord[] = [];
let providerCalls = 0;
const observerMode = process.env.PROFILE_INFERENCE_OBSERVER ?? 'light';
assert(['off', 'light', 'cpu'].includes(observerMode));
const profileSampleRate = Number(process.env.PROFILE_INFERENCE_SAMPLE_RATE ?? 1);
assert(Number.isFinite(profileSampleRate) && profileSampleRate >= 0 && profileSampleRate <= 1);
const profileDirectory = path.join(output, 'performance');
const profileStream = observerMode === 'off' ? undefined : await privatePerformanceFile(profileDirectory);
const profileSink = profileStream ? new PerformanceJsonlSink(profileStream, true) : undefined;
const profiler = profileSink
  ? configurePerformance({
      sampleRate: profileSampleRate,
      durationSeconds: 3600,
      sink: profileSink,
    })
  : undefined;
if (profiler)
  profiler.onClose(
    observeDatabasePools(
      [
        [pool, 'domain'],
        [authPool, 'identity'],
        [credentialPool, 'credential'],
      ],
      capturePerformanceTicket,
      profiler.unattributed,
    ),
  );
const fetchOriginal = globalThis.fetch;
// Identical fixture diagnostics in disabled and enabled observer cohorts.
const lag = monitorEventLoopDelay({ resolution: 20 });
const cpu = observerMode === 'cpu' || process.env.PROFILE_INFERENCE_CPU === '1' ? new Session() : undefined;
const api = await fixtureHttpApi({
  retainBackground: true,
  onResponse: (sample) => {
    handlerSamples.set(sample.key, sample);
  },
});
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
    assert(++providerCalls <= calls + warmupCount);
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
    upstream.set(fixtureRequestKey() ?? '', performance.now() - began);
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
  if (traceURL) {
    process.env.TRACING_ENABLED = 'true';
    configureTraceSink(
      new LangfuseTraceSink({
        exporter: new OTLPTraceExporter({ url: traceURL, timeoutMillis: 3000 }),
      }),
    );
    process.env.TRACING_ENABLED = 'true';
  }
  config.allowPaid = true;
  const account = await fixtureAccount('Synthetic inference profile');
  // Synthetic funds scale with this bounded cohort's maximum reservation;
  // sustained/concurrent qualification must not fail on a tiny fixture wallet.
  const initialCredit = BigInt(calls + warmupCount) * (generative ? 5_000_000n : 100_000n) + 100_000_000n;
  await transaction(account.p.organizationId, (tx) =>
    credit(tx, account.p.organizationId, initialCredit, 'synthetic-inference-profile'),
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
  assert.equal(
    (
      await commandPeer({
        type: 'configure',
        configuration: {
          origin: api.origin,
          key: account.key,
          body,
          expected: expectedValue,
          calls,
          warmups: warmupCount,
          rate,
          concurrency,
        },
      })
    ).type,
    'configured',
  );
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
  lag.enable();
  if (warmupCount) {
    const warmups = await commandPeer({ type: 'invoke', warmup: true });
    assert(warmups.type === 'result');
    assert.equal(warmups.samples.length, warmupCount);
  }
  await api.drainBackground();
  if (tracing) await flushTraces();
  await profiler?.flush();
  lag.reset();
  const startedHost = { load: os.loadavg(), free_memory_bytes: os.freemem() };
  if (cpu) {
    cpu.connect();
    await cpu.post('Profiler.enable');
    await cpu.post('Profiler.start');
  }
  const cpuStarted = process.cpuUsage(),
    heapStarted = process.memoryUsage(),
    measurementStarted = performance.now();
  const invoked = await commandPeer(
    { type: 'invoke', warmup: false },
    Math.min(3600000, Math.max(300000, 120000 + (calls * 1000) / (rate || 1))),
  );
  assert(invoked.type === 'result');
  assert.equal(invoked.samples.length, calls);
  assert.equal(providerCalls, calls + warmupCount);
  assert(!profiler || profiler.active(), 'Profiling capture expired during qualification.');
  // Include all request-retained callbacks and actual trace/JSONL drain CPU,
  // stopping before invariant SQL, JSONL parsing and report construction.
  await api.drainBackground();
  if (tracing) await flushTraces();
  await profiler?.close();
  if (profileStream) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        finished(profileStream),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Qualification JSONL drain timed out.')), 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const measuredCpu = process.cpuUsage(cpuStarted),
    measuredWallMs = performance.now() - measurementStarted,
    measuredMemory = process.memoryUsage();
  lag.disable();
  const loopP99 = lag.percentile(99) / 1e6;
  if (cpu) {
    const { profile } = await cpu.post('Profiler.stop');
    await writeFile(path.join(output, 'cpu.cpuprofile'), JSON.stringify(profile), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  let profileBytes: number | null = null;
  if (profileStream) {
    const files = await readdir(profileDirectory);
    assert.equal(files.length, 1);
    const file = path.join(profileDirectory, files[0]);
    profileBytes = (await stat(file)).size;
    for (const line of (await readFile(file, 'utf8')).split('\n'))
      if (line) profiles.push(JSON.parse(line) as PerformanceRecord);
    assert.equal(profileSink?.stats().dropped, 0, 'Qualification lost profiling records.');
    assert.equal(profileSink?.stats().written, profiles.length);
  }
  for (const sample of invoked.samples) {
    const providerMs = upstream.get(`profile-${sample.index}`),
      handlerMs = handlerSamples.get(`profile-${sample.index}`)?.durationMs;
    assert(typeof providerMs === 'number' && typeof handlerMs === 'number');
    windows.push({ index: sample.index, runId: sample.runId });
    samples.push({
      index: sample.index,
      e2e_ms: sample.e2eMs,
      provider_ms: providerMs,
      adapter_ms: sample.adapterMs,
      overhead_ms: sample.e2eMs - providerMs,
      handler_ms: handlerMs,
      handler_overhead_ms: handlerMs - providerMs,
      arrival_lag_ms: sample.arrivalLagMs,
      intended_start_ms: sample.intendedStartMs,
      submitted_start_ms: sample.submittedStartMs,
      submitted_request_ms: sample.submittedRequestMs,
    });
  }
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
          [account.p.organizationId, initialCredit.toString()],
        )
      ).rows[0],
  );
  assert.equal(financial.runs, calls + warmupCount);
  assert.equal(financial.succeeded, calls + warmupCount);
  assert.equal(financial.invalid_invocations, 0);
  assert.equal(financial.invalid_usage, 0);
  assert.equal(financial.model_held, '0');
  assert.equal(financial.wallet_held, '0');
  assert.equal(financial.in_flight, 0);
  assert.equal(financial.wallet_matches_cost, true);
  const traceStats = await commandPeer({ type: 'stats' });
  assert(traceStats.type === 'stats');
  const traceExport = tracing ? traceStats.counters : undefined;
  if (traceExport) {
    assert(traceExport.exports > 0 && traceExport.bytes > 0);
    assert.equal(traceExport.rejected, 0);
  }
  await profiler?.flush();
  const windowsByRun = new Map(windows.map((window) => [window.runId, window]));
  const foregroundByRun = new Map(
    profiles.filter((profile) => profile.phase === 'foreground').map((profile) => [profile.run_id, profile]),
  );
  const stages = profiles.flatMap((profile) => {
    const sample = profile.run_id ? windowsByRun.get(profile.run_id) : undefined;
    if (!sample || profile.phase !== 'foreground') return [];
    return Object.entries(profile.stages).map(([stage, value]) => ({
      request: sample.index,
      stage,
      duration_ms: value.total_ms,
      count: value.count,
    }));
  });
  const report = {
    report_version: 3,
    attribution: 'submission-correlated-scopes',
    profiling_observer: observerMode,
    profiling_sample_rate: observerMode === 'off' ? 0 : profileSampleRate,
    profiling_installed: observerMode !== 'off',
    profiling_sink: observerMode === 'off' ? 'disabled' : 'production-jsonl-private-file',
    profiling_sink_bytes: profileBytes,
    profiling_sink_stats: profileSink?.stats() ?? null,
    at: new Date().toISOString(),
    node: process.version,
    source,
    synthetic_provider: true,
    model_mode: modelMode,
    model_binding: body.model_binding,
    input_shape: 'explicit-context-typed',
    synthetic_provider_delay_ms: providerDelayMs,
    tracing_enabled: tracing,
    tracing_capture_content: tracingContentEnabled(),
    request_observation_policy: requestObservationPolicy(),
    trace_export: tracing ? 'official-sdk-otlp-http-loopback-drain' : 'disabled',
    trace_export_encoding: tracing ? 'otlp-http/json' : null,
    trace_export_totals: traceExport ?? null,
    financial_verification: financial,
    process_cpu_including_background_drain: measuredCpu,
    process_cpu_boundary:
      'api-server-after-warmup-drain-through-business-trace-jsonl-drain-before-invariant-sql-and-reporting',
    cpu_excluded_processes: ['sdk-load-generator', 'otlp-http-receiver'],
    process_ids: { api_server: process.pid, sdk_and_otlp_peer: peer.pid },
    cpu_affinity: { api_server: fixtureCpuAffinity(), sdk_and_otlp_peer: ready.cpuAffinity },
    measurement_wall_ms: measuredWallMs,
    memory: { started: heapStarted, finished: measuredMemory },
    profiling_drops: profiles.filter((record) => record.type === 'capture').map((record) => record.dropped),
    paid_calls: 0,
    warmups: warmupCount,
    provider_calls: providerCalls,
    arrival_rate: {
      generator: rate ? 'bounded-concurrency-fixed-intended-cadence' : 'bounded-concurrency-back-to-back',
      concurrency,
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
      event_loop_p99_ms: loopP99,
    },
    overhead: statistics(samples.map((sample) => sample.overhead_ms)),
    handler_overhead: statistics(samples.map((sample) => sample.handler_overhead_ms)),
    handler: statistics(samples.map((sample) => sample.handler_ms)),
    end_to_end: statistics(samples.map((sample) => sample.e2e_ms)),
    provider_wait: statistics(samples.map((sample) => sample.provider_ms)),
    samples,
    database: windows.map((window) => {
      const root = foregroundByRun.get(window.runId);
      return {
        index: window.index,
        statements: root?.counters.statements ?? null,
        wait_groups: root?.counters.groups ?? null,
        commits: root?.counters.commits ?? null,
        parameter_bytes: root?.counters.parameter_bytes ?? null,
        unknown_parameters: root?.counters.unknown_parameters ?? null,
      };
    }),
    stages,
    profiles,
    pool_acquisition: {
      boundary: 'aggregate submission-to-grant',
      samples: profiles.map((profile) => profile.stages['db.checkout']).filter(Boolean),
    },
    sql: [], // Raw/static query shapes are no longer collected by this serving observer.
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
  await profiler?.close();
  lag.disable();
  cpu?.disconnect();
  try {
    await closeApi();
    if (tracing) await shutdownTracing();
  } finally {
    try {
      if (peer.connected) assert.equal((await commandPeer({ type: 'stop' })).type, 'stopped');
    } finally {
      if (peer.exitCode === null && peer.signalCode === null) peer.kill('SIGTERM');
      await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
    }
  }
}
