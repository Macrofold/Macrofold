import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError, Sandbox } from '@vercel/sandbox';
import { RenderHosts, VercelHosts } from '../../packages/providers/src/hosts';
import type { HostBinding, HostHealth, HostProvisionSpec } from '../../packages/contracts/host-control';

vi.mock('../../packages/core/src/config', () => ({
  config: { allowPaid: true, origin: 'https://fixture.example.test' },
  isLocal: () => false,
}));
const started = '2026-09-01T00:00:00Z';
const boot = '019e1700-0000-7000-8000-000000000001';
const spec: HostProvisionSpec = {
  id: boot,
  generation: 1,
  name: 'fixture-host',
  secret: 'synthetic-control-secret',
  lifetime_seconds: 900,
  resources: { memory_mib: 4096, cpu_millis: 2000 },
  region: 'virginia',
  size: 'standard',
  runtime: 'managed-1',
  concurrency: 1,
  isolate_runs: true,
};
const binding: HostBinding = {
  name: spec.name,
  sessionId: 'fixture-session',
  createdAt: started,
  controlBootId: boot,
  providerId: 'srv-fixture',
  url: 'https://fixture.onrender.com',
};
const health: HostHealth = {
  boot_id: boot,
  started_at: started,
  configured: true,
  active_assignments: 0,
  capabilities: { scoped_processes: true, sibling_isolation: true, resource_meter: true },
  meters: { kind: 'resource', cpu_ms: '12', memory_mib_ms: '4096' },
};
const service = {
  id: 'srv-fixture',
  name: spec.name,
  ownerId: 'owner-fixture',
  suspended: 'not_suspended',
  createdAt: started,
  serviceDetails: { url: binding.url },
};

