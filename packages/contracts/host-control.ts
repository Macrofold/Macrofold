import { z } from 'zod';

const assignment = { run_id: z.uuid(), assignment_id: z.uuid() };
const resources = z.object({ memory_mib: z.number().int().positive(), cpu_millis: z.number().int().positive() });
/** Private authenticated protocol. Callers cannot select a filesystem path or operating-system identity. */
export const hostControlRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('health') }),
  z.object({ action: z.literal('configure'), host_id: z.uuid(), generation: z.number().int().positive(),
    concurrency: z.number().int().positive().max(1024), isolate_runs: z.boolean(), resources,
    warm_memory_mib: z.number().int().nonnegative(), warm_idle_seconds: z.number().int().nonnegative().max(86400) }),
  z.object({ action: z.literal('prepare'), ...assignment, configuration: z.unknown(),
    worktree_id: z.uuid(), session_id: z.uuid().nullable(), permission_view: z.string().regex(/^[a-f0-9]{64}$/),
    checkpoint_id: z.uuid().nullable(), session_revision: z.string().max(160),
    compatibility_key: z.string().regex(/^[a-f0-9]{64}$/), resources }),
  z.object({ action: z.literal('stage'), ...assignment, files: z.array(z.object({
    path: z.string().regex(/^(chunks\/[a-f0-9]{64}|page-\d+\.json)$/), content: z.string().max(6000000),
  })).max(32) }),
  z.object({ action: z.enum(['restore','restored','launch','cancel']), ...assignment }),
  z.object({ action: z.literal('release'), ...assignment, checkpoint_id: z.uuid().nullable(),
    session_revision: z.string().max(160), persisted: z.boolean() }),
  z.object({ action: z.enum(['probe','snapshot']), ...assignment, offset: z.number().int().nonnegative() }),
  z.object({ action: z.literal('chunk'), ...assignment, hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({ action: z.literal('answer'), ...assignment, id: z.string().max(512), answer: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal('stdio'), ...assignment, invocation: z.object({
    id: z.uuid(), runId: z.uuid(), command: z.string().startsWith('/opt/platform/'), args: z.array(z.string()),
    environment: z.record(z.string(), z.string()), tool: z.string(), arguments: z.record(z.string(), z.unknown()),
  }) }),
]);
export type HostControlRequest = z.infer<typeof hostControlRequest>;
export const hostHealth = z.object({
  boot_id: z.uuid(), started_at: z.string(), configured: z.boolean(), rotation_requested: z.boolean().optional(), active_assignments: z.number().int().nonnegative(),
  capabilities: z.object({ scoped_processes: z.boolean(), sibling_isolation: z.boolean(), resource_meter: z.boolean() }),
  meters: z.object({ kind: z.literal('resource'), cpu_core_ms: z.string().regex(/^\d+$/), memory_mib_ms: z.string().regex(/^\d+$/) }).nullable(),
});
export type HostHealth = z.infer<typeof hostHealth>;
export type HostBinding = {
  name: string; sessionId: string; createdAt: string; controlBootId?: string; providerId?: string; url?: string;
};
export type HostProvisionSpec = {
  id: string; generation: number; name: string; secret: string;
  lifetime_seconds: number | null; resources: { memory_mib: number; cpu_millis: number };
  region: string; size: string; runtime: string; concurrency: number; isolate_runs: boolean;
};
/** All lifecycle operations are reconciled by durable identity. Unknown provider results throw, never mean absence. */
export interface HostProvider {
  provision(spec: HostProvisionSpec): Promise<HostBinding | null>;
  exists(binding: HostBinding, secret: string): Promise<boolean>;
  control(binding: HostBinding, secret: string, request: HostControlRequest): Promise<unknown>;
  /** Returns true only after the provider confirms that this allocation is stopped/absent. */
  destroy(name: string, binding: HostBinding | null): Promise<boolean>;
}
