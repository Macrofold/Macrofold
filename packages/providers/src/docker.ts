import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { config, isLocal } from '../../core/src/config';
import { assert, AppError } from '../../core/src/errors';
import type {
  MachineBinding,
  MachineProvider,
  RuntimeProbe,
  SandboxTools,
  StdioInvocation,
} from '../../core/src/ports';
import type { NativeConfiguration } from '../../runtime/src/types';
import type { SnapshotEntry } from '../../runtime/src/manifest';

const ownerLabel = 'io.platform.owner';
const executionLabel = 'io.platform.execution';
export type DockerCommand = (args: string[], input?: Buffer) => Promise<Buffer>;

/** Never pass capabilities in argv or surface Docker's potentially sensitive stderr. */
export const dockerCommand: DockerCommand = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const output: Buffer[] = [];
    let size = 0;
    let failed = false;
    const fail = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(fail, args.includes('/opt/platform/stdio-call.mjs') ? 60_000 : 30_000);
    child.stdout.on('data', (bytes: Buffer) => {
      size += bytes.length;
      if (size > 8 * 1024 * 1024) fail();
      else output.push(bytes);
    });
    child.stderr.resume();
    child.stdin.on('error', fail);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new AppError(503, 'docker_unavailable', 'Start Docker and verify the runtime image is built.'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failed || code !== 0)
        reject(
          new AppError(
            503,
            'docker_transport_failed',
            'Docker did not confirm the operation. Execution identity is retained.',
          ),
        );
      else resolve(Buffer.concat(output));
    });
    child.stdin.end(input);
  });
const inspected = z.object({
  Id: z.string().regex(/^[a-f0-9]{64}$/),
  State: z.object({ Status: z.string(), Running: z.boolean(), StartedAt: z.string() }),
  Config: z.object({ Labels: z.record(z.string(), z.string()) }),
});
type Container = z.infer<typeof inspected>;

