import type { components } from '../../contracts/api';
type Schema = components['schemas'];
type FileResult = {
  workspace_id: string;
  checkpoint_id: string;
  revision: string;
  path: string;
  previous_path?: string;
  entry?: Schema['FileEntry'];
};
export type OperationResults = {
  file_write: FileResult;
  file_delete: FileResult;
  file_rename: FileResult;
  file_duplicate: FileResult;
  folder_create: FileResult;
  workspace_create: { workspace_id: string; project_id: string };
  workspace_delete: { workspace_id: string; project_id: string };
  project_archive: { project_id: string };
  workspace_restore: { workspace_id: string; checkpoint_id: string; revision: string };
  checkpoint_create: { workspace_id: string; checkpoint_id: string };
  checkpoint_export: {
    checkpoint_id: string;
    format: 'portable_archive' | 'git_bundle';
    download_url: string;
    expires_at: string;
    size_bytes: string;
    sha256: string;
    manifest_url: string;
    manifest_sha256: string;
    export_commit?: string;
    source_commit?: string;
  };
  transfer_pull: { workspace_id: string; transfer_id: string; local_receipt_complete: boolean };
  transfer_push: { workspace_id: string; transfer_id: string; revision: string; checkpoint_id: string };
  git_sync: { workspace_id: string; checkpoint_id?: string; sync?: Schema['GitSync'] };
  webhook_replay: { delivery_id: string; status?: 'delivered' | 'exhausted' };
};
export type OperationKind = keyof OperationResults;
type OperationAuthority = {
  scope: 'files:read' | 'projects:read' | 'webhooks:read';
  binding: 'project' | 'workspace' | 'checkpoint' | 'organization';
};
/** Adding an operation requires an explicit authorization decision. Names never
 * determine permissions, and unknown operations have no default authority. */
export const operationAuthority = {
  file_write: { scope: 'files:read', binding: 'workspace' },
  file_delete: { scope: 'files:read', binding: 'workspace' },
  file_rename: { scope: 'files:read', binding: 'workspace' },
  file_duplicate: { scope: 'files:read', binding: 'workspace' },
  folder_create: { scope: 'files:read', binding: 'workspace' },
  workspace_create: { scope: 'projects:read', binding: 'workspace' },
  workspace_delete: { scope: 'projects:read', binding: 'workspace' },
  project_archive: { scope: 'projects:read', binding: 'project' },
  workspace_restore: { scope: 'files:read', binding: 'workspace' },
  checkpoint_create: { scope: 'files:read', binding: 'workspace' },
  checkpoint_export: { scope: 'files:read', binding: 'checkpoint' },
  transfer_pull: { scope: 'files:read', binding: 'workspace' },
  transfer_push: { scope: 'files:read', binding: 'workspace' },
  git_sync: { scope: 'files:read', binding: 'workspace' },
  webhook_replay: { scope: 'webhooks:read', binding: 'organization' },
} as const satisfies Record<OperationKind, OperationAuthority>;
