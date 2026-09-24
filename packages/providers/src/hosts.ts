import { z } from 'zod';
import { HostControlRequest, HostBinding, HostProvider, HostProvisionSpec, hostHealth } from '../../contracts/host-control';
import { config, isLocal } from '../../core/src/config';
import { assert } from '../../core/src/errors';
import { DockerMachines } from './docker';
import { VercelMachines } from './vercel';

/** Offline simulation preserves durable allocation identity but does not claim native isolation acceptance. */
export class SimulatedHosts implements HostProvider {
  async provision(spec: HostProvisionSpec): Promise<HostBinding> {
    assert(isLocal() && config.execution === 'simulator', 503, 'simulation_required', 'Simulation is available only in the local simulator profile.');
    return { name: spec.name, sessionId: spec.id, controlBootId: spec.id, createdAt: new Date().toISOString() };
  }
  async exists(_binding: HostBinding, _secret: string) { return true; }
  async control(binding: HostBinding, _secret: string, request: HostControlRequest) {
    if (request.action === 'health') return {
      boot_id: binding.sessionId, started_at: binding.createdAt, configured: true, active_assignments: 0,
      capabilities: { scoped_processes: true, sibling_isolation: true, resource_meter: true },
      meters: { kind: 'resource', cpu_ms: '0', memory_mib_ms: '0' },
    };
    assert(request.action === 'configure', 409, 'simulation_native_control', 'The simulator does not execute a native Host control command.');
    return {};
  }
  async destroy(_name: string, _binding: HostBinding | null) { return true; }
}

export class DockerHosts implements HostProvider {
  constructor(private readonly machines = new DockerMachines()) {}
  async provision(spec: HostProvisionSpec) {
    const binding = await this.machines.provision(spec.name, spec.lifetime_seconds, spec.resources);
    await this.machines.startHostControl(binding, spec.secret);
    const health = hostHealth.parse(await this.machines.hostControl(binding, spec.secret, { action: 'health' }));
    return { ...binding, controlBootId: health.boot_id };
  }
  async exists(binding: HostBinding, secret: string) {
    if (!await this.machines.generationRunning(binding)) return false;
    const health = hostHealth.parse(await this.machines.hostControl({ ...binding, controlBootId: undefined }, secret, { action: 'health' }));
    assert(!binding.controlBootId || health.boot_id === binding.controlBootId, 409, 'host_generation_changed',
      'The Host controller restarted; running compute must be stopped before releasing its financial reservation.');
    return true;
  }
  control(binding: HostBinding, secret: string, request: HostControlRequest) { return this.machines.hostControl(binding, secret, request); }
  async destroy(name: string, binding: HostBinding | null) {
    await this.machines.destroyEnvironment(name);
    return !binding || !(await this.machines.environmentRunning(binding));
  }
}

export class VercelHosts implements HostProvider {
  constructor(private readonly machines = new VercelMachines()) {}
  async provision(spec: HostProvisionSpec) {
    assert(spec.lifetime_seconds !== null, 400, 'host_lifetime_required', 'Sandbox allocations require a bounded Host lifetime.');
    // The current provider shape derives memory from vCPU count; unsupported ratios fail before spending.
    assert(spec.resources.cpu_millis % 1000 === 0 && spec.resources.memory_mib === spec.resources.cpu_millis * 2048 / 1000,
      400, 'host_shape_unavailable', 'This sandbox offering must use the supported CPU-to-memory ratio.');
    const binding = await this.machines.provision(spec.name, spec.lifetime_seconds, spec.resources);
    await this.machines.startHostControl(binding, spec.secret);
    const health = hostHealth.parse(await this.machines.hostControl(binding, spec.secret, { action: 'health' }));
    return { ...binding, controlBootId: health.boot_id };
  }
  async exists(binding: HostBinding, secret: string) {
    if (!await this.machines.generationRunning(binding)) return false;
    const health = hostHealth.parse(await this.machines.hostControl({ ...binding, controlBootId: undefined }, secret, { action: 'health' }));
    assert(!binding.controlBootId || health.boot_id === binding.controlBootId, 409, 'host_generation_changed',
      'The Host controller restarted; running compute must be stopped before releasing its financial reservation.');
    return true;
  }
  control(binding: HostBinding, secret: string, request: HostControlRequest) { return this.machines.hostControl(binding, secret, request); }
  async destroy(name: string, binding: HostBinding | null) {
    await this.machines.destroyEnvironment(name);
    return !binding || !(await this.machines.environmentRunning(binding));
  }
}

