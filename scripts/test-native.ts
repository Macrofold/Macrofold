import './build-runtime';
import { spawn } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const imageOnly = process.argv.includes('--image-only');
const selected = process.argv.slice(2).filter((a) => !['--questions', '--image-only'].includes(a));
for (const harness of selected.length ? selected : ['codex', 'claude-code', 'opencode']) {
  if (!['codex', 'claude-code', 'opencode'].includes(harness))
    throw new Error('Choose a supported native harness');
  const args = [
    'run',
    '--rm',
    '--network',
    'none',
    '--mount',
    `type=bind,src=${root}/tests/fixtures,dst=/tests,readonly`,
  ];
  for (const name of imageOnly ? [] : ['native-worker', 'entry', 'restore'])
    args.push(
      '--mount',
      `type=bind,src=${root}/packages/runtime/dist/${name}.mjs,dst=/opt/platform/${name}.mjs,readonly`,
    );
  args.push('platform-runtime:0.1.0', 'node', '/tests/native-mock.mjs', harness);
  if (process.argv.includes('--questions')) args.push('questions');
  const child = spawn('docker', args, { stdio: 'inherit' });
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  if (code !== 0) process.exit(code || 1);
}
