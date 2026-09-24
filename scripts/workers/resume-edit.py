from pathlib import Path
import re
edits={};removed=set()
def read(p):return edits.get(p,Path(p).read_text())
def replace(p,old,new,count=1):
 s=read(p)
 if s.count(old)!=count:raise RuntimeError(f'{p}: changed anchor {old[:90]} ({s.count(old)}/{count})')
 edits[p]=s.replace(old,new)
def cut(p,start,end):
 s=read(p);a=s.index(start);b=s.index(end,a);edits[p]=s[:a]+s[b:]

replace('packages/core/src/engine.ts',"import { computeMaximum } from './catalog';\n",'')
replace('packages/core/src/engine.ts',"import { AppError, assert } from './errors';", "import { assert } from './errors';")
# Delete only the obsolete adapter case; retain unrelated Docker boundary coverage.
p='tests/unit/docker-machines.test.ts'
replace(p,"import { sandboxProvider } from '../../packages/providers/src/sandboxes';\n",'')
cut(p,"  it('passes an unbounded lifetime only through the Docker sandbox adapter'", "  it('keeps simulator keys unable")

p='packages/core/src/worker-machines.ts';original=read(p)
schemas=original[original.index('const probeSchema'):original.index('type AssignmentContext')]
stage=original[original.index('  async stage('):original.index('  async launch(')]
probes=original[original.index('  async probe('):original.index('  async close(')]
edits['packages/core/src/host-runtime.ts']='''import { z } from 'zod';
import { lock, type Tx } from '../../db';
import type { HostControlRequest } from '../../contracts/host-control';
import type { NativeConfiguration } from '../../runtime/src/types';
import type { MachineBinding, MachineProvider, MachineTools, StdioInvocation } from './ports';
import { assert } from './errors';
import { actorAuthorized } from './actor-authorization';
import { getNativeRun, type NativeRunRow } from './runs';

'''+schemas+'''/** One authenticated wire protocol for automatic isolated allocations and explicit Workers. */
export abstract class HostRuntime implements MachineProvider, MachineTools {
  constructor(protected readonly run: NativeRunRow) {}
  protected abstract call(binding: MachineBinding, request: HostControlRequest, readOnly?: boolean): Promise<unknown>;
  abstract provision(name: string, timeoutSeconds: number): Promise<MachineBinding>;
  abstract prepare(binding: MachineBinding, configuration: NativeConfiguration): Promise<{reused: boolean; restoreNamespaces?: ('workspace'|'home')[]}>;
  abstract launch(binding: MachineBinding): Promise<string>;
  abstract close(binding: MachineBinding, preserve: boolean): Promise<{snapshotId?: string}>;
'''+stage+probes+'''}

/** Recheck revocation/cancellation at launch without holding a lock during provider I/O. */
export async function requireNativeLaunch(tx: Tx, expected: NativeRunRow) {
  await lock(tx, `worktree:${expected.worktree_id}`);
  const run = await getNativeRun(tx, expected.id);
  assert(run.lease_generation === expected.lease_generation && !run.cancel_requested && run.deadline && run.deadline.getTime() > Date.now(),
    409, 'run_stopped', 'The Run no longer permits native launch.');
  assert(await actorAuthorized(tx, run), 403, 'permission_revoked', 'Execution authority was revoked before launch.');
  return run;
}
'''
# Preserve the existing durable assignment implementation; share its protocol mechanics.
s=original.replace(schemas,'')
s=s.replace("import type { MachineBinding, MachineProvider, SandboxTools, StdioInvocation } from './ports';", "import type { MachineBinding } from './ports';\nimport { HostRuntime, requireNativeLaunch } from './host-runtime';")
s=s.replace('export class WorkerMachines implements MachineProvider, SandboxTools {', 'export class WorkerMachines extends HostRuntime {')
s=s.replace('constructor(private readonly run: NativeRunRow,', 'constructor(run: NativeRunRow,')
s=s.replace("private readonly providers: (kind: HostRow['provider']) => HostProvider = hostProvider) {}", "private readonly providers: (kind: HostRow['provider']) => HostProvider = hostProvider) { super(run); }")
s=s.replace('  private async call(', '  protected async call(')
s=s.replace(stage,'').replace(probes,'')
s=s.replace('      await lock(tx,`worktree:${this.run.worktree_id}`);\n      const run=await getNativeRun(tx,this.run.id);', '      const run=await requireNativeLaunch(tx,this.run);')
s=s.replace('return {checkpoint:worktree.latest_checkpoint_id??null,sessionRevision:String(session.revision),',
 '''// A Git/editor publication can advance the Worktree after this Run finished.
      // Its cached bytes represent this Run's checkpoint, never an unrelated newer one.
      return {checkpoint:current.result.checkpoint_id??null,sessionRevision:String(session.revision),''')
