import pg from 'pg';
import { PerformanceObserver, monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fixtureHttpApi } from './http-api';
import { config, isLocal } from '../../packages/core/src/config';
import { pool, authPool, credentialPool, transaction } from '../../packages/db';
import { advanceInference } from '../../packages/core/src/inference-engine';
import { AppError } from '../../packages/core/src/errors';
import { getRun } from '../../packages/core/src/runs';

// This process runs only behind the disposable fixture database wrapper. All
// apparent provider requests are rewritten to the parent's exact loopback server.
const providerOrigin = process.env.IMMEDIATE_FIXTURE_PROVIDER_ORIGIN;
if (
  !process.send ||
  !isLocal() ||
  config.allowPaid ||
  !providerOrigin ||
  new URL(providerOrigin).hostname !== '127.0.0.1' ||
  !new URL(config.databaseUrl).pathname.startsWith('/platform_test_')
)
  throw new Error('Immediate inference acceptance needs local isolated unpaid fixtures.');
const networkFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href !== 'https://api.anthropic.com/v1/messages')
    throw new Error('Unreviewed outbound request in immediate inference acceptance.');
  return networkFetch(providerOrigin + '/messages', init);
};
// The adapter's ordinary provider path is enabled only after the closed transport
// is installed. This cannot reach a real account or Docker.
config.allowPaid = true;
process.env.ANTHROPIC_API_KEY = 'immediate-load-fixture-not-a-provider-key';
let sqlQueries = 0,
  sqlMilliseconds = 0,
  transactionCommits = 0;
const queryTimings = new Map<string, { text: string; count: number; total_ms: number; max_ms: number }>();
const lockTimings = new Map<string, { count: number; total_ms: number; max_ms: number; samples: number[] }>();
const sqlDurations: number[] = [],
  poolDurations: number[] = [];
let poolSamples = 0;
const p95 = (samples: number[]) => {
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
};
const sql = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    const details: unknown = 'detail' in entry ? entry.detail : undefined;
    if (entry.name === 'connect') {
      if (Array.isArray(details) && !details.some((value) => typeof value === 'function'))
        poolDurations[poolSamples++ % 10000] = entry.duration;
      continue;
    }
    sqlQueries++;
    sqlMilliseconds += entry.duration;
    sqlDurations[(sqlQueries - 1) % 10000] = entry.duration;
    const first: unknown = Array.isArray(details) ? details[0] : undefined;
    const text =
      typeof first === 'string'
        ? first
        : first && typeof first === 'object' && 'text' in first
          ? first.text
          : undefined;
    if (typeof text === 'string' && /^COMMIT\b/i.test(text)) transactionCommits++;
    if (typeof text === 'string') {
      // Statement shapes only. No parameter values or SQL string literals enter
      // the report, and shape cardinality stays bounded during sustained load.
      let shape = text
        .replace(/'(?:''|[^'])*'/g, "'?'")
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
      if (text.includes('pg_advisory_xact_lock') && Array.isArray(details)) {
        const parameters: unknown = details[1];
        const identity: unknown = Array.isArray(parameters) ? parameters[0] : undefined;
        const label =
          identity === 'capacity:global'
            ? 'capacity_global'
            : typeof identity === 'string' && identity.startsWith('organization:')
              ? 'organization'
              : typeof identity === 'string' && identity.startsWith('idempotency:')
                ? 'idempotency'
                : typeof identity === 'string' && identity.startsWith('storage:')
                  ? 'storage'
                  : 'other';
        shape = `[${label}] ${shape}`;
        const lock = lockTimings.get(label) ?? { count: 0, total_ms: 0, max_ms: 0, samples: [] };
        lock.samples[lock.count++ % 10000] = entry.duration;
        lock.total_ms += entry.duration;
        lock.max_ms = Math.max(lock.max_ms, entry.duration);
        lockTimings.set(label, lock);
      }
      const key = queryTimings.has(shape) || queryTimings.size < 256 ? shape : '[other statement shapes]';
      const previous = queryTimings.get(key) ?? { text: key, count: 0, total_ms: 0, max_ms: 0 };
      previous.count++;
      previous.total_ms += entry.duration;
      previous.max_ms = Math.max(previous.max_ms, entry.duration);
      queryTimings.set(key, previous);
    }
  }
});
// timerify preserves pg's overloaded method and this binding, including Promise
// completion. Only aggregate counts/durations leave this process; no SQL values.
pg.Client.prototype.query = performance.timerify(pg.Client.prototype.query);
pg.Pool.prototype.connect = performance.timerify(pg.Pool.prototype.connect);
sql.observe({ entryTypes: ['function'] });
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();
let peakRss = process.memoryUsage().rss;
let cpuStarted = process.cpuUsage(),
  sampleStarted = performance.now();
