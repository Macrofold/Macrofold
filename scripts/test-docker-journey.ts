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

// Fail before provisioning fixtures if the daemon/image is unavailable; never pull or call a provider.
await dockerCommand(['image', 'inspect', 'platform-runtime:0.1.0']);
const network = `platform-acceptance-${randomUUID()}`;
await dockerCommand(['network', 'create', '--internal', network]);
try {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = (reservation.address() as import('node:net').AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  process.env.APP_ORIGIN = `http://127.0.0.1:${port}`;
  process.env.AUTH_SECRET = 'local-fixture-auth-thirty-two-characters';
  process.env.VAULT_KEY = 'local-fixture-vault-thirty-two-characters';
  // Internal networks have no default route. A fixed-destination relay supplies only our runtime
  // gateway, keeping the native agents off the internet on both Linux and Docker Desktop.
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
      'platform-runtime:0.1.0',
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
    const catalog = [
      { id: 'gpt-5.4', provider: 'openai', harnesses: ['codex', 'opencode'] },
      { id: 'claude-sonnet-4-6', provider: 'anthropic', harnesses: ['claude-code'] },
    ].map((model) => ({
      ...model,
      name: 'Deterministic native fixture',
      enabled: true,
      input_micro_usd_per_million: '1000000',
      output_micro_usd_per_million: '2000000',
    }));
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
      DOCKER_NETWORK: network,
      DOCKER_HOST_GATEWAY_IP: gateway,
      DOCKER_RUNTIME_IMAGE: 'platform-runtime:0.1.0',
      COMPUTE_MICRO_USD_PER_MINUTE: '0',
      OPENAI_API_KEY: 'fixture-never-live',
      ANTHROPIC_API_KEY: 'fixture-never-live',
      OPENROUTER_API_KEY: 'fixture-never-live',
      MODEL_CATALOG_JSON: JSON.stringify(catalog),
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
      for (const harness of ['codex', 'claude-code', 'opencode'] as const) {
        let restarted = false;
        const result = await agentJourney(client, {
          harness,
          model: harness === 'claude-code' ? 'claude-sonnet-4-6' : 'gpt-5.4',
          timeoutSeconds: 180,
          runBudget: '2000000',
          observed: async (event) => {
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
          await database.query('COMMIT');
        } catch (error) {
          await database.query('ROLLBACK');
          throw error;
        }
        console.log(JSON.stringify(result));
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