/** Trusted contributor compute. No bind mounts, socket, host credentials, or automatic agent restart. */
export class DockerMachines implements MachineProvider, SandboxTools {
  private readonly owner = createHash('sha256').update(config.dataDir).digest('hex');
  constructor(private readonly command: DockerCommand = dockerCommand) {}
  private check() {
    assert(
      isLocal() && config.execution === 'docker' && config.orchestration === 'poller',
      503,
      'docker_profile_required',
      'Docker is available only in the explicit local poller profile.',
    );
  }
  private async lookup(name: string): Promise<Container | undefined> {
    this.check();
    assert(/^run-[a-f0-9-]{36}$/.test(name), 400, 'invalid_execution', 'Invalid execution name.');
    // A successful list distinguishes absence from daemon/transport failure.
    const found = (await this.command(['ps', '-aq', '--no-trunc', '--filter', `name=^/${name}$`]))
      .toString()
      .trim();
    if (!found) return undefined;
    const value = inspected.parse(JSON.parse((await this.command(['inspect', found])).toString())[0]);
    assert(
      value.Config.Labels[ownerLabel] === this.owner && value.Config.Labels[executionLabel] === name,
      409,
      'execution_changed',
      'The named container does not belong to this execution.',
    );
    return value;
  }
  private async session(binding: MachineBinding) {
    const current = await this.lookup(binding.name);
    assert(
      current &&
        current.Id === binding.sessionId &&
        current.State.Running &&
        current.State.StartedAt === binding.createdAt,
      409,
      'execution_unavailable',
      'The original container stopped or changed. It will not be restarted automatically.',
    );
    return current.Id;
  }
  async provision(name: string, timeoutSeconds: number): Promise<MachineBinding> {
    let current = await this.lookup(name);
    if (!current) {
      assert(
        Number.isInteger(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 7200,
        400,
        'invalid_timeout',
        'Invalid container timeout.',
      );
      const image = process.env.DOCKER_RUNTIME_IMAGE || 'platform-runtime:0.1.0';
      const network = process.env.DOCKER_NETWORK || 'bridge';
      const gateway = process.env.DOCKER_HOST_GATEWAY_IP || 'host-gateway';
      assert(
        gateway === 'host-gateway' || isIP(gateway) === 4,
        503,
        'invalid_docker_gateway',
        'A custom Docker host gateway must be an IPv4 address.',
      );
      assert(
        /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(network) && !['host', 'none'].includes(network),
        503,
        'invalid_docker_network',
        'Use a Docker bridge network for local execution.',
      );
      const args = [
        'create',
        '--pull=never',
        '--name',
        name,
        '--label',
        `${ownerLabel}=${this.owner}`,
        '--label',
        `${executionLabel}=${name}`,
        '--init',
        '--restart=no',
        '--cpus=2',
        '--memory=4g',
        '--memory-swap=4g',
        '--pids-limit=512',
        '--security-opt=no-new-privileges',
        '--cap-drop=ALL',
        ...['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID', 'KILL'].map((cap) => `--cap-add=${cap}`),
        '--log-driver=local',
        '--log-opt=max-size=10m',
        '--log-opt=max-file=2',
        '--network',
        network,
        `--add-host=host.docker.internal:${gateway}`,
        image,
        'sleep',
        String(timeoutSeconds + 1800),
      ];
      try {
        await this.command(args);
      } catch (error) {
        current = await this.lookup(name);
        if (!current) throw error;
      }
      current ||= await this.lookup(name);
    }
    assert(current, 503, 'docker_create_unknown', 'Docker creation could not be confirmed.');
    // Starting a never-started container cannot replay a prompt. Exited containers are never resumed.
    if (current.State.Status === 'created') {
      try {
        await this.command(['start', current.Id]);
      } catch (error) {
        const observed = await this.lookup(name);
        if (!observed?.State.Running) throw error;
      }
      current = await this.lookup(name);
    }
    assert(current?.State.Running, 409, 'execution_unavailable', 'The original container is not running.');
    return { name, sessionId: current.Id, createdAt: current.State.StartedAt };
  }
  private async exec(binding: MachineBinding, args: string[], input?: Buffer, detached = false) {
    const container = await this.session(binding);
    return this.command(
      ['exec', ...(detached ? ['--detach'] : ['--interactive']), '--user=0', container, ...args],
      input,
    );
  }
  private async write(binding: MachineBinding, files: { path: string; content: Buffer }[]) {
    assert(
      files.reduce((total, file) => total + file.content.length, 0) <= 5 * 1024 * 1024,
      413,
      'stage_too_large',
      'Stage at most five MiB per operation.',
    );
    const script = `const fs=require('node:fs/promises');
      let text=''; for await(const chunk of process.stdin) text+=chunk;
      for(const file of JSON.parse(text)) {
        await fs.mkdir(require('node:path').dirname(file.path),{recursive:true,mode:0o700});
        const temp=file.path+'.'+require('node:crypto').randomUUID()+'.tmp';
        await fs.writeFile(temp,Buffer.from(file.content,'base64'),{mode:0o600,flag:'wx'});
        await fs.rename(temp,file.path);
      }`;
    await this.exec(
      binding,
      ['node', '--input-type=commonjs', '-e', `(async()=>{${script}})().catch(()=>process.exit(1))`],
      Buffer.from(
        JSON.stringify(files.map((f) => ({ path: f.path, content: f.content.toString('base64') }))),
      ),
    );
  }
  async prepare(binding: MachineBinding, configuration: NativeConfiguration) {
    assert(
      binding.name === `run-${configuration.runId}`,
      400,
      'invalid_execution',
      'Runtime configuration belongs to another execution.',
    );
    const rewrite = (value: string) => {
      const url = new URL(value);
      assert(
        url.origin === new URL(config.origin).origin &&
          url.pathname.startsWith(`/runtime/runs/${configuration.runId}/`),
        400,
        'invalid_gateway',
        'The runtime must use its local application gateway.',
      );
      url.hostname = 'host.docker.internal';
      return url.href;
    };
    await this.exec(binding, ['mkdir', '-p', '/platform-control/restore/chunks']);
    await this.write(binding, [
      {
        path: '/platform-control/config.json',
        content: Buffer.from(
          JSON.stringify({
            ...configuration,
            gatewayURL: rewrite(configuration.gatewayURL),
            toolURL: rewrite(configuration.toolURL),
          }),
        ),
      },
    ]);
  }
  async stage(binding: MachineBinding, files: { path: string; content: Buffer }[]) {
    for (const file of files)
      assert(
        /^\/platform-control\/restore\/(chunks\/[a-f0-9]{64}|page-\d+\.json)$/.test(file.path),
        400,
        'invalid_stage_path',
        'Invalid runtime staging path.',
      );
    await this.write(binding, files);
  }
  async restore(binding: MachineBinding) {
    await this.exec(binding, ['node', '/opt/platform/restore.mjs'], undefined, true);
    return binding.sessionId;
  }
  async restored(binding: MachineBinding): Promise<'pending' | 'success' | 'failure'> {
    const bytes = await this.exec(binding, [
      'node',
      '-e',
      "try{process.stdout.write(require('node:fs').readFileSync('/platform-control/restore-result.json'))}catch(e){if(e.code!=='ENOENT')process.exit(1)}",
    ]);
    return bytes.length ? (JSON.parse(bytes.toString()).ok ? 'success' : 'failure') : 'pending';
  }
  async launch(binding: MachineBinding) {
    await this.exec(binding, ['node', '/opt/platform/entry.mjs'], undefined, true);
    return binding.sessionId;
  }
  async probe(binding: MachineBinding, offset: number): Promise<RuntimeProbe> {
    return JSON.parse(
      (await this.exec(binding, ['node', '/opt/platform/probe.mjs', String(offset)])).toString(),
    );
  }
  async answer(binding: MachineBinding, id: string, answer: Record<string, unknown>) {
    await this.write(binding, [
      { path: '/platform-control/answer.json', content: Buffer.from(JSON.stringify({ id, answer })) },
    ]);
  }
  async cancel(binding: MachineBinding) {
    await this.write(binding, [{ path: '/platform-control/cancel', content: Buffer.from('cancel') }]);
  }
  async snapshotPage(
    binding: MachineBinding,
    offset: number,
  ): Promise<{ entries: SnapshotEntry[]; total: number; totalBytes: number }> {
    return JSON.parse(
      (await this.exec(binding, ['node', '/opt/platform/snapshot-page.mjs', String(offset)])).toString(),
    );
  }
  async chunk(binding: MachineBinding, hash: string) {
    assert(/^[a-f0-9]{64}$/.test(hash), 400, 'invalid_chunk', 'Invalid checkpoint chunk.');
    return this.exec(binding, ['cat', `/platform-control/snapshot/chunks/${hash}`]);
  }
  async invokeStdio(binding: MachineBinding, input: StdioInvocation) {
    assert(/^[a-f0-9-]{36}$/.test(input.id), 400, 'invalid_invocation', 'Invalid tool invocation.');
    await this.write(binding, [
      { path: `/platform-control/stdio-${input.id}.json`, content: Buffer.from(JSON.stringify(input)) },
    ]);
    return JSON.parse(
      (await this.exec(binding, ['node', '/opt/platform/stdio-call.mjs', input.id])).toString(),
    ) as Record<string, unknown>;
  }
  async close(binding: MachineBinding, preserve: boolean) {
    const current = await this.lookup(binding.name);
    if (!current && !preserve) return {};
    assert(
      current?.Id === binding.sessionId && current.State.StartedAt === binding.createdAt,
      409,
      'execution_changed',
      'The original container cannot be confirmed.',
    );
    if (preserve) {
      if (current.State.Running) await this.command(['stop', '--time=5', current.Id]);
      return { snapshotId: current.Id };
    }
    await this.command(['rm', '--force', current.Id]);
    return {};
  }
}
