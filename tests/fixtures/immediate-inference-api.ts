import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fixtureHttpApi } from './http-api';
import { config, isLocal } from '../../packages/core/src/config';
import { pool, authPool, credentialPool, transaction } from '../../packages/db';
import { advanceInference } from '../../packages/core/src/inference-engine';
import { AppError } from '../../packages/core/src/errors';
import { getRun } from '../../packages/core/src/runs';
import { immediateInferencePolicy } from '../../packages/core/src/direct-inference';
import { configurePerformance, capturePerformanceTicket } from '../../packages/core/src/performance';
import { observeDatabasePools } from '../../packages/db/diagnostics';

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
// Shorten only this isolated process's local SQL retry attempt for the real
// exceptional-checkpoint crash fixture. Production defaults remain unchanged.
const persistenceAttempt = Number(process.env.IMMEDIATE_FIXTURE_PERSISTENCE_ATTEMPT_MS);
if (process.env.IMMEDIATE_FIXTURE_PERSISTENCE_ATTEMPT_MS !== undefined) {
  if (!Number.isSafeInteger(persistenceAttempt) || persistenceAttempt < 1 || persistenceAttempt > 1000)
    throw new Error('Invalid fixture persistence attempt.');
  Object.assign(immediateInferencePolicy, { persistenceAttemptMs: persistenceAttempt });
}
let sqlQueries = 0,
  sqlMilliseconds = 0,
  transactionCommits = 0;
// Same observer as ordinary serving. Individual query percentiles/lock labels
// are unavailable from bounded operation summaries and are not invented here.
const profiler = configurePerformance({
  sampleRate: 1,
  durationSeconds: 3600,
  sink: {
    enqueue(record) {
      if (record.type !== 'operation') return;
      sqlQueries += record.counters.statements ?? 0;
      sqlMilliseconds += record.stages['db.query']?.total_ms ?? 0;
      transactionCommits += record.counters.commits ?? 0;
    },
    flush: async () => {},
    close: async () => {},
  },
});
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
      metrics_boundary: 'correlated-operation-aggregates',
      commits: transactionCommits,
      peak_rss_bytes: peakRss,
      peak_pool_busy: peakPoolBusy,
      peak_pool_waiting: peakPoolWaiting,
      cpu_time_ms: (cpu.user + cpu.system) / 1000,
      measurement_ms: elapsed,
      event_loop_p99_ms: lag.percentile(99) / 1e6,
    });
    if ('reset' in message && message.reset) {
      sqlQueries = sqlMilliseconds = transactionCommits = peakPoolBusy = peakPoolWaiting = 0;
      peakRss = process.memoryUsage().rss;
      cpuStarted = process.cpuUsage();
      sampleStarted = performance.now();
      lag.reset();
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
  await api.close();
  await profiler.close();
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
  process.disconnect?.();
}
process.once('SIGTERM', () => {
  void stop();
});
