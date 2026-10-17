import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { channel } from 'node:diagnostics_channel';
import { writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks';
import pg from 'pg';
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
assert(process.env.TRACING_ENABLED === 'false');
const calls = Number(process.env.PROFILE_INFERENCE_CALLS),
  bytes = Number(process.env.PROFILE_INFERENCE_CONTEXT_BYTES);
assert(Number.isSafeInteger(calls) && calls > 0 && calls <= 200);
assert(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 1_900_000);
const output = process.env.PROFILE_INFERENCE_OUTPUT;
assert(output && path.isAbsolute(output));
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
type Window = { index: number; start: number; end: number };
type Timing = { request: number; stage: string; duration_ms: number };
type SQL = { start: number; duration: number; shape: string };
const windows: Window[] = [],
  stages: Timing[] = [],
  sql: SQL[] = [],
  checkout: { start: number; duration: number }[] = [];
let active = -1,
  providerCalls = 0;
const timings = channel('macrofold.inference.timing');
const onTiming = (message: unknown) => {
  if (
    active >= 0 &&
    message &&
    typeof message === 'object' &&
    'stage' in message &&
    'durationMs' in message &&
    typeof message.stage === 'string' &&
    typeof message.durationMs === 'number'
  )
    stages.push({ request: active, stage: message.stage, duration_ms: message.durationMs });
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
const api = await fixtureHttpApi({ retainBackground: true });
try {
  // Install before constructing the SDK. Every non-loopback request terminates
  // here; no developer credential, upstream request, retry, or worker is used.
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === api.origin) return fetchOriginal(input, init);
    assert.equal(url.href, 'https://openrouter.ai/api/alpha/decisions');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic-inference-profile');
    assert(++providerCalls <= calls + 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return Response.json({
      id: `synthetic-${providerCalls}`,
      model: 'typesafe/jev-1.13',
      answers: { decision: { type: 'choice', choice: 'yes' } },
      usage: { input_tokens: Math.ceil(bytes / 6) + 723, output_tokens: 31 },
    });
  };
  config.allowPaid = true;
  const account = await fixtureAccount('Synthetic inference profile');
  await transaction(account.p.organizationId, (tx) =>
    credit(tx, account.p.organizationId, 100_000_000n, 'synthetic-inference-profile'),
  );
  const body = decisionExample('unused', 'triage');
  delete body.workspace_id;
  body.definition.question = { kind: 'choice', criteria: { yes: 'Contains hello', no: 'Does not' } };
  body.definition.output_schema = { type: 'string', enum: ['yes', 'no'] };
  body.definition.unknown_values = [];
  body.definition.allowed_models = [{ provider: 'openrouter', model: 'typesafe/jev-1.13' }];
  body.definition.limits = { max_cost_micro_usd: '100000', max_output_tokens: 256, timeout_seconds: 120 };
  body.model_binding = { provider: 'openrouter', model: 'typesafe/jev-1.13', billing_mode: 'managed' };
  body.context.items[0] = {
    ...body.context.items[0],
    status: 'known',
    value: 'hello '.repeat(Math.ceil(bytes / 6)).slice(0, bytes),
  };
  const client = new Client({ baseURL: api.origin, apiKey: account.key, retries: 0 });
  const samples: { index: number; e2e_ms: number; provider_ms: number; overhead_ms: number }[] = [];
  timings.subscribe(onTiming);
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
  for (let index = -2; index < calls; index++) {
    active = index;
    const started = performance.now(),
      before = providerCalls;
    const receipt = await client.inferences.create(body, { idempotencyKey: `profile-${index}` });
    const completed = performance.now();
    assert.equal(receipt.status, 'succeeded');
    assert.equal(providerCalls - before, 1);
    if (index < 0) continue;
    const providerMs = receipt.result?.inference?.timings_ms?.provider;
    assert(typeof providerMs === 'number');
    windows.push({ index, start: started, end: completed });
    samples.push({
      index,
      e2e_ms: completed - started,
      provider_ms: providerMs,
      overhead_ms: completed - started - providerMs,
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
    source: {
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      diff_sha256: createHash('sha256')
        .update(execFileSync('git', ['diff', '--']))
        .digest('hex'),
    },
    synthetic_provider: true,
    paid_calls: 0,
    warmups: 2,
    provider_calls: providerCalls,
    context_bytes: bytes,
    request_bytes: Buffer.byteLength(JSON.stringify(body)),
    host: {
      started: startedHost,
      finished: { load: os.loadavg(), free_memory_bytes: os.freemem() },
      cpus: os.availableParallelism(),
      event_loop_p99_ms: lag.percentile(99) / 1e6,
    },
    overhead: statistics(samples.map((sample) => sample.overhead_ms)),
    end_to_end: statistics(samples.map((sample) => sample.e2e_ms)),
    samples,
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
  console.log(JSON.stringify({ overhead: report.overhead, end_to_end: report.end_to_end, paid_calls: 0 }));
} finally {
  config.allowPaid = false;
  globalThis.fetch = fetchOriginal;
  pg.Client.prototype.query = query;
  pg.Pool.prototype.connect = connect;
  observer.disconnect();
  timings.unsubscribe(onTiming);
  lag.disable();
  cpu?.disconnect();
  try {
    await api.close();
  } finally {
    await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
  }
}
