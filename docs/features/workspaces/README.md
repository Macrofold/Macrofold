# Workspaces, files, and Git

Keep a project's files across runs. Each workspace has an independent working folder and Git branch, with verified checkpoints for recovery.

## Organize work

A project groups related workspaces. Start with its main workspace, then create another from an authorized Git ref or checkpoint for independent work. Only one active writer can modify a workspace. A local CLI link selects remote context; it does not upload your directory.

## Browse and edit files

Open a project in the dashboard to browse, search, preview, edit, upload, and download files. Saves create a new persisted revision. During active execution, file views use the last published revision rather than a live mutable filesystem.

Writes compare the revision you read with current state. A stale revision returns 412; an active writer returns 409. Refresh and reconcile changes before saving again.

| Operation            | Limit                                                   |
| -------------------- | ------------------------------------------------------- |
| Direct file request  | 4 MiB                                                   |
| Text preview         | 1 MiB                                                   |
| Staged file transfer | 25 MiB per file                                         |
| Transfer plan        | 1,000 files and 250 MiB total; expires after 30 minutes |

CLI push and pull are explicit, version-checked transfers. Preview with `--dry-run`; ignored files and deletions require opt-in. See the [CLI guide](../cli/README.md).

## Checkpoints and recovery

Completed persistence, editor saves, and accepted transfers publish verified checkpoints. Restore refuses an active writer and verifies the replacement before changing the current revision. It does not automatically resume an agent or rewrite GitHub history.

A catastrophic sandbox loss can lose edits since the last published checkpoint. Current files and compatible native conversation state persist separately from detailed run-history retention.

## Connect GitHub

Authorize the deployment's GitHub App for a repository you can access. Choose a target branch and synchronization behavior. Runs can queue a separate sync after their checkpoint is saved. Protected branches, conflicts, or revoked access can block a push while leaving your files available.

Git synchronization never force-pushes. Incoming synchronization waits for the workspace writer. Git LFS hydration and recursive submodule fetching are explicit native tasks rather than automatic imports.

## Retention and deletion

Checkpoints keep all revisions for 24 hours, then daily and weekly recovery points, with pins and required current references protected. Plan storage and detailed run-history allowances are described in [billing](../billing/README.md).

Archive a project to keep it without active work. Permanent deletion requires owner/admin confirmation and provides seven days to undo. Content removal follows that window and idle execution; physical object collection is delayed. Accounting records and provider backups have separate retention.

For technical limits, export formats, encryption, and recovery ownership, read [persistence implementation](implementation.md).
