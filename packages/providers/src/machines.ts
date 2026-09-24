import type { NativeRunRow } from '../../core/src/runs';
import { WorkerMachines } from '../../core/src/worker-machines';
import { SandboxMachines } from '../../core/src/sandbox-machines';
import { sandboxProvider } from './sandboxes';
import type { MachineProvider, SandboxTools } from '../../core/src/ports';
import { config, isLocal } from '../../core/src/config';
import { AppError } from '../../core/src/errors';
import { VercelMachines } from './vercel';
import { DockerMachines } from './docker';
/** Composition boundary shared by Workflow, the portable poller, and the runtime tool broker. */
export function machines(run?: NativeRunRow): MachineProvider & SandboxTools {
  if (run?.config.worker_id) return new WorkerMachines(run);
  if (run?.config.sandbox_id) return new SandboxMachines(run, run.config.sandbox_id, sandboxProvider(run.config.sandbox_provider || 'vercel'));
  if (config.execution === 'vercel') return new VercelMachines();
  if (isLocal() && config.execution === 'docker') return new DockerMachines();
  throw new AppError(503, 'execution_unavailable', 'No isolated cloud execution adapter is configured.');
}
