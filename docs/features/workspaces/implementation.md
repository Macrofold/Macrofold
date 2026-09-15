# Persistent workspaces, checkpoints and Git

Contributor reference. Start with the [feature guide](README.md) for user workflows.

## User model

A project owns independent workspaces. A workspace is a complete filesystem and Git clone with one active writer. A session belongs to a workspace and retains native harness state; a run is one bounded execution in that session. Parallel work starts in another workspace/branch from a verified checkpoint or Git ref. A local CLI link only records selection and does not upload files. Persistent projects are the default; explicitly ephemeral projects reject continuation that would imply retained working files.

Connect an existing repository using the GitHub App or explicit file transfers. Project instructions remain ordinary customer files and cannot change platform grants or funding policy.

## Worktree identity and branches

The public Workspace entity remains ID-addressed. Its `name` and `branch` response fields may be null. `workspace-names.ts` owns display-name uniqueness, name-to-branch derivation, and authorized saved-ref discovery; provider code lists Git refs without loading repository objects. `GET /v1/projects/{id}/worktree-options?name=…&branch=…` returns the saved branch choices and advisory validation. POST creation repeats validation under the project lock. Explicit existing branches restore their saved tree; new branches retain the selected checkpoint ancestry.

`nameWorkspaceForRun` assigns an unnamed worktree a prompt-derived slug and collision suffix inside the first admission transaction, after validation and reservation. It makes no extra model call. Rejected admission rolls back naming. The same opaque ID, files, and sessions remain valid before and after assignment. The project lock precedes the workspace writer lock; concurrent admissions cannot publish two identities. Name-only creation derives a Git-safe branch; branch-only creation adopts that display name. Explicit new/existing modes enforce branch availability.

Migration `030_worktree_names.sql` replaces branch uniqueness with a case-insensitive, trimmed, non-deleted name index. Null names are excluded. This allows independent clones on the same branch while retaining name collision protection. Existing names and branches are preserved; a conflicting pre-migration name prevents the migration from completing and must be resolved explicitly before retrying. Forward recovery uses a corrective migration; do not drop the name constraint to bypass a conflict.

## Storage implementation

`packages/providers/src/storage.ts` implements an encrypted object-store boundary, with a private local filesystem implementation for development and S3-compatible R2 in production. Files are content-addressed per organization; large files use 4 MiB chunks plus an encrypted manifest. Envelopes use authenticated encryption and a versioned key ID. Object addresses, vault keys and provider credentials are absent from public file schemas.

Checkpoints preserve regular files, ignored files, safe symlink objects, executable modes, Git objects/refs and compatible native home state. Sockets/devices/FIFOs and injected long-lived credentials are excluded. Marker-free empty directories and shared hard-link identity are not represented; hard links restore as equal independent files. The folder creation API persists a conventional zero-byte `.gitkeep` regular file, so its parent directories survive the same checkpoints and restores as other project files. Native home state is private session content, not editable dashboard project files.

Known native authentication files, runtime configuration and Claude configuration backups are excluded before snapshot chunk creation and cloud transfer. Restore rejects an authentication entry before writing any files. This prevents ordinary credential persistence; it does not make a secret readable by the native UID safe from that UID's tools. Subscription login remains unavailable pending a separately isolated, approved authentication design.

This replaces the proposed per-workspace restic repositories. The benefit is direct bounded file browsing and one verified representation shared by local and cloud execution. The cost is application-owned manifest validation, reachability and garbage collection; those have dedicated corruption, symlink, retention, concurrency and restore tests. R2 and provider snapshots are independent copies. A provider snapshot is a seven-day emergency recovery cache, not the durable project filesystem.

## Publication and restore

Editor saves, accepted transfers and completed runs publish verified checkpoints. The runtime supervisor stops the agent UID's process tree before final capture, including daemonized descendants. Cloud steps page the snapshot, upload bounded chunks, verify complete hashes and atomically publish the database pointer. Checkpoint retry never reruns the prompt. The capture envelope is 10 GiB and 100,000 file entries across workspace and native home.

Editing or uploading replacement content preserves an existing regular file's mode, including its executable bit in Git. Replacing a symlink with an ordinary file does not inherit the symlink's permissions.

There is no promise of a periodic live application-consistent filesystem snapshot. While a run writes, the dashboard reads the last published file revision; native events show activity. The final checkpoint is quiescent. Catastrophic VM loss can lose changes since the last published checkpoint, and the run reports that recovery condition. An unreadable VM is not automatically resumed to populate a UI table.

