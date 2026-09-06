import type { MachineProvider, SandboxTools } from '../../core/src/ports';
import { config } from '../../core/src/config';
import { AppError } from '../../core/src/errors';
import { VercelMachines } from './vercel';
/** Composition boundary shared by Workflow, the portable poller, and the runtime tool broker. */
export function machines(): MachineProvider & SandboxTools {
  if (config.execution === 'vercel') return new VercelMachines();
  throw new AppError(503, 'execution_unavailable', 'No isolated cloud execution adapter is configured.');
}