const serviceSchema = z.object({
  id: z.string().regex(/^srv-[a-z0-9]+$/), name: z.string(), ownerId: z.string(),
  suspended: z.enum(['suspended','not_suspended']), createdAt: z.string(),
  serviceDetails: z.object({ url: z.string() }),
});
type Service = z.infer<typeof serviceSchema>;
export class RenderHosts implements HostProvider {
  constructor(private readonly request: typeof fetch = fetch) {}
  private async api(path: string, method = 'GET', body?: unknown): Promise<unknown | null> {
    assert(!isLocal() && config.allowPaid && process.env.RENDER_SANDBOX_ENABLED === 'true' &&
      process.env.RENDER_API_KEY && process.env.RENDER_OWNER_ID, 503, 'render_unavailable', 'Render Host execution is not configured.');
    const response = await this.request(`https://api.render.com/v1${path}`, {
      method, redirect: 'error', headers: { authorization: `Bearer ${process.env.RENDER_API_KEY}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    assert(response.ok || response.status === 404, 503, 'render_request_failed', 'Render did not confirm this allocation operation.');
    if (response.status === 404) return null;
    return response.status === 204 || response.status === 202 ? {} : response.json();
  }
  private async find(name: string): Promise<Service | null> {
    const query = new URLSearchParams({ name, ownerId: process.env.RENDER_OWNER_ID || '', limit: '100' });
    const found = z.array(z.object({ service: serviceSchema })).parse(await this.api(`/services?${query}`))
      .map(row => row.service).filter(service => service.name === name && service.ownerId === process.env.RENDER_OWNER_ID);
    assert(found.length <= 1, 409, 'host_identity_ambiguous', 'Multiple provider allocations match one Host identity.');
    return found[0] || null;
  }
  async provision(spec: HostProvisionSpec): Promise<HostBinding | null> {
    let service = await this.find(spec.name);
    if (!service) {
      const image = process.env.RENDER_RUNTIME_IMAGE;
      assert(image?.includes('@sha256:'), 503, 'runtime_image_required', 'Configure the immutable server runtime image digest.');
      const created = await this.api('/services', 'POST', {
        type: 'web_service', name: spec.name, ownerId: process.env.RENDER_OWNER_ID, autoDeploy: 'no',
        image: { imagePath: image, ownerId: process.env.RENDER_OWNER_ID,
          ...(process.env.RENDER_REGISTRY_CREDENTIAL_ID ? { registryCredentialId: process.env.RENDER_REGISTRY_CREDENTIAL_ID } : {}) },
        envVars: [{ key: 'HOST_CONTROL_SECRET', value: spec.secret }],
        serviceDetails: { runtime: 'image', plan: spec.size, region: spec.region, numInstances: 1,
          healthCheckPath: '/health', envSpecificDetails: { dockerCommand: 'node /opt/platform/host-control.mjs' } },
      });
      service = z.object({ service: serviceSchema }).parse(created).service;
    }
    // A stopped generation is never resumed. The domain must allocate a new Host identity.
    assert(service.suspended !== 'suspended', 409, 'host_stopped', 'The original Host allocation was suspended.');
    if (!service.serviceDetails.url) return null;
    const binding: HostBinding = { name: spec.name, sessionId: '', providerId: service.id,
      createdAt: service.createdAt, url: service.serviceDetails.url };
    return binding;
  }
  async exists(binding: HostBinding, secret: string) {
    const service = await this.find(binding.name);
    if (!service || service.suspended === 'suspended') return false;
    const health = hostHealth.parse(await this.control({ ...binding, controlBootId: undefined }, secret, { action: 'health' }));
    assert(health.boot_id === binding.controlBootId, 409, 'host_generation_changed',
      'The Host controller restarted; the provider allocation is not confirmed stopped.');
    return true;
  }
  async control(binding: HostBinding, secret: string, request: HostControlRequest) {
    const url = new URL(binding.url || 'https://invalid.invalid');
    assert(url.protocol === 'https:' && url.hostname.endsWith('.onrender.com') && !url.username && !url.password && !url.port,
      503, 'invalid_runtime_origin', 'Unexpected server control origin.');
    const response = await this.request(`${url.origin}/control`, {
      method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ boot_id: binding.controlBootId, request }),
      signal: AbortSignal.timeout(request.action === 'health' ? 5000 : 60000),
    });
    assert(response.ok, 503, 'host_control_failed', 'The Host did not confirm this operation.');
    return z.object({ value: z.unknown() }).parse(await response.json()).value;
  }
  async destroy(name: string, _binding: HostBinding | null) {
    const current = await this.find(name);
    if (!current) return true;
    await this.api(`/services/${current.id}`, 'DELETE');
    // DELETE/202 is intent only; a subsequent lookup owns confirmation and release of liability.
    return (await this.find(name)) === null;
  }
}
const simulated = new SimulatedHosts();
export function hostProvider(kind: 'simulator' | 'docker' | 'vercel' | 'render'): HostProvider {
  if (kind === 'simulator') return simulated;
  if (kind === 'docker') return new DockerHosts();
  if (kind === 'vercel') return new VercelHosts();
  return new RenderHosts();
}