s=s.replace("      const worktree=await resources.get(tx,'worktrees',this.run.worktree_id);\n",'')
# No prepared runtime exists on the no-binding path, but release the SQL slot durably.
s=s.replace('  async close(binding:MachineBinding,preserve:boolean)', '''  async cleanupUnbound() {
    await transaction(this.run.organization_id, async tx => {
      await lock(tx, `worktree:${this.run.worktree_id}`);
      const assignment = await activeHostRun(tx, this.run.id);
      if (assignment && !assignment.launched_at) await releaseHostRun(tx, assignment, false, null);
    });
  }
  async close(binding:MachineBinding,preserve:boolean)''')
edits[p]=s

edits['packages/core/src/automatic-machines.ts']='''import { z } from 'zod';
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
'''
replace('packages/core/src/ports.ts', 'export type MachineBinding = { name: string; sessionId: string; createdAt: string };',
 "export type MachineBinding = import('../../contracts/host-control').HostBinding;")
replace('packages/core/src/ports.ts', 'export interface MachineProvider {', '''export interface MachineProvider {
  /** Close a named pre-launch allocation after an uncertain provisioning acknowledgement. */
  cleanupUnbound?(): Promise<void>;''')
replace('packages/core/src/runs.ts', '  worker_id?: string;', '  automatic_control_secret_ciphertext?: string;\n  worker_id?: string;')
replace('packages/providers/src/machines.ts', "import { WorkerMachines } from '../../core/src/worker-machines';", "import { WorkerMachines } from '../../core/src/worker-machines';\nimport { AutomaticMachines } from '../../core/src/automatic-machines';")
replace('packages/providers/src/machines.ts', "  if (config.execution === 'vercel') return new VercelMachines();", "  if (config.execution === 'vercel') return run ? new AutomaticMachines(run, 'vercel', new VercelMachines()) : new VercelMachines();")
replace('packages/providers/src/machines.ts', "  if (isLocal() && config.execution === 'docker') return new DockerMachines();", "  if (isLocal() && config.execution === 'docker') return run ? new AutomaticMachines(run, 'docker', new DockerMachines()) : new DockerMachines();")
# Prepare the Host before materializing files, including automatic allocations.
p='packages/core/src/cloud-engine.ts'
replace(p,"{ provider: selected, phase: run.config.worker_id ? 'provision' : 'input', inputOffset: 0, failures: 0 }", "{ provider: selected, phase: 'provision', inputOffset: 0, failures: 0 }")
replace(p,"      state.workerPrepared = Boolean(run.config.worker_id);", "      state.workerPrepared = true;")
cut(p,'      if (!state.machine && run.config.worker_id) {',"      state.phase = 'done';")
replace(p,"      state.phase = 'done';", "      if (!state.machine) await provider.cleanupUnbound?.();\n      state.phase = 'done';")
# Private execution-tool port has no ownership relationship to persistent files.
for p in ['packages/core/src/ports.ts','packages/core/src/tool-broker.ts','packages/providers/src/docker.ts','packages/providers/src/vercel.ts','packages/providers/src/machines.ts']:
 s=read(p);edits[p]=s.replace('SandboxTools','MachineTools').replace('sandboxTools','machineTools')

p='docs/maintainers/TODO.md'
replace(p,'## Worker cutover regression obligations\n', '''## Worker cutover regression obligations

- [ ] Cover automatic native execution on the Host protocol, encrypted control-secret recovery, pre-launch allocation cleanup without a received binding, and Session continuation when switching between automatic and explicit Worker placement.
- [ ] Cover a Worktree advancing via Git/editor publication before Host cleanup: local cache metadata must name the Run's own verified checkpoint, never the newer Worktree checkpoint.
''')
for p,s in edits.items():Path(p).parent.mkdir(parents=True,exist_ok=True);Path(p).write_text(s)
print('APPLIED_SOURCE_FILES',', '.join(edits))
