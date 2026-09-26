# Native runtime and durable execution

This guide owns the native execution path, its persistence and security boundaries, and the separation between durable Runs and replaceable compute. The [Worker architecture](../../architecture/worker-execution.md) defines the public compute contract; [verification](workers/verification.md) separates source/runtime evidence from hosted acceptance.

## One execution identity across retries

Claude Code still uses one official Agent SDK adapter. Named subscription configurations select future authentication, not another harness. Subscription runs currently fail closed before launch; see [named connection boundaries](../../engineering/testing/named-connections.md).

The database admits a run and commits an outbox record in the same transaction. The Next.js transport dispatches that outbox after responding; a scheduled maintenance route repairs missed dispatches. Vercel Workflow advances a small domain state machine. Workflow arguments contain organization and run identifiers, not credentials, prompts, or file contents. Those remain in the application database and encrypted object store.

The phases are input preparation, machine provisioning, hydration, restore, launch, polling, snapshot indexing, chunk upload and verification, publication, and cleanup. A database phase lease fences concurrent dispatchers. Automatic compute uses a private Host for one Run; an explicit Worker can have several Hosts and many concurrent assignments. Provider allocation names are internal. Every Run has a protected control directory and assignment identity. The native supervisor creates a non-removable atomic execution marker before launching a harness. A lost launch acknowledgement can cause a second launch request, but the marker prevents the prompt from executing twice. Unknown external tool outcomes are recorded as unknown and are not silently replayed.

