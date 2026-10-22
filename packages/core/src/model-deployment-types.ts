import type { components } from '../../contracts/api';
type Schema = components['schemas'];
export type ModelDeploymentCapabilities = Schema['ModelDeploymentCapabilities'];
export type DeploymentSource = Schema['ModelDeploymentSource'];
export type DeploymentRuntime = Schema['ModelDeploymentRuntime'];
export type DeploymentHosting = Schema['ModelDeploymentHosting'];
export type DeploymentPolicy = Schema['ModelDeploymentServicePolicy'];
export type DeploymentTarget = {
  deployment_id: string;
  deployment_revision_id: string;
  endpoint_connection_id: string | null;
  credential_connection_id?: string;
  provider_resource_id?: string;
  endpoint_url: string;
  model_alias: string;
  capabilities: ModelDeploymentCapabilities;
};
export type DeploymentRow = {
  id: string;
  organization_id: string;
  owner_subject_id: string;
  name: string;
  desired_state: 'running' | 'stopped';
  desired_revision_id: string;
  serving_revision_id: string | null;
  state: Schema['ModelDeployment']['state'];
  policy: DeploymentPolicy | null;
  accepted_rates: DeploymentRates | null;
  generation: string;
  retired: boolean;
  ready_replicas: number | null;
  observed_at: Date | null;
  failure_code: string | null;
  next_check_at: Date | null;
  lease_id: string | null;
  lease_until: Date | null;
  failure_attempts: number;
  startup_at: Date | null;
  drain_started_at: Date | null;
  created_at: Date;
  updated_at: Date;
};
export type DeploymentRevisionRow = {
  id: string;
  organization_id: string;
  deployment_id: string;
  source: DeploymentSource;
  runtime: DeploymentRuntime;
  hosting: DeploymentHosting;
  capabilities: ModelDeploymentCapabilities;
  source_evidence: Record<string, unknown>;
  created_at: Date;
};
export type DeploymentRates = {
  hourly_micro_usd: string;
  gpu_hourly_micro_usd: string;
  disk_hourly_micro_usd: string;
  observed_at: string;
};
export type DeploymentResourceRow = {
  id: string;
  organization_id: string;
  deployment_id: string;
  revision_id: string;
  connection_id: string;
  attempt_id: string;
  provider_id: string | null;
  endpoint_url: string | null;
  secret_ciphertext: string;
  cleanup_secret_ciphertext: string | null;
  config: Record<string, unknown>;
  accepted_rates: DeploymentRates;
  state: 'creating' | 'ambiguous' | 'starting' | 'ready' | 'stopping' | 'deleted' | 'cleanup_pending';
  created_at: Date;
  stopped_at: Date | null;
  deleted_at: Date | null;
  observed_at: Date | null;
  cost_checked_at: Date | null;
  last_error: string | null;
};
export type GpuOffer = {
  pool: string;
  id: string;
  name: string;
  memory_bytes: string;
  hourly_micro_usd: string | null;
  region_ids: string[];
};
export type ServingObservation = {
  id: string;
  endpoint_url: string;
  ready_replicas: number;
  workers: { id: string; pool: string | null; started_at: string | null; stopped_at: string | null }[];
  config: Record<string, unknown>;
};
export interface ModelHostingProvider {
  catalog(secret: string): Promise<GpuOffer[]>;
  create(secret: string, config: Record<string, unknown>): Promise<{ id: string; endpoint_url: string }>;
  inspect(secret: string, providerId: string): Promise<ServingObservation | null>;
  findAttempt(secret: string, attemptId: string): Promise<{ id: string; endpoint_url: string }[]>;
  update(secret: string, providerId: string, config: Record<string, unknown>): Promise<void>;
  delete(secret: string, providerId: string): Promise<void>;
  costs(
    secret: string,
    providerId: string,
    start: string,
    end: string,
  ): Promise<{ start: string; end: string; micro_usd: string }[]>;
}
