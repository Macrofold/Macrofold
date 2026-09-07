import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withFixtureDatabase } from './fixture-database';
import { background, command, ready } from './coverage/processes';

const reservation = createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = (reservation.address() as import('node:net').AddressInfo).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
process.env.APP_ORIGIN = `http://127.0.0.1:${port}`;
await withFixtureDatabase(async (env) => {
  await command(['exec', 'tsx', 'scripts/seed.ts'], env);
  const seed = JSON.parse(await readFile(path.join(env.DATA_DIR!, 'demo.json'), 'utf8'));
  const fixture = { ...env, MACROFOLD_FIXTURE_ORIGIN: env.APP_ORIGIN, MACROFOLD_FIXTURE_KEY: seed.api_key };
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
