import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

export async function command(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const child = spawn('pnpm', args, { env, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Test command failed (${code}): pnpm ${args.join(' ')}`);
}
export function background(args: string[], env: NodeJS.ProcessEnv, log: string) {
  const output = createWriteStream(log);
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.pipe(output);
  child.stderr!.pipe(output);
  const done = once(child, 'exit');
  return {
    child,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
      try {
        await done;
      } finally {
        clearTimeout(timer);
        output.end();
      }
    },
  };
}
export async function ready(origin: string, child: ChildProcess) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Fixture server exited before readiness');
    if (
      await fetch(origin + '/health', { signal: AbortSignal.timeout(1000) })
        .then((r) => r.ok)
        .catch(() => false)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Fixture server did not become ready');
}
