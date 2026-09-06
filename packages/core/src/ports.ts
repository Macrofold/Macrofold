import type { NativeConfiguration, NativeResult } from '../../runtime/src/types';
import type { SnapshotEntry } from '../../runtime/src/manifest';

export type MachineBinding = { name: string; sessionId: string; createdAt: string };
export type StdioInvocation = {
  id: string;
  runId: string;
  command: string;
  args: string[];
  environment: Record<string, string>;
  tool: string;
  arguments: Record<string, unknown>;
};
export interface SandboxTools {
  invokeStdio(binding: MachineBinding, input: StdioInvocation): Promise<Record<string, unknown>>;
}
export type RuntimeProbe = {
  events: { sequence: number; type: string; data: Record<string, unknown> }[];
  nextOffset: number;
  status: { state: string } | null;
  result:
    | (NativeResult & { persistence: 'captured' | 'failed'; persistenceError?: string; completedAt: string })
    | null;
  input: { id: string; question: string; details: Record<string, unknown> } | null;
};
/** Durable orchestration owns retries, leases and checkpoints. A compute adapter owns only VM I/O. */
export interface MachineProvider {
  provision(name: string, timeoutSeconds: number): Promise<MachineBinding>;
  prepare(binding: MachineBinding, configuration: NativeConfiguration): Promise<void>;
  stage(binding: MachineBinding, files: { path: string; content: Buffer }[]): Promise<void>;
  restore(binding: MachineBinding): Promise<string>;
  restored(binding: MachineBinding): Promise<'pending' | 'success' | 'failure'>;
  launch(binding: MachineBinding): Promise<string>;
  probe(binding: MachineBinding, offset: number): Promise<RuntimeProbe>;
  answer(binding: MachineBinding, id: string, answer: Record<string, unknown>): Promise<void>;
  cancel(binding: MachineBinding): Promise<void>;
  snapshotPage(
    binding: MachineBinding,
    offset: number,
  ): Promise<{ entries: SnapshotEntry[]; total: number; totalBytes: number }>;
  chunk(binding: MachineBinding, hash: string): Promise<Buffer>;
  close(binding: MachineBinding, preserve: boolean): Promise<{ snapshotId?: string }>;
}
