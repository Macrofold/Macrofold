import { afterEach, expect, it, vi } from 'vitest';
import { RenderSandboxes } from '../../packages/providers/src/render';
import { config } from '../../packages/core/src/config';
const original = config.allowPaid;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  config.allowPaid = original;
});
const secret = 'synthetic-control-credential-'.repeat(2);
const service = {
  id: 'srv-fixture',
  name: 'env-fixture-1',
  ownerId: 'tea-fixture',
  suspended: 'not_suspended',
  createdAt: '2026-09-19T00:00:00Z',
  serviceDetails: { url: 'https://fixture.onrender.com' },
};
function configure() {
  config.allowPaid = true;
  vi.stubEnv('RENDER_SANDBOX_ENABLED', 'true');
  vi.stubEnv('RENDER_API_KEY', 'synthetic-key');
  vi.stubEnv('RENDER_OWNER_ID', 'tea-fixture');
  vi.stubEnv('RENDER_RUNTIME_IMAGE', `registry.example/runtime@sha256:${'a'.repeat(64)}`);
}
it('creates one disposable image service with no disk and sends the management key only to Render', async () => {
  configure();
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: input, init });
      if (input.includes('/services?')) return Response.json([]);
      if (input.endsWith('/services')) return Response.json({ service });
      return Response.json({ value: { boot_id: '00000000-0000-4000-8000-000000000001' } });
    }),
  );
  const result = await new RenderSandboxes().create(service.name, secret, 900);
  expect(result?.providerId).toBe(service.id);
  const body = JSON.parse(String(calls[1].init?.body));
  expect(body.serviceDetails.disk).toBeUndefined();
  expect(body.serviceDetails.numInstances).toBe(1);
  expect(body.envVars).toEqual([{ key: 'SANDBOX_CONTROL_SECRET', value: secret }]);
  expect(calls[2].init?.headers).toMatchObject({ authorization: `Bearer ${secret}` });
  expect(JSON.stringify(calls[2])).not.toContain('synthetic-key');
});
it('does not create on a failed lookup or replay a create when a unique service already exists', async () => {
  configure();
  const fetcher = vi.fn(async () => Response.json({}, { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(new RenderSandboxes().create(service.name, secret, 900)).rejects.toMatchObject({
    code: 'render_request_failed',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(async () => Response.json([{ service }]));
  expect(await new RenderSandboxes().create(service.name, secret, 900)).toBeNull();
  expect(fetcher.mock.calls.length).toBe(3);
});
it('uses suspend/resume for pause and DELETE for destruction, and refuses an untrusted control URL', async () => {
  configure();
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(`${init?.method || 'GET'} ${url}`);
      if (url.includes('/services?'))
        return Response.json([
          { service: { ...service, suspended: requests.length > 2 ? 'suspended' : 'not_suspended' } },
        ]);
      return new Response(null, { status: 202 });
    }),
  );
  const provider = new RenderSandboxes();
  await expect(provider.pause(service.name, null)).rejects.toMatchObject({ code: 'sandbox_stopping' });
  await provider.create(service.name, secret, 900);
  await provider.destroy(service.name, null);
  expect(requests.some((r) => r.endsWith('/suspend'))).toBe(true);
  expect(requests.some((r) => r.endsWith('/resume'))).toBe(true);
  expect(requests.some((r) => r === 'DELETE https://api.render.com/v1/services/srv-fixture')).toBe(true);
  await expect(
    provider.control(
      { name: service.name, sessionId: 'boot', createdAt: '', url: 'https://attacker.example' },
      secret,
      { action: 'health' },
    ),
  ).rejects.toMatchObject({ code: 'invalid_runtime_origin' });
});
