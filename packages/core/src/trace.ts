/** Completed observations cross process boundaries by durable identity, never by
 * credentials or an in-memory active span. Exporters are diagnostics, not a ledger. */
export type TraceContext = {
  organization_id: string;
  run_id: string;
  workspace_id: string | null;
  worktree_id: string | null;
  session_id: string | null;
  user_id: string;
  customer_id?: string;
  customer_binding_id?: string;
  agent_key?: string;
  workspace_name?: string;
  worktree_name?: string;
  agent_id?: string | null;
  agent_version?: number | null;
  task_id?: string;
  application_namespace?: string;
  actor_id?: string;
  definition_revision?: string;
  run_kind: string;
  harness?: string;
  provider?: string;
  model: string;
  billing_mode: string;
  client_type?: string;
};
export type TraceObservation = {
  context: TraceContext;
  /** Stable identity within the run, including on recovery/replayed delivery. */
  id: string;
  name: string;
  type: 'agent' | 'generation' | 'tool' | 'retriever' | 'event';
  startedAt: Date;
  endedAt: Date;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  level?: 'DEFAULT' | 'WARNING' | 'ERROR';
  model?: string;
  usage?: { input: number; output: number; cached: number; cacheWrite: number; complete: boolean };
  /** Only the charge represented by this observation. Never repeat totals on parents. */
  chargedMicroUsd?: string;
  firstOutputAt?: Date;
};
export interface TraceSink {
  record(observation: TraceObservation): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
