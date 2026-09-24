import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, chown, readdir } from 'node:fs/promises';
import { sandboxControlRequest, type SandboxControlRequest } from '../../contracts/sandbox-control';
import { runtimeConfiguration, supervise, discardHarness, type LiveHarness } from './supervisor';
import { agentProcesses } from './agent-processes';
import { warmSessionKey } from './warm-session';
import { atomicJSON, probeRuntime } from './manifest';
import { z } from 'zod';

const root = '/platform-control';
const boot = randomUUID();
const children = new Map<string, number>();
let active: string | undefined;
const resident: LiveHarness = { processes: new Set() };
let reused = false;
// Serialize control mutations in one root process; subprocesses never receive this credential.
let queue = Promise.resolve();
function command(run: string, script: string, args: string[] = [], detached = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`/opt/platform/${script}.mjs`, ...args], {
      env: { PATH: process.env.PATH, NODE_ENV: 'production', PLATFORM_RUN_ID: run },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    children.set(run, (children.get(run) || 0) + 1);
    child.stdout.on('data', (bytes: Buffer) => {
      output += bytes.toString();
      if (output.length > 8 * 1024 * 1024) child.kill('SIGKILL');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      children.set(run, Math.max(0, (children.get(run) || 1) - 1));
      if (!detached) code === 0 ? resolve(output) : reject(new Error('runtime_command_failed'));
    });
    if (detached) child.once('spawn', () => resolve('started'));
  });
}
export async function control(request: SandboxControlRequest): Promise<unknown> {
  if (request.action === 'health') return { boot_id: boot, created_at: new Date().toISOString() };
  const run = request.run_id;
  const dir = `${root}/runs/${run}`;
  if (request.action === 'prepare') {
    const configuration = runtimeConfiguration.parse(request.configuration);
    if (
      configuration.runId !== run ||
      configuration.workspace !== '/workspace' ||
      configuration.stateHome !== '/agent-home'
    )
      throw new Error('invalid_configuration');
    if (active && active !== run) throw new Error('sandbox_busy');
    if (!active) {
      // A previously released run must never reclaim the VM after a delayed request.
      try {
        await readFile(`${dir}/prepared`);
        throw new Error('run_released');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const key = warmSessionKey(configuration);
      const processes = await agentProcesses();
      reused = Boolean(
        [...resident.processes].every((pid) => processes.get(pid) === 'T') &&
        resident.child &&
        resident.child.exitCode === null &&
        key &&
        key === resident.key &&
        configuration.warm?.checkpointId === resident.checkpointId &&
        configuration.resumeId === resident.resumeId,
      );
      if (!reused) await discardHarness(resident);
      // Restore from the authoritative checkpoint, including deletions and session changes.
      // A working directory alone is not a filesystem isolation boundary.
      if (!reused) {
        await rm('/workspace', { recursive: true, force: true });
        await rm('/agent-home', { recursive: true, force: true });
        for (const path of ['/workspace', '/agent-home']) {
          await mkdir(path, { recursive: true });
          await chown(path, 10001, 10001);
        }
      }
    }
    await mkdir(`${dir}/restore/chunks`, { recursive: true, mode: 0o700 });
    await atomicJSON(`${dir}/config.json`, configuration);
    await writeFile(`${dir}/prepared`, '', { mode: 0o600 });
    active = run;
    return { reused };
  }
  if (request.action === 'release' && active !== run) {
    await readFile(`${dir}/released`);
    return {};
  }
  if (active !== run) throw new Error('run_not_active');
  switch (request.action) {
    case 'stage':
      for (const file of request.files)
        await writeFile(`${dir}/restore/${file.path}`, Buffer.from(file.content, 'base64'), { mode: 0o600 });
      return {};
    case 'restore':
      if (reused) return 'started';
      return command(run, 'restore', [], true);
    case 'restored': {
      if (reused) return 'success';
      try {
        return JSON.parse(await readFile(`${dir}/restore-result.json`, 'utf8')).ok ? 'success' : 'failure';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'pending';
        throw error;
      }
    }
    case 'launch': {
      // Root owns a single resident native process independently of per-run commands.
      if (children.get(run)) return 'started';
      children.set(run, 1);
      void supervise(`${dir}/config.json`, '/opt/platform/native-worker.mjs', resident)
        .catch(async () => {
          await discardHarness(resident);
          await atomicJSON(`${dir}/result.json`, {
            output: '',
            outcome: 'failure',
            failureCode: 'supervisor_failed',
            persistence: 'failed',
            completedAt: new Date().toISOString(),
          });
        })
        .finally(() => children.set(run, 0));
      return 'started';
    }
    case 'probe':
      return probeRuntime(dir, request.offset);
    case 'snapshot':
      return JSON.parse(await command(run, 'snapshot-page', [String(request.offset)]));
    case 'chunk':
      return { content: (await readFile(`${dir}/snapshot/chunks/${request.hash}`)).toString('base64') };
    case 'answer':
      await atomicJSON(`${dir}/answer.json`, { id: request.id, answer: request.answer });
      return {};
    case 'cancel':
      await writeFile(`${dir}/cancel`, 'cancel');
      return {};
    case 'stdio':
      if (request.invocation.runId !== run) throw new Error('invalid_invocation');
      await atomicJSON(`${dir}/stdio-${request.invocation.id}.json`, request.invocation);
      return JSON.parse(await command(run, 'stdio-call', [request.invocation.id]));
    case 'release':
      if (children.get(run)) throw new Error('runtime_not_quiescent');
      // Release only after supervisor capture, never while descendants may be writing.
      if (!(await probeRuntime(dir, 0)).result) throw new Error('runtime_not_finished');
      resident.checkpointId = request.checkpoint_id ?? null;
      for (const name of await readdir(dir))
        if (!['prepared', 'execution.lock', 'restore.lock'].includes(name))
          await rm(`${dir}/${name}`, { recursive: true, force: true });
      await writeFile(`${dir}/released`, '', { mode: 0o600 });
      active = undefined;
      return {};
  }
}

async function main() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0)
    throw new Error('Isolated Linux root required');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const secret =
    process.env.SANDBOX_CONTROL_SECRET || (await readFile(`${root}/control-secret`, 'utf8')).trim();
  if (secret.length < 32) throw new Error('Control secret required');
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.end('ok');
      return;
    }
    const authorization = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== 'POST' || req.url !== '/control') {
      res.writeHead(404).end();
      return;
    }
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 8 * 1024 * 1024) throw new Error('request_too_large');
        chunks.push(bytes);
      }
      const envelope = z
        .object({ boot_id: z.string().optional(), request: sandboxControlRequest })
        .parse(JSON.parse(Buffer.concat(chunks).toString()));
      if (envelope.boot_id && envelope.boot_id !== boot) throw new Error('sandbox_restarted');
      const task = queue.then(() => control(envelope.request));
      queue = task.then(
        () => {},
        () => {},
      );
      const value = await task;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ value }));
    } catch {
      res
        .writeHead(409, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'sandbox_control_failed' }));
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  server.listen(Number(process.env.PORT || 10000), process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
}
if (process.argv[1]?.endsWith('/sandbox-control.mjs')) await main();
