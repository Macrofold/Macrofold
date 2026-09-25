import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { once } from 'node:events';
import type { ExecutionProvider } from '../../packages/providers/src/execution';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const reportPath = '/tmp/worker-stress.json';
const runCount = Number(process.env.WORKER_STRESS_RUNS || 128);
if (!Number.isSafeInteger(runCount) || runCount < 32 || runCount > 512)
  throw new Error('WORKER_STRESS_RUNS must be an integer between 32 and 512.');
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    Math.round((sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] || 0) * 100) /
    100;
  return {
    samples: sorted.length,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    p99_ms: percentile(0.99),
    max_ms: percentile(1),
  };
}
async function parallel<T>(
  count: number,
  concurrency: number,
  action: (index: number) => Promise<T>,
): Promise<T[]> {
  const output: T[] = new Array(count);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(count, concurrency) }, async () => {
      while (next < count) {
        const index = next++;
        output[index] = await action(index);
      }
    }),
  );
  return output;
}

async function workload() {
  const { config } = await import('../../packages/core/src/config');
  if (
    config.mode !== 'local' ||
    config.execution !== 'simulator' ||
    config.allowPaid ||
    !process.env.DATABASE_URL?.includes('platform_test_')
  )
    throw new Error('This workload requires its own disposable unpaid database.');
  const { fixtureAccount } = await import('../../tests/fixtures/account');
  const { Client } = await import('../../sdk/typescript/src/client');
  const { handleApi } = await import('../../packages/core/src/http');
  const { pool, authPool, credentialPool, transaction } = await import('../../packages/db');
  const { credit } = await import('../../packages/core/src/ledger');
  const { startRun } = await import('../../packages/core/src/engine');
  const { pendingRunCandidates } = await import('../../packages/core/src/scheduling');
  const { reconcileWorker } = await import('../../packages/core/src/worker-reconciler');
  const { id } = await import('../../packages/core/src/crypto');
  const lag = monitorEventLoopDelay({ resolution: 20 });
  const started = performance.now();
  const timings = { admission: [] as number[], listing: [] as number[], execution: [] as number[] };
  const stats = {
    accepted_runs: 0,
    completed_runs: 0,
    scheduling_deferrals: 0,
    peak_execution_concurrency: 0,
    peak_hosts: 0,
    observed_allocations: 0,
    rounds: 0,
    violations: 0,
    paid_api_calls: 0,
  };
  let activeExecutions = 0;
  let status = 'failed';
  let failure: string | undefined;
  const server = createServer(async (incoming, outgoing) => {
    try {
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) {
        const value = Buffer.from(chunk);
        bytes += value.length;
        if (bytes > 4 * 1024 * 1024) throw new Error('Workload request exceeded its body limit.');
        chunks.push(value);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers))
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const response = await handleApi(
        new Request(config.origin + incoming.url, {
          method: incoming.method,
          headers,
          ...(bytes ? { body: Buffer.concat(chunks).toString('utf8') } : {}),
        }),
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end('{"error":{"code":"workload_transport_failed"}}');
    }
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback listener.');
    const account = await fixtureAccount('Worker load exercise');
    const org = account.p.organizationId;
    await transaction(org, async (tx) => {
      await credit(tx, org, 100000000n, `worker-load:${id()}`);
      await tx.query("UPDATE organizations SET plan='scale' WHERE id=$1", [org]);
    });
    const client = new Client({
      baseURL: `http://127.0.0.1:${address.port}`,
      apiKey: account.key,
      retries: 0,
    });
    const worker = await client.request('createWorker', {
      body: {
        name: 'Bounded agent load',
        compute: 'server',
        dedicated: true,
        isolate_runs: false,
        min_instances: 0,
        max_instances: 4,
        max_concurrency: 32,
        max_hourly_compute_cost_micro_usd: '1000000',
      },
    });
    await parallel(20, 4, async (index) =>
      client.request('createWorker', {
        body: {
          name: `Dormant observation ${index}`,
          compute: 'server',
          dedicated: true,
          isolate_runs: false,
          max_instances: 1,
          min_instances: 0,
          max_hourly_compute_cost_micro_usd: '1000000',
        },
      }),
    );
    lag.enable();
    const accepted = await parallel(runCount, 8, async (index) => {
      const workspace = await client.request('createWorkspace', { body: { name: `Character ${index}` } });
      const at = performance.now();
      const result = await client.request('createRun', {
        body: {
          worktree_id: workspace.default_worktree_id!,
          worker_id: worker.id,
          prompt: 'Perform one bounded synthetic character turn.',
          harness: 'codex',
          model: 'fixture-model',
          billing_mode: 'managed',
          memory_mib: 256,
          cpu_millis: 125,
          queue_timeout_seconds: 600,
          limits: { timeout_seconds: 30, max_cost_micro_usd: '100000' },
        },
      });
      timings.admission.push(performance.now() - at);
      if (result.worker_id !== worker.id)
        throw new Error('Worker identity was lost at the public API boundary.');
      stats.accepted_runs++;
      return result;
    });
    const syntheticExecution: ExecutionProvider = {
      async execute(input, emit) {
        const at = performance.now();
        activeExecutions++;
        stats.peak_execution_concurrency = Math.max(stats.peak_execution_concurrency, activeExecutions);
        try {
          await emit({ type: 'runtime.started', data: { simulated: true, harness: input.harness } });
          // This delay represents model/tool waiting, not real model/provider capacity.
          await sleep(2000);
          if (input.signal.aborted) throw input.signal.reason;
          return {
            output: 'Synthetic character turn complete',
            files: [
              ...input.files,
              {
                path: 'notes/turn.txt',
                bytes: Buffer.from('verified character output\n'.repeat(128)),
              },
            ],
            resumeState: '{"turn":1}',
            inputTokens: 0,
            outputTokens: 0,
            usageComplete: true,
          };
        } finally {
          activeExecutions--;
          timings.execution.push(performance.now() - at);
        }
      },
    };
    const remaining = new Set(accepted.map((run) => run.run_id));
    const deadline = Date.now() + 240000;
    async function observe() {
      const hosts = await transaction(org, (tx) =>
        tx.query<{
          occupied: number;
          memory: number;
          cpu: number;
          capacity: number;
          memory_mib: number;
          cpu_millis: number;
        }>(
          `SELECT h.capacity,h.memory_mib,h.cpu_millis,count(a.id)::integer AS occupied,
          coalesce(sum(a.memory_mib),0)::integer AS memory,coalesce(sum(a.cpu_millis),0)::integer AS cpu
         FROM hosts h LEFT JOIN host_runs a ON a.host_id=h.id AND a.released_at IS NULL
         WHERE h.worker_id=$1 AND h.status<>'stopped' GROUP BY h.id`,
          [worker.id],
        ),
      );
      stats.peak_hosts = Math.max(stats.peak_hosts, hosts.rows.length);
      stats.observed_allocations += hosts.rows.length;
      for (const host of hosts.rows) {
        if (
          host.occupied > host.capacity ||
          host.cpu > host.cpu_millis ||
          host.memory > host.memory_mib - Math.min(512, Math.ceil(host.memory_mib / 8))
        ) {
          stats.violations++;
          throw new Error('Host resource ownership exceeded its accepted allocation.');
        }
      }
    }
    const inFlight = new Map<string, Promise<void>>();
    let executionError: unknown;
    let reconcileAt = 0;
    try {
      while (remaining.size) {
        if (executionError) throw executionError;
        if (Date.now() > deadline || stats.rounds++ > 2400)
          throw new Error(`Workload did not drain: ${remaining.size} Runs remain.`);
        if (Date.now() >= reconcileAt) {
          await reconcileWorker(org, worker.id);
          reconcileAt = Date.now() + 500;
        }
        // Exercise the same eligibility/fairness hints as production dispatch.
        // Retrying an arbitrary prefix can omit the scheduler's winning Run and
        // measure driver starvation rather than the available execution capacity.
        const candidates = await pendingRunCandidates(Math.max(1, 32 - inFlight.size));
        for (const { resource_id: runId } of candidates) {
          if (inFlight.size >= 32) break;
          if (!remaining.has(runId) || inFlight.has(runId)) continue;
          const started = await startRun(org, runId, syntheticExecution);
          if (!started) {
            stats.scheduling_deferrals++;
            continue;
          }
          const task = started.completion
            .then((done) => {
              if (done) {
                remaining.delete(runId);
                stats.completed_runs++;
              } else stats.scheduling_deferrals++;
            })
            .catch((error) => {
              executionError ??= error;
            })
            .finally(() => {
              inFlight.delete(runId);
            });
          inFlight.set(runId, task);
        }
        await sleep(100);
        await observe();
      }
      if (executionError) throw executionError;
    } finally {
      await Promise.allSettled(inFlight.values());
    }
    const terminal = await transaction(org, (tx) =>
      tx.query<{ status: string; persistence: string; n: number }>(
        "SELECT status,result->>'persistence_status' AS persistence,count(*)::integer AS n FROM runs WHERE id=ANY($1::uuid[]) GROUP BY status,result->>'persistence_status'",
        [accepted.map((run) => run.run_id)],
      ),
    );
    if (terminal.rows.some((row) => row.status !== 'succeeded' || row.persistence !== 'verified'))
      throw new Error('A synthetic Run did not publish verified state.');
    await parallel(80, 8, async () => {
      const at = performance.now();
      const page = await client.request('listWorkers', { params: { query: { limit: 100 } } });
      if (page.data.length !== 21) throw new Error('Worker listing lost an authorized target.');
      timings.listing.push(performance.now() - at);
    });
    await client.request('listBillingUsage', {
      params: {
        query: {
          worker_id: worker.id,
          from: new Date(Date.now() - 3600000).toISOString(),
          to: new Date().toISOString(),
        },
      },
    });
    await client.request('pauseWorker', { params: { path: { worker_id: worker.id } } });
    await reconcileWorker(org, worker.id);
    const paused = await client.request('getWorker', { params: { path: { worker_id: worker.id } } });
    if (paused.status !== 'paused' || paused.occupied_slots !== 0)
      throw new Error('The completed workload retained active compute claims.');
    await client.request('destroyWorker', { params: { path: { worker_id: worker.id } } } });
    await reconcileWorker(org, worker.id);
    status = 'passed';
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    // Independent diagnostic connection: the domain pool may itself be saturated.
    // This workload is guarded to a disposable unpaid database with synthetic data.
    console.log(
      'WORKER_POOL_STATE',
      JSON.stringify({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }),
    );
    await credentialPool
      .query(
        `SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,
      left(query,240) AS statement FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle' ORDER BY pid`,
      )
      .then((value) => console.log('WORKER_DATABASE_WAIT', JSON.stringify(value.rows)))
      .catch(() => console.log('WORKER_DATABASE_WAIT_UNAVAILABLE'));
    throw error;
  } finally {
    lag.disable();
    const result = {
      status,
      failure,
      source_commit: process.env.WORKER_SOURCE_COMMIT || 'working-tree',
      node: process.version,
      scope:
        'Real loopback HTTP, generated TypeScript SDK, admission, scheduler, PostgreSQL, persistence and ledger; external compute and model execution are explicit simulator boundaries.',
      ...stats,
      elapsed_ms: Math.round(performance.now() - started),
      admission: distribution(timings.admission),
      worker_listing: distribution(timings.listing),
      synthetic_execution: distribution(timings.execution),
      event_loop_p99_ms: Number.isFinite(lag.percentile(99))
        ? Math.round(lag.percentile(99) / 10000) / 100
        : null,
      peak_rss_kib: process.resourceUsage().maxRSS,
    };
    await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n');
    console.log('WORKER_STRESS_RESULT', JSON.stringify(result));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await authPool.end();
    await credentialPool.end();
  }
}

if (process.argv.includes('--fixture')) await workload();
else {
  const { withFixtureDatabase } = await import('../fixture-database');
  await withFixtureDatabase(async (env) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'scripts/workers/stress.ts', '--fixture'], {
      env: { ...env, API_RATE_LIMIT_PER_MINUTE: '100000' },
      stdio: 'inherit',
      timeout: 300000,
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) throw new Error(`Worker performance workload exited with ${code}.`);
  });
}
