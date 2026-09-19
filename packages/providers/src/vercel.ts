import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SandboxBinding, SandboxControlRequest } from '../../contracts/sandbox-control';
import { Sandbox } from '@vercel/sandbox';
import type {
  MachineProvider,
  MachineBinding,
  RuntimeProbe,
  SandboxTools,
  StdioInvocation,
} from '../../core/src/ports';
import type { NativeConfiguration } from '../../runtime/src/types';
import type { SnapshotEntry } from '../../runtime/src/manifest';
import { assert } from '../../core/src/errors';
import { config, isLocal } from '../../core/src/config';

function paid() {
  assert(
    config.allowPaid && !isLocal(),
    503,
    'paid_execution_disabled',
    'Paid sandbox execution is disabled.',
  );
}
function providerCode(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as {
    code?: string;
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  // The Sandbox SDK's APIError keeps status on its Response, unlike other
  // providers' top-level status fields. Only a confirmed 404 permits creation.
  return value.response?.status ?? value.status ?? value.statusCode ?? value.code;
}
export class VercelMachines implements MachineProvider, SandboxTools {
  async invokeStdio(binding: MachineBinding, input: StdioInvocation) {
    assert(/^[a-f0-9-]{36}$/.test(input.id), 400, 'invalid_invocation', 'Invalid tool invocation.');
    const session = await this.session(binding);
    await session.writeFiles([
      {
        path: `/platform-control/stdio-${input.id}.json`,
        content: Buffer.from(JSON.stringify(input)),
        mode: 0o600,
      },
    ]);
    const command = await session.runCommand({
      cmd: 'node',
      args: ['/opt/platform/stdio-call.mjs', input.id],
      sudo: true,
      timeoutMs: 55000,
    });
    assert(
      command.exitCode === 0,
      502,
      'stdio_outcome_unknown',
      'The stdio tool may have run. Inspect its effects before issuing a new action.',
    );
    return JSON.parse(await command.stdout()) as Record<string, unknown>;
  }
  async provision(name: string, timeoutSeconds: number): Promise<MachineBinding> {
    paid();
    assert(
      process.env.RUNTIME_IMAGE?.includes('@sha256:'),
      503,
      'runtime_image_required',
      'Configure an immutable VCR runtime image digest.',
    );
    let sandbox: Sandbox;
    try {
      sandbox = await Sandbox.get({ name, resume: false });
    } catch (error) {
      assert(
        ['not_found', 404].includes(providerCode(error)!),
        503,
        'sandbox_lookup_failed',
        'Unable to determine whether the named execution exists.',
      );
      try {
        sandbox = await Sandbox.create({
          name,
          image: process.env.RUNTIME_IMAGE!,
          persistent: true,
          timeout: (timeoutSeconds + 1800) * 1000,
          resources: { vcpus: 2 },
          snapshotExpiration: 7 * 86400_000,
          keepLastSnapshots: { count: 2, expiration: 7 * 86400_000, deleteEvicted: true },
          networkPolicy: {
            allow: [
              new URL(config.origin).hostname,
              // Large model requests upload encrypted bytes directly using a short-lived grant.
              ...(process.env.R2_ENDPOINT ? [new URL(process.env.R2_ENDPOINT).hostname] : []),
              ...(
                process.env.SANDBOX_EGRESS_DOMAINS ||
                'registry.npmjs.org,pypi.org,files.pythonhosted.org,github.com,api.github.com,codeload.github.com,raw.githubusercontent.com'
              )
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean),
            ],
            subnets: {
              deny: ['10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16'],
            },
          },
        });
      } catch (creationError) {
        // A lost create response may have succeeded. Look up the same name; never mint a second execution identity.
        try {
          sandbox = await Sandbox.get({ name, resume: false });
        } catch {
          throw creationError;
        }
      }
    }
    const session = sandbox.currentSession();
    assert(
      session.status === 'running',
      409,
      'execution_unavailable',
      'The original VM is not running. It will not be restarted automatically.',
    );
    return { name, sessionId: session.sessionId, createdAt: session.createdAt.toISOString() };
  }
  private async session(binding: MachineBinding) {
    paid();
    const sandbox = await Sandbox.get({ name: binding.name, resume: false });
    const session = sandbox.currentSession();
    assert(
      session.sessionId === binding.sessionId && session.status === 'running',
      409,
      'execution_unavailable',
      'The original VM has stopped. Its recovery snapshot is retained.',
    );
    // Session methods do not silently resume a stopped VM; Sandbox methods can.
    return session;
  }
  async startControl(binding: MachineBinding, secret: string) {
    const session = await this.session(binding);
    const setup = await session.runCommand({ cmd: 'node', args: ['-e', "const fs=require('fs');fs.mkdirSync('/platform-control',{recursive:true});fs.chmodSync('/platform-control',0o2770)"], sudo: true });
    assert(setup.exitCode === 0, 502, 'runtime_setup_failed', 'Unable to initialize control.');
    const group = await session.runCommand({ cmd: 'id', args: ['-g'] });
    const gid = (await group.stdout()).trim();
    assert(/^\d+$/.test(gid) && gid !== '10001', 502, 'runtime_identity_invalid', 'Invalid SDK identity.');
    await session.runCommand({ cmd: 'chgrp', args: [gid, '/platform-control'], sudo: true });
    await session.writeFiles([{ path: '/platform-control/control-secret', content: Buffer.from(secret), mode: 0o600 }]);
    const network = await session.runCommand({ cmd: 'sysctl', args: ['-w', 'net.ipv6.conf.all.disable_ipv6=1', 'net.ipv6.conf.default.disable_ipv6=1'], sudo: true });
    assert(network.exitCode === 0, 502, 'runtime_network_setup_failed', 'Unable to configure network.');
    await session.runCommand({ cmd: 'node', args: ['-e', "const fs=require('fs');try{fs.mkdirSync('/platform-control/server.lock')}catch(e){if(e.code==='EEXIST')process.exit(0);throw e}require('child_process').spawn('node',['/opt/platform/sandbox-control.mjs'],{detached:true,stdio:'ignore'}).unref()"], sudo: true });
  }
  async control(binding: SandboxBinding, _secret: string, request: SandboxControlRequest) {
    const session = await this.session(binding);
    const path = `/platform-control/request-${randomUUID()}.json`;
    await session.writeFiles([{ path, content: Buffer.from(JSON.stringify({ boot_id: binding.controlBootId, request })), mode: 0o600 }]);
    const result = await session.runCommand({ cmd: 'node', args: ['/opt/platform/sandbox-control-cli.mjs', path], sudo: true, timeoutMs: 60_000 });
    assert(result.exitCode === 0, 502, 'sandbox_control_failed', 'The runtime did not confirm this operation.');
    return z.object({ value: z.unknown() }).parse(JSON.parse(await result.stdout())).value;
  }
  async environmentRunning(binding: MachineBinding) {
    paid();
    let sandbox: Sandbox;
    try { sandbox = await Sandbox.get({ name: binding.name, resume: false }); }
    catch (error) { if (providerCode(error) === 404) return false; throw error; }
    const session = sandbox.currentSession();
    return session.status === 'running' && session.sessionId === binding.sessionId;
  }
  async destroyEnvironment(name: string) {
    paid();
    let sandbox: Sandbox;
    try { sandbox = await Sandbox.get({ name, resume: false }); }
    catch (error) { if (providerCode(error) === 404) return; throw error; }
    await sandbox.delete({ deleteOrphanSnapshots: true });
  }
  async prepare(binding: MachineBinding, configuration: NativeConfiguration) {
    const session = await this.session(binding);
    // Vercel rejects IPv6 CIDRs. Disable IPv6 in the VM before exposing run
    // credentials or starting native code; retain the IPv4 egress firewall.
    const network = await session.runCommand({
      cmd: 'sysctl',
      args: ['-w', 'net.ipv6.conf.all.disable_ipv6=1', 'net.ipv6.conf.default.disable_ipv6=1'],
      sudo: true,
      timeoutMs: 10_000,
    });
    assert(
      network.exitCode === 0,
      502,
      'runtime_network_setup_failed',
      'Unable to enforce the runtime network restrictions.',
    );
    const setup = await session.runCommand({
      cmd: 'mkdir',
      args: ['-p', '/platform-control/restore/chunks'],
      sudo: true,
      timeoutMs: 10_000,
    });
    assert(
      setup.exitCode === 0,
      502,
      'runtime_setup_failed',
      'Unable to initialize the runtime control directory.',
    );
    const group = await session.runCommand({ cmd: 'id', args: ['-g'], timeoutMs: 5000 });
    const gid = (await group.stdout()).trim();
    assert(
      /^\d+$/.test(gid) && gid !== '10001',
      502,
      'runtime_identity_invalid',
      'The sandbox SDK user must differ from the untrusted agent user.',
    );
    await session.runCommand({
      cmd: 'chgrp',
      args: ['-R', gid, '/platform-control'],
      sudo: true,
      timeoutMs: 5000,
    });
    await session.runCommand({
      cmd: 'chmod',
      args: ['-R', '2770', '/platform-control'],
      sudo: true,
      timeoutMs: 5000,
    });
    await session.writeFiles([
      {
        path: '/platform-control/config.json',
        content: Buffer.from(JSON.stringify(configuration)),
        mode: 0o640,
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
    await (await this.session(binding)).writeFiles(files.map((f) => ({ ...f, mode: 0o600 })));
  }
  async restore(binding: MachineBinding) {
    const command = await (
      await this.session(binding)
    ).runCommand({
      cmd: 'node',
      args: ['/opt/platform/restore.mjs'],
      sudo: true,
      detached: true,
      timeoutMs: 900_000,
    });
    return command.cmdId;
  }
  async restored(binding: MachineBinding): Promise<'pending' | 'success' | 'failure'> {
    const value = await (
      await this.session(binding)
    ).readFileToBuffer({ path: '/platform-control/restore-result.json' });
    return value ? (JSON.parse(value.toString()).ok ? 'success' : 'failure') : 'pending';
  }
  async launch(binding: MachineBinding) {
    const command = await (
      await this.session(binding)
    ).runCommand({ cmd: 'node', args: ['/opt/platform/entry.mjs'], sudo: true, detached: true });
    return command.cmdId;
  }
  async probe(binding: MachineBinding, offset: number): Promise<RuntimeProbe> {
    const command = await (
      await this.session(binding)
    ).runCommand({
      cmd: 'node',
      args: ['/opt/platform/probe.mjs', String(offset)],
      sudo: true,
      timeoutMs: 10_000,
    });
    assert(command.exitCode === 0, 502, 'runtime_probe_failed', 'Unable to inspect runtime state.');
    return JSON.parse(await command.stdout());
  }
  async answer(binding: MachineBinding, id: string, answer: Record<string, unknown>) {
    await (
      await this.session(binding)
    ).writeFiles([
      {
        path: '/platform-control/answer.json',
        content: Buffer.from(JSON.stringify({ id, answer })),
        mode: 0o600,
      },
    ]);
  }
  async cancel(binding: MachineBinding) {
    await (
      await this.session(binding)
    ).writeFiles([{ path: '/platform-control/cancel', content: Buffer.from('cancel'), mode: 0o600 }]);
  }
  async snapshotPage(
    binding: MachineBinding,
    offset: number,
  ): Promise<{ entries: SnapshotEntry[]; total: number; totalBytes: number }> {
    const command = await (
      await this.session(binding)
    ).runCommand({
      cmd: 'node',
      args: ['/opt/platform/snapshot-page.mjs', String(offset)],
      sudo: true,
      timeoutMs: 10_000,
    });
    assert(
      command.exitCode === 0,
      502,
      'checkpoint_unavailable',
      'The runtime checkpoint index is unavailable.',
    );
    return JSON.parse(await command.stdout());
  }
  async chunk(binding: MachineBinding, hash: string) {
    assert(/^[a-f0-9]{64}$/.test(hash), 400, 'invalid_chunk', 'Invalid checkpoint chunk.');
    const bytes = await (
      await this.session(binding)
    ).readFileToBuffer({ path: `/platform-control/snapshot/chunks/${hash}` });
    assert(bytes, 502, 'checkpoint_unavailable', 'Checkpoint chunk is missing.');
    return bytes;
  }
  async close(binding: MachineBinding, preserve: boolean) {
    paid();
    const sandbox = await Sandbox.get({ name: binding.name, resume: false });
    assert(
      sandbox.currentSession().sessionId === binding.sessionId,
      409,
      'execution_changed',
      'A newer session must not be stopped by an older execution.',
    );
    if (!preserve) {
      await sandbox.delete({ deleteOrphanSnapshots: true });
      return {};
    }
    if (sandbox.currentSession().status === 'running') {
      const snapshot = await sandbox.snapshot({ expiration: 7 * 86400_000 });
      return { snapshotId: snapshot.snapshotId };
    }
    return {};
  }
}
