import { z } from 'zod';
import { transaction, lock } from '../../db';
import type { HostControlRequest, HostProvider } from '../../contracts/host-control';
import type { NativeConfiguration } from '../../runtime/src/types';
import type { MachineBinding } from './ports';
import { HostRuntime, requireNativeLaunch } from './host-runtime';
import { hostProvider } from '../../providers/src/hosts';
import { assert, AppError } from './errors';
import { unseal } from './crypto';
import { activeHostRun, getHost, releaseHostRun, type HostRow, type HostRunRow } from './host-allocations';
import { getNativeRun, type NativeRunRow } from './runs';
import * as resources from './resources';

type AssignmentContext = { assignment: HostRunRow; host: HostRow; provider: HostProvider };
/** A Run borrows a fenced allocation. Its cleanup never destroys a neighboring Run's compute. */
export class WorkerMachines extends HostRuntime {
  constructor(run: NativeRunRow,
    private readonly providers: (kind: HostRow['provider']) => HostProvider = hostProvider) { super(run); }
  private async context(binding?: MachineBinding, readOnly = false): Promise<AssignmentContext> {
    const result = await transaction(this.run.organization_id,async tx=>{
      const assignment = binding ? (await tx.query<HostRunRow>('SELECT * FROM host_runs WHERE id=$1 AND run_id=$2',
        [binding.sessionId,this.run.id])).rows[0] : await activeHostRun(tx,this.run.id);
      assert(assignment && (readOnly || assignment.released_at===null),409,'host_assignment_lost','This Run no longer owns its Host assignment.');
      const host = await getHost(tx,assignment.host_id);
      assert(host.worker_id===this.run.config.worker_id && host.generation===assignment.host_generation,
        409,'host_generation_changed','The original execution generation is no longer available.');
      if(binding) assert(binding.name===`run-${this.run.id}` && binding.createdAt===assignment.claimed_at.toISOString(),
        409,'host_assignment_changed','The execution binding does not match the original assignment.');
      return {assignment,host};
    });
    return {...result,provider:this.providers(result.host.provider)};
  }
  async provision(): Promise<MachineBinding> {
    const {assignment,host,provider}=await this.context();
    if(!host.binding || host.status==='provisioning') throw new AppError(503,'worker_starting','Worker capacity is still starting.');
    assert(host.status!=='stopped' && await provider.exists(host.binding,unseal<string>(host.secret_ciphertext)),
      409,'host_lost','The original Host generation stopped. The prompt will not be replayed automatically.');
    return {name:`run-${this.run.id}`,sessionId:assignment.id,createdAt:assignment.claimed_at.toISOString()};
  }
  protected async call(binding: MachineBinding, request: HostControlRequest, readOnly=false): Promise<unknown> {
    const {assignment,host,provider}=await this.context(binding,readOnly);
    assert(assignment.id===('assignment_id' in request ? request.assignment_id : undefined) &&
      host.binding && host.status!=='stopped' && host.stopped_at===null,
      409,'host_lost','The original execution Host is unavailable.');
    return provider.control(host.binding,unseal<string>(host.secret_ciphertext),request);
  }
  async prepare(binding:MachineBinding,configuration:NativeConfiguration) {
    assert(configuration.runId===this.run.id,400,'invalid_configuration','This configuration belongs to another Run.');
    const {assignment}=await this.context(binding);
    const context=assignment.configuration;
    assert(context.permission_view && context.compatibility_key && assignment.worktree_id && assignment.session_id,
      500,'assignment_context_missing','The assignment is missing its authorized input identity.');
    const response=await this.call(binding,{action:'prepare',run_id:this.run.id,assignment_id:assignment.id,configuration,
      worktree_id:assignment.worktree_id,session_id:assignment.session_id,permission_view:context.permission_view,
      checkpoint_id:context.checkpoint_id??null,session_revision:context.session_revision||'0',compatibility_key:context.compatibility_key,
      resources:{memory_mib:assignment.memory_mib,cpu_millis:assignment.cpu_millis}});
    await transaction(this.run.organization_id,tx=>tx.query("UPDATE host_runs SET state='prepared' WHERE id=$1 AND state='claimed'",[assignment.id]).then(()=>{}));
    return z.object({reused:z.boolean(),restoreNamespaces:z.array(z.enum(['workspace','home'])).optional()}).parse(response);
  }
  async launch(binding:MachineBinding) {
    await transaction(this.run.organization_id,async tx=>{
      const run=await requireNativeLaunch(tx,this.run);
      const assignment=await activeHostRun(tx,this.run.id);
      assert(assignment?.id===binding.sessionId && !run.cancel_requested && run.deadline && run.deadline.getTime()>Date.now(),
        409,'run_stopped','The Run no longer permits native launch.');
      // This records launch intent before I/O. A dropped acknowledgement cannot authorize a new assignment.
      await tx.query("UPDATE host_runs SET state='running',launched_at=coalesce(launched_at,now()) WHERE id=$1",[assignment.id]);
    });
    return z.string().parse(await this.call(binding,{action:'launch',run_id:this.run.id,assignment_id:binding.sessionId}));
  }
  async cleanupUnbound() {
    const assignment = await transaction(this.run.organization_id, tx => activeHostRun(tx, this.run.id));
    if (!assignment) return;
    assert(!assignment.launched_at, 409, 'host_launch_unknown',
      'An unbound launch intent requires recovery; its ownership cannot be discarded.');
    // A missing orchestration binding is not proof that prepare never reached the
    // controller. Its fenced release must finish before relinquishing SQL ownership.
    await this.close({name:`run-${this.run.id}`,sessionId:assignment.id,createdAt:assignment.claimed_at.toISOString()}, true);
  }
  async close(binding:MachineBinding,preserve:boolean):Promise<{snapshotId?:string}> {
    const {assignment,host,provider}=await this.context(binding,true);
    if(assignment.released_at)return preserve?{snapshotId:assignment.id}:{};
    const context=await transaction(this.run.organization_id,async tx=>{
      const session=await resources.get(tx,'sessions',this.run.session_id);
      const current=await getNativeRun(tx,this.run.id);
      // A Git/editor publication can advance the Worktree after this Run finished.
      // Its cached bytes represent this Run's checkpoint, never an unrelated newer one.
      return {checkpoint:current.result.checkpoint_id??null,sessionRevision:String(session.revision),
        persisted:!preserve && current.result.persistence_status==='verified'};
    });
    const exists=host.binding && host.stopped_at===null && await provider.exists(host.binding,unseal<string>(host.secret_ciphertext));
    if(exists && host.binding) {
      if(preserve && assignment.launched_at) await provider.control(host.binding,unseal<string>(host.secret_ciphertext),
        {action:'cancel',run_id:this.run.id,assignment_id:assignment.id});
      // A non-quiescent release throws. Durable cleanup retries without freeing the slot or writer claim.
      await provider.control(host.binding,unseal<string>(host.secret_ciphertext),{action:'release',run_id:this.run.id,
        assignment_id:assignment.id,checkpoint_id:context.checkpoint,session_revision:context.sessionRevision,persisted:context.persisted});
    }
    await transaction(this.run.organization_id,async tx=>{
      await lock(tx,`worktree:${this.run.worktree_id}`);
      await releaseHostRun(tx,assignment,!!exists && context.persisted,context.checkpoint);
    });
    return preserve?{snapshotId:assignment.id}:{};
  }
}
