import { mkdir, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { build } from 'esbuild';
import { withFixtureDatabase } from './fixture-database';
import { background, command, ready } from './coverage/processes';
import { pack } from './coverage/pack';
import { currentSourceManifest, sameSources } from './coverage/maps';

const directory = path.resolve(process.env.COVERAGE_DIR || 'coverage/full');
await mkdir(directory, { recursive: true });
// A separate loopback port prevents attaching to or disrupting the running preview.
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = (reservation.address() as import('node:net').AddressInfo).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
process.env.APP_ORIGIN = `http://localhost:${port}`;
process.env.NEXT_DIST_DIR = `.next/coverage-${port}`;
process.env.TEST_COVERAGE_BUILD = '1';
// Next clears its output directory at build start; keep the private config beside it.
const typecheckConfig = `.next/tsconfig-coverage-${port}.json`;
await mkdir(path.join('apps/web', process.env.NEXT_DIST_DIR), { recursive: true });
await writeFile(
  path.join('apps/web', typecheckConfig),
  JSON.stringify({
    extends: '../tsconfig.json',
    include: [
      '../next-env.d.ts',
      '../app/**/*.ts',
      '../app/**/*.tsx',
      '../components/**/*.ts',
      '../components/**/*.tsx',
      '../lib/**/*.ts',
      '../workflows/**/*.ts',
      `./coverage-${port}/types/**/*.ts`,
    ],
    exclude: ['../node_modules'],
  }),
);
await withFixtureDatabase(async (base) => {
  const env = {
    ...base,
    APP_ORIGIN: process.env.APP_ORIGIN,
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR,
    NEXT_TYPECHECK_CONFIG: typecheckConfig,
    TEST_COVERAGE_BUILD: '1',
    NODE_OPTIONS: '--dns-result-order=ipv4first',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  for (const surface of ['browser', 'server', 'worker', 'cli']) await mkdir(path.join(directory, surface));
  await command(['exec', 'tsx', 'scripts/seed.ts'], env);
  const buildSources = await currentSourceManifest(process.cwd());
  await command(['build'], env);
  if (!sameSources(buildSources, await currentSourceManifest(process.cwd())))
    throw new Error('Source changed during the acceptance build');
  await writeFile(path.join(directory, 'build-sources.json'), JSON.stringify(buildSources));
  await command(['--filter', '@hosted-agents/cli', 'build'], env);
  const dist = path.resolve('apps/web', env.NEXT_DIST_DIR!);
  await cp(path.join(dist, 'static'), path.join(dist, 'standalone/apps/web', env.NEXT_DIST_DIR!, 'static'), {
    recursive: true,
  });
  const workerPath = path.join(directory, 'worker.mjs');
  await build({
    entryPoints: ['scripts/worker.ts'],
    outfile: workerPath,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: true,
  });
  const flush = path.resolve('tests/fixtures/coverage-flush.mjs');
  const server = background(
    ['--enable-source-maps', '--import', flush, path.join(dist, 'standalone/apps/web/server.js')],
    { ...env, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_V8_COVERAGE: path.join(directory, 'server') },
    path.join(directory, 'server.log'),
  );
  const worker = background(
    ['--enable-source-maps', '--import', flush, workerPath],
    { ...env, NODE_V8_COVERAGE: path.join(directory, 'worker') },
    path.join(directory, 'worker.log'),
  );
  try {
    await ready(env.APP_ORIGIN!, server.child);
    const failures: unknown[] = [];
    for (const [args, additions] of [
      [
        ['exec', 'playwright', 'test', ...process.argv.slice(2)],
        {
          BROWSER_COVERAGE_DIR: path.join(directory, 'browser'),
          BROWSER_SOURCE_MAP_ROOT: path.join(dist, 'static'),
        },
      ],
      [['exec', 'vitest', 'run', 'tests/cli'], { CLI_V8_COVERAGE: path.join(directory, 'cli') }],
      [['exec', 'python3', 'scripts/test-terminal.py'], { CLI_V8_COVERAGE: path.join(directory, 'cli') }],
      [['exec', 'python3', 'scripts/test-python-live.py'], { PYTHONPATH: path.resolve('sdk/python') }],
    ] as [string[], Partial<NodeJS.ProcessEnv>][]) {
      try {
        await command(args, { ...env, ...additions });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, 'Application acceptance failed; all surfaces were attempted.');
  } finally {
    await Promise.all([server.stop(), worker.stop()]);
    for (const surface of ['server', 'worker', 'cli'])
      await pack(path.join(directory, surface), false, surface === 'server' ? dist : undefined);
  }
});
