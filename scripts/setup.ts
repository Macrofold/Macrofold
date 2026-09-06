import { spawn } from 'node:child_process';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { config, isLocal } from '../packages/core/src/config';
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node.js 24 or newer.');
if (!isLocal() || config.execution !== 'simulator' || config.allowPaid)
  throw new Error(
    'Local setup requires PLATFORM_MODE=local, EXECUTION_PROVIDER=simulator and ALLOW_PAID_EXECUTION=false. Production is configured separately.',
  );
try {
  const existing = await lstat('.env');
  if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('Refusing a non-regular .env file.');
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  // The local profile intentionally preserves the documented local fixture keys; never rotate existing data implicitly.
  await writeFile('.env', await readFile('.env.example'), { mode: 0o600, flag: 'wx' });
}
async function run(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed with exit code ${code}`)),
    );
  });
}
await run('docker', ['compose', '-f', 'infra/compose.yml', 'up', '-d', '--wait', '--wait-timeout', '60']);
for (const script of ['migrate', 'auth-migrate', 'provision-cli', 'seed'])
  await run('pnpm', ['exec', 'tsx', `scripts/${script}.ts`]);
await run('pnpm', ['exec', 'tsx', 'scripts/doctor.ts']);
console.log(
  'Local setup complete. Start pnpm dev and pnpm worker in separate terminals. Open http://localhost:3210. No paid execution was enabled.',
);