beforeEach(() => {
  vi.stubEnv('RENDER_WORKER_ENABLED', 'true');
  vi.stubEnv('RENDER_API_KEY', 'synthetic-api-key');
  vi.stubEnv('RENDER_OWNER_ID', service.ownerId);
  vi.stubEnv('RENDER_RUNTIME_IMAGE', 'fixture@sha256:' + '0'.repeat(64));
  vi.stubEnv('RUNTIME_IMAGE', 'fixture@sha256:' + '0'.repeat(64));
  // No fixture is allowed to fall through to paid provider traffic.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected live request');
    }),
  );
  vi.spyOn(Sandbox, 'get').mockRejectedValue(new Error('Unexpected SDK lookup'));
  vi.spyOn(Sandbox, 'create').mockRejectedValue(new Error('Unexpected SDK creation'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function render(...responses: Response[]) {
  const request = vi.fn<typeof fetch>(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected provider request');
    return response;
  });
  return { provider: new RenderHosts(request), request };
}
const listed = (...services: (typeof service)[]) => Response.json(services.map((service) => ({ service })));

describe('Render Host lifecycle receipts', () => {
  it('creates only after confirmed absence, with an immutable image and protected controller credential', async () => {
    const { provider, request } = render(listed(), Response.json({ service }));
    expect(await provider.provision(spec)).toEqual({
      name: spec.name,
      sessionId: '',
      providerId: service.id,
      createdAt: started,
      url: binding.url,
    });
    const [url, init] = request.mock.calls[1];
    expect(url).toBe('https://api.render.com/v1/services');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      name: spec.name,
      ownerId: service.ownerId,
      autoDeploy: 'no',
      image: { imagePath: 'fixture@sha256:' + '0'.repeat(64) },
      envVars: [{ key: 'HOST_CONTROL_SECRET', value: spec.secret }],
      serviceDetails: { plan: spec.size, region: spec.region, numInstances: 1 },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('recovers an existing allocation without issuing a second create', async () => {
    const { provider, request } = render(listed(service));
    expect(await provider.provision(spec)).toMatchObject({ providerId: service.id });
    expect(request).toHaveBeenCalledOnce();
    expect(String(request.mock.calls[0][0])).toContain('ownerId=owner-fixture');
  });
  it('waits for a control URL without creating another allocation', async () => {
    const { provider, request } = render(listed({ ...service, serviceDetails: { url: '' } }));
    expect(await provider.provision(spec)).toBeNull();
    expect(request).toHaveBeenCalledOnce();
  });
  it.each([403, 429, 500])('does not translate HTTP %i lookup failure into absence', async (status) => {
    const { provider, request } = render(new Response(null, { status }));
    await expect(provider.provision(spec)).rejects.toMatchObject({ code: 'render_request_failed' });
    expect(request).toHaveBeenCalledOnce();
  });
  it('rejects duplicate allocation identities before any mutation', async () => {
    const { provider, request } = render(listed(service, { ...service, id: 'srv-duplicate' }));
    await expect(provider.provision(spec)).rejects.toMatchObject({ code: 'host_identity_ambiguous' });
    expect(request).toHaveBeenCalledOnce();
  });
  it('never resumes a suspended generation', async () => {
    const { provider, request } = render(listed({ ...service, suspended: 'suspended' }));
    await expect(provider.provision(spec)).rejects.toMatchObject({ code: 'host_stopped' });
    expect(request).toHaveBeenCalledOnce();
  });
  it.each([true, false])('requires observed absence after an accepted delete (absent=%s)', async (absent) => {
    const { provider, request } = render(
      listed(service),
      new Response(null, { status: 202 }),
      listed(...(absent ? [] : [service])),
    );
    expect(await provider.destroy(spec.name, binding)).toBe(absent);
    expect(request.mock.calls[1]).toEqual([
      `https://api.render.com/v1/services/${service.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    ]);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('does not delete a same-named allocation belonging to another owner', async () => {
    const { provider, request } = render(listed({ ...service, ownerId: 'someone-else' }));
    expect(await provider.destroy(spec.name, binding)).toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });
  it.each(['missing', 'suspended'])(
    'confirms a %s allocation stopped without querying its controller',
    async (state) => {
      const { provider, request } = render(
        listed(...(state === 'missing' ? [] : [{ ...service, suspended: 'suspended' }])),
      );
      expect(await provider.exists(binding, spec.secret)).toBe(false);
      expect(request).toHaveBeenCalledOnce();
    },
  );
  it('fences a live restarted controller instead of releasing liability', async () => {
    const { provider } = render(
      listed(service),
      Response.json({ value: { ...health, boot_id: '019e1700-0000-7000-8000-000000000002' } }),
    );
    await expect(provider.exists(binding, spec.secret)).rejects.toMatchObject({
      code: 'host_generation_changed',
    });
  });
  it('authenticates control requests and preserves the requested boot fence', async () => {
    const { provider, request } = render(Response.json({ value: health }));
    expect(await provider.control(binding, spec.secret, { action: 'health' })).toEqual(health);
    expect(request.mock.calls[0]).toEqual([
      `${binding.url}/control`,
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: { authorization: `Bearer ${spec.secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ boot_id: boot, request: { action: 'health' } }),
      }),
    ]);
  });
  it.each([
    'http://fixture.onrender.com',
    'https://evil.test',
    'https://fixture.onrender.com.evil.test',
    'https://user:password@fixture.onrender.com',
    'https://fixture.onrender.com:8443',
  ])('rejects unsafe controller origin %s before credential transmission', async (url) => {
    const { provider, request } = render();
    await expect(
      provider.control({ ...binding, url }, spec.secret, { action: 'health' }),
    ).rejects.toMatchObject({ code: 'invalid_runtime_origin' });
    expect(request).not.toHaveBeenCalled();
  });
  it('fails closed on an unconfirmed controller operation', async () => {
    const { provider, request } = render(new Response(null, { status: 503 }));
    await expect(provider.control(binding, spec.secret, { action: 'quiesce' })).rejects.toMatchObject({
      code: 'host_control_failed',
    });
    expect(request).toHaveBeenCalledOnce();
  });
});

function sandboxSession(
  options: { status?: string; sessionId?: string; exitCode?: number; value?: unknown } = {},
) {
  const writeFiles = vi.fn().mockResolvedValue(undefined);
  const runCommand = vi.fn().mockImplementation(async (command: { cmd: string }) => ({
    exitCode: options.exitCode ?? 0,
    stdout: async () =>
      command.cmd === 'id' ? '1000\n' : JSON.stringify({ value: options.value ?? health }),
  }));
  const remove = vi.fn().mockResolvedValue(undefined);
  const value = {
    currentSession: () => ({
      status: options.status ?? 'running',
      sessionId: options.sessionId ?? binding.sessionId,
      createdAt: new Date(started),
      writeFiles,
      runCommand,
    }),
    delete: remove,
  };
  vi.mocked(Sandbox.get).mockResolvedValue(value as unknown as Awaited<ReturnType<typeof Sandbox.get>>);
  return { writeFiles, runCommand, remove };
}

