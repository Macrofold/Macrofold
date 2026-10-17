import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { mapConcurrent } from '../packages/core/src/concurrent';
import type { ComponentMode, componentWorkload } from './capacity-components';

type Scenario = {
  mode: 'http' | 'session' | 'auth' | 'credential' | 'inference' | ComponentMode;
  pool: number;
  concurrency: number;
  count: number;
  delay?: number;
  tenants?: number;
  traffic?: 'read' | 'write' | 'control' | 'admission' | 'direct';
  rate?: number;
  payloadBytes?: number;
  domainPool?: number;
};
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    Math.round((sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0) * 100) / 100;
  return { samples: values.length, p50_ms: at(0.5), p95_ms: at(0.95), p99_ms: at(0.99), max_ms: at(1) };
}

async function workload(scenario: Scenario) {
  const { config, isLocal } = await import('../packages/core/src/config');
  assert(isLocal() && !config.allowPaid && config.execution === 'simulator');
  assert(new URL(config.databaseUrl).pathname.startsWith('/platform_test_'));
  const { pool, authPool, credentialPool, transaction, credentialTransaction } =
    await import('../packages/db');
  const measuredPool = ['session', 'auth'].includes(scenario.mode)
    ? authPool
    : scenario.mode === 'credential'
      ? credentialPool
      : pool;
  // Exercise effective server settings, not only client configuration: poolers
  // reject startup options, and template clones omit per-database role defaults.
  for (const connections of [pool, authPool, credentialPool]) {
    const settings = await connections.query(`SELECT current_setting('statement_timeout') AS statement,
      current_setting('idle_in_transaction_session_timeout') AS idle`);
    assert.deepEqual(settings.rows[0], { statement: '1min', idle: '2min' });
  }
  const { auth } = await import('../packages/core/src/auth');
  const { fixtureAccount } = await import('../tests/fixtures/account');
  const { fixtureHttpApi } = await import('../tests/fixtures/http-api');
  const { credit } = await import('../packages/core/src/ledger');
  const { createKey } = await import('../packages/core/src/keys');
  const resources = await import('../packages/core/src/resources');
  const { decisionExample } = await import('../examples/decisions/contracts');
  const { CloudDispatcher } = await import('../packages/core/src/portable-dispatch');
  const { admitInference } = await import('../packages/core/src/inferences');
  const { id } = await import('../packages/core/src/crypto');
  const networkFetch = globalThis.fetch;
  let providerCalls = 0,
    activeCalls = 0,
    peakCalls = 0;
  const provider = createServer(async (req, res) => {
    for await (const _ of req) {
      /* Drain the actual serialized provider request. */
    }
    providerCalls++;
    activeCalls++;
    peakCalls = Math.max(peakCalls, activeCalls);
    await sleep(scenario.delay ?? 1000);
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': id() });
    res.end(
      JSON.stringify({
        type: 'message',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: '"wait"' }],
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );
    activeCalls--;
  }).listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const address = provider.address();
  assert(address && typeof address !== 'string');
  const providerOrigin = `http://127.0.0.1:${address.port}`;
  // Fail closed: synthetic credentials can only reach this process's loopback fixture.
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === 'https://api.anthropic.com') return networkFetch(providerOrigin + url.pathname, init);
    throw new Error('Unexpected outbound request in capacity fixture');
  };
  const api = await fixtureHttpApi();
  const lag = monitorEventLoopDelay({ resolution: 20 });
  const timings: number[] = [];
  const errors: Record<string, number> = {};
  const poolSamples: { total: number; busy: number; waiting: number }[] = [];
  let peakRss = 0,
    completed = 0;
  let dispatcher: InstanceType<typeof CloudDispatcher> | undefined;
  let component: Awaited<ReturnType<typeof componentWorkload>> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const started = performance.now();
  let measuredAt = started;
  let outcome: Record<string, unknown> = {};
  try {
    const accounts = await mapConcurrent(
      Array.from({ length: scenario.tenants ?? 8 }, (_, i) => i),
      2,
      async (i) => {
        const account = await fixtureAccount(`Capacity fixture ${i}`);
        return transaction(account.p.organizationId, async (tx) => {
          await tx.query("UPDATE organizations SET plan='scale' WHERE id=$1", [account.p.organizationId]);
          await credit(tx, account.p.organizationId, 1_000_000_000n, `capacity:${id()}`);
          const workspace = await resources.create(tx, 'workspaces', account.p.organizationId, {
            name: 'Synthetic load',
          });
          const key = await createKey(tx, account.p, {
            name: 'Capacity caller',
            scopes: ['runs:read', 'runs:write', 'workspaces:read', 'workspaces:write'],
          });
          return {
            ...account,
            key: key.secret,
            workspace: workspace.id,
            principal: { ...account.p, kind: 'api_key' as const, id: key.id, scopes: key.scopes },
          };
        });
      },
    );
    const orgIds = accounts.map((a) => a.p.organizationId);
    process.env.ANTHROPIC_API_KEY = 'capacity-fixture-not-a-real-key';
    config.allowPaid = true;
    const verifyAccounting = async (expected: number, runIds?: string[]) => {
      const accounting = await mapConcurrent(orgIds, 2, (org) =>
        transaction(org, async (tx) => {
          const requests = await tx.query(
            'SELECT count(*)::integer AS count,count(DISTINCT run_id)::integer AS runs FROM model_usage WHERE ($1::uuid[] IS NULL OR run_id=ANY($1::uuid[]))',
            [runIds ?? null],
          );
          const balance = await tx.query('SELECT reserved_micro_usd::text FROM organizations WHERE id=$1', [
            org,
          ]);
          return { usage: requests.rows[0], held: balance.rows[0].reserved_micro_usd };
        }),
      );
      outcome.accounting = accounting;
      assert(
        accounting.every((a) => a.held === '0' && a.usage.count === a.usage.runs),
        'Unsettled or duplicate accounting',
      );
      assert.equal(
        accounting.reduce((n, a) => n + a.usage.count, 0),
        expected,
      );
      assert.equal(providerCalls, expected, 'Missing or duplicate provider requests');
    };
    const controlRuns =
      scenario.traffic === 'control'
        ? await mapConcurrent(
            Array.from({ length: scenario.count + 32 }, (_, i) => accounts[i % accounts.length]),
            8,
            (account) =>
              transaction(account.p.organizationId, async (tx) => {
                const run = await admitInference(
                  tx,
                  account.principal,
                  decisionExample(account.workspace, 'triage'),
                );
                return run.run_id;
              }),
          )
        : [];
    // Saturation runs explicitly raise fixture-only rate policy. Production
    // enforcement is checked separately; it must not mask processing capacity.
    const http = async (index: number, scheduledAt?: number) => {
      const account = accounts[index % accounts.length];
      const at = scheduledAt ?? performance.now();
      const write = scenario.traffic
        ? ['write', 'admission', 'direct'].includes(scenario.traffic)
        : index % 5 === 0;
      const control = scenario.traffic === 'control';
      const response = await networkFetch(
        api.origin +
          (control
            ? `/v1/runs/${controlRuns[index]}/cancel`
            : ['admission', 'direct'].includes(scenario.traffic ?? '')
              ? '/v1/inferences'
              : '/v1/workspaces' + (write ? '' : '?limit=100')),
        {
          method: write || control ? 'POST' : 'GET',
          headers: {
            ...(scenario.mode === 'session'
              ? { cookie: account.cookie, origin: config.origin }
              : { authorization: `Bearer ${account.key}` }),
            'content-type': 'application/json',
            ...(scenario.traffic === 'admission' ? { prefer: 'respond-async' } : {}),
            ...(write || control ? { 'idempotency-key': id() } : {}),
          },
          ...(write || control
            ? {
                body: JSON.stringify(
                  control
                    ? {}
                    : ['admission', 'direct'].includes(scenario.traffic ?? '')
                      ? decisionExample(account.workspace, 'triage')
                      : { name: `Synthetic ${index}` },
                ),
              }
            : {}),
        },
      );
      const body = await response.json();
      timings.push(performance.now() - at);
      if (!response.ok)
        errors[body.error?.code ?? String(response.status)] =
          (errors[body.error?.code ?? String(response.status)] ?? 0) + 1;
      else completed++;
    };
    if (['webhook', 'finance', 'storage', 'snapshot', 'restore'].includes(scenario.mode)) {
      component = await (
        await import('./capacity-components')
      ).componentWorkload(
        scenario.mode as ComponentMode,
        accounts,
        scenario.count,
        scenario.delay ?? 20,
        scenario.payloadBytes ?? 0,
        networkFetch,
      );
    }
    let runIds: string[] = [];
    if (scenario.mode === 'inference') {
      // Queue construction is measured separately from dispatch/settlement.
      const admissionAt = performance.now();
      runIds = await mapConcurrent(
        Array.from({ length: scenario.count }, (_, i) => i),
        8,
        async (i) => {
          const account = accounts[i % accounts.length];
          const body = decisionExample(account.workspace, 'triage');
          if (scenario.payloadBytes) {
            body.context.items[0] = {
              ...body.context.items[0],
              status: 'known',
              value: 'x'.repeat(scenario.payloadBytes),
            };
            body.definition.limits.max_cost_micro_usd = '500000';
          }
          body.definition.limits.timeout_seconds = 180;
          return (
            await transaction(account.p.organizationId, (tx) =>
              admitInference(tx, account.principal, { ...body, queue_timeout_seconds: 600 }),
            )
          ).run_id;
        },
      );
      outcome.admission_ms = Math.round(performance.now() - admissionAt);
      dispatcher = new CloudDispatcher(
        () => {
          throw new Error('Inference constructed a machine');
        },
        { inference: scenario.concurrency, provision: 1, transfer: 1, control: 1 },
      );
    } else if (!component) {
      await mapConcurrent(
        Array.from({ length: 32 }, (_, i) => i),
        8,
        http,
      );
      timings.length = 0;
      completed = 0;
      assert(!Object.keys(errors).length, 'HTTP warmup failed');
    }
    const initialRss = process.memoryUsage().rss;
    const cpuStart = process.cpuUsage();
    measuredAt = performance.now();
    lag.enable();
    timer = setInterval(() => {
      poolSamples.push({
        total: measuredPool.totalCount,
        busy: measuredPool.totalCount - measuredPool.idleCount,
        waiting: measuredPool.waitingCount,
      });
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 25);
    if (component) {
      await mapConcurrent(
        Array.from({ length: scenario.count }, (_, i) => i),
        scenario.concurrency,
        async (i) => {
          const at = performance.now();
          await component!.run(i);
          timings.push(performance.now() - at);
          completed++;
        },
      );
      outcome.component = await component.close();
      component = undefined;
    } else if (scenario.mode === 'auth') {
      await mapConcurrent(
        Array.from({ length: scenario.count }, (_, i) => i),
        scenario.concurrency,
        async (i) => {
          const at = performance.now();
          const session = await auth.api.getSession({
            headers: new Headers({ cookie: accounts[i % accounts.length].cookie }),
            query: { disableCookieCache: true },
          });
          assert(session, 'Session validation failed');
          timings.push(performance.now() - at);
          completed++;
        },
      );
    } else if (scenario.mode === 'credential') {
      // Exercise independent credential commits while callers occupy domain
      // connections. No credential value or external refresh is involved.
      await mapConcurrent(
        Array.from({ length: scenario.count }, (_, i) => i),
        scenario.concurrency,
        async (i) => {
          const at = performance.now(),
            org = orgIds[i % orgIds.length];
          await transaction(org, () =>
            credentialTransaction(org, async (tx) => {
              await tx.query('SELECT id FROM connections LIMIT 1');
            }),
          );
          timings.push(performance.now() - at);
          completed++;
        },
      );
    } else if (scenario.mode !== 'inference') {
      await mapConcurrent(
        Array.from({ length: scenario.count }, (_, i) => i),
        scenario.concurrency,
        async (i) => {
          if (outcome.overloaded) return;
          if (scenario.rate)
            await sleep(Math.max(0, measuredAt + (i * 1000) / scenario.rate - performance.now()));
          if (scenario.rate && performance.now() - (measuredAt + (i * 1000) / scenario.rate) > 10000) {
            outcome.overloaded = true;
            return;
          }
          await http(i + 32, scenario.rate ? measuredAt + (i * 1000) / scenario.rate : undefined);
        },
      );
    } else {
      const deadline = Date.now() + 180000;
      let nextObservation = 0;
      while (completed < scenario.count && Date.now() < deadline) {
        await dispatcher!.tick();
        if (Date.now() >= nextObservation) {
          const rows = await pool.query<{ status: string; n: number }>(
            'SELECT status,count(*)::integer AS n FROM reporting.runs WHERE id=ANY($1::uuid[]) GROUP BY status',
            [runIds],
          );
          completed = rows.rows
            .filter((r) => ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(r.status))
            .reduce((sum, r) => sum + r.n, 0);
          nextObservation = Date.now() + 250;
        }
        await dispatcher!.waitForProgress(25);
      }
      await dispatcher!.drain();
      const states = await pool.query(
        'SELECT status,count(*)::integer AS n FROM reporting.runs WHERE id=ANY($1::uuid[]) GROUP BY status',
        [runIds],
      );
      outcome.states = states.rows;
      for (const row of states.rows) if (row.status !== 'succeeded') errors[row.status] = row.n;
      const measurements = await pool.query(
        'SELECT extract(epoch FROM completed_at-started_at)*1000 AS duration, extract(epoch FROM started_at-created_at)*1000 AS queued, extract(epoch FROM completed_at-created_at)*1000 AS total FROM reporting.runs WHERE id=ANY($1::uuid[]) AND completed_at IS NOT NULL',
        [runIds],
      );
      timings.push(...measurements.rows.map((r) => Number(r.duration)));
      outcome.queue_latency = distribution(measurements.rows.map((r) => Number(r.queued)));
      outcome.total_latency = distribution(measurements.rows.map((r) => Number(r.total)));
      await verifyAccounting(scenario.count, runIds);
    }
    if (scenario.traffic === 'direct') await verifyAccounting(completed + 32);
    const elapsed = performance.now() - measuredAt;
    const cpu = process.cpuUsage(cpuStart);
    outcome = {
      ...outcome,
      elapsed_ms: Math.round(elapsed),
      requests_per_second: Math.round((completed * 100000) / elapsed) / 100,
      latency: distribution(timings),
      event_loop_p99_ms: Math.round(lag.percentile(99) / 10000) / 100,
      process_cpu_ms: (cpu.user + cpu.system) / 1000,
      initial_rss_mib: initialRss / 1024 ** 2,
    };
  } catch (error) {
    outcome.failure = error instanceof Error ? error.message : String(error);
  } finally {
    clearInterval(timer);
    lag.disable();
    // Keep the loopback-only transport installed until all started work stops,
    // including when an observation or accounting assertion fails.
    await dispatcher?.drain();
    try {
      await component?.close();
    } catch (error) {
      outcome.failure ??= error instanceof Error ? error.message : String(error);
    }
    config.allowPaid = false;
    globalThis.fetch = networkFetch;
    const report = {
      scenario,
      configured_pools: {
        domain: pool.options.max,
        auth: authPool.options.max,
        credential: credentialPool.options.max,
      },
      ...outcome,
      completed,
      errors,
      provider_calls: providerCalls,
      provider_peak_in_flight: peakCalls,
      peak_rss_mib: Math.round(peakRss / 1024 ** 2),
      pool_peak_connections: Math.max(0, ...poolSamples.map((s) => s.total)),
      pool_peak_busy: Math.max(0, ...poolSamples.map((s) => s.busy)),
      pool_peak_waiters: Math.max(0, ...poolSamples.map((s) => s.waiting)),
      pool_wait_samples_percent: poolSamples.length
        ? (100 * poolSamples.filter((s) => s.waiting > 0).length) / poolSamples.length
        : 0,
      total_ms: Math.round(performance.now() - started),
      node: process.version,
    };
    await appendFile(process.env.CAPACITY_REPORT!, JSON.stringify(report) + '\n');
    console.log('CAPACITY_RESULT', JSON.stringify(report));
    await api.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
    assert(
      !outcome.failure && !Object.keys(errors).length && completed === scenario.count,
      'Capacity workload failed; see report',
    );
  }
}

