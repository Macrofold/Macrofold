import { z } from 'zod';

/** Private control protocol. No shell command or arbitrary filesystem path is accepted. */
export const sandboxControlRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('health') }),
  z.object({ action: z.literal('prepare'), run_id: z.uuid(), configuration: z.unknown() }),
  z.object({
    action: z.literal('stage'),
    run_id: z.uuid(),
    files: z
      .array(
        z.object({
          path: z.string().regex(/^(chunks\/[a-f0-9]{64}|page-\d+\.json)$/),
          content: z.string().max(6_000_000),
        }),
      )
      .max(32),
  }),
  z.object({ action: z.enum(['restore', 'restored', 'launch', 'cancel']), run_id: z.uuid() }),
  z.object({ action: z.literal('release'), run_id: z.uuid(), checkpoint_id: z.string().nullable().optional() }),
  z.object({
    action: z.enum(['probe', 'snapshot']),
    run_id: z.uuid(),
    offset: z.number().int().nonnegative(),
  }),
  z.object({ action: z.literal('chunk'), run_id: z.uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({
    action: z.literal('answer'),
    run_id: z.uuid(),
    id: z.string(),
    answer: z.record(z.string(), z.unknown()),
  }),
  z.object({
    action: z.literal('stdio'),
    run_id: z.uuid(),
    invocation: z.object({
      id: z.uuid(),
      runId: z.uuid(),
      command: z.string().startsWith('/opt/platform/'),
      args: z.array(z.string()),
      environment: z.record(z.string(), z.string()),
      tool: z.string(),
      arguments: z.record(z.string(), z.unknown()),
    }),
  }),
]);
export type SandboxControlRequest = z.infer<typeof sandboxControlRequest>;
export type SandboxProviderKind = 'vercel' | 'docker' | 'render';
export type SandboxBinding = {
  name: string;
  sessionId: string;
  createdAt: string;
  controlBootId?: string;
  providerId?: string;
  url?: string;
};
/** Provider lifecycle is independent of a run. An absent result means creation is still pending. */
export interface SandboxProvider {
  /** Null requests no provider lifetime limit; idle policy and billing still apply. */
  create(name: string, secret: string, lifetimeSeconds: number | null): Promise<SandboxBinding | null>;
  /** False only for confirmed loss; transport failures must throw. Used before a run is prepared. */
  isRunning(binding: SandboxBinding, secret: string): Promise<boolean>;
  control(binding: SandboxBinding, secret: string, request: SandboxControlRequest): Promise<unknown>;
  pause(name: string, binding: SandboxBinding | null): Promise<void>;
  destroy(name: string, binding: SandboxBinding | null): Promise<void>;
}
