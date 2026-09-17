import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { APIError, Sandbox } from '@vercel/sandbox';
import { isIPv4 } from 'node:net';
import type { NativeConfiguration } from '../../packages/runtime/src/types';
vi.mock('../../packages/core/src/config', () => ({
  config: { allowPaid: true, origin: 'https://fixture.example.test' },
  isLocal: () => false,
}));
import { VercelMachines } from '../../packages/providers/src/vercel';
const createdAt = new Date('2026-09-06T00:00:00Z');
const sandbox = {
  currentSession: () => ({ status: 'running', sessionId: 'fixture-session', createdAt }),
} as unknown as Awaited<ReturnType<typeof Sandbox.create>>;
beforeEach(() => {
  vi.stubEnv('RUNTIME_IMAGE', 'fixture@sha256:' + '0'.repeat(64));
  // Every SDK network entrypoint used by these cases is replaced before invoking the adapter.
  vi.spyOn(Sandbox, 'get').mockRejectedValue(new Error('Unexpected fixture lookup'));
  vi.spyOn(Sandbox, 'create').mockRejectedValue(new Error('Unexpected fixture creation'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('creates a named sandbox after an actual SDK APIError with HTTP 404', async () => {
  vi.mocked(Sandbox.get).mockRejectedValueOnce(new APIError(new Response(null, { status: 404 })));
  vi.mocked(Sandbox.create).mockResolvedValueOnce(sandbox);
  expect(await new VercelMachines().provision('fixture-run', 300)).toEqual({
    name: 'fixture-run',
    sessionId: 'fixture-session',
    createdAt: createdAt.toISOString(),
  });
  expect(Sandbox.get).toHaveBeenCalledWith({ name: 'fixture-run', resume: false });
  expect(Sandbox.create).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'fixture-run', persistent: true }),
  );
});

it.each([403, 429, 500])('does not create on an ambiguous or rejected HTTP %i lookup', async (status) => {
  vi.mocked(Sandbox.get).mockRejectedValueOnce(new APIError(new Response(null, { status })));
  await expect(new VercelMachines().provision('fixture-run', 300)).rejects.toMatchObject({
    code: 'sandbox_lookup_failed',
  });
  expect(Sandbox.create).not.toHaveBeenCalled();
});

it('recovers a lost creation acknowledgement by looking up the same identity without resuming', async () => {
  vi.mocked(Sandbox.get)
    .mockRejectedValueOnce(new APIError(new Response(null, { status: 404 })))
    .mockResolvedValueOnce(sandbox);
  vi.mocked(Sandbox.create).mockRejectedValueOnce(new Error('Response lost after creation'));
  expect((await new VercelMachines().provision('fixture-run', 300)).sessionId).toBe('fixture-session');
  expect(Sandbox.create).toHaveBeenCalledOnce();
  expect(Sandbox.get).toHaveBeenNthCalledWith(2, { name: 'fixture-run', resume: false });
});

it('provisions with supported IPv4 firewall ranges and a scoped domain allowlist', async () => {
  vi.mocked(Sandbox.get).mockRejectedValueOnce(new APIError(new Response(null, { status: 404 })));
  vi.mocked(Sandbox.create).mockImplementationOnce(async (options) => {
    const policy = options?.networkPolicy;
    if (!policy || typeof policy === 'string') throw new Error('A scoped firewall is required');
    for (const cidr of policy.subnets?.deny || [])
      if (!isIPv4(cidr.split('/')[0])) throw new Error(`Invalid CIDR "${cidr}"`);
    expect(policy.allow).toContain('fixture.example.test');
    expect(policy.subnets?.allow).toBeUndefined();
    expect(policy.subnets?.deny).toEqual([
      '10.0.0.0/8',
      '127.0.0.0/8',
      '169.254.0.0/16',
      '172.16.0.0/12',
      '192.168.0.0/16',
    ]);
    return sandbox;
  });
  await expect(new VercelMachines().provision('fixture-run', 120)).resolves.toMatchObject({
    sessionId: 'fixture-session',
  });
});

it.each([0, 1])(
  'requires successful IPv6 isolation before writing run credentials (exit %i)',
  async (exitCode) => {
    const writeFiles = vi.fn().mockResolvedValue(undefined);
    const runCommand = vi.fn().mockImplementation(async (options: { cmd: string }) => ({
      exitCode: options.cmd === 'sysctl' ? exitCode : 0,
      stdout: async () => '0\n',
    }));
    vi.mocked(Sandbox.get).mockResolvedValueOnce({
      currentSession: () => ({
        status: 'running',
        sessionId: 'fixture-session',
        createdAt,
        runCommand,
        writeFiles,
      }),
    } as unknown as Awaited<ReturnType<typeof Sandbox.get>>);
    const configuration: NativeConfiguration = {
      runId: 'fixture-run',
      harness: 'claude-code',
      model: 'fixture',
      provider: 'anthropic',
      prompt: 'Synthetic test',
      workspace: '/workspace',
      stateHome: '/agent-home',
      gatewayURL: 'https://fixture.example.test/gateway',
      toolURL: 'https://fixture.example.test/tools',
      token: 'synthetic-runtime-token',
      deadline: '2026-09-06T00:05:00Z',
      toolGrants: false,
    };
    const preparation = new VercelMachines().prepare(
      {
        name: 'fixture-run',
        sessionId: 'fixture-session',
        createdAt: createdAt.toISOString(),
      },
      configuration,
    );
    if (exitCode === 0) {
      await preparation;
      expect(writeFiles).toHaveBeenCalledOnce();
      expect(writeFiles.mock.calls[0][0][0].path).toBe('/platform-control/config.json');
    } else {
      await expect(preparation).rejects.toMatchObject({ code: 'runtime_network_setup_failed' });
      expect(writeFiles).not.toHaveBeenCalled();
      expect(runCommand).toHaveBeenCalledOnce();
    }
    expect(runCommand).toHaveBeenNthCalledWith(1, {
      cmd: 'sysctl',
      args: ['-w', 'net.ipv6.conf.all.disable_ipv6=1', 'net.ipv6.conf.default.disable_ipv6=1'],
      sudo: true,
      timeoutMs: 10_000,
    });
  },
);
