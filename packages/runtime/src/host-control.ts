import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFile, chmod, chown, lstat, mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { hostControlRequest, type HostControlRequest } from '../../contracts/host-control';
import { runtimeConfiguration, supervise, discardHarness, type LiveHarness } from './supervisor';
import { agentProcesses, agentMemoryMiB } from './agent-processes';
import { atomicJSON, probeRuntime } from './manifest';
import { hostRunPaths, KeyedCommands, type HostRunContext } from './host-paths';
import { HostMeter, type HostResourceMeters } from './host-meter';
import type { NativeConfiguration } from './types';

const root = '/platform-control';
type Configuration = Extract<HostControlRequest, { action: 'configure' }>;
type Prepare = Extract<HostControlRequest, { action: 'prepare' }>;
type Handle = {
  id: string;
  uid: number;
  worktree: string;
  session: string | null;
  permission: string;
  checkpoint: string | null;
  sessionRevision: string;
  compatibility: string;
  runtime: LiveHarness;
  active: string | null;
  lastUsed: number;
  memoryMiB: number;
};
type Assignment = {
  id: string;
  run: string;
  fingerprint: string;
  request: Prepare;
  handle: Handle;
  configuration: NativeConfiguration;
  directory: string;
  filesReused: boolean;
  sessionReused: boolean;
  preparation?: Promise<{ reused: boolean; restoreNamespaces: ('workspace' | 'home')[] }>;
  supervision?: Promise<void>;
  finished: boolean;
  children: Set<ChildProcess>;
  restoration?: Promise<string>;
  released: boolean;
  recovery: boolean;
  meterClaimed: boolean;
};
type CachedFiles = { checkpoint: string | null; permission: string; bytes: number; lastUsed: number };

/** One trusted controller per provider allocation; slow operations are scoped to their assignment. */
export class HostController {
  readonly boot = randomUUID();
  readonly startedAt = new Date().toISOString();
  private configuration?: Configuration;
  private readonly commands = new KeyedCommands();
  private readonly assignments = new Map<string, Assignment>();
  private readonly handles = new Map<string, Handle>();
  private readonly writers = new Map<string, string>();
  private readonly files = new Map<string, CachedFiles>();
  private readonly tombstones = new Set<string>();
  private readonly meter = new HostMeter();
  private metered: boolean | undefined;
  private quiesced = false;
  private finalMeters: HostResourceMeters | null = null;
  private nextUID = 20000;

