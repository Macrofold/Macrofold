import type { components } from '../../contracts/api';
type Schema = components['schemas'];
type FileResult = {
  worktree_id: string;
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
  worktree_create: { worktree_id: string; workspace_id: string };
  worktree_delete: { worktree_id: string; workspace_id: string };
  workspace_archive: { workspace_id: string };
  worktree_restore: { worktree_id: string; checkpoint_id: string; revision: string };
  checkpoint_create: { worktree_id: string; checkpoint_id: string };
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
  transfer_pull: { worktree_id: string; transfer_id: string; local_receipt_complete: boolean };
  transfer_push: { worktree_id: string; transfer_id: string; revision: string; checkpoint_id: string };
  git_sync: { worktree_id: string; checkpoint_id?: string; sync?: Schema['GitSync'] };
  webhook_replay: { delivery_id: string; status?: 'delivered' | 'exhausted' };
};
export type OperationKind = keyof OperationResults;
type OperationAuthority = {
  scope: 'files:read' | 'workspaces:read' | 'webhooks:read';
  binding: 'workspace' | 'worktree' | 'checkpoint' | 'organization';
};
/** Adding an operation requires an explicit authorization decision. Names never
 * determine permissions, and unknown operations have no default authority. */
export const operationAuthority = {
  file_write: { scope: 'files:read', binding: 'worktree' },
  file_delete: { scope: 'files:read', binding: 'worktree' },
  file_rename: { scope: 'files:read', binding: 'worktree' },
  file_duplicate: { scope: 'files:read', binding: 'worktree' },
  folder_create: { scope: 'files:read', binding: 'worktree' },
  worktree_create: { scope: 'workspaces:read', binding: 'worktree' },
  worktree_delete: { scope: 'workspaces:read', binding: 'worktree' },
  workspace_archive: { scope: 'workspaces:read', binding: 'workspace' },
  worktree_restore: { scope: 'files:read', binding: 'worktree' },
  checkpoint_create: { scope: 'files:read', binding: 'worktree' },
  checkpoint_export: { scope: 'files:read', binding: 'checkpoint' },
  transfer_pull: { scope: 'files:read', binding: 'worktree' },
  transfer_push: { scope: 'files:read', binding: 'worktree' },
  git_sync: { scope: 'files:read', binding: 'worktree' },
  webhook_replay: { scope: 'webhooks:read', binding: 'organization' },
} as const satisfies Record<OperationKind, OperationAuthority>;
