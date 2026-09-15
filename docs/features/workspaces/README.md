# Worktrees, files, and Git

Keep a project's files across runs. Each worktree has an independent working folder and a selected Git branch, with verified checkpoints for recovery.

## Organize work

A project groups related worktrees. Start with its main worktree, then create another from an authorized Git ref or checkpoint for independent work. Only one active writer can modify a workspace. A local CLI link selects remote context; it does not upload your directory.

## Name a worktree

The dashboard calls project workspaces **worktrees**. The API keeps `/workspaces` resource paths and always addresses a worktree by its ID. In **Create worktree**, Name and Branch are optional:

| Name | Branch | Result |
| --- | --- | --- |
| Provided | Empty | Use the name and create a Git-safe branch derived from it. |
| Empty | Provided | Use the branch as the display name; select it if it exists, otherwise create it. |
| Provided | Provided | Use both values. |
| Empty | Empty | Keep both unset until the first accepted agent run, then derive them from the task. |

Names must be unique within a project, ignoring case and surrounding spaces. Two independently named worktrees can use the same branch. Advanced options can require a new or existing branch. The branch picker lists saved refs from authorized project worktrees; it does not fetch GitHub on every keystroke.

For customer-owned assistants, follow [customer-agent identity](../customer-agents/README.md) and the [optional memory starter](../customer-agents/memory.md).

## Share files between agents

Point different agents at the same workspace and wait for each run to finish persistence before starting the next. They share saved files while keeping separate conversations. Follow the [shared-workspace guide](shared-agents.md) for a complete example and parallel-work alternatives.

## Browse and edit files

Open a project in the dashboard to browse, search, preview, edit, upload, and download files. Existing files autosave after two seconds without typing; **Saved** confirms persistence and refresh. Creating a file or folder remains explicit. Hover a file for its menu: copy name, copy relative path, duplicate, rename, or delete. Rename edits inline; Enter commits and Escape cancels. Drag a file onto a folder (or the root) to move it. Duplicate and move preserve the original content and file mode, and reject occupied destinations. Folders can be expanded independently, and search finds files across the workspace. Saves create a new persisted revision. During active execution, file views use the last published revision rather than a live mutable filesystem.

Empty folders are kept by a conventional `.gitkeep` file, visible inside them when **Show hidden files** is enabled. Keep that marker if the folder needs to survive after its other files are removed. Markers persist through checkpoints and restores, and follow ordinary Git ignore rules. Renaming a file preserves its bytes and executable mode and refuses an existing destination.

Writes compare the revision you read with current state. A stale revision returns 412; an active writer returns 409. Refresh and reconcile changes before saving again.

| Operation            | Limit                                                   |
| -------------------- | ------------------------------------------------------- |
| Direct file request  | 4 MiB                                                   |
| Text preview         | 1 MiB                                                   |
| Staged file transfer | 25 MiB per file                                         |
| Transfer plan        | 1,000 files and 250 MiB total; expires after 30 minutes |

CLI push and pull are explicit, version-checked transfers. Preview with `--dry-run`; ignored files and deletions require opt-in. See the [CLI guide](../cli/README.md).

## Edit Markdown

Markdown opens in **Rich** with a Tiptap formatting toolbar: body text, headings, bold, italic, strike, bullet/numbered/task lists, quotes, links, image references, code blocks, tables, collapsible sections, and undo/redo. **Source** edits the Markdown directly. **Preview** retains the reading outline, file links, front matter, tables, and copyable code. **Changes** shows a rich or source diff against the last confirmed save; it clears as autosave confirms the draft. Extensionless files containing Markdown headings also offer these views.

Front matter is preserved. Documents containing raw HTML or footnotes use the safe reading view in Rich and remain editable in Source, so unsupported syntax is not silently discarded. Images stay explicit references and never load external content automatically.

## Read files from your application

Retrieve a complete persisted file by workspace ID and relative path through the [file-read API and SDK guide](read-files.md). Wait for run persistence before fetching an agent's edits.

## Compare revisions

The diff API lists changed paths between checkpoints. Inline text patches are available when both versions together are smaller than 512,000 bytes (500 KiB) and contain no binary marker. Larger files are identified from checkpoint metadata without loading their contents; binary classification is `null` when not inspected. File downloads remain available separately.

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
