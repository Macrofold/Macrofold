import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

type ProcessInfo = { pid: number; parent: number; command: string };

export function parseProcesses(output: string): ProcessInfo[] {
  return output.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }] : [];
  });
}

/** Match entry points, never a port alone or every Node process on the machine. */
export function serviceKind(command: string): 'worker' | 'web' | undefined {
  if (!/^\S*(?:node|tsx)(?:\s|$)/.test(command)) return;
  if (/(?:^|\s)(?:\S*\/)?scripts\/worker\.ts(?:\s|$)/.test(command)) return 'worker';
  if (/\/next(?:\/dist\/bin\/next)?\s+(?:dev|start)\s+-p\s+3210(?:\s|$)/.test(command)) return 'web';
}

export function isTestProcess(process: ProcessInfo, processes: ProcessInfo[]): boolean {
  const visited = new Set<number>();
  let current: ProcessInfo | undefined = process;
  while (current && !visited.has(current.pid)) {
    visited.add(current.pid);
    if (/(?:scripts\/test[^\s]*|\bvitest\b|\bplaywright\b)/.test(current.command)) return true;
    current = processes.find((entry) => entry.pid === current!.parent);
  }
  return false;
}

function processes(): ProcessInfo[] {
  return parseProcesses(execFileSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8' }));
}

function cwd(pid: number): string | undefined {
  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const path = output
      .split('\n')
      .find((line) => line.startsWith('n'))
      ?.slice(1);
    return path ? realpathSync(path) : undefined;
  } catch {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return undefined;
    }
    throw new Error(
      `Cannot inspect PID ${pid}. Ensure lsof is installed and process access is allowed; infrastructure was left running.`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--down', '--dry-run'].includes(arg)))
    throw new Error('Usage: pnpm run stop [--down] [--dry-run]');
  const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  const snapshot = processes();
  const targets = snapshot.filter((entry) => {
    const kind = serviceKind(entry.command);
    if (!kind || isTestProcess(entry, snapshot)) return false;
    const directory = cwd(entry.pid);
    return directory === root || (kind === 'web' && directory === resolve(root, 'apps/web'));
  });
  // tsx has a launcher and a child. Signal only the launcher; it forwards SIGTERM.
  const roots = targets.filter((entry) => !targets.some((other) => other.pid === entry.parent));
  const action = args.includes('--down') ? 'down' : 'stop';
  for (const entry of roots) console.log(`Stop local ${serviceKind(entry.command)} (PID ${entry.pid})`);
  console.log(`docker compose -f infra/compose.yml ${action} (database volume retained)`);
  if (args.includes('--dry-run')) return;

  for (const entry of roots) {
    const current = processes().find((candidate) => candidate.pid === entry.pid);
    if (!current) continue;
    if (
      current.command !== entry.command ||
      ![root, resolve(root, 'apps/web')].includes(cwd(entry.pid) ?? '')
    )
      throw new Error('A process changed during shutdown; services were left running. Retry.');
    try {
      process.kill(entry.pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  // Keep PostgreSQL available while workers drain. Never force-kill active work.
  const deadline = Date.now() + 60_000;
  while (
    processes().some((entry) =>
      targets.some((target) => target.pid === entry.pid && target.command === entry.command),
    )
  ) {
    if (Date.now() >= deadline)
      throw new Error(
        'App/worker shutdown is still pending. PostgreSQL was left running; retry after active work finishes.',
      );
    await delay(250);
  }
  execFileSync('docker', ['compose', '-f', resolve(root, 'infra/compose.yml'), action], { stdio: 'inherit' });
  console.log('Local services stopped. Database data and .data files are preserved.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Local shutdown failed.');
    process.exitCode = 1;
  });
}
