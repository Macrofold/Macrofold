import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { harnessNames } from '../packages/contracts/harnesses';

const memoryProfile = process.argv.includes('--memory-profile');
const selected = process.argv.slice(2).filter((value) => value !== '--memory-profile');
const harnesses = selected.length
  ? selected
  : memoryProfile
    ? ['opencode', 'claude-code', 'pi']
    : harnessNames;
if (harnesses.some((value) => !harnessNames.includes(value as (typeof harnessNames)[number])))
  throw new Error('Choose a supported native harness.');
const fixtures = path.resolve(import.meta.dirname, '../tests/fixtures');
let image = process.env.DOCKER_RUNTIME_IMAGE || 'platform-runtime:0.1.0';
let profileDirectory: string | undefined;
if (memoryProfile) {
  if (!process.env.NATIVE_MEMORY_OUTPUT_DIR)
    throw new Error('Set a new private NATIVE_MEMORY_OUTPUT_DIR for qualification.');
  profileDirectory = path.resolve(process.env.NATIVE_MEMORY_OUTPUT_DIR);
  await mkdir(path.dirname(profileDirectory), { recursive: true, mode: 0o700 });
  await mkdir(profileDirectory, { mode: 0o700 }); // Never overwrite failed or successful evidence.
  const command = promisify(execFile);
  const metadata = async (commandName: string, args: string[]) =>
    (await command(commandName, args, { timeout: 30000, maxBuffer: 1024 * 1024 })).stdout.trim();
  image = await metadata('docker', ['image', 'inspect', '--format', '{{.Id}}', image]);
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error('The qualification image must resolve to an immutable local ID.');
  await writeFile(
    path.join(profileDirectory, 'environment.json'),
    JSON.stringify(
      {
        source: await metadata('git', ['rev-parse', 'HEAD']),
        image,
        lockfile_sha256: createHash('sha256')
          .update(await readFile('pnpm-lock.yaml'))
          .digest('hex'),
        runner_node: process.version,
        fixture_sha256: createHash('sha256')
          .update(await readFile(path.join(fixtures, 'native-memory.mjs')))
          .digest('hex'),
        docker: JSON.parse(
          await metadata('docker', [
            'info',
            '--format',
            '{"architecture":"{{.Architecture}}","cpus":{{.NCPU}},"memory_bytes":{{.MemTotal}},"kernel":"{{.KernelVersion}}"}',
          ]),
        ),
        limits: { cpus: 2, memory_bytes: 4 * 1024 ** 3, pids: 4096 },
        capture: process.env.NATIVE_MEMORY_CAPTURE === '1',
        note: 'Network-disabled built image; no runtime source overlay. Container/controller startup is separate from native turn timings.',
      },
      null,
      2,
    ),
    { mode: 0o600, flag: 'wx' },
  );
} else await import('./build-runtime');
async function run(harness: string, mode: 'concurrent' | 'export' | 'import' | 'memory', directory: string) {
  const name = `worker-acceptance-${randomUUID()}`;
  const args = [
    'run',
    '--rm',
    '--name',
    name,
    '--network',
    'none',
    '--init',
    '--cpus=2',
    '--memory=4g',
    '--memory-swap=4g',
    '--pids-limit=4096',
    '--security-opt=no-new-privileges',
    '--cap-drop=ALL',
    ...['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID', 'KILL'].map((value) => `--cap-add=${value}`),
    '--mount',
    `type=bind,src=${fixtures},dst=/tests,readonly`,
    '--mount',
    `type=bind,src=${directory},dst=/worker-exchange${mode === 'import' ? ',readonly' : ''}`,
    ...(mode === 'memory'
      ? [
          '-e',
          `NATIVE_MEMORY_CAPTURE=${process.env.NATIVE_MEMORY_CAPTURE === '1' ? '1' : '0'}`,
          ...(process.getuid && process.getgid
            ? [
                '-e',
                `NATIVE_MEMORY_OUTPUT_UID=${process.getuid()}`,
                '-e',
                `NATIVE_MEMORY_OUTPUT_GID=${process.getgid()}`,
              ]
            : []),
          ...['COLD_COUNT', 'WARM_COUNT', 'DELAY_MS', 'CASE', 'EXPECT_DIAGNOSTICS', 'EXPECT_LAZY'].flatMap(
            (key) =>
              process.env[`NATIVE_MEMORY_${key}`] === undefined
                ? []
                : ['-e', `NATIVE_MEMORY_${key}=${process.env[`NATIVE_MEMORY_${key}`]}`],
          ),
        ]
      : []),
    image,
    'node',
    mode === 'memory' ? '/tests/native-memory.mjs' : '/tests/worker-native.mjs',
    harness,
    mode,
  ];
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('docker', args, { stdio: 'inherit' });
      const timer = setTimeout(() => child.kill('SIGTERM'), mode === 'memory' ? 30 * 60000 : 300000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`${harness} ${mode} acceptance failed (${code}).`));
      });
    });
  } finally {
    await new Promise<void>((resolve) => {
      const cleanup = spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
      cleanup.once('error', () => resolve());
      cleanup.once('close', () => resolve());
    });
  }
}
for (const harness of harnesses) {
  if (memoryProfile && profileDirectory) {
    const directory = path.join(profileDirectory, harness);
    await mkdir(directory, { mode: 0o700 });
    await run(harness, 'memory', directory);
    continue;
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'macrofold-worker-native-'));
  try {
    await run(harness, 'concurrent', directory);
    await run(harness, 'export', directory);
    // A different container has no surviving process or disk cache from the exported Host.
    await run(harness, 'import', directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
