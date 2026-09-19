import { z } from 'zod';
import type {
  SandboxProvider,
  SandboxProviderKind,
  SandboxBinding,
  SandboxControlRequest,
} from '../../contracts/sandbox-control';
import { DockerMachines } from './docker';
import { VercelMachines } from './vercel';
import { RenderSandboxes } from './render';
import { assert } from '../../core/src/errors';

class EphemeralSandboxes implements SandboxProvider {
  constructor(private readonly transport: DockerMachines | VercelMachines) {}
  async create(name: string, secret: string, lifetimeSeconds: number | null): Promise<SandboxBinding | null> {
    let binding: SandboxBinding;
    if (this.transport instanceof DockerMachines)
      binding = await this.transport.provision(name, lifetimeSeconds);
    else {
      assert(
        lifetimeSeconds !== null,
        400,
        'unsupported_lifetime',
        'This provider requires a bounded sandbox lifetime.',
      );
      binding = await this.transport.provision(name, Math.min(84600, lifetimeSeconds));
    }
    await this.transport.startControl(binding, secret);
    // Readiness is retried by the durable lifecycle, not a sleep in an API transaction.
    try {
      const health = z
        .object({ boot_id: z.uuid() })
        .parse(await this.transport.control(binding, secret, { action: 'health' }));
      return { ...binding, controlBootId: health.boot_id };
    } catch {
      return null;
    }
  }
  async isRunning(binding: SandboxBinding, secret: string) {
    if (!(await this.transport.environmentRunning(binding))) return false;
    const health = z
      .object({ boot_id: z.uuid() })
      .parse(
        await this.transport.control({ ...binding, controlBootId: undefined }, secret, { action: 'health' }),
      );
    return health.boot_id === binding.controlBootId;
  }
  control(binding: SandboxBinding, secret: string, request: SandboxControlRequest) {
    return this.transport.control(binding, secret, request);
  }
  pause(name: string) {
    return this.transport.destroyEnvironment(name);
  }
  destroy(name: string) {
    return this.transport.destroyEnvironment(name);
  }
}
export function sandboxProvider(kind: SandboxProviderKind): SandboxProvider {
  switch (kind) {
    case 'render':
      return new RenderSandboxes();
    case 'docker':
      return new EphemeralSandboxes(new DockerMachines());
    case 'vercel':
      return new EphemeralSandboxes(new VercelMachines());
  }
}
