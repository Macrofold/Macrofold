import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
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
await withFixtureDatabase(async (env) => {
  await command(['exec', 'tsx', 'scripts/seed.ts'], env);
  const seed = JSON.parse(await readFile(path.join(env.DATA_DIR!, 'demo.json'), 'utf8'));
  const fixture: NodeJS.ProcessEnv = {
    ...env,
    PYTHONPATH: path.resolve('sdk/python'),
    MACROFOLD_FIXTURE_ORIGIN: env.APP_ORIGIN,
    MACROFOLD_FIXTURE_KEY: seed.api_key,
  };
  const server = background(
    ['--import', 'tsx', 'tests/fixtures/sdk-server.ts'],
    env,
    path.join(env.DATA_DIR!, 'sdk-server.log'),
  );
  const worker = background(
    ['--import', 'tsx', 'scripts/worker.ts'],
    env,
    path.join(env.DATA_DIR!, 'sdk-worker.log'),
  );
  try {
    await ready(env.APP_ORIGIN!, server.child);
    const client = new Client({ baseURL: env.APP_ORIGIN!, apiKey: seed.api_key });
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
    await Promise.all([server.stop(), worker.stop()]);
  }
});
