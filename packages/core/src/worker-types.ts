/** Resolved domain contracts; HTTP schemas and provider wire bindings have separate owners. */
export type WorkerCompute = 'server' | 'sandbox';
export type WorkerDesiredState = 'enabled' | 'paused' | 'destroyed';
export type WorkerInput = {
  compute?: WorkerCompute;
  dedicated?: boolean;
  isolate_runs?: boolean;
  region?: string;
  runtime?: string;
  size?: string | null;
  min_instances?: number;
  max_instances?: number;
  max_concurrency?: number;
  idle_timeout_seconds?: number | null;
  expires_at?: string | null;
  max_hourly_compute_cost_micro_usd?: string;
};
export type WorkerPolicyLimits = Readonly<{
  region: string;
  runtime: string;
  default_hourly_compute_cost_micro_usd: string;
  default_max_instances: number;
  max_instances: number;
  default_max_concurrency: number;
  max_concurrency: number;
}>;
export type WorkerSettings = Readonly<{
  compute: WorkerCompute;
  dedicated: boolean;
  isolate_runs: boolean;
  region: string;
  runtime: string;
  size: string | null;
  min_instances: number;
  max_instances: number | null;
  max_concurrency: number;
  idle_timeout_seconds: number | null;
  expires_at_ms: number | null;
  max_hourly_compute_cost_micro_usd: string;
}>;
export type WorkerIdentity = Readonly<{
  id: string;
  organization_id: string;
  desired_state: WorkerDesiredState;
  settings: WorkerSettings;
}>;
export type ResourceAllocation = Readonly<{ memory_mib: number; cpu_millis: number }>;
export type ComputePrice =
  | Readonly<{ kind: 'allocation'; hourly_micro_usd: string }>
  | Readonly<{ kind: 'resource'; cpu_hour_micro_usd: string; gib_hour_micro_usd: string }>;
/** An accepted, versioned quote, never a mutable price lookup during settlement. */
export type ComputeOffering = Readonly<{
  id: string;
  revision: string;
  compute: WorkerCompute;
  dedicated: boolean;
  isolate_runs: boolean;
  region: string;
  runtime: string;
  size: string;
  resources: ResourceAllocation;
  concurrency: number;
  max_host_lifetime_seconds: number | null;
  price: ComputePrice;
}>;
export type WorktreeMaterialization = Readonly<{
  worktree_id: string;
  revision: string;
  permission_view: string;
  state: 'clean' | 'active' | 'recovery_required';
}>;
export type WarmHarness = Readonly<{
  session_id: string;
  session_revision: string;
  compatibility_key: string;
  permission_view: string;
  worktree_id: string | null;
  worktree_revision: string | null;
  state: 'idle' | 'leased';
  reserved_memory_mib: number;
}>;
export type HostSnapshot = Readonly<{
  id: string;
  worker_id: string;
  organization_id: string;
  generation: number;
  status: 'provisioning' | 'ready' | 'draining' | 'stopped';
  billable: boolean;
  offering: ComputeOffering;
  occupied_slots: number;
  allocated: ResourceAllocation;
  retained_memory_mib: number;
  expires_at_ms: number | null;
  worktrees: readonly WorktreeMaterialization[];
  warm_harnesses: readonly WarmHarness[];
}>;
/** Construct only after authorization; callers cannot supply trusted cache fingerprints. */
export type RunDemand = Readonly<{
  run_id: string;
  resources: ResourceAllocation;
  execution_seconds: number;
  cleanup_seconds: number;
  worktree: Readonly<{ id: string; revision: string }> | null;
  session: Readonly<{ id: string; revision: string }> | null;
  permission_view: string;
  compatibility_key: string;
}>;
export type WorkerWaitReason =
  | 'worker_paused'
  | 'worker_destroyed'
  | 'worker_expired'
  | 'worker_concurrency'
  | 'worker_starting'
  | 'worker_instance_limit'
  | 'worker_cost_limit'
  | 'worker_lifetime'
  | 'compute_unavailable';
export type WorkerPlacement =
  | Readonly<{ action: 'place'; host_id: string; host_generation: number; reuse: 'warm' | 'files' | 'cold' }>
  | Readonly<{ action: 'provision'; offering: ComputeOffering }>
  | Readonly<{ action: 'wait'; reason: WorkerWaitReason }>;