let peakPoolBusy = 0,
  peakPoolWaiting = 0;
const sample = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  peakPoolBusy = Math.max(peakPoolBusy, pool.totalCount - pool.idleCount);
  peakPoolWaiting = Math.max(peakPoolWaiting, pool.waitingCount);
}, 25);
sample.unref();
const api = await fixtureHttpApi({ retainBackground: true });
process.send({ type: 'ready', origin: api.origin, pid: process.pid });
process.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  if (message.type === 'metrics') {
    const cpu = process.cpuUsage(cpuStarted),
      elapsed = performance.now() - sampleStarted;
    process.send?.({
      type: 'metrics',
      pid: process.pid,
      node: process.version,
      sql_queries: sqlQueries,
      sql_milliseconds: sqlMilliseconds,
      sql_query_mean_ms: sqlQueries ? sqlMilliseconds / sqlQueries : 0,
      sql_query_p95_ms: p95(sqlDurations),
      pool_acquisition_p95_ms: p95(poolDurations),
      commits: transactionCommits,
      peak_rss_bytes: peakRss,
      peak_pool_busy: peakPoolBusy,
      peak_pool_waiting: peakPoolWaiting,
      cpu_time_ms: (cpu.user + cpu.system) / 1000,
      measurement_ms: elapsed,
      event_loop_p99_ms: lag.percentile(99) / 1e6,
      query_timings: [...queryTimings.values()].sort((a, b) => b.total_ms - a.total_ms).slice(0, 10),
      // Client round-trip includes server lock wait, networking and scheduling;
      // it is an upper bound on lock wait, not an isolated server wait metric.
      lock_statement_timings: [...lockTimings].map(([kind, value]) => ({
        kind,
        count: value.count,
        mean_ms: value.total_ms / value.count,
        p95_ms: p95(value.samples),
        max_ms: value.max_ms,
      })),
    });
    if ('reset' in message && message.reset) {
      sqlQueries = sqlMilliseconds = transactionCommits = peakPoolBusy = peakPoolWaiting = 0;
      peakRss = process.memoryUsage().rss;
      cpuStarted = process.cpuUsage();
      sampleStarted = performance.now();
      lag.reset();
      queryTimings.clear();
      lockTimings.clear();
      sqlDurations.length = poolDurations.length = 0;
      poolSamples = 0;
    }
  }
  if (
    message.type === 'advance' &&
    'organization' in message &&
    typeof message.organization === 'string' &&
    'run_id' in message &&
    typeof message.run_id === 'string'
  ) {
    const organization = message.organization,
      runId = message.run_id;
    // Only the exported pre-change baseline uses queued inference. The new
    // request owner never asks this fixture to act as a dispatch poller.
    void (async () => {
      for (let step = 0; step < 8; step++) if ((await advanceInference(organization, runId)).done) break;
      const run = await transaction(organization, (tx) => getRun(tx, runId));
      process.send?.({ type: 'advanced', run_id: runId, status: run.status });
    })().catch((error) =>
      process.send?.({
        type: 'error',
        message:
          error instanceof AppError ? `Baseline dispatch failed: ${error.code}` : 'Baseline dispatch failed',
      }),
    );
  }
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(sample);
  lag.disable();
  sql.disconnect();
  await api.close();
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
  process.disconnect?.();
}
process.once('SIGTERM', () => {
  void stop();
});
