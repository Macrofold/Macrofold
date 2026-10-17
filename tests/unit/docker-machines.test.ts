import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  config,
  assertSecurityConfiguration,
  readinessErrors,
  realExecutionEnabled,
} from '../../packages/core/src/config';
import { DockerMachines, type DockerCommand } from '../../packages/providers/src/docker';
import type { NativeConfiguration } from '../../packages/runtime/src/types';
const original = { ...config };
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(config, original);
  vi.unstubAllEnvs();
});
function fixture() {
  Object.assign(config, {
    mode: 'local',
    execution: 'docker',
    orchestration: 'poller',
    origin: 'http://localhost:3210',
    allowPaid: true,
  });
  vi.stubEnv('DOCKER_NETWORK', 'bridge');
  vi.stubEnv('DOCKER_HOST_GATEWAY_IP', '');
  let container:
    | {
        Id: string;
        State: { Running: boolean; Status: string; StartedAt: string };
        Config: { Labels: Record<string, string> };
        NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[]> };
      }
    | undefined;
  let loseCreate = false;
  let loseStart = false;
  const inputs: Buffer[] = [];
  const command = vi.fn<DockerCommand>(async (args, input) => {
    if (input) inputs.push(input);
    if (args[0] === 'ps') return Buffer.from(container?.Id || '');
    if (args[0] === 'inspect') return Buffer.from(JSON.stringify([container]));
    if (args[0] === 'create') {
      const labels = args.flatMap((value, i) => (value === '--label' ? [args[i + 1].split('=')] : []));
      container = {
        Id: 'a'.repeat(64),
        State: { Running: false, Status: 'created', StartedAt: '' },
        Config: { Labels: Object.fromEntries(labels) },
        NetworkSettings: {
          Ports: args.includes('--publish=127.0.0.1::10000')
            ? { '10000/tcp': [{ HostIp: '127.0.0.1', HostPort: '49152' }] }
            : {},
        },
      };
      if (loseCreate) throw new Error('lost create response');
    }
    if (args[0] === 'start') {
      container!.State = { Running: true, Status: 'running', StartedAt: '2026-09-07T00:00:00Z' };
      if (loseStart) throw new Error('lost start response');
    }
    if (args[0] === 'stop') {
      container!.State.Running = false;
      container!.State.Status = 'exited';
    }
    if (args[0] === 'rm') container = undefined;
    return Buffer.from('{}');
  });
  const request = vi.fn<typeof fetch>(async () => Response.json({ value: { ready: true } }));
  const provider = new DockerMachines(command, request);
  return {
    provider,
    command,
    request,
    inputs,
    name: 'run-11111111-1111-4111-8111-111111111111',
    current: () => container!,
    loseResponses: () => {
      loseCreate = true;
      loseStart = true;
    },
  };
}
describe('local Docker execution boundary', () => {
  it('publishes only to loopback and authenticates Host HTTP without per-request Docker subprocesses', async () => {
    const f = fixture();
    const binding = {
      ...(await f.provider.provisionHost(f.name, 120, { memory_mib: 4096, cpu_millis: 2000 })),
      controlBootId: 'fixture-boot',
    };
    expect(f.command.mock.calls.find(([args]) => args[0] === 'create')?.[0]).toContain(
      '--publish=127.0.0.1::10000',
    );
    f.command.mockClear();
    const request = { action: 'health' as const };
    const secret = 'synthetic-private-host-secret-32-characters';
    expect(await f.provider.hostControl(binding, secret, request)).toEqual({ ready: true });
    expect(binding.url).toBe('http://127.0.0.1:49152');
    expect(f.command).not.toHaveBeenCalled();
    expect(f.request.mock.calls[0]).toEqual([
      `${binding.url}/control`,
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ boot_id: 'fixture-boot', request }),
      }),
    ]);
    expect(JSON.stringify(f.command.mock.calls)).not.toContain(secret);
    f.request.mockClear();
    await expect(
      f.provider.hostControl(binding, secret, {
        action: 'stage',
        run_id: f.name.slice(4),
        assignment_id: f.name.slice(4),
        files: [{ path: 'chunks/fixture', content: 'x'.repeat(8 * 1024 * 1024) }],
      }),
    ).rejects.toMatchObject({ code: 'stage_too_large' });
    expect(f.command).not.toHaveBeenCalled();
    await expect(
      f.provider.hostControl({ ...binding, sessionId: 'unsafe-id' }, secret, request),
    ).rejects.toMatchObject({ code: 'invalid_execution' });
    await expect(f.provider.hostControl(binding, '', request)).rejects.toMatchObject({
      code: 'invalid_control_secret',
    });
    expect(f.command).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
    f.request.mockRejectedValueOnce(new Error('Original controller unavailable'));
    await expect(f.provider.hostControl(binding, secret, request)).rejects.toThrow(
      'Original controller unavailable',
    );
    expect(f.command).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    'http://localhost:49152',
    'http://0.0.0.0:49152',
    'https://127.0.0.1:49152',
    'http://127.0.0.2:49152',
    'http://2130706433:49152',
    'http://user:secret@127.0.0.1:49152',
    'http://127.0.0.1:49152/path',
    'http://127.0.0.1:49152?secret',
    'http://127.0.0.1:49152#secret',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
  ])('rejects an invalid Host origin %s before credentials leave the process', async (url) => {
    const f = fixture();
    await expect(
      f.provider.hostControl(
        { name: f.name, sessionId: 'a'.repeat(64), createdAt: '', url },
        'fixture-secret-thirty-two-characters',
        { action: 'health' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_runtime_origin' });
    expect(f.request).not.toHaveBeenCalled();
    expect(f.command).not.toHaveBeenCalled();
  });
  it('rejects non-loopback or ambiguous inspected port mappings and leaves legacy machines unpublished', async () => {
    const f = fixture();
    const legacy = await f.provider.provision(f.name, 120);
    expect(legacy.url).toBeUndefined();
    expect(
      f.command.mock.calls
        .find(([args]) => args[0] === 'create')?.[0]
        .some((arg) => arg.startsWith('--publish')),
    ).toBe(false);
    f.current().NetworkSettings.Ports['10000/tcp'] = [{ HostIp: '0.0.0.0', HostPort: '49152' }];
    await expect(
      f.provider.provisionHost(f.name, 120, { memory_mib: 4096, cpu_millis: 2000 }),
    ).rejects.toMatchObject({ code: 'invalid_runtime_origin' });
    f.current().NetworkSettings.Ports['10000/tcp'] = [
      { HostIp: '127.0.0.1', HostPort: '49152' },
      { HostIp: '::', HostPort: '49152' },
    ];
    await expect(
      f.provider.provisionHost(f.name, 120, { memory_mib: 4096, cpu_millis: 2000 }),
    ).rejects.toMatchObject({ code: 'invalid_runtime_origin' });
  });
  it.each([
    { lifetime: null, command: 'infinity' },
    { lifetime: 3600, command: '5400' },
  ])('uses $command as the reusable container lifetime for $lifetime', async ({ lifetime, command }) => {
    const f = fixture();
    const name = `env-${f.name.slice(4)}-1`;
    const binding = await f.provider.provision(name, lifetime);
    const creation = f.command.mock.calls.find(([args]) => args[0] === 'create');
    expect(creation?.[0].slice(-2)).toEqual(['sleep', command]);
    expect(await f.provider.environmentRunning(binding)).toBe(true);
    await f.provider.destroyEnvironment(name);
    expect(await f.provider.environmentRunning(binding)).toBe(false);
  });
  it('rejects an unbounded lifetime for a disposable per-run container', async () => {
    const f = fixture();
    await expect(f.provider.provision(f.name, null)).rejects.toMatchObject({ code: 'invalid_timeout' });
    expect(f.command.mock.calls.some(([args]) => args[0] === 'create')).toBe(false);
  });
  it('keeps simulator keys unable to enable real inference and validates the explicit poller profile', () => {
    fixture();
    expect(realExecutionEnabled()).toBe(true);
    config.allowPaid = false;
    expect(realExecutionEnabled()).toBe(false);
    config.allowPaid = true;
    config.execution = 'simulator';
    expect(realExecutionEnabled()).toBe(false);
    config.execution = 'docker';
    config.orchestration = 'workflow';
    expect(assertSecurityConfiguration).toThrow('SQL poller');
    expect(readinessErrors()).toContain('Local Docker execution requires the SQL poller');
    config.orchestration = 'poller';
    expect(readinessErrors()).toEqual([]);
  });
  it('supports an isolated fixture gateway but refuses host networking and malformed gateway overrides', async () => {
    const f = fixture();
    vi.stubEnv('DOCKER_NETWORK', 'host');
    await expect(f.provider.provision(f.name, 120)).rejects.toMatchObject({ code: 'invalid_docker_network' });
    vi.stubEnv('DOCKER_NETWORK', 'fixture-internal');
    vi.stubEnv('DOCKER_HOST_GATEWAY_IP', '172.22.0.2,escape');
    await expect(f.provider.provision(f.name, 120)).rejects.toMatchObject({ code: 'invalid_docker_gateway' });
    expect(f.command.mock.calls.some(([args]) => args[0] === 'create')).toBe(false);
    vi.stubEnv('DOCKER_HOST_GATEWAY_IP', '172.22.0.2');
    await f.provider.provision(f.name, 120);
    expect(f.command.mock.calls.find(([args]) => args[0] === 'create')![0]).toContain(
      '--add-host=host.docker.internal:172.22.0.2',
    );
  });
  it('recovers ambiguous create/start acknowledgements with the same owned identity after a worker restart', async () => {
    const f = fixture();
    f.loseResponses();
    const first = await f.provider.provision(f.name, 120);
    const second = await new DockerMachines(f.command).provision(f.name, 120);
    expect(second).toEqual(first);
    expect(f.command.mock.calls.filter(([args]) => args[0] === 'create')).toHaveLength(1);
    expect(f.command.mock.calls.filter(([args]) => args[0] === 'start')).toHaveLength(1);
    const args = f.command.mock.calls.find(([args]) => args[0] === 'create')![0];
    expect(args).toEqual(
      expect.arrayContaining([
        '--pull=never',
        '--cpus=2',
        '--memory=4g',
        '--pids-limit=512',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
      ]),
    );
    expect(args.some((arg) => /--mount|--volume|--privileged|--env/.test(arg))).toBe(false);
  });
  it('does not create anything when lookup is uncertain', async () => {
    const f = fixture();
    f.command.mockRejectedValueOnce(new Error('daemon offline'));
    await expect(f.provider.provision(f.name, 120)).rejects.toThrow('daemon offline');
    expect(f.command).toHaveBeenCalledTimes(1);
  });
  it('refuses stopped, restarted, replaced and foreign containers without launching or deleting them', async () => {
    const f = fixture();
    const binding = await f.provider.provision(f.name, 120);
    f.current().State.Running = false;
    f.current().State.Status = 'exited';
    await expect(f.provider.provision(f.name, 120)).rejects.toMatchObject({ code: 'execution_unavailable' });
    f.current().State.Running = true;
    f.current().State.StartedAt = 'changed';
    await expect(f.provider.launch(binding)).rejects.toMatchObject({ code: 'execution_unavailable' });
    await expect(f.provider.close(binding, false)).rejects.toMatchObject({ code: 'execution_changed' });
    f.current().Config.Labels['io.platform.owner'] = 'another-installation';
    await expect(f.provider.cancel(binding)).rejects.toMatchObject({ code: 'execution_changed' });
    expect(f.command.mock.calls.some(([args]) => ['exec', 'rm'].includes(args[0]))).toBe(false);
  });
  it('retains stopped recovery bytes and makes successful deletion retryable', async () => {
    const f = fixture();
    const binding = await f.provider.provision(f.name, 120);
    expect(await f.provider.close(binding, true)).toEqual({ snapshotId: binding.sessionId });
    expect(f.current().State.Running).toBe(false);
    expect(await f.provider.close(binding, true)).toEqual({ snapshotId: binding.sessionId });
    await f.provider.close(binding, false);
    await expect(f.provider.close(binding, false)).resolves.toEqual({});
  });
  it('passes only run capabilities through stdin and confines host networking to its gateway', async () => {
    const f = fixture();
    const binding = await f.provider.provision(f.name, 120);
    const configuration: NativeConfiguration = {
      runId: f.name.slice(4),
      harness: 'codex',
      model: 'model',
      provider: 'openai',
      prompt: 'synthetic prompt',
      workspace: '/workspace',
      stateHome: '/agent-home',
      token: 'scoped-capability',
      deadline: '2026-09-07T00:02:00Z',
      toolGrants: false,
      gatewayURL: `${config.origin}/runtime/runs/${f.name.slice(4)}/model`,
      toolURL: `${config.origin}/runtime/runs/${f.name.slice(4)}/mcp`,
    };
    await f.provider.prepare(binding, configuration);
    const file = JSON.parse(f.inputs[0].toString())[0];
    const native = JSON.parse(Buffer.from(file.content, 'base64').toString());
    expect(native.gatewayURL).toBe(
      `http://host.docker.internal:3210/runtime/runs/${configuration.runId}/model`,
    );
    expect(native.token).toBe('scoped-capability');
    expect(JSON.stringify(f.command.mock.calls.map(([args]) => args))).not.toContain('scoped-capability');
    await expect(
      f.provider.prepare(binding, { ...configuration, gatewayURL: 'http://169.254.169.254/latest' }),
    ).rejects.toMatchObject({ code: 'invalid_gateway' });
    await expect(
      f.provider.stage(binding, [{ path: '/workspace/escape', content: Buffer.from('x') }]),
    ).rejects.toMatchObject({ code: 'invalid_stage_path' });
    await expect(f.provider.chunk(binding, '../secret')).rejects.toMatchObject({ code: 'invalid_chunk' });
  });
});
