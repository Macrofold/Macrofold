import { harnessNames } from '../packages/contracts/harnesses';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { withFixtureDatabase } from './fixture-database';
import { background, command, ready } from './coverage/processes';
import { dockerCommand } from '../packages/providers/src/docker';
import { Client } from '../sdk/typescript/src/index';
import { agentJourney } from './agent-journey';

const selected = process.argv.slice(2);
if (selected.some((name) => !harnessNames.includes(name as (typeof harnessNames)[number])))
  throw new Error('Choose a supported native harness');
const matrix = selected.length ? harnessNames.filter((name) => selected.includes(name)) : harnessNames;
const profileDeltas = process.env.NATIVE_DELTA_PROFILE === '1';

// Fail before provisioning fixtures if the daemon/image is unavailable; never pull or call a provider.
await dockerCommand(['image', 'inspect', process.env.DOCKER_RUNTIME_IMAGE || 'platform-runtime:0.1.0']);
const authFixture = await readFile(
  new URL('../tests/fixtures/host-control-auth.mjs', import.meta.url),
  'utf8',
);
const authContainer = (
  await dockerCommand([
    'create',
    '--pull=never',
    '--network=none',
    process.env.DOCKER_RUNTIME_IMAGE || 'platform-runtime:0.1.0',
    'node',
    '--input-type=module',
    '-e',
    authFixture,
  ])
)
  .toString()
  .trim();