  private async health() {
    let meters = this.finalMeters;
    if (!this.quiesced) {
      try {
        meters = await this.meter.sample();
        this.metered = true;
      } catch {
        this.metered = false;
      }
    }
    return {
      boot_id: this.boot,
      started_at: this.startedAt,
      configured: !!this.configuration,
      quiesced: this.quiesced,
      active_assignments: [...this.assignments.values()].filter((value) => !value.released).length,
      rotation_requested:
        this.tombstones.size >= 90000 || !!(this.configuration?.isolate_runs && this.tombstones.size),
      capabilities: {
        scoped_processes: process.platform === 'linux' && process.getuid?.() === 0,
        sibling_isolation: !this.configuration || this.configuration.isolate_runs,
        resource_meter: this.metered,
      },
      meters,
    };
  }
  private async evict(handle: Handle, releasingAssignment?: string) {
    if (handle.active && handle.active !== releasingAssignment) throw new Error('handle_in_use');
    await discardHarness(handle.runtime);
    const base = `/host-data/handles/${handle.id}`;
    await rm(base, { recursive: true, force: true });
    if (handle.session)
      await rm(`/host-data/continuations/${handle.session}`, { recursive: true, force: true });
    if (!this.writers.has(handle.worktree) || this.writers.get(handle.worktree) === releasingAssignment) {
      const workspace = `/host-data/worktrees/${handle.worktree}`;
      await chown(workspace, 0, 0).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await chmod(workspace, 0o700).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    this.handles.delete(handle.id);
  }
  private async trimCaches(requiredMiB = 0, keep?: Handle) {
    const config = this.configuration;
    if (!config) return;
    const idle = [...this.handles.values()]
      .filter((handle) => !handle.active && handle !== keep)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    let memory = [...this.handles.values()]
      .filter((handle) => !handle.active)
      .reduce((sum, handle) => sum + handle.memoryMiB, 0);
    const active = [...this.assignments.values()]
      .filter((item) => !item.released)
      .reduce((sum, item) => sum + item.request.resources.memory_mib, 0);
    const headroom = Math.min(512, Math.ceil(config.resources.memory_mib / 8));
    for (const handle of idle) {
      if (
        memory > config.warm_memory_mib ||
        active + memory + requiredMiB > config.resources.memory_mib - headroom ||
        handle.lastUsed + config.warm_idle_seconds * 1000 < Date.now() ||
        this.handles.size > 128
      ) {
        await this.evict(handle);
        memory -= handle.memoryMiB;
      }
    }
    const cached = [...this.files].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    let bytes = cached.reduce((sum, entry) => sum + entry[1].bytes, 0);
    const disk = await statfs('/host-data');
    let free = Number(disk.bavail) * Number(disk.bsize);
    for (const [worktree, cache] of cached) {
      if (this.writers.has(worktree)) continue;
      if (this.files.size <= 128 && bytes <= 2 * 1024 ** 3 && free >= 512 * 1024 ** 2) break;
      for (const handle of this.handles.values())
        if (handle.worktree === worktree && !handle.active) await this.evict(handle);
      await rm(`/host-data/worktrees/${worktree}`, { recursive: true, force: true });
      this.files.delete(worktree);
      bytes -= cache.bytes;
      free += cache.bytes;
    }
  }
  async sweep(): Promise<void> {
    if (!this.configuration || this.quiesced) return;
    await this.commands.run('allocation', async () => {
      if (!this.quiesced) await this.trimCaches();
    });
  }
  private async own(paths: string[], uid: number) {
    for (const value of paths) {
      await mkdir(value, { recursive: true, mode: 0o700 });
      const current = await lstat(value);
      if (!current.isDirectory()) throw new Error('unsafe_runtime_root');
      // A warm handle already owns its tree. Avoid recursively visiting a large
      // unchanged Worktree on every turn; cold identity handoff still repairs it.
      if (current.uid !== uid || current.gid !== uid)
        await new Promise<void>((resolve, reject) => {
          const child = spawn('/bin/chown', ['-hR', `${uid}:${uid}`, value], { stdio: 'ignore' });
          child.once('error', reject);
          child.once('close', (code) =>
            code === 0 ? resolve() : reject(new Error('runtime_ownership_failed')),
          );
        });
      await chmod(value, 0o700);
    }
  }
  private async allocate(request: Prepare): Promise<Assignment> {
    const config = this.configuration;
    if (
      !config ||
      this.quiesced ||
      this.tombstones.size >= 100000 ||
      (config.isolate_runs && this.tombstones.size > 0)
    )
      throw new Error('host_rotation_required');
    if (this.tombstones.has(request.assignment_id)) throw new Error('assignment_released');
    const parsed = runtimeConfiguration.parse(request.configuration);
    if (parsed.runId !== request.run_id || Date.parse(parsed.deadline) <= Date.now())
      throw new Error('invalid_configuration');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          run: request.run_id,
          worktree: request.worktree_id,
          session: request.session_id,
          view: request.permission_view,
          checkpoint: request.checkpoint_id,
          revision: request.session_revision,
          key: request.compatibility_key,
          resources: request.resources,
          prompt: parsed.prompt,
          harness: parsed.harness,
          model: parsed.model,
          deadline: parsed.deadline,
        }),
      )
      .digest('hex');
    const existing = this.assignments.get(request.assignment_id);
    if (existing) {
      if (existing.run !== request.run_id || existing.fingerprint !== fingerprint || existing.released)
        throw new Error('assignment_changed');
      return existing;
    }
    if (this.writers.has(request.worktree_id)) throw new Error('worktree_busy');
    const active = [...this.assignments.values()].filter((value) => !value.released);
    const memory = active.reduce((sum, value) => sum + value.request.resources.memory_mib, 0);
    const cpu = active.reduce((sum, value) => sum + value.request.resources.cpu_millis, 0);
    const headroom = Math.min(512, Math.ceil(config.resources.memory_mib / 8));
    if (
      active.length >= config.concurrency ||
      memory + request.resources.memory_mib > config.resources.memory_mib - headroom ||
      cpu + request.resources.cpu_millis > config.resources.cpu_millis
    )
      throw new Error('host_capacity');
    let handle = [...this.handles.values()].find(
      (value) =>
        !value.active &&
        value.session !== null &&
        value.session === request.session_id &&
        value.worktree === request.worktree_id &&
        value.permission === request.permission_view &&
        value.checkpoint === request.checkpoint_id &&
        value.sessionRevision === request.session_revision &&
        value.compatibility === request.compatibility_key,
    );
    if (handle) {
      const processes = await agentProcesses(handle.uid);
      if (
        !handle.runtime.child ||
        handle.runtime.child.exitCode !== null ||
        !processes.size ||
        [...processes.values()].some((state) => state !== 'T') ||
        (await agentMemoryMiB(handle.uid)) > request.resources.memory_mib
      ) {
        await this.evict(handle);
        handle = undefined;
      }
    }
    // A Worktree has one local writer/view. An old frozen conversation cannot keep a stale filesystem incarnation alive.
    for (const old of this.handles.values())
      if (old !== handle && (old.worktree === request.worktree_id || config.isolate_runs))
        await this.evict(old);
    await this.trimCaches(handle ? 0 : request.resources.memory_mib, handle);
    const cached = this.files.get(request.worktree_id);
    const filesReused =
      !!cached &&
      cached.checkpoint === request.checkpoint_id &&
      cached.permission === request.permission_view;
    if (!filesReused && handle) {
      await this.evict(handle);
      handle = undefined;
    }
    if (!handle) {
      const uid = this.nextUID++;
      const handleId = randomUUID();
      // Never recycle UIDs within a generation: unknown tool scratch files cannot become accessible to a later authority.
      if (uid >= 2147483646) throw new Error('host_rotation_required');
      const home = hostRunPaths({
        assignmentId: request.assignment_id,
        handleId,
        worktreeId: request.worktree_id,
        sessionId: request.session_id,
        uid,
        memoryMiB: request.resources.memory_mib,
      }).home;
      await appendFile('/etc/group', `agent${uid}:x:${uid}:\n`);
      await appendFile(
        '/etc/passwd',
        `agent${uid}:x:${uid}:${uid}:Macrofold execution:${home}:/usr/sbin/nologin\n`,
      );
      handle = {
        id: handleId,
        uid,
        worktree: request.worktree_id,
        session: request.session_id,
        permission: request.permission_view,
        checkpoint: request.checkpoint_id,
        sessionRevision: request.session_revision,
        compatibility: request.compatibility_key,
        runtime: { uid, processes: new Set() },
        active: null,
        lastUsed: Date.now(),
        memoryMiB: 0,
      };
      this.handles.set(handleId, handle);
    }
    const owner = handle;
    const context: HostRunContext = {
      assignmentId: request.assignment_id,
      handleId: handle.id,
      worktreeId: request.worktree_id,
      sessionId: request.session_id,
      uid: handle.uid,
      memoryMiB: request.resources.memory_mib,
    };
    const paths = hostRunPaths(context);
    const configuration: NativeConfiguration = {
      ...parsed,
      workspace: paths.workspace,
      stateHome: paths.home,
      hostRun: context,
      warm:
        request.session_id && config.warm_memory_mib > 0
          ? {
              sessionId: request.session_id,
              checkpointId: request.checkpoint_id,
              toolFingerprint: request.compatibility_key,
            }
          : undefined,
    };
    const value: Assignment = {
      id: request.assignment_id,
      run: request.run_id,
      fingerprint,
      request,
      handle,
      configuration,
      directory: paths.control,
      filesReused,
      sessionReused: !!handle.runtime.child,
      finished: false,
      children: new Set(),
      released: false,
      recovery: false,
      meterClaimed: false,
    };
    handle.active = value.id;
    this.writers.set(request.worktree_id, value.id);
    this.assignments.set(value.id, value);
    this.files.delete(request.worktree_id);
    value.preparation = (async () => {
      if (this.metered) {
        await this.meter.claim(value.id, request.resources.memory_mib);
        value.meterClaimed = true;
      }
      if (!filesReused) await rm(paths.workspace, { recursive: true, force: true });
      await this.own([paths.workspace, paths.handle, paths.home, paths.temp], owner.uid);
      await mkdir(`${paths.control}/restore/chunks`, { recursive: true, mode: 0o700 });
      await atomicJSON(`${paths.control}/config.json`, configuration);
      await writeFile(`${paths.control}/prepared`, '', { mode: 0o600 });
      const restoreNamespaces: ('workspace' | 'home')[] = value.sessionReused
        ? []
        : filesReused
          ? ['home']
          : ['workspace', 'home'];
      return { reused: value.sessionReused, restoreNamespaces };
    })();
    // The caller observes failure; attach a handler immediately so a rejected preparation cannot become an unhandled rejection.
    void value.preparation.catch(() => {});
    return value;
  }
  private command(
    value: Assignment,
    script: 'restore' | 'snapshot-page' | 'stdio-call',
    args: string[] = [],
  ): { child: ChildProcess; result: Promise<string> } {
    const child = spawn(process.execPath, [`/opt/platform/${script}.mjs`, ...args], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        PLATFORM_RUN_ID: value.run,
        PLATFORM_ASSIGNMENT_ID: value.id,
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    value.children.add(child);
    const result = new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout?.on('data', (bytes: Buffer) => {
        output += bytes.toString();
        if (Buffer.byteLength(output) > 8 * 1024 * 1024) child.kill('SIGKILL');
      });
      child.once('error', reject);
      child.once('close', (code) => {
        value.children.delete(child);
        code === 0 ? resolve(output) : reject(new Error('runtime_command_failed'));
      });
    });
    return { child, result };
  }
  async control(request: HostControlRequest): Promise<unknown> {
    if (request.action === 'health') return this.health();
    if (request.action === 'quiesce')
      return this.commands.run('allocation', async () => {
        if (this.quiesced) return this.health();
        if ([...this.assignments.values()].some((value) => !value.released))
          throw new Error('runtime_not_quiescent');
        for (const handle of [...this.handles.values()]) await this.evict(handle);
        // This immutable receipt survives lost acknowledgements. Once sealed, this
        // generation cannot admit another assignment or accrue customer workload usage.
        const health = await this.health();
        this.finalMeters = health.meters;
        this.quiesced = true;
        return { ...health, quiesced: true };
      });
    if (request.action === 'configure')
      return this.commands.run('allocation', async () => {
        if (this.quiesced) throw new Error('host_rotation_required');
        if (request.isolate_runs && request.concurrency !== 1)
          throw new Error('isolation_requires_exclusive_host');
        if (this.configuration && JSON.stringify(this.configuration) !== JSON.stringify(request))
          throw new Error('host_configuration_immutable');
        this.configuration = request;
        for (const directory of [
          '/host-data',
          '/host-data/worktrees',
          '/host-data/handles',
          '/host-data/continuations',
        ]) {
          await mkdir(directory, { recursive: true, mode: 0o711 });
          await chmod(directory, 0o711);
        }
        await this.health();
        return {};
      });
    if (request.action === 'prepare') {
      const assignment = await this.commands.run('allocation', () => this.allocate(request));
      return assignment.preparation;
    }
    const value = this.assignments.get(request.assignment_id);
    if (!value || value.run !== request.run_id) {
      if (request.action === 'release' && this.tombstones.has(request.assignment_id)) return {};
      throw new Error('assignment_not_active');
    }
    if (value.released && !['probe', 'snapshot', 'chunk', 'release'].includes(request.action))
      throw new Error('assignment_released');
    // Probes/cancellation never wait behind restores or capture commands for another Run.
    if (request.action === 'probe') return probeRuntime(value.directory, request.offset);
    if (request.action === 'cancel') {
      await mkdir(value.directory, { recursive: true, mode: 0o700 });
      await writeFile(`${value.directory}/cancel`, 'cancel', { mode: 0o600 });
      if (!value.supervision) for (const child of value.children) child.kill('SIGTERM');
      return {};
    }
    if (request.action === 'answer') {
      await atomicJSON(`${value.directory}/answer.json`, { id: request.id, answer: request.answer });
      return {};
    }
    return this.commands.run(value.id, async () => {
      switch (request.action) {
        case 'stage':
          await value.preparation;
          if (value.supervision || value.restoration) throw new Error('assignment_already_restoring');
          for (const file of request.files)
            await writeFile(`${value.directory}/restore/${file.path}`, Buffer.from(file.content, 'base64'), {
              mode: 0o600,
            });
          return {};
        case 'restore': {
          await value.preparation;
          if (value.sessionReused) return 'started';
          if (value.supervision) throw new Error('assignment_already_launched');
          // An acknowledgement may be lost. Retrying restore must never create a
          // second writer or truncate files while the original restore is active.
          if (!value.restoration) {
            value.restoration = this.command(value, 'restore').result;
            void value.restoration.catch(() => {});
          }
          return 'started';
        }
        case 'restored':
          if (value.sessionReused) return 'success';
          try {
            return JSON.parse(await readFile(`${value.directory}/restore-result.json`, 'utf8')).ok
              ? 'success'
              : 'failure';
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'pending';
            throw error;
          }
        case 'launch':
          await value.preparation;
          if (value.supervision) return 'started';
          await value.restoration;
          if (value.children.size) throw new Error('assignment_preparing');
          try {
            await readFile(`${value.directory}/cancel`);
            throw new Error('run_stopped');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          if (!value.sessionReused) {
            const restored = JSON.parse(await readFile(`${value.directory}/restore-result.json`, 'utf8'));
            if (!restored.ok) throw new Error('restore_failed');
          }
          value.supervision = supervise(
            `${value.directory}/config.json`,
            '/opt/platform/native-worker.mjs',
            value.handle.runtime,
          )
            .catch(async () => {
              await discardHarness(value.handle.runtime);
              await atomicJSON(`${value.directory}/result.json`, {
                output: '',
                outcome: 'failure',
                failureCode: 'supervisor_failed',
                persistence: 'failed',
                completedAt: new Date().toISOString(),
              });
            })
            .finally(() => {
              value.finished = true;
            });
          void value.supervision.catch(() => {});
          return 'started';
        case 'snapshot':
          return JSON.parse(await this.command(value, 'snapshot-page', [String(request.offset)]).result);
        case 'chunk':
          return {
            content: (await readFile(`${value.directory}/snapshot/chunks/${request.hash}`)).toString(
              'base64',
            ),
          };
        case 'stdio':
          if (request.invocation.runId !== value.run || !value.supervision || value.finished)
            throw new Error('invalid_invocation');
          await atomicJSON(`${value.directory}/stdio-${request.invocation.id}.json`, request.invocation);
          return JSON.parse(await this.command(value, 'stdio-call', [request.invocation.id]).result);
        case 'release':
          return this.commands.run('allocation', async () => {
            if (value.released) return {};
            if (value.children.size || (value.supervision && !value.finished))
              throw new Error('runtime_not_quiescent');
            await value.preparation?.catch(() => {});
            const result = (await probeRuntime(value.directory, 0)).result;
            const clean = request.persisted && result?.persistence === 'captured';
            // Keep the writer and resource claim until every fallible cleanup step
            // succeeds. A retry must not race a new Run against unconfirmed writers.
            const retain =
              clean && value.handle.runtime.child && value.handle.runtime.child.exitCode === null;
            const memoryMiB = retain ? await agentMemoryMiB(value.handle.uid) : 0;
            if (!retain) await this.evict(value.handle, value.id);
            if (value.meterClaimed) await this.meter.release(value.id);
            value.meterClaimed = false;
            value.handle.active = null;
            value.handle.lastUsed = Date.now();
            this.writers.delete(value.request.worktree_id);
            if (clean) {
              this.files.set(value.request.worktree_id, {
                checkpoint: request.checkpoint_id,
                permission: value.request.permission_view,
                bytes: typeof result.snapshotBytes === 'number' ? result.snapshotBytes : 0,
                lastUsed: Date.now(),
              });
              value.handle.checkpoint = request.checkpoint_id;
              value.handle.sessionRevision = request.session_revision;
              value.handle.runtime.checkpointId = request.checkpoint_id;
              value.handle.memoryMiB = memoryMiB;
            }
            value.released = true;
            value.recovery = !clean;
            this.tombstones.add(value.id);
            if (clean) {
              await rm(value.directory, { recursive: true, force: true });
              this.assignments.delete(value.id);
            }
            // Recovery snapshots remain read-only for the lifetime of this Host; no released assignment may execute again.
            await this.trimCaches();
            return {};
          });
      }
    });
  }
}

