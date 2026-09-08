import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parse } from 'dotenv';

const action = process.argv[2];
if (!['dev', 'worker', 'doctor'].includes(action)) throw new Error('Choose dev, worker, or doctor.');
// Exported variables win over the explicit Docker overlay, which wins over the simulator .env.
// Never rewrite either file or infer permission to spend from provider credentials.
const env = {
  ...parse(await readFile('.env')),
  ...parse(await readFile('.env.docker')),
  ...process.env,
};
if (
  env.PLATFORM_MODE !== 'local' ||
  env.EXECUTION_PROVIDER !== 'docker' ||
  env.ORCHESTRATION_BACKEND !== 'poller'
)
  throw new Error('Configure .env.docker from .env.docker.example before starting local Docker execution.');
const child = spawn('pnpm', ['run', action], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('error', () => {
  console.error('Unable to start pnpm.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