try {
  console.log((await dockerCommand(['start', '--attach', authContainer])).toString().trim());
} finally {
  await dockerCommand(['rm', '--force', authContainer]);
}
const network = `platform-acceptance-${randomUUID()}`;
// Docker suppresses published ports on --internal networks. This dedicated
// bridge qualifies actual loopback Host HTTP; synthetic keys and rejecting
// provider transports still prevent live API traffic. Image-only harness tests
// retain --network=none and qualify that separate isolation boundary.
await dockerCommand(['network', 'create', network]);
try {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = (reservation.address() as import('node:net').AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  process.env.APP_ORIGIN = `http://127.0.0.1:${port}`;
  process.env.AUTH_SECRET = 'local-fixture-auth-thirty-two-characters';
  process.env.VAULT_KEY = 'local-fixture-vault-thirty-two-characters';
  // The fixed-destination relay supplies the fixture's application gateway on
  // Linux and Docker Desktop without a host bind mount or Docker socket.
  const relaySource = await readFile(new URL('../tests/fixtures/runtime-relay.mjs', import.meta.url), 'utf8');
  const relay = (
    await dockerCommand([
      'create',
      '--pull=never',
      '--network=bridge',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--memory=128m',
      '--pids-limit=32',
      '--add-host=host.docker.internal:host-gateway',
      process.env.DOCKER_RUNTIME_IMAGE || 'platform-runtime:0.1.0',
      'node',
      '--input-type=module',
      '-e',
      `${relaySource}\nruntimeRelay('http://host.docker.internal:${port}').listen(${port},'0.0.0.0');`,
    ])
  )
    .toString()
    .trim();
  try {
    await dockerCommand(['network', 'connect', network, relay]);
    await dockerCommand(['start', relay]);
  } catch (error) {
    await dockerCommand(['rm', '--force', relay]);
    throw error;
  }
  const relayInfo = JSON.parse((await dockerCommand(['inspect', relay])).toString())[0];
  const gateway = relayInfo.NetworkSettings.Networks[network].IPAddress as string;
  await withFixtureDatabase(async (env) => {
    await command(['exec', 'tsx', 'scripts/seed.ts'], env);
    const seed = JSON.parse(await readFile(path.join(env.DATA_DIR!, 'demo.json'), 'utf8'));
    const syntheticSecrets = Object.fromEntries(
      Object.keys(env)
        .filter((key) => /KEY|SECRET|TOKEN|PASSWORD/.test(key))
        .map((key) => [key, '']),
    );
    const fixture = {
      ...env,
      ...syntheticSecrets,
      AUTH_SECRET: 'local-fixture-auth-thirty-two-characters',
      VAULT_KEY: 'local-fixture-vault-thirty-two-characters',
      EXECUTION_PROVIDER: 'docker',
      ORCHESTRATION_BACKEND: 'poller',
      ALLOW_PAID_EXECUTION: 'true',
      DETERMINISTIC_AGENT_JOURNEY: '1',
      NATIVE_DELTA_PROFILE: profileDeltas ? '1' : '0',
      ...(profileDeltas ? { WORKER_DIAGNOSTICS: '1' } : {}),
      DOCKER_NETWORK: network,
      DOCKER_HOST_GATEWAY_IP: gateway,
      DOCKER_RUNTIME_IMAGE: process.env.DOCKER_RUNTIME_IMAGE || 'platform-runtime:0.1.0',
      COMPUTE_MICRO_USD_PER_MINUTE: '0',
      OPENAI_API_KEY: 'fixture-never-live',
      ANTHROPIC_API_KEY: 'fixture-never-live',
      OPENROUTER_API_KEY: 'fixture-never-live',
      RESEND_API_KEY: '',
      STRIPE_SECRET_KEY: '',
      BRAVE_SEARCH_API_KEY: '',
      GITHUB_APP_PRIVATE_KEY: '',
    };
    const server = background(
      ['--import', 'tsx', 'tests/fixtures/journey-server.ts'],
      fixture,
      path.join(env.DATA_DIR!, 'journey-server.log'),
    );
    let worker = background(
      ['--import', 'tsx', 'scripts/worker.ts'],
      fixture,
      path.join(env.DATA_DIR!, 'journey-worker.log'),
    );
    const database = new pg.Client({ connectionString: env.DATABASE_URL });
    try {
      await database.connect();
      await ready(env.APP_ORIGIN!, server.child);
      const client = new Client({ baseURL: env.APP_ORIGIN!, token: seed.api_key });
      for (const harness of matrix) {
        console.log(`Verifying complete ${harness} API journey`);
        let restarted = false;
        let output = '';
        const received = new Set<string>();
        const latencies: number[] = [];
        const ingestionLatencies: number[] = [];
        const deliveryLatencies: number[] = [];
        const markers: {
          run: string;
          sequence: string;
          provider: number;
          received: number;
          ingested: number;
        }[] = [];
        const result = await agentJourney(client, {
          harness,
          model: harness === 'claude-code' ? 'claude-sonnet-4-6' : 'gpt-5.4-mini',
          timeoutSeconds: 180,
          runBudget: '2000000',
          accepted: async () => {
            output = '';
          },
          observed: async (event) => {
            if (profileDeltas && event.type === 'output.delta') {
              const now = Date.now();
              output += String(event.data.text || '');
              for (const match of output.matchAll(/fixture_delta_(\d+)_(\d+)\n/g)) {
                if (received.has(match[0])) continue;
                received.add(match[0]);
                const latency = now - Number(match[1]);
                if (latency < 0) throw new Error('Fixture producer and receiver clocks disagree');
                latencies.push(latency);
                ingestionLatencies.push(Date.parse(event.ingested_at) - Number(match[1]));
                deliveryLatencies.push(now - Date.parse(event.ingested_at));
                markers.push({
                  run: event.run_id,
                  sequence: event.sequence,
                  provider: Number(match[1]),
                  received: now,
                  ingested: Date.parse(event.ingested_at),
                });
              }
            }
            // Recovery acceptance deliberately waits for an expired phase lease;
            // latency profiling instead measures uninterrupted native transport.
            if (profileDeltas) return;
            if (restarted || event.type !== 'runtime.started') return;
            restarted = true;
            // Kill only this fixture worker after observing the real native execution identity.
            worker.child.kill('SIGKILL');
            await worker.stop();
            worker = background(
              ['--import', 'tsx', 'scripts/worker.ts'],
              fixture,
              path.join(env.DATA_DIR!, 'journey-worker.log'),
            );
          },
        });
        const rows = (
          await database.query(
            'SELECT execution_binding,model_reserved_micro_usd,budget_used_micro_usd FROM runs WHERE id=ANY($1::uuid[])',
            [result.runs],
          )
        ).rows;
        // Restricted SQL needs tenant context; use the existing transaction owner for observations.
        if (rows.length) throw new Error('Unscoped runtime SQL unexpectedly exposed tenant runs');
        await database.query('BEGIN');
        let sourceRows: {
          run_id: string;
          sequence: string;
          producer_id: string;
          producer_sequence: string;
        }[] = [];
        try {
          await database.query("SELECT set_config('app.organization_id',$1,true)", [seed.organization_id]);
          const saved = (
            await database.query(
              'SELECT execution_binding,model_reserved_micro_usd,budget_used_micro_usd FROM runs WHERE id=ANY($1::uuid[])',
              [result.runs],
            )
          ).rows;
          if (
            saved.length !== 2 ||
            saved.some((r) => r.model_reserved_micro_usd !== '0' || BigInt(r.budget_used_micro_usd) <= 0n) ||
            saved[0].execution_binding.machine.sessionId === saved[1].execution_binding.machine.sessionId
          )
            throw new Error('Fresh-container continuation or terminal model settlement failed');
          if (profileDeltas)
            console.log(
              JSON.stringify({
                native_phase_timings: saved.map((row) => row.execution_binding.phaseTimings),
              }),
            );
          if (profileDeltas)
            sourceRows = (
              await database.query(
                "SELECT run_id,sequence::text,producer_id,producer_sequence::text FROM run_events WHERE run_id=ANY($1::uuid[]) AND type='output.delta'",
                [result.runs],
              )
            ).rows;
          await database.query('COMMIT');
        } catch (error) {
          await database.query('ROLLBACK');
          throw error;
        }
        console.log(JSON.stringify(result));
        if (profileDeltas) {
          if (latencies.length !== 80) throw new Error(`Missing fixture deltas: ${latencies.length}/80`);
          const distribution = (values: number[]) => {
            values.sort((a, b) => a - b);
            return {
              samples: values.length,
              mean: values.reduce((a, b) => a + b, 0) / values.length,
              p50: values[Math.ceil(values.length * 0.5) - 1],
              p95: values[Math.ceil(values.length * 0.95) - 1],
              max: values.at(-1),
            };
          };
          const emitted = new Map<string, { at: number; observed: number; probeStarted: number }>();
          const probeStarts = new Map<string, number>();
          for (const line of (await readFile(path.join(env.DATA_DIR!, 'journey-worker.log'), 'utf8')).split(
            '\n',
          )) {
            let event: {
              observation?: string;
              run_id?: string;
              lease_generation?: string;
              source_sequence?: number;
              source_emitted_at?: number;
              timestamp: string;
            };
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            if (event.observation === 'worker.native_probe.started' && event.run_id)
              probeStarts.set(event.run_id, Date.parse(event.timestamp));
            if (event.observation === 'worker.native_event.observed' && event.source_emitted_at !== undefined)
              emitted.set(`${event.run_id}:runtime:${event.lease_generation}:${event.source_sequence}`, {
                at: event.source_emitted_at,
                observed: Date.parse(event.timestamp),
                probeStarted: probeStarts.get(event.run_id || '') || 0,
              });
          }
          const publicSources = new Map(
            sourceRows.map((event) => [
              `${event.run_id}:${event.sequence}`,
              emitted.get(`${event.run_id}:${event.producer_id}:${event.producer_sequence}`),
            ]),
          );
          const nativeBuffer: number[] = [],
            runtimeDelivery: number[] = [],
            runtimeIngestion: number[] = [],
            nativeScheduling: number[] = [],
            nativeRpc: number[] = [],
            nativePostRpc: number[] = [];
          for (const marker of markers) {
            const source = publicSources.get(`${marker.run}:${marker.sequence}`);
            if (source === undefined) throw new Error('Missing private runtime timing for a public delta');
            const at = source.at;
            if (at < marker.provider || at > marker.received)
              throw new Error('Fixture producer, runtime and receiver clocks disagree');
            nativeBuffer.push(at - marker.provider);
            runtimeDelivery.push(marker.received - at);
            runtimeIngestion.push(marker.ingested - at);
            nativeScheduling.push(Math.max(0, source.probeStarted - at));
            nativeRpc.push(source.observed - Math.max(at, source.probeStarted));
            nativePostRpc.push(marker.ingested - source.observed);
          }
          console.log(
            JSON.stringify({
              harness,
              native_delta_transport_ms: distribution(latencies),
              provider_to_sql_event_ms: distribution(ingestionLatencies),
              sql_event_to_client_ms: distribution(deliveryLatencies),
              provider_to_native_event_ms: distribution(nativeBuffer),
              native_event_to_sql_ms: distribution(runtimeIngestion),
              native_event_to_client_ms: distribution(runtimeDelivery),
              native_scheduling_ms: distribution(nativeScheduling),
              native_rpc_after_output_ready_ms: distribution(nativeRpc),
              native_control_to_sql_ms: distribution(nativePostRpc),
              scope: 'synthetic provider SSE write through native harness, Docker, SQL and API SDK',
            }),
          );
        }
      }
    } catch (error) {
      for (const log of ['journey-server.log', 'journey-worker.log'])
        console.error((await readFile(path.join(env.DATA_DIR!, log), 'utf8')).slice(-4000));
      throw error;
    } finally {
      await Promise.all([server.stop(), worker.stop()]);
      await database.end();
    }
  });
} finally {
  const containers = (await dockerCommand(['ps', '-aq', '--filter', `network=${network}`]))
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const container of containers) await dockerCommand(['rm', '--force', container]);
  await dockerCommand(['network', 'rm', network]);
}
