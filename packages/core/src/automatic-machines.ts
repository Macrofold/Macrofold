import { z } from 'zod';
import { transaction } from '../../db';
import { hostHealth, type HostControlRequest, type HostProvider } from '../../contracts/host-control';
import type { NativeConfiguration } from '../../runtime/src/types';
import { hostProvider } from '../../providers/src/hosts';
import type { MachineBinding, MachineProvider } from './ports';
import { HostRuntime, requireNativeLaunch } from './host-runtime';
import { AppError, assert } from './errors';
import { seal, token, unseal } from './crypto';
import { getNativeRun, type NativeRunRow } from './runs';
import { runDemand } from './host-allocations';
import { hostMemoryHeadroom } from './worker-placement';

const allocation = { memory_mib: 4096, cpu_millis: 2000 };
/** Automatic compute is one isolated assignment, billed through the existing Run
 * reservation. It does not invent a customer Worker or share another Worker's capacity. */
export class AutomaticMachines extends HostRuntime {
  private readonly provider: HostProvider;
  constructor(run: NativeRunRow, driver: 'docker' | 'vercel',
    private readonly physical: Pick<MachineProvider, 'close'>) {
    super(run); this.provider = hostProvider(driver);
  }
  private name() { return `env-${this.run.id}-${this.run.lease_generation}`; }
  private async secret(): Promise<string> {
    let ciphertext = this.run.config.automatic_control_secret_ciphertext;
    if (!ciphertext) {
      ciphertext = await transaction(this.run.organization_id, async tx => {
        await tx.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [this.run.id]);
        const current = await getNativeRun(tx, this.run.id);
        if (current.config.automatic_control_secret_ciphertext) return current.config.automatic_control_secret_ciphertext;
        const value = seal(token('host'));
        await tx.query("UPDATE runs SET config=jsonb_set(config,'{automatic_control_secret_ciphertext}',$2::jsonb) WHERE id=$1", [this.run.id, JSON.stringify(value)]);
        return value;
      });
      this.run.config.automatic_control_secret_ciphertext = ciphertext;
    }
    return unseal<string>(ciphertext);
  }
  async provision(name: string, timeoutSeconds: number): Promise<MachineBinding> {
    assert(name === `run-${this.run.id}`, 400, 'invalid_execution', 'The allocation belongs to another Run.');
    const binding = await this.provider.provision({ id: this.run.id, generation: Number(this.run.lease_generation),
      name: this.name(), secret: await this.secret(), lifetime_seconds: timeoutSeconds + 180,
      resources: allocation, region: 'iad1', size: '2cpu-4g', runtime: process.env.WORKER_RUNTIME_VERSION || 'managed-1',
      concurrency: 1, isolate_runs: true });
    if (!binding) throw new AppError(503, 'worker_starting', 'Isolated execution capacity is starting.');
    return binding;
  }
  protected async call(binding: MachineBinding, request: HostControlRequest): Promise<unknown> {
    assert(binding.name === this.name() && binding.controlBootId, 409, 'host_assignment_changed', 'The execution binding does not match this Run.');
    const scoped = 'assignment_id' in request ? { ...request, run_id: this.run.id, assignment_id: this.run.id } : request;
    return this.provider.control(binding, await this.secret(), scoped);
  }
  async prepare(binding: MachineBinding, configuration: NativeConfiguration) {
    assert(configuration.runId === this.run.id, 400, 'invalid_configuration', 'This configuration belongs to another Run.');
    const health = hostHealth.parse(await this.call(binding, { action: 'health' }));
    assert(health.boot_id === binding.controlBootId && health.capabilities.scoped_processes && health.capabilities.sibling_isolation,
      503, 'host_isolation_unavailable', 'The runtime does not support isolated scoped execution.');
    await this.call(binding, { action: 'configure', host_id: this.run.id, generation: Number(this.run.lease_generation),
      resources: allocation, concurrency: 1, isolate_runs: true, warm_memory_mib: 0, warm_idle_seconds: 0 });
    const demand = await transaction(this.run.organization_id, tx => runDemand(tx, this.run));
    const response = await this.call(binding, { action: 'prepare', run_id: this.run.id, assignment_id: this.run.id,
      configuration, worktree_id: this.run.worktree_id, session_id: this.run.session_id,
      checkpoint_id: demand.worktree?.revision || null, permission_view: demand.permission_view,
      session_revision: demand.session?.revision || '0', compatibility_key: demand.compatibility_key,
      resources: { memory_mib: allocation.memory_mib - hostMemoryHeadroom(allocation.memory_mib), cpu_millis: allocation.cpu_millis } });
    return z.object({ reused: z.boolean(), restoreNamespaces: z.array(z.enum(['workspace', 'home'])).optional() }).parse(response);
  }
  async launch(binding: MachineBinding) {
    await transaction(this.run.organization_id, tx => requireNativeLaunch(tx, this.run));
    return z.string().parse(await this.call(binding, { action: 'launch', run_id: this.run.id, assignment_id: this.run.id }));
  }
  close(binding: MachineBinding, preserve: boolean) {
    assert(binding.name === this.name(), 409, 'host_assignment_changed', 'The allocation belongs to another Run.');
    // There are no neighbors on an automatic allocation. Provider stop/snapshot
    // contains every descendant even if the controller cannot acknowledge cleanup.
    return this.physical.close(binding, preserve);
  }
  async cleanupUnbound() {
    assert(await this.provider.destroy(this.name(), null), 503, 'host_stop_unconfirmed',
      'The provider has not confirmed cleanup of the named pre-launch allocation.');
  }
}
