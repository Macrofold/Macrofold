import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withFixtureDatabase } from './fixture-database';
import { background, command, ready } from './coverage/processes';
import { Client } from '../sdk/typescript/src/client';
import pg from 'pg';

const reservation = createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = (reservation.address() as import('node:net').AddressInfo).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
process.env.APP_ORIGIN = `http://127.0.0.1:${port}`;
await withFixtureDatabase(async (base) => {
  const env: NodeJS.ProcessEnv = { ...base, LOCAL_MODEL_ENDPOINT_ALLOWED_ORIGINS: base.APP_ORIGIN };
  await command(['exec', 'tsx', 'scripts/seed.ts'], env);
  const seed = JSON.parse(await readFile(path.join(env.DATA_DIR!, 'demo.json'), 'utf8'));
  const fixture: NodeJS.ProcessEnv = {
    ...env,
    PYTHONPATH: path.resolve('sdk/python'),
    MACROFOLD_FIXTURE_ORIGIN: env.APP_ORIGIN,
    MACROFOLD_FIXTURE_KEY: seed.api_key,
    MACROFOLD_FIXTURE_INFERENCE_INPUT: path.resolve('tests/fixtures/sdk-immediate-input.json'),
  };
  const server = background(
    ['--import', 'tsx', 'tests/fixtures/sdk-server.ts'],
    env,
    path.join(env.DATA_DIR!, 'sdk-server.log'),
  );
  const immediateOnly = process.env.SDK_IMMEDIATE_ONLY === 'true';
  const worker = immediateOnly
    ? undefined
    : background(['--import', 'tsx', 'scripts/worker.ts'], env, path.join(env.DATA_DIR!, 'sdk-worker.log'));
  try {
    await ready(env.APP_ORIGIN!, server.child);
    const client = new Client({ baseURL: env.APP_ORIGIN!, apiKey: seed.api_key });
    const identity = await client.request('getIdentity');
    const endpoint = await client.connections.create({
      name: 'SDK stopped deployment endpoint',
      kind: 'external_model',
      provider: 'openai',
      auth_method: 'bearer',
      secret: 'sdk-external-fixture-not-a-provider-key',
      url: `${env.APP_ORIGIN}/model-fixture/v1`,
    });
    const capabilities = {
      protocol: 'openai_chat' as const,
      input_modalities: ['text' as const],
      chat_completions: true,
      json_object: false,
      json_schema: false,
      tools: false,
      streaming: true,
      stream_usage: true,
      schema_keywords: [],
      accepted_parameters: ['temperature', 'max_tokens'],
      schema_dialect: null,
      context_window_tokens: 8192,
      max_output_tokens: 2048,
      max_concurrent_requests: 2,
    };
    const deployment = await client.modelDeployments.create({
      name: 'SDK stopped external deployment',
      source: { kind: 'external', repository: null, revision: null, capabilities },
      runtime: { kind: 'external', engine: 'fixture-engine', version: null },
      hosting: {
        kind: 'external_openai',
        endpoint_connection_id: endpoint.id,
        model_alias: 'fixture-model',
        lifecycle: 'external',
        external_hosting_acknowledged: true,
      },
      access: {
        grants: [
          {
            subject: { kind: 'api_key', api_key_id: identity.principal_id },
            workspace_scope: { kind: 'all' },
          },
        ],
      },
    });
    fixture.MACROFOLD_FIXTURE_DEPLOYMENT = deployment.deployment_id;
    fixture.MACROFOLD_FIXTURE_DEPLOYMENT_REVISION = deployment.desired_revision_id;
    const deploymentInput = path.join(env.DATA_DIR!, 'sdk-deployment-input.json');
    await writeFile(
      deploymentInput,
      JSON.stringify({
        model_binding: {
          deployment_id: deployment.deployment_id,
          deployment_revision_id: deployment.desired_revision_id,
        },
        input: { messages: [{ role: 'user', content: 'This stopped deployment must not generate.' }] },
        limits: { max_cost_micro_usd: '0', max_output_tokens: 32, timeout_seconds: 20 },
      }),
    );
    fixture.MACROFOLD_FIXTURE_DEPLOYMENT_INFERENCE_INPUT = deploymentInput;
    const database = new pg.Client({ connectionString: env.DATABASE_URL });
    await database.connect();
    try {
      for (const language of ['typescript', 'python', 'go', 'rust', 'java']) {
        const ready = await client.modelDeployments.create({
          name: `SDK ${language} ready deployment`,
          source: { kind: 'external', repository: null, revision: null, capabilities },
          runtime: { kind: 'external', engine: 'fixture-engine', version: null },
          hosting: {
            kind: 'external_openai',
            endpoint_connection_id: endpoint.id,
            model_alias: `fixture-model-${language}`,
            lifecycle: 'external',
            external_hosting_acknowledged: true,
          },
          access: {
            grants: [
              {
                subject: { kind: 'api_key', api_key_id: identity.principal_id },
                workspace_scope: { kind: 'all' },
              },
            ],
          },
        });
        await client.modelDeployments.setService(ready.deployment_id, {
          deployment_revision_id: ready.desired_revision_id,
          desired_state: 'running',
          policy: { max_concurrent_requests: 2, stop_at: null },
        });
        // The fixture owns a known serving engine above; mark only this local
        // synthetic service ready without depending on maintenance cadence.
        await database.query('BEGIN');
        try {
          await database.query("SELECT set_config('app.organization_id',$1,true)", [
            identity.organization_id,
          ]);
          const result = await database.query(
            "UPDATE model_deployments SET state='ready',serving_revision_id=desired_revision_id,next_check_at=now()+interval '1 day' WHERE id=$1",
            [ready.deployment_id],
          );
          assert.equal(result.rowCount, 1);
          await database.query('COMMIT');
        } catch (error) {
          await database.query('ROLLBACK');
          throw error;
        }
        const suffix = language.toUpperCase();
        fixture[`MACROFOLD_FIXTURE_READY_DEPLOYMENT_${suffix}`] = ready.deployment_id;
        fixture[`MACROFOLD_FIXTURE_READY_DEPLOYMENT_REVISION_${suffix}`] = ready.desired_revision_id;
        const input = path.join(env.DATA_DIR!, `sdk-deployment-${language}-input.json`);
        await writeFile(
          input,
          JSON.stringify({
            model_binding: {
              deployment_id: ready.deployment_id,
              deployment_revision_id: ready.desired_revision_id,
            },
            input: { messages: [{ role: 'user', content: 'Reply with a synthetic greeting.' }] },
            limits: { max_cost_micro_usd: '0', max_output_tokens: 32, timeout_seconds: 20 },
          }),
        );
        fixture[`MACROFOLD_FIXTURE_READY_DEPLOYMENT_INPUT_${suffix}`] = input;
      }
    } finally {
      await database.end();
    }
    async function deploymentDispatches() {
      const response = await fetch(env.APP_ORIGIN! + '/model-fixture/observations', {
        headers: { Authorization: 'Bearer sdk-external-fixture-not-a-provider-key' },
      });
      assert(response.ok);
      assert.deepEqual(
        await response.json(),
        Object.fromEntries(
          ['typescript', 'python', 'go', 'rust', 'java'].map((language) => [`fixture-model-${language}`, 2]),
        ),
        'JSON and SSE each dispatch once; same-key recovery after stop never dispatches again.',
      );
    }
    await command(['exec', 'tsx', 'tests/fixtures/sdk-immediate-journey.ts'], fixture);
    if (immediateOnly) {
      await command(
        [
          'exec',
          'python',
          '-m',
          'pytest',
          'sdk/python/tests/test_immediate_inference.py',
          '-k',
          'application',
          '-q',
        ],
        fixture,
      );
      await command(
        ['exec', 'go', '-C', 'sdk/go', 'test', './...', '-run', 'TestImmediateInferenceApplication'],
        fixture,
      );
      await command(
        [
          'exec',
          'cargo',
          'test',
          '--locked',
          '--manifest-path',
          'sdk/rust/Cargo.toml',
          '--test',
          'immediate_inference',
          'application_immediate',
          '--',
          '--include-ignored',
        ],
        fixture,
      );
      await command(
        [
          'exec',
          'mvn',
          '-B',
          '-q',
          '-f',
          'sdk/java/pom.xml',
          '-Dtest=ImmediateInferenceTest#applicationImmediate',
          'test',
        ],
        fixture,
      );
      assert((await fetch(env.APP_ORIGIN! + '/health')).ok, 'Fixture background work failed.');
      await deploymentDispatches();
      return;
    }
    const workspace = await client.workspaces.create({ name: 'Shared file-read fixture' });
    const worktree = workspace.default_worktree_id;
    assert(worktree, 'The fixture workspace must have a default worktree.');
    for (const [path, content] of [
      ['notes/日本語 + #?.bin', new Uint8Array([0, 255, 10, 128])],
      ['empty.txt', new Uint8Array()],
    ] as const) {
      await client.worktrees.writeFile(worktree, {
        path,
        content,
        ifMatch: (await client.worktrees.get(worktree)).revision,
      });
    }
    fixture.MACROFOLD_FIXTURE_FILES_WORKTREE = worktree;
    const customer = await client.customerAgents.ensure('customer / 日本語', {
      key: 'assistant',
      name: 'SDK customer fixture',
      configuration: {
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
        limits: { max_cost_micro_usd: '2000000' },
      },
    });
    await client.worktrees.writeFile(customer.worktree_id, {
      path: 'brief.md',
      content: new TextEncoder().encode('Customer document fixture'),
      ifMatch: (await client.worktrees.get(customer.worktree_id)).revision,
    });
    const message = await client.customerAgents.sendMessage(customer.customer_id, customer.id, {
      prompt: 'Verify the optional customer-agent path.',
      attachments: ['brief.md'],
    });
    await client.customerAgents.waitRun(customer.customer_id, customer.id, message.run_id);
    fixture.MACROFOLD_FIXTURE_CUSTOMER_AGENT = customer.id;
    fixture.MACROFOLD_FIXTURE_CUSTOMER_RUN = message.run_id;

    await command(['exec', 'tsx', 'tests/fixtures/sdk-journey.ts'], fixture);
    await command(['exec', 'python', '-m', 'pytest', 'sdk/python/tests', '-q'], fixture);
    await command(['exec', 'python', '-m', 'pyright', '--project', 'sdk/python/pyrightconfig.json'], fixture);
    await command(['exec', 'go', '-C', 'sdk/go', 'test', './...'], fixture);
    await command(
      [
        'exec',
        'cargo',
        'test',
        '--locked',
        '--manifest-path',
        'sdk/rust/Cargo.toml',
        '--',
        '--include-ignored',
      ],
      fixture,
    );
    await command(['exec', 'mvn', '-B', '-q', '-f', 'sdk/java/pom.xml', 'verify'], fixture);
    await deploymentDispatches();
  } catch (error) {
    // Retain content-free failure reasons before the disposable database is removed.
    const database = new pg.Client({ connectionString: env.MIGRATION_DATABASE_URL });
    try {
      await database.connect();
      console.error(
        'Fixture run failures:',
        (
          await database.query(
            "SELECT id,status,result->>'failure_code' AS failure_code FROM runs WHERE status='failed'",
          )
        ).rows,
      );
    } finally {
      await database.end();
    }
    throw error;
  } finally {
    await Promise.all([server.stop(), worker?.stop()]);
  }
});
