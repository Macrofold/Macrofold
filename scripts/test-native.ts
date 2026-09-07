import './build-runtime';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pack } from './coverage/pack';
const root = path.resolve(import.meta.dirname, '..');
const imageOnly = process.argv.includes('--image-only');
const stdio = process.argv.includes('--stdio');
const selected = process.argv.slice(2).filter((a) => !['--questions', '--image-only', '--stdio'].includes(a));
for (const harness of stdio ? ['stdio'] : selected.length ? selected : ['codex', 'claude-code', 'opencode']) {
  if (!['codex', 'claude-code', 'opencode', 'stdio'].includes(harness))
    throw new Error('Choose a supported native harness');
  const args = [
    'run',
    '--rm',
    '--network',
    'none',
    '--mount',
    `type=bind,src=${root}/tests/fixtures,dst=/tests,readonly`,
  ];
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
  for (const name of imageOnly ? [] : ['native-worker', 'entry', 'restore'])
    args.push(
      '--mount',
      `type=bind,src=${root}/packages/runtime/dist/${name}.mjs,dst=/opt/platform/${name}.mjs,readonly`,
    );
  args.push('platform-runtime:0.1.0', 'node', stdio ? '/tests/stdio-native.mjs' : '/tests/native-mock.mjs');
  if (!stdio) args.push(harness);
  if (process.argv.includes('--questions')) args.push('questions');
  const child = spawn('docker', args, { stdio: 'inherit' });
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  if (coverage) await pack(coverage, true);
  if (code !== 0) process.exit(code || 1);
}