if (process.env.CAPACITY_CASE) await workload(JSON.parse(process.env.CAPACITY_CASE));
else {
  const directory = path.resolve(process.env.CAPACITY_OUTPUT || `.data/capacity-${Date.now()}`);
  await mkdir(directory, { recursive: true });
  const report = path.join(directory, 'results.jsonl');
  await writeFile(report, '');
  const { withFixtureDatabase } = await import('./fixture-database');
  const cases: Scenario[] = process.env.CAPACITY_CASES
    ? JSON.parse(process.env.CAPACITY_CASES)
    : [
        ...[5, 20, 40, 80].map((pool) => ({ mode: 'http' as const, pool, concurrency: 64, count: 512 })),
        ...[64, 128, 256].map((concurrency) => ({
          mode: 'inference' as const,
          pool: 20,
          concurrency,
          count: 256,
          delay: 1000,
        })),
        { mode: 'inference', pool: 40, concurrency: 256, count: 256, delay: 1000 },
      ];
  await withFixtureDatabase(
    async (env) => {
      const databases = env.FIXTURE_DATABASES?.split(',');
      for (const [index, scenario] of cases.entries()) {
        const isolated = { ...env };
        for (const key of ['DATABASE_URL', 'AUTH_DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
          const url = new URL(env[key]!);
          if (databases) url.pathname = '/' + databases[index];
          isolated[key] = url.href;
        }
        isolated.DATA_DIR = path.join(env.DATA_DIR!, String(index));
        await mkdir(isolated.DATA_DIR, { recursive: true });
        const child = spawn(process.execPath, ['--import', 'tsx', import.meta.filename], {
          env: {
            ...isolated,
            CAPACITY_CASE: JSON.stringify(scenario),
            CAPACITY_REPORT: report,
            DATABASE_POOL_SIZE: String(
              scenario.domainPool ??
                (['session', 'auth', 'credential'].includes(scenario.mode) ? 40 : scenario.pool),
            ),
            AUTH_DATABASE_POOL_SIZE: ['session', 'auth'].includes(scenario.mode)
              ? String(scenario.pool)
              : '20',
            CREDENTIAL_DATABASE_POOL_SIZE: scenario.mode === 'credential' ? String(scenario.pool) : '32',
            GLOBAL_CONCURRENT_RUN_LIMIT: '2200',
            NATIVE_CONCURRENT_RUN_LIMIT: '200',
            LIGHTWEIGHT_CONCURRENT_RUN_LIMIT: '2000',
            API_RATE_LIMIT_PER_MINUTE: '1000000',
            API_READ_RATE_LIMIT_PER_MINUTE: '1000000',
            API_WRITE_RATE_LIMIT_PER_MINUTE: '1000000',
            API_CONTROL_RATE_LIMIT_PER_MINUTE: '1000000',
          },
          stdio: 'inherit',
          timeout: 240000,
        });
        const [code] = await once(child, 'exit');
        if (code !== 0) {
          console.error('CAPACITY_CASE_FAILED', JSON.stringify(scenario));
          process.exitCode = 1;
        }
      }
    },
    { workers: cases.length },
  );
  console.log(`Capacity evidence: ${report}`);
}
