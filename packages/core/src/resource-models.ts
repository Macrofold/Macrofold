import type { components } from '../../contracts/api';
import type { Principal } from './auth';
import type { OperationKind, OperationResults } from './operations';
import type { FileRecord } from './files';
type Schema = components['schemas'];
type Fields<K extends keyof Schema> = Omit<Schema[K], 'id' | 'organization_id' | 'created_at' | 'revision'>;

export type GitState = {
  files: FileRecord[];
  git_files: FileRecord[];
  git_commit?: string;
  git_status: 'ready' | 'attention';
  git_error?: string | null;
};
type SavedFiles = Partial<GitState>;

/** Persisted fields are explicit, including private state that is never part of an
 * API response. Public response projection remains the HTTP boundary's job. */
export type ResourceModels = {
  projects: Omit<Fields<'Project'>, 'connections'> & {
    target_branch?: string;
    deleted?: boolean;
    deletion_prior_archived?: boolean;
  };
  workspaces: Fields<'Workspace'> &
    SavedFiles & {
      recovery_run_id?: string;
      source_ref?: string;
      base_checkpoint_id?: string;
      sync?: Schema['GitSync'];
    };
  agents: Omit<Fields<'Agent'>, 'connections'>;
  sessions: Fields<'Session'> & {
    project_id: string;
    instructions?: string;
    config?: Schema['SessionCreate'];
    permission_fingerprint?: string;
    run_permissions?: Schema['AgentPermissions'];
    resume_state?: string;
    native_session_id?: string;
    state_files?: FileRecord[];
  };
  connections: Fields<'Connection'> & {
    secret_ciphertext?: string | null;
    headers_ciphertext?: string | null;
    environment_ciphertext?: string | null;
    oauth_ciphertext?: string | null;
    access_organization_wide: boolean;
    access_tools: string[];
    access_version: string;
    args?: string[];
    external_account_id?: string | null;
    provider_subject_id?: string;
    authorization_attempt_id?: string | null;
    identity_verified?: boolean;
    cleanup_status?: 'pending' | 'retrying' | 'revoked' | 'manual_revocation_required';
    last_error?: string | null;
  };
  checkpoints: Fields<'Checkpoint'> &
    SavedFiles & { project_id: string; label?: string; created_by?: string };
  artifacts: Fields<'Artifact'> & { key: string; project_id: string; workspace_id?: string };
  webhooks: Fields<'Webhook'> & {
    secret_ciphertext: string;
    previous_secret_ciphertext?: string;
    previous_secret_expires_at?: string;
  };
  deliveries: Fields<'Delivery'> & {
    payload: string;
    operation_id?: string;
    replay_of?: string;
    replay_operation_id?: string;
    completed_at?: string | null;
    error_code?: string | null;
  };
  operations: Omit<Fields<'Operation'>, 'kind' | 'result' | 'error'> & {
    kind: OperationKind;
    result: OperationResults[OperationKind];
    required_scopes: string[];
    error?: Schema['ErrorDetail'];
    mode?: 'push' | 'pull' | 'pull_request';
    source_run_id?: string;
    github_notification?: boolean;
    actor?: Pick<Principal, 'id' | 'userId' | 'kind' | 'oauthTokenId' | 'projectIds'>;
    expires_at?: string;
  };
  transfers: Fields<'Transfer'> & {
    project_id: string;
    principal_id: string;
    files?: FileRecord[];
    snapshot_files?: FileRecord[];
    uploads?: Record<string, string>;
    staged?: Record<string, Pick<FileRecord, 'key' | 'sha256' | 'size_bytes'>>;
  };
};

export type ResourceMetadata = {
  id: string;
  organization_id: string;
  created_at: string;
  revision: string;
  deleted?: boolean;
  project_id?: string;
  workspace_id?: string;
};
export type Document<K extends keyof ResourceModels> = ResourceMetadata & ResourceModels[K];
