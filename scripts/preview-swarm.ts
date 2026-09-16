import { spawn } from 'node:child_process';
import path from 'node:path';

const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3347'],
  {
    cwd: path.resolve('apps/web'),
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_DIST_DIR: '.next/swarm-site-dev',
      MARKETING_MEDIA_BASE_URL: '/swarm-media/myriad/v1',
    },
  },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
