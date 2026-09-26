import { z } from 'zod';
import { lock, type Tx } from '../../db';
import type { HostControlRequest } from '../../contracts/host-control';
import type { NativeConfiguration } from '../../runtime/src/types';
import type { MachineBinding, MachineProvider, MachineTools, StdioInvocation } from './ports';
import { assert } from './errors';
import { actorAuthorized } from './actor-authorization';
import { getNativeRun, type NativeRunRow } from './runs';

const probeSchema = z.object({
  events: z.array(z.object({ sequence: z.number(), type: z.string(), data: z.record(z.string(),z.unknown()) })),
  nextOffset: z.number(), status: z.object({ state: z.string() }).nullable(),
  result: z.object({ output: z.string(), outcome: z.enum(['success','failure','cancelled','timed_out']),
    resumeId: z.string().optional(), failureCode: z.string().optional(), persistence: z.enum(['captured','failed']),
    persistenceError: z.string().optional(), completedAt: z.string() }).nullable(),
  input: z.object({ id:z.string(), question:z.string(), details:z.record(z.string(),z.unknown()) }).nullable(),
});
const snapshotSchema = z.object({ entries:z.array(z.object({
  namespace:z.enum(['workspace','home']), path:z.string(),type:z.enum(['file','symlink']),size:z.number().int().nonnegative(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),mode:z.number().int(),modifiedAt:z.string(),
  chunks:z.array(z.object({hash:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().nonnegative()})),
})),total:z.number().int().nonnegative(),totalBytes:z.number().int().nonnegative() });

/** One authenticated wire protocol for automatic isolated allocations and explicit Workers. */
export abstract class HostRuntime implements MachineProvider, MachineTools {
  constructor(protected readonly run: NativeRunRow) {}
  protected abstract call(binding: MachineBinding, request: HostControlRequest, readOnly?: boolean): Promise<unknown>;
  abstract provision(name: string, timeoutSeconds: number): Promise<MachineBinding>;
  abstract prepare(binding: MachineBinding, configuration: NativeConfiguration): Promise<{reused: boolean; restoreNamespaces?: ('workspace'|'home')[]}>;
  abstract launch(binding: MachineBinding): Promise<string>;
  abstract close(binding: MachineBinding, preserve: boolean): Promise<{snapshotId?: string}>;
  async stage(binding:MachineBinding,files:{path:string;content:Buffer}[]) {
    assert(files.every(file=>/^\/platform-control\/restore\/(chunks\/[a-f0-9]{64}|page-\d+\.json)$/.test(file.path)),
      400,'invalid_stage_path','Invalid restore transfer path.');
    await this.call(binding,{action:'stage',run_id:this.run.id,assignment_id:binding.sessionId,
      files:files.map(file=>({path:file.path.slice('/platform-control/restore/'.length),content:file.content.toString('base64')}))});
  }
  async restore(binding:MachineBinding) {
    return z.string().parse(await this.call(binding,{action:'restore',run_id:this.run.id,assignment_id:binding.sessionId}));
  }
  async restored(binding:MachineBinding) {
    return z.enum(['pending','success','failure']).parse(await this.call(binding,{action:'restored',run_id:this.run.id,assignment_id:binding.sessionId}));
  }
  async probe(binding:MachineBinding,offset:number) {
    return probeSchema.parse(await this.call(binding,{action:'probe',run_id:this.run.id,assignment_id:binding.sessionId,offset},true));
  }
  async snapshotPage(binding:MachineBinding,offset:number) {
    return snapshotSchema.parse(await this.call(binding,{action:'snapshot',run_id:this.run.id,assignment_id:binding.sessionId,offset},true));
  }
  async chunk(binding:MachineBinding,hash:string) {
    return Buffer.from(z.object({content:z.string()}).parse(await this.call(binding,
      {action:'chunk',run_id:this.run.id,assignment_id:binding.sessionId,hash},true)).content,'base64');
  }
  async answer(binding:MachineBinding,id:string,answer:Record<string,unknown>) {
    await this.call(binding,{action:'answer',run_id:this.run.id,assignment_id:binding.sessionId,id,answer});
  }
  async cancel(binding:MachineBinding) {
    await this.call(binding,{action:'cancel',run_id:this.run.id,assignment_id:binding.sessionId});
  }
  async invokeStdio(binding:MachineBinding,invocation:StdioInvocation) {
    return z.record(z.string(),z.unknown()).parse(await this.call(binding,
      {action:'stdio',run_id:this.run.id,assignment_id:binding.sessionId,invocation}));
  }
}

/** Recheck revocation/cancellation at launch without holding a lock during provider I/O. */
export async function requireNativeLaunch(tx: Tx, expected: NativeRunRow) {
  await lock(tx, `worktree:${expected.worktree_id}`);
  const run = await getNativeRun(tx, expected.id);
  assert(run.lease_generation === expected.lease_generation && !run.cancel_requested && run.deadline && run.deadline.getTime() > Date.now(),
    409, 'run_stopped', 'The Run no longer permits native launch.');
  assert(await actorAuthorized(tx, run), 403, 'permission_revoked', 'Execution authority was revoked before launch.');
  return run;
}
