# Persistent workspaces, checkpoints and Git

Contributor reference. Start with the [feature guide](README.md) for user workflows.

## User model

A project owns independent workspaces. A workspace is a complete filesystem and Git clone with one active writer. A session belongs to a workspace and retains native harness state; a run is one bounded execution in that session. Parallel work starts in another workspace/branch from a verified checkpoint or Git ref. A local CLI link only records selection and does not upload files. Persistent projects are the default; explicitly ephemeral projects reject continuation that would imply retained working files.

Connect an existing repository using the GitHub App or explicit file transfers. Project instructions remain ordinary customer files and cannot change platform grants or funding policy.

## Storage implementation

`packages/providers/src/storage.ts` implements an encrypted object-store boundary, with a private local filesystem implementation for development and S3-compatible R2 in production. Files are content-addressed per organization; large files use 4 MiB chunks plus an encrypted manifest. Envelopes use authenticated encryption and a versioned key ID. Object addresses, vault keys and provider credentials are absent from public file schemas.

Checkpoints preserve regular files, ignored files, safe symlink objects, executable modes, Git objects/refs and compatible native home state. Sockets/devices/FIFOs and injected long-lived credentials are excluded. Empty directories and shared hard-link identity are not represented; hard links restore as equal independent files. Native home state is private session content, not editable dashboard project files.

This replaces the proposed per-workspace restic repositories. The benefit is direct bounded file browsing and one verified representation shared by local and cloud execution. The cost is application-owned manifest validation, reachability and garbage collection; those have dedicated corruption, symlink, retention, concurrency and restore tests. R2 and provider snapshots are independent copies. A provider snapshot is a seven-day emergency recovery cache, not the durable project filesystem.

## Publication and restore

Editor saves, accepted transfers and completed runs publish verified checkpoints. The runtime supervisor stops the agent UID's process tree before final capture, including daemonized descendants. Cloud steps page the snapshot, upload bounded chunks, verify complete hashes and atomically publish the database pointer. Checkpoint retry never reruns the prompt. The capture envelope is 10 GiB and 100,000 file entries across workspace and native home.

Editing or uploading replacement content preserves an existing regular file's mode, including its executable bit in Git. Replacing a symlink with an ordinary file does not inherit the symlink's permissions.

There is no promise of a periodic live application-consistent filesystem snapshot. While a run writes, the dashboard reads the last published file revision; native events show activity. The final checkpoint is quiescent. Catastrophic VM loss can lose changes since the last published checkpoint, and the run reports that recovery condition. An unreadable VM is not automatically resumed to populate a UI table.

Restore takes the workspace lock, refuses an active writer, preserves the current revision and switches only after verification. It restores files before symlinks and rejects children under symlinks. A restored checkpoint does not rewrite GitHub history or automatically resume a task. Native continuation requires a compatible harness session format. Switching harness families starts a new conversation over the preserved files.

## Files and transfers

The dashboard lists paginated file paths with server-side substring search, sizes and revisions, supports text editing with CodeMirror, uploads and downloads, and exposes checkpoints/restore. User HTML is never executed as a same-origin preview. Direct file requests are limited to 4 MiB; previews are bounded to 1 MiB. Staged transfer limits are 25 MiB per file, 1,000 files and 250 MiB per plan. Runtime internal checkpoints can be larger.

Mutations require the observed workspace revision (`If-Match` or a body revision). Stale edits return 412; a busy writer returns 409. Push plans compare local, baseline and remote hashes; unknown baseline differs from known absent. Conflicts receive no destructive capability. PUT staging binds exact size/type/object identity; application publication verifies SHA-256. Raw staging has TLS/provider encryption until verified content is application-encrypted. The operator configures exact-origin R2 CORS and one-day staging expiration.