Restore takes the workspace lock, refuses an active writer, preserves the current revision and switches only after verification. It restores files before symlinks and rejects children under symlinks. A restored checkpoint does not rewrite GitHub history or automatically resume a task. Native continuation requires a compatible harness session format. Switching harness families starts a new conversation over the preserved files.

## Files and transfers

The dashboard lists paginated file paths and expandable folders with server-side substring search, sizes and revisions, supports text editing with CodeMirror, uploads and downloads, and exposes checkpoints/restore. User HTML is never executed as a same-origin preview. Direct file requests are limited to 4 MiB; previews are bounded to 1 MiB. Staged transfer limits are 25 MiB per file, 1,000 files and 250 MiB per plan. Runtime internal checkpoints can be larger.

The dashboard autosaves existing files after a two-second debounce. Editor saves retain the visible draft and disable competing actions until the saved revision finishes refreshing. A failed refresh does not clear the draft. Background refreshes preserve unsaved text and its original revision so a stale save receives an explicit conflict.

`GET /v1/workspaces/{id}/files` preserves flat recursive listing by default. With `recursive=false`, it derives and deduplicates direct child directories under `path` before applying filters, cursor, and limit. Directory entries contain `path`, `type: directory`, and the workspace revision; file size and hash are omitted. Listing remains on the published manifest during active execution.

`POST /v1/workspaces/{id}/folders` accepts `{path}` and creates its `.gitkeep` marker. `PATCH /v1/workspaces/{id}/file?path=source` accepts `{new_path}` and renames one file or symlink without following links or copying its content object. `PUT /v1/workspaces/{id}/file?path=target&create_only=true` atomically rejects an existing file or directory rather than overwriting it. `POST /v1/workspaces/{id}/files/duplicate` accepts `{path,new_path}` and reuses the source content object and mode without a browser download. These operations take the existing workspace writer lock, reauthorize the resource, check `If-Match`, reject path collisions, verify a checkpoint, and publish the workspace revision in one database transaction. Folder deletion and folder renaming are not provided by these operations.

Successful direct mutations return the committed `revision`, `checkpoint_id`, and `path` in `Operation.result`; creation, save, folder creation, and rename also return the public `FileEntry`. Rename includes `previous_path`; deletion omits `entry`. This lets a client update the affected listing from authoritative results without an existence preflight or blocking on unrelated queries.

Mutations require the observed workspace revision (`If-Match` or a body revision). Stale edits return 412; a busy writer returns 409. Push plans compare local, baseline and remote hashes; unknown baseline differs from known absent. Conflicts receive no destructive capability. PUT staging binds exact size/type/object identity; application publication verifies SHA-256. Raw staging has TLS/provider encryption until verified content is application-encrypted. The operator configures exact-origin R2 CORS and one-day staging expiration.

Pull uses local preconditions and atomic per-file replacement; partial application is reported honestly. Symlink ancestors, traversal, reserved metadata paths and ambiguous platform filenames are rejected by the CLI. Deletion and ignored-file inclusion are explicit. Dry run produces a plan without upload grants. Plans expire after 30 minutes. Browser/CLI/API all use the same services.

Exports produce a standard Git bundle or `workspace/` plus a separate root `manifest.json` in a portable tar archive. User `manifest.json` cannot overwrite export metadata. Confined relative symlinks retain their identity; escaping links fail export. Public exports expose authorized project content, not vault keys or arbitrary session credentials. The internal database/object restore preserves native sessions; the customer archive is a project-file export, not a universal conversation migration format.

Diff pagination selects paths first. For each selected entry, combined checkpoint sizes must be below 512,000 bytes before either content object is read. Larger entries retain path/hash/change metadata and return `binary: null` without a patch. Small entries retain content verification and binary detection. This bounds content memory per selected diff entry; it does not make whole-workspace manifest indexing a streaming operation.

## Git implementation and synchronization

`isomorphic-git` maintains ordinary compatible objects and refs in trusted temporary directories; native agents use system Git in their own sandbox. Initial workspace creation, file saves, transfers and finalization create Git revisions where valid. `.gitignore` controls publication, not independent filesystem persistence. Safe metadata import excludes hooks, alternates, arbitrary config and metadata symlinks. Trusted maintenance never executes customer checkout filters or hooks.

