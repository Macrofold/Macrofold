# Hosted-agent terminal CLI

Status: implemented launch CLI, version 0.1.0. Local API, subprocess, tarball installation and POSIX PTY acceptance are recorded in [16-implementation-status.md](16-implementation-status.md). The CLI is a first-class client of the same API used by the dashboard and SDKs. It gives a Claude Code/Codex-like terminal experience while the agent, shell tools, models, files, and Git operations execute in the hosted workspace.

The command name agent below is an illustrative executable name, not a selected brand or published package. Distribution name, configuration directory, environment-variable prefix, and help branding are centralized release settings. No CLI internals depend on the repository codename.

## Technology and distribution

Use TypeScript and Node.js 24 LTS, oclif for command routing/flags/help/completions, Ink/React for the interactive terminal, and the generated TypeScript SDK plus maintained streaming helpers for HTTP. Use built-in readline for plain-terminal fallback. Keep HTTP/session state separate from Ink rendering so the same commands work over SSH, in CI, and with redirected output. [oclif](https://oclif.io/docs/introduction/), [Ink](https://github.com/vadimdemedes/ink)

The npm package targets macOS and Linux with Node 24, pinned dependencies and generated bash/zsh/fish/PowerShell completion text. Windows-specific ACL/install/terminal behavior is not yet accepted and must be verified before advertising Windows support. Test installation from the built tarball, not only source execution. Standalone bundled binaries and Homebrew are subsequent packaging work; the launch package requires Node. Publish release checksums and provenance where the registry supports it. The CLI never downloads or executes remote code merely to render a result.

## Core commands

| Command                                                               | Behavior                                                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| agent login [--profile NAME] [--host URL]                             | Browser/device authorization against a selected trusted service                                           |
| agent logout / whoami                                                 | Revoke local authorization where supported; inspect identity/organization                                 |
| agent project list / create / show                                    | Discover and manage authorized hosted projects                                                            |
| agent link PROJECT [--workspace ID]                                   | Associate the local directory with an existing remote project                                             |
| agent unlink                                                          | Remove local association without deleting remote data                                                     |
| agent worktree list / create NAME --from REF / use NAME / remove NAME | Manage and select remote isolated workspaces and branches                                                 |
| agent worktree checkout NAME --local PATH                             | Explicitly create a local Git worktree for review from an exported remote Git bundle                      |
| agent chat [--session ID]                                             | Open an interactive continuing remote-agent session                                                       |
| agent run PROMPT [--detach]                                           | Submit one prompt; stream and wait by default                                                             |
| agent run --prompt-file FILE                                          | Submit UTF-8 prompt file; use - for stdin                                                                 |
| agent run list / show ID / attach ID / cancel ID                      | Inspect, reconnect to, or cancel remote work                                                              |
| agent run input ID --request INPUT_ID --answer-file FILE              | Answer a waiting run without an interactive terminal                                                      |
| agent version                                                         | Print installed CLI/build version locally                                                                 |
| agent session list / resume ID                                        | Discover and continue hosted conversation history                                                         |
| agent files list / cat PATH / diff [--local]                          | Inspect remote checkpoint diffs; --local uses a dry-run transfer comparison with recorded local baselines |
| agent files push [PATH...] / pull [PATH...] [--dry-run]               | Explicit version-checked file transfer; no continuous sync                                                |
| agent checkpoint list / create / restore ID                           | Inspect or restore remote persistent state                                                                |
| agent git status / sync                                               | Inspect/retry remote Git synchronization                                                                  |
| agent connection list / add / authorize / tools                       | Configure the same authorized MCP/provider resources as the dashboard                                     |
| agent usage / config / doctor                                         | Inspect tenant usage, profiles, API compatibility, and non-billable diagnostics                           |

With no arguments in a TTY, agent opens chat using the selected profile/project; missing authorization or selection returns setup instructions. A non-TTY invocation prints help. The run topic reserves list/show/attach/cancel/input; use `agent run -- "list"` or --prompt-file when a literal prompt collides with a subcommand. The parser normalizes this convenience form before dispatching through oclif.

Global selection flags are --profile, --organization, --project, --workspace and --session. Execution flags include --harness, --model, --billing-mode, --provider-connection, --connection, --timeout and --max-cost. Local flags never increase server-enforced grants, account limits, or catalog capabilities. Running commands without an interactive terminal requires explicit selectors when a choice is ambiguous.

## Example user experience

```sh
agent login
agent project list
agent link research
agent worktree create weekly-report --from main --use
agent chat
agent run "Update the weekly report and save the supporting notes"
agent run "Investigate the failing tests" --detach
agent run attach RUN_ID
agent files diff
agent files pull notes/weekly.md --dry-run
```

Inside chat the header shows the selected workspace, branch, harness/model and session ID. The status line shows active or queued runs. A bounded terminal transcript streams assistant text, tool/event summaries and persistence outcomes. `/status` reads workspace state, `/connections` reads authorized connections and `/answer REQUEST_ID TEXT` answers an exposed native input request. Rich tool payloads and retained historical traces remain available through the dashboard/API; the terminal is a compact live view. The execution budget is supplied by `--max-cost` and remains enforced on the server.

Slash commands include /help, /status, /worktree, /model, /connections, /diff, /cancel, /detach, /new, /clear and /exit. /clear only clears the local view. /new opens a new conversation in the selected workspace. A harness change requires a new session; model changes apply only when allowed by the session's harness/catalog. The agent is never silently restarted locally.

## Login and local state

Register a public first-party OAuth CLI client without an embedded secret. Use Better Auth's OAuth device authorization integration: request a device/user code, display the verification URL/code, optionally open the browser, and poll the token endpoint at the server-provided interval. Handle authorization_pending, slow_down, expiration and denial. This works through SSH without a callback listener. Tokens have the customer API audience, not the admin MCP audience. [Better Auth CLI authorization](https://better-auth.com/docs/plugins/oauth-provider)

Default consent includes identity, offline access, projects/files/runs read and write, connections read, and usage read, capped by membership. Connection changes require the corresponding granted write scope; `agent login --scope connections:write` requests additional consent. `connection add` obtains secret fields through masked input or a protected stdin/file input, never a secret-valued argv flag. No operator scope is included. Use configurable short access-token lifetimes (initially 15 minutes) and revocable refresh grants (initially 30 days). Refresh access tokens automatically with a per-profile lock; replace rotated tokens atomically. Revocation/account removal is checked server-side on subsequent operations.

Store credentials in the user's private configuration directory with mode 0700 and a credentials file with mode 0600 on the supported POSIX systems. Windows ACL support remains a platform acceptance task. Tokens are plaintext within that protected file, not claimed to be encrypted. Refuse unsafe permissions rather than broadening access. Support an explicitly configured external credential helper later without requiring a small native keychain dependency at launch. Never place tokens in the project, process arguments, URLs, logs, or error reports. CI uses a scoped API key from an environment variable or --api-key-stdin; do not encourage --api-key SECRET arguments.

agent link writes a non-secret .agent/link.json containing schema version, approved profile name, organization/project/workspace IDs, and transfer baseline references. Add this local state to Git's local excludes when applicable. A checked-out link file is a hint, not authorization: resolve membership and project/workspace consistency, display context, and never send credentials to an origin specified by repository content. Hosts come from user-approved global profiles. Changing host requires explicit login/trust and exact origin matching.

Selector precedence: explicit flags, then linked directory, then an explicitly set global default. When a session is selected, its server-owned workspace/project/harness wins; contradictory selectors are errors. Resolve the nearest linked root without following a symlink outside the user's selected directory. Each local Git worktree has independent link/context state so changing one does not switch another terminal's remote workspace.

## Remote worktrees and optional local review

CLI worktree is the user-facing name for the existing remote Workspace entity: an independent clone, working directory and branch. Creating it does not create a local checkout or upload the current folder. --from accepts an authorized project branch/commit or verified checkpoint; absent --from uses the latest project target revision. Resolve and persist the exact source commit/checkpoint, never a moving symbolic ref alone. Only one executing writer owns a remote workspace at a time.

An explicit --local checkout exports a verified checkpoint as a Git bundle plus manifest, downloads it, verifies hashes, imports it into the linked local Git repository, and creates a normal local Git worktree. If there is no local repository, fail with instructions to create/link one; do not initialize unrelated directories implicitly. Refuse occupied paths and existing conflicting branches. Imported Git configuration/credential helpers/hooks are not executed; use an internal bundle ref and a new local branch. This requires exporting only versioned Git content; ignored private files remain remote unless separately pulled.

If a selected checkpoint contains permitted tracked/nonignored edits beyond its Git HEAD, the export task makes a review commit in its temporary clone and identifies both source_commit and export_commit in the manifest. It does not change the hosted branch or push that commit. Display that the checkout is a snapshot for review, establish transfer baselines from the verified manifest, and never present the old HEAD as including uncommitted files. New projects have local Git versioning even without GitHub.

Local editing is optional. No watcher, background rsync, remote filesystem mount, local shell agent, or arbitrary remote PTY is part of the launch CLI. The user explicitly pushes local changes before remote work and pulls results afterward, or uses Git. Future live synchronization can build on the same revision/transfer API without changing default data movement.

## Explicit file transfers

Push/pull first obtains a transfer plan using the remote base revision and a bounded local manifest of selected paths, sizes, and hashes. By default select tracked and nonignored files; exclude secret patterns, credential files, .git internals, and CLI local state. Including ignored files requires --include-ignored with explicit paths. Deletions require --delete and are absent by default.

The server checks ownership, quotas, path/symlink safety and writer availability, then issues scoped temporary upload/download URLs. No arbitrary destination host is accepted. Default limit is 1,000 files/250 MiB per transfer and 25 MiB per file; plans expire after 30 minutes. Transfer regular files only at launch; symlink/device/type conflicts require explicit resolution. Standalone local folders use explicit paths and the same exclusion rules; repository folders default to Git-tracked/nonignored selection. --dry-run prints paths/actions/conflicts and sends no file contents. --yes permits a reviewed noninteractive apply; without a TTY and without --yes, mutation needing a transfer confirmation fails rather than hanging.

Use the last transfer manifest for three-way conflict detection. If both local and remote changed a path since that baseline, return a conflict instead of overwriting. With no baseline, overwrite of an existing differing path is a conflict; users resolve/select paths explicitly. Pull downloads to temporary files, verifies hashes, rechecks local preconditions, and atomically replaces each authorized path. Report a resumable partial local apply if the process dies; do not pretend multi-file writes on a user's local filesystem are globally atomic.

Push stages all uploaded bytes separately, verifies them, then obtains a fenced workspace lease and compares the expected revision. Apply to a replacement workspace directory, persist a checkpoint, and switch the workspace revision atomically. Starting a run or another edit in between planning and applying returns stale_revision/workspace_busy. Upload retry does not apply twice; expiration removes abandoned staged objects. File transfer is not an agent run or model call, though actual hosted storage/compute used is accounted for.

## Streaming, reconnect, input and cancellation

Use GET /runs/{id}/stream with durable sequence IDs. Persist the last rendered cursor per run; reconnect with Last-Event-ID, exponential backoff/jitter and token refresh on authentication expiry. The server intentionally rotates an SSE connection after 55 seconds; clients reconnect seamlessly. Terminal closure, SSH disconnect, or API function recycling does not cancel remote execution. Cursor expiry falls back to retained history/result with an explicit gap notice.

During an active session, a new prompt is persisted as a queued follow-up using the session-message API with queue_if_busy=true. It receives a run ID immediately, appears as queued in dashboard/CLI, and executes FIFO after the workspace's active writer completes. Limit ten queued follow-ups per session; expire unstarted queued prompts after one hour with a failed outcome and `queue_expired` error code. Reserve budget at admission and release on queue expiration/cancellation. Queued prompts cannot change the active run's grant set. Native mid-turn steering is not assumed across all harnesses.

Explicit harness input requests are different from follow-up prompts: answer them using their input_request_id so the existing run can continue. In noninteractive mode, report waiting_for_input with run ID and exit code 4; the hosted run waits under its deadline and can be answered later through the CLI/dashboard/API.

First Ctrl-C during execution requests cancellation of that run and waits for acknowledgement while partial work is saved. A second Ctrl-C exits the terminal immediately, stating whether cancellation was acknowledged. /detach, Ctrl-D at an empty prompt, --detach and ordinary terminal disconnection leave remote work running. Cancelling an active run does not implicitly cancel already queued follow-ups; show their count and allow `agent run cancel QUEUED_RUN_ID` for each queued follow-up. Restore raw mode/cursor visibility on every exit path.

## Human and machine output

TTY uses Ink; --plain and TERM=dumb use line-oriented text. Respect NO_COLOR and --no-color; sanitize terminal control sequences from untrusted model/tool output, including OSC hyperlinks/clipboard escapes. Do not execute agent-suggested local commands or automatically open arbitrary result URLs.

--json uses the schema_version/command/ok/data-or-error/exit_code envelope defined in the command contract and outputs one final result envelope (or immediate run reference with --detach) on stdout, with progress only on stderr. --jsonl streams the normalized event envelope, one JSON object per line; no ANSI, spinners, banners or unsolicited telemetry appear on stdout. Plain non-TTY output prints final assistant text to stdout and progress to stderr. Stdin '-' is supported for prompts/files; reject an invocation that tries to consume stdin simultaneously as both a credential and a prompt. Preserve stable JSON schema versions and documented exit codes. [CLI design guidelines](https://clig.dev/)

Exit codes: 0 success/accepted detach; 1 execution failure; 2 invalid invocation/configuration; 3 authentication/authorization failure; 4 waiting for user input; 5 conflict; 6 insufficient credits/quota; 7 transport unavailable with remote status unknown; 8 timeout; 130 local interrupt/cancel. A transport failure is not reported as an agent failure. Include run/request IDs and a reconnect command without exposing credentials.

## API, metrics and acceptance

The implemented API includes GET /v1/me; user-scoped OAuth for existing customer resources; workspace source/ref selection and listing updates; GET/PATCH /v1/workspaces/{id}; GET /v1/workspaces/{id}/diff; POST/GET /v1/workspaces/{id}/transfers; GET /v1/transfers/{id}; POST /v1/transfers/{id}/apply; and POST /v1/checkpoints/{id}/exports for Git bundles/portable archives. Reuse existing runs/events/input/cancel, connections, usage and async operations. Version the CLI configuration and minimum API compatibility handshake.

Request metadata records client_type=cli and version; client-supplied attribution is descriptive, never proof of human activity. Device-authorized foreground CLI actions count as human product activity; API-key scripts count as service activity. Linking alone is local and does not inflate remote request/product metrics. Record successful CLI execution, remote workspace creation and completed transfers as existing business events with source attribution, not duplicate event families. Attach is request/transport activity; background reconnection never qualifies a person as active.

Acceptance uses real CLI subprocesses and Python's POSIX PTY module. It covers command/help contracts, local linking without upload, isolated workspaces, verified local Git checkout, explicit transfer and conflict handling, streaming/JSON output, session continuation, device authorization and token rotation/revocation. The PTY journey covers Ink rendering, prompt submission, queued follow-up, persistence, status and detach. Terminal escape/secret redaction and unsafe local path rejection have separate regressions. Windows and a full terminal-emulator matrix are not claimed tested. Package installation does not start a run. See the evidence record for exact commands and upstream fixture boundaries.

## API security and machine reference

The [machine-readable command contract](api/cli.json) maps every command to public operation IDs or explicitly local/OAuth protocol behavior. Its scopes, queues, stream rotation, transfer limits and exits must agree with [OpenAPI](api/openapi.json). Object-transfer/download requests never inherit the API Authorization header. GET /operations authorizes the underlying stored operation resource; possessing its ID does not grant content access.

## Queue and execution controls

`agent run "Investigate the failure" --timeout 1800 --queue-timeout 900 --scheduling interactive` caps execution at 30 minutes and the pre-start wait at 15 minutes. API background jobs default to a full day of queue tolerance. Attached CLI runs and chat default to interactive; `--detach` defaults to background. Either can explicitly select a class. Interactive work takes first consideration when a slot opens but never interrupts a running agent or bypasses an earlier writer in its workspace.

`agent run show RUN_ID --json` exposes under `data.run` `wait_seconds`, `waiting_reason`, `queue_expires_at`, `execution_deadline`, `scheduling_class` and `reserved_micro_usd`. Human streams show waiting updates every five seconds and the exact `agent run cancel RUN_ID` command. `agent run attach RUN_ID --jsonl` continues to emit durable events; inspect separately for transient queue observations. Expiry emits `run.failed` with `data.code=queue_expired`. It retains history and releases the reserved budget. The server enforces the current Starter/Pro/Scale runtime and account concurrency cap; run timeouts cannot override a plan. [Complete policy](25-scheduling.md).
