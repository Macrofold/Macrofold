import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parse } from 'dotenv';

const action = process.argv[2];
if (!['dev', 'worker', 'doctor'].includes(action)) throw new Error('Choose dev, worker, or doctor.');
// The API and worker share one configuration; exported variables still take precedence.
const env = {
  ...parse(await readFile('.env')),
  ...process.env,
};
if (
  env.PLATFORM_MODE !== 'local' ||
  env.EXECUTION_PROVIDER !== 'docker' ||
  env.ORCHESTRATION_BACKEND !== 'poller'
)
  throw new Error('Set PLATFORM_MODE=local, EXECUTION_PROVIDER=docker and ORCHESTRATION_BACKEND=poller in .env.');
const child = spawn('pnpm', ['run', action], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('error', () => {
  console.error('Unable to start pnpm.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
