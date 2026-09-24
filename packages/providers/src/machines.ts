import type { NativeRunRow } from '../../core/src/runs';
import { WorkerMachines } from '../../core/src/worker-machines';
import { AutomaticMachines } from '../../core/src/automatic-machines';
import type { MachineProvider, MachineTools } from '../../core/src/ports';
import { config, isLocal } from '../../core/src/config';
import { AppError } from '../../core/src/errors';
import { VercelMachines } from './vercel';
import { DockerMachines } from './docker';
/** Composition boundary shared by Workflow, the portable poller, and the runtime tool broker. */
export function machines(run?: NativeRunRow): MachineProvider & MachineTools {
  if (run?.config.worker_id) return new WorkerMachines(run);
  if (config.execution === 'vercel') return run ? new AutomaticMachines(run, 'vercel', new VercelMachines()) : new VercelMachines();
  if (isLocal() && config.execution === 'docker') return run ? new AutomaticMachines(run, 'docker', new DockerMachines()) : new DockerMachines();
  throw new AppError(503, 'execution_unavailable', 'No isolated cloud execution adapter is configured.');
}
