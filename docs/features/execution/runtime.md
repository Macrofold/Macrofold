# Native runtime and durable execution

This document records the implementation decisions made while validating the production execution path. It supplements the architecture and portability plans.

## One execution identity across retries

Claude Code still uses one official Agent SDK adapter. Named subscription configurations select future authentication, not another harness. Subscription runs currently fail closed before launch; see [named connection boundaries](../../engineering/testing/named-connections.md).

The database admits a run and commits an outbox record in the same transaction. The Next.js transport dispatches that outbox after responding; a scheduled maintenance route repairs missed dispatches. Vercel Workflow advances a small domain state machine. Workflow arguments contain organization and run identifiers, not credentials, prompts, or file contents. Those remain in the application database and encrypted object store.

The phases are input preparation, machine provisioning, hydration, restore, launch, polling, snapshot indexing, chunk upload and verification, publication, and cleanup. A database phase lease fences concurrent workers. Default VMs use `run-<run UUID>`; reusable compute has a separate sandbox identity and a per-run control directory. The native supervisor creates a non-removable atomic execution marker before launching a harness. A lost launch acknowledgement can cause a second launch request, but the marker prevents the prompt from executing twice. Unknown external tool outcomes are recorded as unknown and are not silently replayed.

The Vercel adapter deliberately calls `Sandbox.get({name, resume: false})`, checks the original session identifier, and performs I/O through `currentSession()`. High-level Sandbox I/O can resume a stopped machine. Session-bound I/O avoids that behavior. A stopped or replaced VM is a recovery condition. The platform does not resume an agent merely to inspect its status. [SDK reference](https://vercel.com/docs/sandbox/sdk-reference)

## Startup latency and measurement

Ready phases advance without an artificial timer in both Workflow and the standalone SQL worker. Pending restore checks still wait three seconds, active execution polls every two seconds, and contention/failure backoff remains explicit. A completed native process drains its remaining transcript immediately. Every advance retains the existing phase lease; Workflow still hands off after 128 advances to bound history. See [waiting and history limits](workflow-history.md).

[Hydration](../../../packages/core/src/execution-hydration.ts) stages up to 32 restore objects and 4 MiB of decoded data in one provider call. Up to four object-store reads run concurrently; all are drained before propagating a failure. Chunk hashes and sizes are verified before upload. The byte cap accommodates one full checkpoint chunk and both compute adapters. For 32 small chunks that fit the cap, this replaces 32 sandbox lookups/uploads and eight hydration passes with one upload/pass.

SQL marks a batch processed only after the provider acknowledges the entire upload. A failed or ambiguous upload retries the same immutable paths; it cannot skip partially written objects or launch before restoration verifies the checkpoint. Larger batches can retransmit more bytes after a failure, bounded by the same 4 MiB cap. Restore format, atomic file publication, native launch markers, reservations and recovery snapshots are unchanged.

`runs.execution_binding.phaseTimings` stores bounded, internal per-phase measurements: epoch-millisecond `startedAt`/`completedAt`, accumulated `activeMs`, and `attempts`. Active time covers phase work and caught failures, excluding phase-lease acquisition and the final state write. Wall time includes waits between attempts; killed attempts that never persist their final state are not counted. Existing run `created_at`/`started_at` measure queue-to-claim time. Provision includes sandbox creation and preparation; launch measures dispatch acknowledgement, not the first model token. These measurements contain no prompts, paths or credentials and do not add public API fields or analytics events.

Runs use disposable compute by default. Opt-in [reusable sandboxes](sandboxes.md) retain machines and compatible native harness sessions between runs. A live hit skips hydration and harness initialization while refreshing run credentials; a cold miss restores verified files. **Current limitation:** the dot-path checkpoint filter also excludes hidden native conversation state, so cold continuation can fail even though a live warm continuation succeeds. See the [recovery follow-up](../../maintainers/TODO.md#native-startup-failure-diagnostics). Model processing and network time remain, so compare phase timings and real first-response latency.

## Reusable sandbox lifecycle

`core/src/sandboxes.ts` owns tenant/workspace authorization, worktree affinity, concurrency, lifecycle leases, idle expiry and separate compute reservations. `contracts/sandbox-control.ts` defines the provider-neutral lifecycle and private control protocol. Admission selects Docker for both local modes, Vercel for hosted ordinary sandboxes and Render for hosted long-running servers. Local long-running containers have no provider lifetime cutoff; ordinary containers retain their bounded timeout. `providers/sandboxes.ts` constructs the selected adapter; provider-specific transport objects do not enter domain state beyond a small serialized binding. `SandboxMachines` adapts a borrowed environment to the existing run machine port.

A sandbox has one active run until cleanup, even after that run becomes terminal. Lifecycle operations reject active ownership. Docker pause (including long-running workers) and ordinary cloud pause delete physical compute; resume creates a new generation; Render pause suspends its service. Destroy retires the logical ID and never modifies durable checkpoints. Provider loss is replaceable only before preparation; run calls then require the original binding and root-control boot ID. Failed provider lookup never means absence.

The root control service serializes operations and uses per-run control directories with persistent execution/restore markers. Cold preparation clears worktree/home before verified hydration; compatible live sessions retain both. Capture suspends retained native processes and terminates other agent-UID writers. Release requires quiescence, removes run credentials and staging, and retains small tombstones rejecting late requests. A compatible next run continues the loaded native session. Failed persistence stops reuse and keeps the prior checkpoint authoritative; reusable compute does not yet retain a provider recovery-disk snapshot. The existing degraded-worktree recovery flow remains required.

[Server operations](sandboxes/operations.md) explains pricing, maintenance and provider limitations; [acceptance](sandboxes/verification.md) distinguishes local evidence from live checks.

## Runtime image and process isolation

`infra/runtime.Dockerfile` builds a Linux image with Node.js 24, Git, Python, ripgrep, and pinned native harness packages. Codex uses its app-server JSON-RPC protocol; Claude Code uses the official Agent SDK; OpenCode uses its official SDK and server. Hermes embeds the pinned upstream Python agent core; DeepSeek uses its minimal profile with the official agent create/resume APIs; Pi uses its official coding-agent SDK. The production configuration requires a VCR image digest. The image must be built for `linux/amd64` and reach VCR's Ready state. Sandbox does not execute a Docker image's CMD or ENTRYPOINT automatically; the adapter explicitly starts the supervisor. [Custom images](https://vercel.com/docs/sandbox/concepts/images)

The root supervisor starts the native worker as UID 10001, without sudo rights. Native processes receive a sanitized environment and a short-lived capability restricted to their run, lease, deadline, model and approved connection grants. Vendor model keys, database credentials, object-store credentials and Composio credentials stay in the control plane. The sandbox network policy permits the application gateway and reviewed package/repository domains; operators can configure additional domains.

The Vercel firewall API rejects IPv6 CIDR entries. The adapter sends private/loopback/link-local IPv4 denies and disables IPv6 on existing and future VM interfaces with root-owned sysctl settings before writing the run configuration. Failure to apply those settings stops preparation before native launch; the unprivileged agent cannot re-enable IPv6. The application and reviewed-domain allowlist remains in force. A bounded staging probe verified the provider rejection, successful IPv4 provisioning, and removal of IPv6 interface addresses after the sysctl command.

The supervisor owns a protected control directory. Native state lives in `/agent-home`; user files live in `/worktree`. Before capture, the supervisor terminates processes belonging to the agent UID, including daemonized descendants. This separates a quiescent checkpoint from a copy made while agents are still writing. Cancellation and timeouts still enter the capture path. An agent failure is independent from persistence success.

Claude Code always receives the SDK's `claude_code` system-prompt preset, including when a run has no custom instructions. The adapter appends the persistent worktree path and explains that `/tmp` and other paths outside the worktree are excluded from workspace checkpoints, then appends any run instructions. The SDK's minimal default omits workspace context; setting the process working directory alone does not give the model that context. This guidance does not constrain unrestricted shell access or prove that a requested file exists: verify the published worktree contents separately from successful execution. See [the SDK prompt contract](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts).

All six adapters implement the [universal permission policy](permissions.md) through native tool restrictions and shared checked file tools. Native configuration is controller-owned; Codex profiles and temporary MCP endpoints are rebuilt on continuation, while native conversation state remains portable.

OpenCode server startup allows up to 30 seconds, capped by the remaining run deadline, and receives the run's cancellation signal. The SDK's default five-second startup window proved insufficient in the local native fixture on a busy host. This allowance does not retry prompt execution.

The runtime emits normalized output deltas, tool events, lifecycle metadata and provider-exposed reasoning summaries. It forwards readable provider-exposed thinking separately from answer text, never encrypted reasoning, signatures or redacted blocks. The worker batches reasoning fragments through `reasoning-events.ts` before supervisor persistence. Each event has a producer sequence; the database assigns the public durable sequence and deduplicates repeated ingestion. The supervisor writes bounded JSONL records and the cloud poller resumes by byte offset. Large tool payloads and oversized traces are explicitly marked as truncated.

## Harness adapters

Native adapters implement the **Unified Harness Interface (UHI)** through `HarnessAdapter` in `packages/runtime/src/types.ts`. The [UHI guide](unified-harness-interface.md) owns the shared contract and contributor workflow; this section describes harness-specific integration decisions.

`packages/contracts/harnesses.ts` owns the six harness identifiers and display metadata. Admission, CLI choices, dashboard controls and native dispatch use that registry; OpenAPI and all five generated SDKs carry matching enums, checked deterministically. The [public comparison](harnesses.md) describes supported model routes and tools.

Hermes runs the official Python `AIAgent` through a private JSONL bridge. Continuation explicitly loads active conversation history from `SessionDB`, including compaction ancestry. Its selected model and auxiliary compression calls use the run's gateway capability. The native tool-discovery bridge exposes granted MCP tools; unrelated upstream web providers and remote terminal backends are not enabled.

DeepSeek runs the unmodified `sdk-minimal` profile with a small driver plugin calling the official agent registry's create/resume methods. The upstream convenience SDK's named `run()` creates sessions and cannot reopen a persisted session in another process. Embedding the existing registry preserves native persistence without replacing its execution loop. Unrestricted runs include persistent Bash and the editor, with explicit gateway/MCP plugins; guarded runs disable those tool producers and use checked file tools; it does not enable the upstream web UI, job scheduler, subagents or independent model credentials. Committed assistant messages and tool events become the existing normalized events; private reasoning stays private.

Pi uses `createAgentSession`, the official `SessionManager`, in-memory runtime credentials, and a single gateway model registration. Local package extensions and automatic model discovery are disabled. Granted broker tools become Pi custom tools; discovery/authentication failures abort startup and tool failures retain error semantics. Missing requested sessions fail instead of starting fresh.

Hermes and DeepSeek share only their private process framing/cleanup helper. The existing supervisor still owns cancellation, deadlines, execution identity, process-tree shutdown and capture for every harness. No scheduler, hosting provider or public streaming system was added.

Native session files live in `.hermes`, `.dsh/sessions` and `.pi/agent/sessions`. The current dot-path checkpoint filter excludes these directories, as well as OpenCode, Claude and Codex hidden session storage; native conversation IDs alone cannot restore that history. Temporary gateway/MCP configuration and recognized authentication files are excluded before capture and rejected on restore; they are rebuilt for each admitted run. Capability-bearing config is separate from workspace files, Git and exports. This is not an authentication vault, and cannot hide a credential from tools running as the same OS user.

Pinned versions, image cost and release checks are recorded in [dependency review](../../engineering/dependencies.md) and [harness acceptance](../../engineering/testing/harnesses.md).

## Portable persistence

The current portable checkpoint includes regular files and symbolic links except paths containing a dot-prefixed component. This excludes `.git` and hidden native session storage in addition to hidden worktree files; recognized authentication paths are independently excluded. The same filter runs during capture and control-plane indexing. Symlinks are recorded without traversing them. Runtime sockets and FIFOs are excluded because they are process resources. Empty directories are not represented. Hard links restore as independent files with identical content. Restore creates ordinary files before links and rejects any entry that descends through a symlink, preventing a checkpoint from redirecting writes outside its restore root.

Files are split into 4 MiB content-addressed chunks. Each chunk is encrypted before object storage. An encrypted manifest records chunk hashes, complete file hash, size, mode and timestamp. The control plane verifies chunks and the complete file hash before atomically publishing a checkpoint. Large file verification streams chunks, bounding memory use. Public file transfer and editor limits remain separate from the internal checkpoint format.

The initial runtime limits are 10 GiB and 100,000 persistent file entries across worktree and native home. Exceeding a capture limit fails persistence explicitly. The last verified checkpoint stays available, a default per-run VM recovery snapshot is retained (reusable servers stop without retaining a disk snapshot), and further writers are blocked until recovery or an explicit restore. Provider recovery snapshots expire after seven days by default; they are an emergency recovery mechanism, not the long-term source of truth. Successful portable publication permits VM and temporary snapshot cleanup.

Git data is stored separately from the dashboard's editable file collection. Native home state belongs to the session and is restored when that session continues. The same run model rate card is frozen at admission, so configuration changes cannot retroactively alter its retail token rates.

## Model and connector accounting

The model gateway supports the reviewed OpenAI Responses/chat, Anthropic Messages, and OpenRouter chat routes. It accepts text, client-executed tools, and bounded inline images for the reviewed combinations in the [media guide](../media/README.md). Documents are extracted inside the runtime before model dispatch. Hosted billable tools, other native media, remote file/image references and server-side conversation references remain rejected by this route. Before every upstream request it reserves a conservative token bound plus the remaining compute allowance. Streaming usage settles that reservation; a missing final usage frame remains explicitly provisional. BYOK never falls back to managed credentials.

Codex's client-executed `tool_search` declaration is allowed only with explicit `execution: "client"`; absent or server execution remains rejected. This enables native tool discovery without admitting provider-hosted billable search. The complete Docker journey exercises the pinned Codex declaration, and gateway tests cover both allowed and denied forms. [OpenAI client-executed tool search](https://developers.openai.com/api/docs/guides/tools-tool-search).

The runtime MCP broker presents only tools granted to both the session and the current connection owner/organization. It rechecks grants on execution, validates the tool schema, and records a tool invocation before calling the external service. Composio toolkit versions and retail call fees must be configured. Tool results are encrypted for replay. Native MCP request IDs are scoped to a run for idempotency; an ambiguous request cannot be retried as a new action automatically.

The published compute rate currently covers the run's configured execution window. Bounded provisioning and checkpoint recovery overhead beyond that window is borne by the platform; it must be included in margin estimates and observed operationally. This is deliberately distinct from claiming the provider invoice has been measured. R2 request/storage expense, native snapshots, Workflow events and connector subscription fees remain operator costs until the billing integration records their actual dimensions.

## Local Docker execution

The [Docker development guide](../../getting-started/local-development/docker.md) connects public API admission to the same persisted phases through `DockerMachines` and the standalone SQL worker. Local infrastructure remains separate from simulated inference. The adapter keeps owned container identity, protected supervisor state, scoped gateway credentials and independent encrypted checkpoints. Default successful runs remove their containers; explicitly reusable containers follow the sandbox idle policy. Failed persistence retains a stopped recovery layer. Docker is trusted contributor compute, while production retains Vercel microVM isolation. See [architecture and acceptance](../../engineering/development-modes.md).

## Validation boundary

The local native tests run actual pinned binaries in Docker with `--network none` against a loopback mock model server. They exercise native protocol compatibility, tools, filesystem capture, portable restore, and session continuation without paid inference. Fault tests use a fake machine provider with real PostgreSQL and encrypted local object storage to test duplicate launch acknowledgements, failed-agent checkpoints and unavailable-machine recovery.

These tests do not prove Vercel account quotas, image acceptance, production egress/TLS behavior, provider model entitlements or real invoice reconciliation. The launch guide must include those operator checks and keep inference disabled until the operator chooses a budget for a paid smoke test.

## Built-in model catalog

The [model catalog guide](models.md) owns discovery, compatibility, pricing, refresh and operator commands. Model configuration is bundled with the application and cached in PostgreSQL; routine availability changes do not require environment edits. Accepted runs keep their own prices, and reconciliation never substitutes a current catalog price.

## Large model request transport

Native adapters share a per-worker loopback bridge in `packages/runtime/src/model-transport.ts`. Small requests preserve the existing gateway route; requests above 4 MiB stage authenticated ciphertext in private object storage and send a short-lived claim to the same metering gateway. Streaming responses, current actor checks and financial settlement remain unchanged. The complete request is capped at 8 MiB. See [media transport decisions](../media/implementation.md) for encryption, cleanup and deployment requirements.

## Lightweight execution boundary

Runs are discriminated as `native_agent`, `inference` or `bounded_agent`. The lifecycle in this guide describes native execution. Lightweight dispatch happens before constructing a machine provider and never acquires a worktree writer or restores a conversation. It uses the same financial reservation, run observation and scheduler; [decision execution](../decisions/implementation.md) owns its invocation receipts and recovery. Capability gating must cover every dispatcher before admission is enabled.

## Execution tracing

Native worker exceptions emit a `runtime.failed` event before the terminal result.
The existing run Events tab, event API and Langfuse export include the harness,
last initialization/execution stage, allowlisted error category and safe message.
OpenCode distinguishes server startup, session creation, event subscription and
turn execution; other adapters share the worker's preparation/initialization and
ready-turn stages. Returned harness failures are marked `harness_reported_failure`.
The terminal `failure_code` remains unchanged. No new log store or per-stage
network call is introduced.

The shared diagnostic classifier permits known operating-system codes, bounded
cause inspection and recognized SDK errors. Unknown messages, stack traces and
raw stderr remain withheld because they can contain credentials and customer
content. Unknown errors still identify the failing stage; classification is not
a promise to preserve arbitrary SDK text. Diagnostics do not retry execution or
extend deadlines. Existing images need rebuilding to activate this behavior, and long-lived poller processes need restarting to load the corresponding event-ingestion code. Restart only an idle poller; a web preview or Docker-daemon restart is not required for this activation.

The [observability integration](../observability/README.md) captures model calls at the gateway, surfaced harness/tool events, lifecycle timings and final run results. Its independent exporter receives shared tenant/workspace/worktree/customer attribution and separate compute charges; no tracing credentials enter a sandbox. See [ownership and lifecycle](../observability/implementation.md).

## Resident harness ownership

The sandbox control process owns one resident worker. A compatible follow-up uses the same native conversation; session, configuration, grants and checkpoint identity fence reuse. A mismatch tears down the resident process before hydration. The shared loopback model/tool transport captures current run authorization for each request and rejects requests while idle. Model calls retain their existing staging, budget, trace and no-blind-retry behavior.

The root supervisor suspends retained native processes, terminates tool descendants and verifies stopped writers before snapshot capture. Failed/cancelled turns discard resident state. The next run must not reuse processes after an external file edit, restore, policy change, pause or native process loss. Sandbox release publishes the new checkpoint identity only after domain persistence succeeds. This is one loaded session per server, not a multi-session memory pool. See [reuse compute](sandboxes.md) for the public contract.
