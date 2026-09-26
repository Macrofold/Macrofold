import { harnessNames } from '../packages/contracts/harnesses';
import './build-runtime';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pack } from './coverage/pack';
import { dockerCommand } from '../packages/providers/src/docker';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..');
const image = process.env.DOCKER_RUNTIME_IMAGE || 'platform-runtime:0.1.0';
const imageOnly = process.argv.includes('--image-only');
const media = process.argv.includes('--media');
if (media)
  await build({
    entryPoints: ['packages/core/src/model-content.ts'],
    outfile: 'packages/runtime/dist/media-validation.mjs',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    packages: 'external',
    sourcemap: true,
  });
const stdio = process.argv.includes('--stdio');
const warm = process.argv.includes('--warm');
const selected = process.argv
  .slice(2)
  .filter(
    (a) =>
      ![
        '--questions',
        '--tools',
        '--failure',
        '--cancel',
        '--permissions',
        '--image-only',
        '--stdio',
        '--media',
        '--warm',
      ].includes(a),
  );
for (const harness of stdio ? ['stdio'] : selected.length ? selected : harnessNames) {
  if (![...harnessNames, 'stdio'].includes(harness))
    throw new Error('Choose a supported native harness');
  const args = [
    'run',
    '--rm',
    '--network',
    'none',
    '--mount',
    `type=bind,src=${root}/tests/fixtures,dst=/tests,readonly`,
  ];
  if (media)
    for (const suffix of ['', '.map']) args.push(
      '--mount',
      `type=bind,src=${root}/packages/runtime/dist/media-validation.mjs${suffix},dst=/opt/platform/media-validation.mjs${suffix},readonly`,
    );
  const coverage = process.env.NATIVE_COVERAGE_DIR
    ? path.resolve(process.env.NATIVE_COVERAGE_DIR, randomUUID())
    : undefined;
  if (coverage) {
    await mkdir(coverage, { recursive: true });
    args.push(
      '--mount',
      `type=bind,src=${coverage},dst=/coverage`,
      '-e',
      'NODE_V8_COVERAGE=/coverage',
      '-e',
      'NODE_OPTIONS=--enable-source-maps --import=/tests/coverage-flush.mjs',
    );
  }
  for (const name of imageOnly
    ? []
    : [
        'native-worker',
        'entry',
        'restore',
        'deepseek-bridge',
        'document-worker',
        'snapshot-page', 'stdio-call',
      ])
    for (const suffix of ['', '.map']) args.push(
      '--mount',
      `type=bind,src=${root}/packages/runtime/dist/${name}.mjs${suffix},dst=/opt/platform/${name}.mjs${suffix},readonly`,
    );
  if (!imageOnly)
    args.push(
      '--mount',
      `type=bind,src=${root}/packages/runtime/dist/hermes-bridge.py,dst=/opt/platform/hermes-bridge.py,readonly`,
    );
  args.push(
    image,
    'node',
    stdio ? '/tests/stdio-native.mjs' : '/tests/native-mock.mjs',
  );
  if (!stdio) args.push(harness);
  if (warm) args.push('--warm');
  if (process.argv.includes('--media')) args.push('media');
  else if (process.argv.includes('--questions')) args.push('questions');
  else if (process.argv.includes('--permissions')) args.push('permissions');
  else if (process.argv.includes('--tools')) args.push('tools');
  else if (process.argv.includes('--failure')) args.push('failure');
  else if (process.argv.includes('--cancel')) args.push('cancel');
  const child = spawn('docker', args, { stdio: 'inherit' });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (coverage) {
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    if (uid !== undefined && gid !== undefined) {
      // Runtime umask is deliberately private. Transfer only finished fixture
      // coverage to the invoking contributor; never relax execution permissions.
      await dockerCommand([
        'run', '--rm', '--pull=never', '--network=none', '--read-only',
        '--security-opt=no-new-privileges', '--cap-drop=ALL',
        '--cap-add=CHOWN', '--cap-add=DAC_OVERRIDE', '--memory=128m', '--pids-limit=32',
        '--mount', `type=bind,src=${coverage},dst=/coverage`,
        image, 'node', '--input-type=module', '-e', `
          import { readdir, lstat, chown } from 'node:fs/promises';
          const [uid, gid] = process.argv.slice(1).map(Number);
          for (const name of await readdir('/coverage')) {
            if (!/^coverage-.*\\.json$/.test(name) && name !== 'runtime-sources.json') continue;
            const file = '/coverage/' + name;
            if (!(await lstat(file)).isFile()) throw new Error('Unexpected coverage file type');
            await chown(file, uid, gid);
          }
        `, String(uid), String(gid),
      ]);
    }
    await pack(coverage, true);
  }
  if (code !== 0) process.exit(code || 1);
}