The Vercel adapter deliberately calls `Sandbox.get({name, resume: false})`, checks the original session identifier, and performs I/O through `currentSession()`. High-level Sandbox I/O can resume a stopped machine. Session-bound I/O avoids that behavior. A stopped or replaced VM is a recovery condition. The platform does not resume an agent merely to inspect its status. [SDK reference](https://vercel.com/docs/sandbox/sdk-reference)

## Startup latency and measurement

Ready phases advance without an artificial timer in both Workflow and the standalone SQL worker. Pending restore checks still wait three seconds, active execution polls every two seconds, and contention/failure backoff remains explicit. A completed native process drains its remaining transcript immediately. Every advance retains the existing phase lease; Workflow still hands off after 128 advances to bound history. See [waiting and history limits](workflow-history.md).

[Hydration](../../../packages/core/src/execution-hydration.ts) stages up to 32 restore objects and 4 MiB of decoded data in one provider call. Up to four object-store reads run concurrently; all are drained before propagating a failure. Chunk hashes and sizes are verified before upload. The byte cap accommodates one full checkpoint chunk and both compute adapters. For 32 small chunks that fit the cap, this replaces 32 provider lookups/uploads and eight hydration passes with one upload/pass.

SQL marks a batch processed only after the provider acknowledges the entire upload. A failed or ambiguous upload retries the same immutable paths; it cannot skip partially written objects or launch before restoration verifies the checkpoint. Larger batches can retransmit more bytes after a failure, bounded by the same 4 MiB cap. Restore format, atomic file publication, native launch markers, reservations and recovery snapshots are unchanged.

`runs.execution_binding.phaseTimings` stores bounded, internal per-phase measurements: epoch-millisecond `startedAt`/`completedAt`, accumulated `activeMs`, and `attempts`. Active time covers phase work and caught failures, excluding phase-lease acquisition and the final state write. Wall time includes waits between attempts; killed attempts that never persist their final state are not counted. Existing run `created_at`/`started_at` measure queue-to-claim time. Provision includes Host acquisition and preparation; launch measures dispatch acknowledgement, not the first model token. These measurements contain no prompts, paths or credentials and do not add public API fields or analytics events.

Runs use automatic isolated compute by default. Explicit [Workers](workers.md) retain capacity and compatible native harnesses according to their settings. A compatible live hit skips hydration and initialization while rotating Run capabilities. A cold harness can reuse clean authorized Worktree files while restoring only its Session continuation. Hidden Git and native history files are eligible for persistence; authentication exclusions remain separate. Model processing and network time still apply, so compare phase timings and real first-response latency rather than treating warmth as a latency guarantee.

## Worker and Host lifecycle

`core/src/workers.ts` owns Worker permissions, settings, desired state and accepted economic contracts. `worker-reconciler.ts` scales and drains internal Hosts under finite limits; `host-allocations.ts` owns transactional slots, writer claims, immutable prices and generation-fenced assignment history. `contracts/host-control.ts` defines the private provider-neutral protocol. The public Worker is never bound to one Worktree or Session.

`AutomaticMachines` gives ordinary Runs one isolated allocation without creating a customer-visible Worker. `WorkerMachines` adapts an explicit assignment to the same machine port. Docker, Vercel and Render implementations live behind the existing provider boundary. Their credentials, transport objects and lifecycle details do not become public Run parameters.

Pause records desired state immediately, stops new admissions and drains active assignments. Idle sleep may release Hosts without pausing the Worker; new demand can wake that Worker. Destroy retires the target, cancels queued work and drains active work, with explicit force cancellation available. Cleanup retains ownership even after a Run becomes terminal. Release of funds waits for confirmed provider shutdown, not merely a deletion request.

The root Host controller has keyed Run/Worktree operations and multiple native handles. Each handle has its own process identity and paths; lifecycle operations coordinate only where necessary. Clean authorized Worktree materializations and live native handles are independent caches. Restore, capture, credentials and cleanup remain assignment-scoped. Generation checks, boot IDs and bounded tombstones reject stale requests.

Successful durable publication supplies the exact checkpoint identity used to release a materialization as clean. Failed persistence quarantines that Worktree rather than destroying unrelated Runs. Native process loss or an incompatible configuration causes a verified cold restore, not silent conversation replacement. Host-local unpublished bytes remain at risk until persisted.

[Worker operations](workers/operations.md) explains pricing, maintenance and provider limitations; [verification](workers/verification.md) records actual execution evidence.

## Runtime image and process isolation

`infra/runtime.Dockerfile` builds a Linux image with Node.js 24, Git, Python, ripgrep, and pinned native harness packages. Codex uses its app-server JSON-RPC protocol; Claude Code uses the official Agent SDK; OpenCode uses its official SDK and server. Hermes embeds the pinned upstream Python agent core; DeepSeek uses its minimal profile with the official agent create/resume APIs; Pi uses its official coding-agent SDK. The production configuration requires a VCR image digest. The image must be built for `linux/amd64` and reach VCR's Ready state. Sandbox does not execute a Docker image's CMD or ENTRYPOINT automatically; the adapter explicitly starts the supervisor. [Custom images](https://vercel.com/docs/sandbox/concepts/images)

The Host controller assigns each native handle a distinct unprivileged OS identity without sudo rights. A handle can outlive one Run only as a bounded warm cache; active authorization still belongs to the current Run. Native processes receive a sanitized environment and a short-lived capability restricted to their run, lease, deadline, model and approved connection grants. Vendor model keys, database credentials, object-store credentials and Composio credentials stay in the control plane. The sandbox network policy permits the application gateway and reviewed package/repository domains; operators can configure additional domains.

The Vercel firewall API rejects IPv6 CIDR entries. The adapter sends private/loopback/link-local IPv4 denies and disables IPv6 on existing and future VM interfaces with root-owned sysctl settings before writing the run configuration. Failure to apply those settings stops preparation before native launch; the unprivileged agent cannot re-enable IPv6. The application and reviewed-domain allowlist remains in force. A bounded staging probe verified the provider rejection, successful IPv4 provisioning, and removal of IPv6 interface addresses after the sysctl command.

The supervisor owns a protected control directory. The controller assigns Worktree, native-state, temporary and control roots instead of sharing one global mutable home or workspace. The public Session abstraction does not require a universal filesystem path: each adapter restores the ID, files, or both that it needs. Before capture, the supervisor quiesces only the current handle and its tool descendants, including daemonized descendants under that identity. Cancellation and timeouts still enter the capture path. An agent failure is independent from persistence success.

Trusted shared Runs have separate process identities, directory permissions and scoped cleanup; this is not a hostile-code isolation guarantee. Current isolated offerings use an exclusive environment for one Run and retire it rather than reusing it for another principal. Resource admission includes memory headroom, a bounded native process population, periodic memory observation and evictable warm caches. Do not describe these controls as per-Run kernel CPU quotas or cross-customer physical packing.

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

Native session files include `.hermes`, `.dsh/sessions` and `.pi/agent/sessions`, as well as the hidden state used by OpenCode, Claude and Codex. Capture preserves required local continuation state, including dot-prefixed paths; a native conversation ID alone does not substitute for missing local history. Temporary gateway/MCP configuration and recognized authentication files are excluded before capture and rejected on restore; they are rebuilt for each admitted run. Capability-bearing config is separate from workspace files, Git and exports. This is not an authentication vault, and cannot hide a credential from tools running as the same OS user.

Pinned versions, image cost and release checks are recorded in [dependency review](../../engineering/dependencies.md) and [harness acceptance](../../engineering/testing/harnesses.md).

## Portable persistence

Portable checkpoints include ordinary and hidden files, Git metadata, adapter-native continuation state, and symbolic links. Recognized authentication paths remain excluded during capture and rejected on restore. Control-plane indexing preserves the same accepted entries rather than discarding hidden paths a second time. Symlinks are recorded without traversing them. Runtime sockets and FIFOs are excluded because they are process resources. Empty directories are not represented. Hard links restore as independent files with identical content. Restore creates ordinary files before links and rejects any entry that descends through a symlink, preventing a checkpoint from redirecting writes outside its restore root.

Files are split into 4 MiB content-addressed chunks. Each chunk is encrypted before object storage. An encrypted manifest records chunk hashes, complete file hash, size, mode and timestamp. The control plane verifies chunks and the complete file hash before atomically publishing a checkpoint. Large file verification streams chunks, bounding memory use. Public file transfer and editor limits remain separate from the internal checkpoint format.

The initial runtime limits are 10 GiB and 100,000 persistent file entries across worktree and native home. Exceeding a capture limit fails persistence explicitly. The last verified checkpoint stays available, automatic compute retains provider recovery state where supported; shared-Host failures quarantine only the affected materialization, and further writers are blocked until recovery or an explicit restore. Provider recovery snapshots expire after seven days by default; they are an emergency recovery mechanism, not the long-term source of truth. Successful portable publication permits VM and temporary snapshot cleanup.

Git data is stored separately from the dashboard's editable file collection. Native home state belongs to the session and is restored when that session continues. The same run model rate card is frozen at admission, so configuration changes cannot retroactively alter its retail token rates.

## Model and connector accounting

The model gateway supports the reviewed OpenAI Responses/chat, Anthropic Messages, and OpenRouter chat routes. It accepts text, client-executed tools, and bounded inline images for the reviewed combinations in the [media guide](../media/README.md). Documents are extracted inside the runtime before model dispatch. Hosted billable tools, other native media, remote file/image references and server-side conversation references remain rejected by this route. Before every upstream request it reserves a conservative token bound plus the remaining compute allowance. Streaming usage settles that reservation; a missing final usage frame remains explicitly provisional. BYOK never falls back to managed credentials.

Codex's client-executed `tool_search` declaration is allowed only with explicit `execution: "client"`; absent or server execution remains rejected. This enables native tool discovery without admitting provider-hosted billable search. The complete Docker journey exercises the pinned Codex declaration, and gateway tests cover both allowed and denied forms. [OpenAI client-executed tool search](https://developers.openai.com/api/docs/guides/tools-tool-search).

The runtime MCP broker presents only tools granted to both the session and the current connection owner/organization. It rechecks grants on execution, validates the tool schema, and records a tool invocation before calling the external service. Composio toolkit versions and retail call fees must be configured. Tool results are encrypted for replay. Native MCP request IDs are scoped to a run for idempotency; an ambiguous request cannot be retried as a new action automatically.

Automatic execution retains its Run-level compute reservation and quoted rate. Explicit Worker allocations have their own accepted rate, funding and meter lifecycle, including retained idle capacity for dedicated offers. They are not charged in full to every concurrent Run. Cumulative metering and final quiescent receipts settle independently; uncertain shutdown or missing final counters retain financial liability. Neither application quote nor local fixture settlement proves an actual provider invoice. R2 request/storage expense, native snapshots, Workflow events and connector subscription fees remain operator costs until the billing integration records their actual dimensions.

## Local Docker execution

The [Docker development guide](../../getting-started/local-development/docker.md) connects public API admission to the same persisted phases through `DockerMachines` and the standalone SQL worker. Local infrastructure remains separate from simulated inference. The adapter keeps owned container identity, protected supervisor state, scoped gateway credentials and independent encrypted checkpoints. Successful automatic Runs release their private allocations. Explicit Workers follow their baseline, idle, draining and expiration settings. Failed persistence retains or quarantines recoverable state without stopping neighboring assignments. Docker is trusted contributor compute; hosted isolation depends on the advertised offering and provider capabilities. See [architecture and acceptance](../../engineering/development-modes.md).

## Validation boundary

The native performance workload runs actual pinned Codex and Claude Code binaries in Docker with `--network none` against loopback model fixtures. It has demonstrated concurrent processes, warm reuse, and continuation in a fresh container; see the commit-scoped [evidence](workers/verification.md). The broader native test runners also exercise other harnesses, but their historical results are not a current Worker cutover pass. Local native tests run actual pinned binaries against a loopback mock model server. They exercise native protocol compatibility, tools, filesystem capture, portable restore, and session continuation without paid inference. Fault tests use a fake machine provider with real PostgreSQL and encrypted local object storage to test duplicate launch acknowledgements, failed-agent checkpoints and unavailable-machine recovery.

These tests do not prove Vercel account quotas, image acceptance, production egress/TLS behavior, provider model entitlements or real invoice reconciliation. The launch guide must include those operator checks and keep inference disabled until the operator chooses a budget for a paid smoke test.

## Built-in model catalog

The [model catalog guide](models.md) owns discovery, compatibility, pricing, refresh and operator commands. Model configuration is bundled with the application and cached in PostgreSQL; routine availability changes do not require environment edits. Accepted runs keep their own prices, and reconciliation never substitutes a current catalog price.

## Large model request transport

Native adapters share a per-handle loopback bridge in `packages/runtime/src/model-transport.ts`. Small requests preserve the existing gateway route; requests above 4 MiB stage authenticated ciphertext in private object storage and send a short-lived claim to the same metering gateway. Streaming responses, current actor checks and financial settlement remain unchanged. The complete request is capped at 8 MiB. See [media transport decisions](../media/implementation.md) for encryption, cleanup and deployment requirements.

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

The [observability integration](../observability/README.md) captures model calls at the gateway, surfaced harness/tool events, lifecycle timings and final run results. Its independent exporter receives shared tenant/workspace/worktree/customer attribution and separate compute charges; no tracing credentials enter an execution Host. See [ownership and lifecycle](../observability/implementation.md).

## Resident harness ownership

The Host controller owns a bounded collection of live harness handles, independently from HostRun turn ownership. A compatible follow-up can acquire an idle handle for the same Session. Session revision, Worktree checkpoint, permission view, harness configuration, model/grants and runtime compatibility fence reuse. Incompatible processes are stopped without discarding unrelated clean Worktree caches.

The loopback model/tool bridge captures the current Run capability on each request and rejects requests while idle. Capabilities, deadline, tracing identity and budget are refreshed for every turn. The root supervisor suspends retained native processes, terminates tool descendants and verifies quiescence before capture. Failed/cancelled turns discard their live handle; only published durable state can be resumed later.

Warm retention is bounded by idle expiry, process count and memory pressure. It can disappear after an external edit, configuration change, pause, process loss or Host replacement. Global placement currently uses persisted authorized Worktree materializations; a local compatible handle can accelerate a selected Host, but no durable global warm-process registry is required for correctness. See [Workers](workers.md) for the public contract.

