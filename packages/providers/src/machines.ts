import type { MachineProvider, SandboxTools } from '../../core/src/ports';
import { config, isLocal } from '../../core/src/config';
import { AppError } from '../../core/src/errors';
import { VercelMachines } from './vercel';
import { DockerMachines } from './docker';
/** Composition boundary shared by Workflow, the portable poller, and the runtime tool broker. */
export function machines(): MachineProvider & SandboxTools {
  if (config.execution === 'vercel') return new VercelMachines();
  if (isLocal() && config.execution === 'docker') return new DockerMachines();
  throw new AppError(503, 'execution_unavailable', 'No isolated cloud execution adapter is configured.');
}