describe('Vercel Host generation and control boundaries', () => {
  it('starts protected Host control and transfers boot-fenced requests through the original SDK session', async () => {
    const { writeFiles, runCommand } = sandboxSession();
    const provider = new VercelHosts();
    await provider.start(binding, spec.secret);
    expect(writeFiles).toHaveBeenCalledWith([
      { path: '/platform-control/control-secret', content: Buffer.from(spec.secret), mode: 0o600 },
    ]);
    expect(runCommand.mock.calls.some(([command]) => command.cmd === 'sysctl')).toBe(true);
    expect(await provider.control(binding, spec.secret, { action: 'health' })).toEqual(health);
    const files = writeFiles.mock.calls.at(-1)![0];
    expect(files[0].path).toMatch(/^\/platform-control\/request-[a-f0-9-]+\.json$/);
    expect(files[0].mode).toBe(0o600);
    expect(JSON.parse(files[0].content.toString())).toEqual({ boot_id: boot, request: { action: 'health' } });
    expect(await provider.exists(binding, spec.secret)).toBe(true);
    expect(Sandbox.create).not.toHaveBeenCalled();
    expect(Sandbox.get).toHaveBeenCalledWith({ name: spec.name, resume: false });
  });
  it.each([null, 900])(
    'rejects unsupported lifetime or resource shapes before provider calls (%s)',
    async (lifetime) => {
      await expect(
        new VercelHosts().provision({
          ...spec,
          lifetime_seconds: lifetime,
          resources: { memory_mib: 8192, cpu_millis: 2000 },
        }),
      ).rejects.toMatchObject({
        code: lifetime === null ? 'host_lifetime_required' : 'host_shape_unavailable',
      });
      expect(Sandbox.get).not.toHaveBeenCalled();
      expect(Sandbox.create).not.toHaveBeenCalled();
    },
  );
  it('rejects a changed live execution generation without querying its control process', async () => {
    const { runCommand } = sandboxSession({ sessionId: 'new-session' });
    await expect(new VercelHosts().exists(binding, spec.secret)).rejects.toMatchObject({
      code: 'host_generation_changed',
    });
    expect(runCommand).not.toHaveBeenCalled();
  });
  it('rejects a restarted controller inside the same provider session', async () => {
    sandboxSession({ value: { ...health, boot_id: '019e1700-0000-7000-8000-000000000002' } });
    await expect(new VercelHosts().exists(binding, spec.secret)).rejects.toMatchObject({
      code: 'host_generation_changed',
    });
  });
  it.each([404, 500])('distinguishes confirmed absence from lookup uncertainty (%i)', async (status) => {
    vi.mocked(Sandbox.get).mockRejectedValue(new APIError(new Response(null, { status })));
    const result = new VercelHosts().exists(binding, spec.secret);
    if (status === 404) expect(await result).toBe(false);
    else await expect(result).rejects.toBeInstanceOf(APIError);
    expect(Sandbox.create).not.toHaveBeenCalled();
  });
  it('does not mistake an accepted deletion for stopped compute', async () => {
    const { remove } = sandboxSession();
    expect(await new VercelHosts().destroy(spec.name, binding)).toBe(false);
    expect(remove).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
  });
  it('confirms deletion only after the provider lookup reports absence', async () => {
    const { remove } = sandboxSession();
    vi.mocked(Sandbox.get)
      .mockResolvedValueOnce(await Sandbox.get({ name: spec.name }))
      .mockRejectedValueOnce(new APIError(new Response(null, { status: 404 })));
    expect(await new VercelHosts().destroy(spec.name, binding)).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
  });
  it('does not report success after a failed controller command', async () => {
    sandboxSession({ exitCode: 1 });
    await expect(
      new VercelHosts().control(binding, spec.secret, { action: 'quiesce' }),
    ).rejects.toMatchObject({ code: 'host_control_failed' });
  });
});
