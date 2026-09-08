import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withFixtureDatabase } from './fixture-database';
import { background, command, ready } from './coverage/processes';
import { Client } from '../sdk/typescript/src/client';

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
    const project = await client.projects.create({ name: 'Shared file-read fixture' });
    const workspace = project.default_workspace_id;
    assert(workspace, 'The fixture project must have a default workspace.');
    for (const [path, content] of [
      ['notes/日本語 + #?.bin', new Uint8Array([0, 255, 10, 128])],
      ['empty.txt', new Uint8Array()],
    ] as const) {
      await client.workspaces.writeFile(workspace, {
        path,
        content,
        ifMatch: (await client.workspaces.get(workspace)).revision,
      });
    }
    fixture.MACROFOLD_FIXTURE_FILES_WORKSPACE = workspace;
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
  } finally {
    await Promise.all([server.stop(), worker.stop()]);
  }
});