Pull uses local preconditions and atomic per-file replacement; partial application is reported honestly. Symlink ancestors, traversal, reserved metadata paths and ambiguous platform filenames are rejected by the CLI. Deletion and ignored-file inclusion are explicit. Dry run produces a plan without upload grants. Plans expire after 30 minutes. Browser/CLI/API all use the same services.

Exports produce a standard Git bundle or `workspace/` plus a separate root `manifest.json` in a portable tar archive. User `manifest.json` cannot overwrite export metadata. Confined relative symlinks retain their identity; escaping links fail export. Public exports expose authorized project content, not vault keys or arbitrary session credentials. The internal database/object restore preserves native sessions; the customer archive is a project-file export, not a universal conversation migration format.

## Git implementation and synchronization

`isomorphic-git` maintains ordinary compatible objects and refs in trusted temporary directories; native agents use system Git in their own sandbox. Initial workspace creation, file saves, transfers and finalization create Git revisions where valid. `.gitignore` controls publication, not independent filesystem persistence. Safe metadata import excludes hooks, alternates, arbitrary config and metadata symlinks. Trusted maintenance never executes customer checkout filters or hooks.

Git work is capped at 250 MiB tracked content, 250 MiB metadata and 100,000 entries/objects. Submodule gitlinks can persist, but recursive fetch and LFS hydration are explicit native work. Optional GitHub access uses both current user repository write permission and selected-repository App authorization; installation IDs alone prove nothing. Installation credentials stay in the control plane and never appear in persisted remotes.

After a verified run, automatic publication (when enabled) queues a separate job carrying its source revision. Under a project integration lock, fetch the current target, merge normally in an independent clone and push without force. A concurrent remote change causes bounded refetch/reconciliation. Conflicts, protected branches, revoked App access and exhausted retries leave source files/history available. Draft PR is a separate explicit sync mode. Clean merge does not prove semantic correctness; repository protection/checks remain authoritative.

Incoming GitHub pushes are signed hints. Receipts are deduplicated transactionally; notifications coalesce and the worker fetches actual remote state. Optional incoming fetch/merge waits while a workspace writes. Revocation blocks queued sync, and restoration of upstream access requires explicit reconnection. Git sync success and run success are separate UI/API fields.

A CLI local review uses a verified exported Git bundle and creates an actual local Git worktree without running checkout filters. It rejects existing destinations, unsafe manifest metadata and case-insensitive path collisions. It does not silently merge into the user's current checkout.

## Retention, quotas and deletion

Keep all checkpoints for 24 hours, one daily for 30 days and one weekly for 12 weeks, plus pins, current/base and recent-run references. Physical encrypted objects deduplicate within an organization. Destructive maintenance takes an exclusive tenant storage lock, skips active work, traverses all retained references and defers deletion for incomplete graphs. Unreferenced objects wait fourteen days before bounded collection.

Starter includes 1 GiB, Pro 10 GiB, and Scale 50 GiB. Overage is disabled until an owner explicitly enables it with a monthly budget and prepaid credit. Storage is metered from completed physical-byte observations and charged at $0.10/GiB per fixed 30-day month. Provider snapshots/raw staging are excluded from the customer meter. Already admitted work can overshoot during preservation; subsequent runs/uploads/writes stop when measured allowance or budget is exhausted. Downloads and recovery remain possible.

Archival is reversible. Permanent project deletion needs an owner/admin, exact name and recent browser authentication or password confirmation. It requests cancellation, pauses admission and allows seven days to undo. After that period and idle execution, maintenance purges project/session/result references while retaining accounting identities. Object collection follows its independent fourteen-day delay. Detailed run content expires after 30 days for Starter and 90 days for Pro/Scale; terminal status, sequence and accounting survive. Provider/database backups expire according to the operator's separately disclosed policy.

Independent recovery requires **database + all referenced encrypted objects + retained vault keys**, not a database dump alone. The fresh-install test rehearses a real PostgreSQL dump/restore into another database, separately copied objects, file hash reads and native-session fixture continuation. Production backup pairing and PITR are specified in the launch guide.