Checkpoint maintenance reads and verifies imported Git metadata before use. If a resulting metadata file has identical bytes and belongs to the same organization, saving reuses its existing encrypted object instead of uploading history again. Changed metadata and the trusted replacement config are stored normally. This reduces object-store PUTs while preserving verification, history, and the storage maintenance fence; manifest and Git processing still scale with workspace size.

Git work is capped at 250 MiB tracked content, 250 MiB metadata and 100,000 entries/objects. Submodule gitlinks can persist, but recursive fetch and LFS hydration are explicit native work. Optional GitHub access uses both current user repository write permission and selected-repository App authorization; installation IDs alone prove nothing. Installation credentials stay in the control plane and never appear in persisted remotes.

After a verified run, automatic publication (when enabled) queues a separate job carrying its source revision. Under a project integration lock, fetch the current target, merge normally in an independent clone and push without force. A concurrent remote change causes bounded refetch/reconciliation. Conflicts, protected branches, revoked App access and exhausted retries leave source files/history available. Draft PR is a separate explicit sync mode. Clean merge does not prove semantic correctness; repository protection/checks remain authoritative.

Incoming GitHub pushes are signed hints. Receipts are deduplicated transactionally; notifications coalesce and the worker fetches actual remote state. Optional incoming fetch/merge waits while a workspace writes. Revocation blocks queued sync, and restoration of upstream access requires explicit reconnection. Git sync success and run success are separate UI/API fields.

A CLI local review uses a verified exported Git bundle and creates an actual local Git worktree without running checkout filters. It rejects existing destinations, unsafe manifest metadata and case-insensitive path collisions. It does not silently merge into the user's current checkout.

## Retention, quotas and deletion

Keep all checkpoints for 24 hours, one daily for 30 days and one weekly for 12 weeks, plus pins, current/base and recent-run references. Physical encrypted objects deduplicate within an organization. Destructive maintenance takes an exclusive tenant storage lock, skips active work, traverses all retained references and defers deletion for incomplete graphs. Unreferenced objects wait fourteen days before bounded collection.

Starter includes 1 GiB, Pro 10 GiB, and Scale 50 GiB. Overage is disabled until an owner explicitly enables it with a monthly budget and prepaid credit. Storage is metered from completed physical-byte observations and charged at $0.10/GiB per fixed 30-day month. Provider snapshots/raw staging are excluded from the customer meter. Already admitted work can overshoot during preservation; subsequent runs/uploads/writes stop when measured allowance or budget is exhausted. Downloads and recovery remain possible.

Archival is reversible. Permanent project deletion needs an owner/admin, exact name and recent browser authentication or password confirmation. It requests cancellation, pauses admission and allows seven days to undo. After that period and idle execution, maintenance purges project/session/result references while retaining accounting identities. Object collection follows its independent fourteen-day delay. Detailed run content expires after 30 days for Starter and 90 days for Pro/Scale; terminal status, sequence and accounting survive. Provider/database backups expire according to the operator's separately disclosed policy.

Independent recovery requires **database + all referenced encrypted objects + retained vault keys**, not a database dump alone. The fresh-install test rehearses a real PostgreSQL dump/restore into another database, separately copied objects, file hash reads and native-session fixture continuation. Production backup pairing and PITR are specified in the launch guide.

## Small file mutation preparation

Direct write, delete, rename, duplicate and folder creation use a read/prepare/commit path. A short tenant transaction authorizes the source revision and creates a bounded `storage_preparations` lease. Content verification and Git work run outside SQL. Unchanged verified payloads reuse their stored content and existing Git blob IDs. Publication reacquires the worktree writer lock, reauthorizes the actor, checks lease expiry, revision and storage capacity, then atomically saves the checkpoint, worktree and operation.

The lease protects unpublished objects from destructive storage maintenance; it does not serialize worktree writers. Existing tenant storage locks coordinate lease acquisition and publication with garbage collection. Expired preparations cannot publish, and stale concurrent preparations fail compare-and-swap. Idempotency replay is checked both before preparation and at commit. A failed preparation leaves the previous checkpoint available; unreferenced immutable objects remain eligible for normal garbage collection.

The document models in `packages/core/src/resource-models.ts` enumerate public and private persisted fields. Resource access requires a concrete table type. Operation results have an explicit kind/result map and authorization registry; their names do not determine authority.