async function main() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0)
    throw new Error('Isolated Linux root required');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const secret = process.env.HOST_CONTROL_SECRET || (await readFile(`${root}/control-secret`, 'utf8')).trim();
  if (secret.length < 32) throw new Error('Control secret required');
  const controller = new HostController();
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.end('ok');
      return;
    }
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
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
        .object({ boot_id: z.uuid().optional(), request: hostControlRequest })
        .parse(JSON.parse(Buffer.concat(chunks).toString()));
      if (envelope.request.action !== 'health' && envelope.boot_id !== controller.boot)
        throw new Error('host_restarted');
      const value = await controller.control(envelope.request);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ value }));
    } catch (error) {
      const code =
        error instanceof z.ZodError
          ? 'invalid_host_request'
          : error instanceof Error && /^[a-z_]+$/.test(error.message)
            ? error.message
            : 'host_control_failed';
      // Never log request bodies, credentials, prompts, file contents, or exception
      // messages containing user data. Codes and schema paths are enough to triage.
      const systemCode =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string' &&
        /^E[A-Z_]+$/.test(error.code)
          ? error.code
          : undefined;
      console.error(
        JSON.stringify({
          event: 'host.control_failed',
          code,
          system_code: systemCode,
          issues:
            error instanceof z.ZodError
              ? error.issues.slice(0, 8).map((issue) => ({ path: issue.path.join('.'), code: issue.code }))
              : undefined,
        }),
      );
      res.writeHead(409, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: code }));
    }
  });
  let sweeping = false;
  const maintenance = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void controller
      .sweep()
      .catch(() => {
        console.error(JSON.stringify({ event: 'host.cache_cleanup_failed' }));
      })
      .finally(() => {
        sweeping = false;
      });
  }, 10000);
  maintenance.unref();
  server.once('close', () => clearInterval(maintenance));
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || 10000), '0.0.0.0');
}
if (process.argv[1]?.endsWith('/host-control.mjs')) await main();
