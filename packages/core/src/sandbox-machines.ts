import { z } from 'zod';
import { lock, transaction } from '../../db';
import type { SandboxProvider, SandboxControlRequest } from '../../contracts/sandbox-control';
import type { MachineProvider, MachineBinding, SandboxTools, StdioInvocation } from './ports';
import type { NativeConfiguration } from '../../runtime/src/types';
import type { NativeRunRow } from './runs';
import { getSandbox, acquireSandbox, releaseSandbox, advanceSandbox, sandboxName } from './sandboxes';
import { unseal } from './crypto';
import { AppError, assert } from './errors';

const probeSchema = z.object({
  events: z.array(
    z.object({ sequence: z.number(), type: z.string(), data: z.record(z.string(), z.unknown()) }),
  ),
  nextOffset: z.number(),
  status: z.object({ state: z.string() }).nullable(),
  result: z
    .object({
      output: z.string(),
      outcome: z.enum(['success', 'failure', 'cancelled', 'timed_out']),
      resumeId: z.string().optional(),
      failureCode: z.string().optional(),
      persistence: z.enum(['captured', 'failed']),
      persistenceError: z.string().optional(),
      completedAt: z.string(),
    })
    .nullable(),
  input: z
    .object({ id: z.string(), question: z.string(), details: z.record(z.string(), z.unknown()) })
    .nullable(),
});
const snapshotSchema = z.object({
  entries: z.array(
    z.object({
      namespace: z.enum(['workspace', 'home']),
      path: z.string(),
      type: z.enum(['file', 'symlink']),
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      mode: z.number().int(),
      modifiedAt: z.string(),
      chunks: z.array(
        z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative() }),
      ),
    }),
  ),
  total: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});

/** A run borrows compute; only the environment service may retire its VM. */
export class SandboxMachines implements MachineProvider, SandboxTools {
  constructor(
    private readonly run: NativeRunRow,
    private readonly sandboxId: string,
    private readonly provider: SandboxProvider,
  ) {}
  private async row() {
    return transaction(this.run.organization_id, (tx) => getSandbox(tx, this.sandboxId));
  }
  async provision(): Promise<MachineBinding> {
    const row = await transaction(this.run.organization_id, (tx) =>
      acquireSandbox(tx, this.sandboxId, this.run.id, this.run.worktree_id),
    );
    if (row.status === 'ready' && row.binding) {
      const secret = unseal<string>(row.secret_ciphertext);
      // Only this pre-prepare phase may replace lost compute. Never replay an ambiguously started harness.
      const enoughLifetime =
        !row.expires_at ||
        row.expires_at.getTime() >
          Date.now() + ((this.run.config.limits?.timeout_seconds || 900) + 120) * 1000;
      if (!enoughLifetime || !(await this.provider.isRunning(row.binding, secret))) {
        await this.provider.destroy(sandboxName(row), row.binding);
        await transaction(row.organization_id, async (tx) => {
          await lock(tx, `sandbox:${row.id}`);
          const current = await getSandbox(tx, row.id);
          assert(
            current.active_run_id === this.run.id,
            409,
            'sandbox_lease_lost',
            'Sandbox ownership changed.',
          );
          if (current.generation === row.generation)
            await tx.query(
              "UPDATE sandboxes SET status='creating',generation=generation+1,binding=NULL,expires_at=NULL,provisioning_at=now() WHERE id=$1",
              [row.id],
            );
        });
        row.status = 'creating';
      }
    }
    if (row.status === 'creating') await advanceSandbox(row.organization_id, row.id, this.provider);
    const current = await this.row();
    assert(
      ['ready', 'creating'].includes(current.status),
      409,
      'sandbox_unavailable',
      'Sandbox startup failed or was stopped.',
    );
    if (current.status !== 'ready' || !current.binding)
      throw new AppError(503, 'sandbox_starting', 'Sandbox is starting.');
    return current.binding;
  }
  private async call(binding: MachineBinding, request: SandboxControlRequest) {
    const row = await this.row();
    assert(
      row.active_run_id === this.run.id &&
        row.binding?.sessionId === binding.sessionId &&
        row.binding?.name === binding.name,
      409,
      'sandbox_lease_lost',
      'This run no longer owns the sandbox.',
    );
    return this.provider.control(row.binding, unseal<string>(row.secret_ciphertext), request);
  }
  async prepare(binding: MachineBinding, configuration: NativeConfiguration) {
    const response = await this.call(binding, { action: 'prepare', run_id: this.run.id, configuration });
    return z.object({ reused: z.boolean() }).parse(response);
  }
  async stage(binding: MachineBinding, files: { path: string; content: Buffer }[]) {
    assert(
      files.every((file) => file.path.startsWith('/platform-control/restore/')),
      400,
      'invalid_stage_path',
      'Invalid restore path.',
    );
    await this.call(binding, {
      action: 'stage',
      run_id: this.run.id,
      files: files.map((file) => ({
        path: file.path.slice('/platform-control/restore/'.length),
        content: file.content.toString('base64'),
      })),
    });
  }
  async restore(binding: MachineBinding) {
    return z.string().parse(await this.call(binding, { action: 'restore', run_id: this.run.id }));
  }
  async restored(binding: MachineBinding) {
    return z
      .enum(['pending', 'success', 'failure'])
      .parse(await this.call(binding, { action: 'restored', run_id: this.run.id }));
  }
  async launch(binding: MachineBinding) {
    return z.string().parse(await this.call(binding, { action: 'launch', run_id: this.run.id }));
  }
  async probe(binding: MachineBinding, offset: number) {
    return probeSchema.parse(await this.call(binding, { action: 'probe', run_id: this.run.id, offset }));
  }
  async snapshotPage(binding: MachineBinding, offset: number) {
    return snapshotSchema.parse(
      await this.call(binding, { action: 'snapshot', run_id: this.run.id, offset }),
    );
  }
  async chunk(binding: MachineBinding, hash: string) {
    return Buffer.from(
      z
        .object({ content: z.string() })
        .parse(await this.call(binding, { action: 'chunk', run_id: this.run.id, hash })).content,
      'base64',
    );
  }
  async answer(binding: MachineBinding, id: string, answer: Record<string, unknown>) {
    await this.call(binding, { action: 'answer', run_id: this.run.id, id, answer });
  }
  async cancel(binding: MachineBinding) {
    await this.call(binding, { action: 'cancel', run_id: this.run.id });
  }
  async invokeStdio(binding: MachineBinding, invocation: StdioInvocation) {
    return z
      .record(z.string(), z.unknown())
      .parse(await this.call(binding, { action: 'stdio', run_id: this.run.id, invocation }));
  }
  async close(binding: MachineBinding, preserve: boolean): Promise<{ snapshotId?: string }> {
    const row = await this.row();
    if (row.active_run_id !== this.run.id) return {};
    if (preserve) {
      // Uncertain execution is stopped, not reused. The last published checkpoint remains authoritative.
      await this.provider.pause(sandboxName(row), row.binding);
    } else {
      const checkpoint = await transaction(
        row.organization_id,
        async (tx) =>
          (
            await tx.query<{ data: { latest_checkpoint_id?: string } }>(
              'SELECT data FROM worktrees WHERE id=$1',
              [this.run.worktree_id],
            )
          ).rows[0].data.latest_checkpoint_id,
      );
      await this.call(binding, { action: 'release', run_id: this.run.id, checkpoint_id: checkpoint ?? null });
    }
    await releaseSandbox(
      row.organization_id,
      row.id,
      this.run.id,
      this.run.config.keep_warm_seconds,
      preserve,
    );
    return {};
  }
}
