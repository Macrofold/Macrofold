import type { RunAttachment } from '../../contracts/media';
import type { PermissionLayers } from '../../contracts/permissions';
import type { HarnessName } from '../../contracts/harnesses';
export type { HarnessName } from '../../contracts/harnesses';
export interface PermissionFileEndpoint {
  url: string;
  token: string;
}
export type NativeEvent = { type: string; data: Record<string, unknown> };
export type NativeConfiguration = {
  runId: string;
  warm?: { sessionId: string; checkpointId: string | null; toolFingerprint: string };
  harness: HarnessName;
  model: string;
  provider: string;
  prompt: string;
  instructions?: string;
  attachments?: RunAttachment[];
  workspace: string;
  stateHome: string;
  gatewayURL: string;
  toolURL: string;
  token: string;
  deadline: string;
  resumeId?: string;
  toolGrants: boolean;
  permissions?: PermissionLayers;
};
export type NativeResult = {
  output: string;
  resumeId?: string;
  outcome: 'success' | 'failure' | 'cancelled' | 'timed_out';
  failureCode?: string;
};
export type HarnessContext = {
  configuration: NativeConfiguration;
  signal: AbortSignal;
  emit: (event: NativeEvent) => Promise<void>;
  ask: (id: string, question: string, details: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Ephemeral checked-file service, owned by the native worker; never persisted. */
  fileTools?: PermissionFileEndpoint;
  /** Validated images, prepared once by the worker, mapped by native adapters. */
  images?: { mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string }[];
};
export interface HarnessAdapter {
  run(context: HarnessContext): Promise<NativeResult>;
  close?(): void | Promise<void>;
}
