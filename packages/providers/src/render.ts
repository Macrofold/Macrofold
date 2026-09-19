import { z } from 'zod';
import type { SandboxBinding, SandboxControlRequest, SandboxProvider } from '../../contracts/sandbox-control';
import { assert } from '../../core/src/errors';
import { config } from '../../core/src/config';

const serviceSchema = z.object({
  id: z.string().regex(/^srv-[a-z0-9]+$/),
  name: z.string(),
  ownerId: z.string(),
  suspended: z.enum(['suspended', 'not_suspended']),
  createdAt: z.string(),
  serviceDetails: z.object({ url: z.string() }),
});
type Service = z.infer<typeof serviceSchema>;
/** Render manages disposable single-instance web services. The only HTTP service is the
 * authenticated root control protocol, never the agent's application or a shell endpoint. */
export class RenderSandboxes implements SandboxProvider {
  private async api(path: string, method = 'GET', body?: unknown) {
    assert(
      config.allowPaid &&
        process.env.RENDER_SANDBOX_ENABLED === 'true' &&
        process.env.RENDER_API_KEY &&
        process.env.RENDER_OWNER_ID,
      503,
      'render_unavailable',
      'Render execution is not configured.',
    );
    const response = await fetch(`https://api.render.com/v1${path}`, {
      method,
      redirect: 'error',
      headers: { authorization: `Bearer ${process.env.RENDER_API_KEY}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    assert(
      response.ok || response.status === 404,
      503,
      'render_request_failed',
      'Render did not confirm the operation.',
    );
    if (response.status === 404) return null;
    if (response.status === 204 || response.status === 202) return {};
    return response.json() as Promise<unknown>;
  }
  private async find(name: string): Promise<Service | null> {
    // Exact provider-unique name plus owner scopes ambiguous-create recovery. A lookup error never authorizes create.
    const query = new URLSearchParams({ name, ownerId: process.env.RENDER_OWNER_ID || '', limit: '100' });
    const rows = z.array(z.object({ service: serviceSchema })).parse(await this.api(`/services?${query}`));
    const matches = rows
      .map((r) => r.service)
      .filter((s) => s.name === name && s.ownerId === process.env.RENDER_OWNER_ID);
    assert(
      matches.length <= 1,
      409,
      'render_identity_ambiguous',
      'More than one server matches this sandbox.',
    );
    return matches[0] || null;
  }
  async create(name: string, secret: string, _lifetimeSeconds: number | null): Promise<SandboxBinding | null> {
    let service = await this.find(name);
    if (!service) {
      const image = process.env.RENDER_RUNTIME_IMAGE;
      assert(
        image?.includes('@sha256:'),
        503,
        'runtime_image_required',
        'Configure an immutable Render runtime image digest.',
      );
      const created = await this.api('/services', 'POST', {
        type: 'web_service',
        name,
        ownerId: process.env.RENDER_OWNER_ID,
        autoDeploy: 'no',
        image: {
          imagePath: image,
          ownerId: process.env.RENDER_OWNER_ID,
          ...(process.env.RENDER_REGISTRY_CREDENTIAL_ID
            ? { registryCredentialId: process.env.RENDER_REGISTRY_CREDENTIAL_ID }
            : {}),
        },
        envVars: [{ key: 'SANDBOX_CONTROL_SECRET', value: secret }],
        serviceDetails: {
          runtime: 'image',
          plan: process.env.RENDER_COMPUTE_PLAN || '2c-4g',
          region: process.env.RENDER_REGION || 'virginia',
          numInstances: 1,
          healthCheckPath: '/health',
          envSpecificDetails: { dockerCommand: 'node /opt/platform/sandbox-control.mjs' },
        },
      });
      service = z.object({ service: serviceSchema }).parse(created).service;
    }
    if (service.suspended === 'suspended') {
      await this.api(`/services/${service.id}/resume`, 'POST');
      return null;
    }
    const url = service.serviceDetails.url;
    if (!url) return null;
    const binding: SandboxBinding = {
      name,
      providerId: service.id,
      url,
      sessionId: '',
      createdAt: service.createdAt,
    };
    try {
      const health = z
        .object({ boot_id: z.uuid() })
        .parse(await this.control(binding, secret, { action: 'health' }));
      return { ...binding, sessionId: health.boot_id, controlBootId: health.boot_id };
    } catch {
      return null;
    }
  }
  async isRunning(binding: SandboxBinding, secret: string) {
    const service = await this.find(binding.name);
    if (!service || service.suspended === 'suspended') return false;
    const health = z
      .object({ boot_id: z.uuid() })
      .parse(await this.control({ ...binding, controlBootId: undefined }, secret, { action: 'health' }));
    return health.boot_id === binding.controlBootId;
  }
  async control(binding: SandboxBinding, secret: string, request: SandboxControlRequest) {
    const url = new URL(binding.url || 'https://invalid.invalid');
    assert(
      url.protocol === 'https:' &&
        url.hostname.endsWith('.onrender.com') &&
        !url.username &&
        !url.password &&
        !url.port,
      503,
      'invalid_runtime_origin',
      'Unexpected Render control origin.',
    );
    const response = await fetch(`${url.origin}/control`, {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ boot_id: binding.controlBootId, request }),
      signal: AbortSignal.timeout(request.action === 'health' ? 5_000 : 60_000),
    });
    assert(response.ok, 503, 'sandbox_control_failed', 'The server did not confirm this operation.');
    return z.object({ value: z.unknown() }).parse(await response.json()).value;
  }
  async pause(name: string, _binding: SandboxBinding | null) {
    const service = await this.find(name);
    if (service && service.suspended !== 'suspended') {
      await this.api(`/services/${service.id}/suspend`, 'POST');
      // 202 only acknowledges the request. Keep the reservation until a later lookup confirms suspension.
      assert(false, 503, 'sandbox_stopping', 'Render suspension is still in progress.');
    }
  }
  async destroy(name: string, _binding: SandboxBinding | null) {
    const service = await this.find(name);
    if (service) await this.api(`/services/${service.id}`, 'DELETE');
  }
}
