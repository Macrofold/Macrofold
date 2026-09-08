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
  const provider = new DockerMachines(command);
  return {
    provider,
    command,
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
