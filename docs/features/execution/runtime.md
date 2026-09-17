# Native runtime and durable execution

This document records the implementation decisions made while validating the production execution path. It supplements the architecture and portability plans.

## One execution identity across retries

Claude Code still uses one official Agent SDK adapter. Named subscription configurations select future authentication, not another harness. Subscription runs currently fail closed before launch; see [named connection boundaries](../../engineering/testing/named-connections.md).

The database admits a run and commits an outbox record in the same transaction. The Next.js transport dispatches that outbox after responding; a scheduled maintenance route repairs missed dispatches. Vercel Workflow advances a small domain state machine. Workflow arguments contain organization and run identifiers, not credentials, prompts, or file contents. Those remain in the application database and encrypted object store.

The phases are input preparation, machine provisioning, hydration, restore, launch, polling, snapshot indexing, chunk upload and verification, publication, and cleanup. A database phase lease fences concurrent workers. The named VM is `run-<run UUID>`. The native supervisor creates a non-removable atomic execution marker before launching a harness. A lost launch acknowledgement can cause a second launch request, but the marker prevents the prompt from executing twice. Unknown external tool outcomes are recorded as unknown and are not silently replayed.

The Vercel adapter deliberately calls `Sandbox.get({name, resume: false})`, checks the original session identifier, and performs I/O through `currentSession()`. High-level Sandbox I/O can resume a stopped machine. Session-bound I/O avoids that behavior. A stopped or replaced VM is a recovery condition. The platform does not resume an agent merely to inspect its status. [SDK reference](https://vercel.com/docs/sandbox/sdk-reference)

## Runtime image and process isolation

`infra/runtime.Dockerfile` builds a Linux image with Node.js 24, Git, Python, ripgrep, and pinned native harness packages. Codex uses its app-server JSON-RPC protocol; Claude Code uses the official Agent SDK; OpenCode uses its official SDK and server. Hermes embeds the pinned upstream Python agent core; DeepSeek uses its minimal profile with the official agent create/resume APIs; Pi uses its official coding-agent SDK. The production configuration requires a VCR image digest. The image must be built for `linux/amd64` and reach VCR's Ready state. Sandbox does not execute a Docker image's CMD or ENTRYPOINT automatically; the adapter explicitly starts the supervisor. [Custom images](https://vercel.com/docs/sandbox/concepts/images)

The root supervisor starts the native worker as UID 10001, without sudo rights. Native processes receive a sanitized environment and a short-lived capability restricted to their run, lease, deadline, model and approved connection grants. Vendor model keys, database credentials, object-store credentials and Composio credentials stay in the control plane. The sandbox network policy permits the application gateway and reviewed package/repository domains; operators can configure additional domains.

The Vercel firewall API rejects IPv6 CIDR entries. The adapter sends private/loopback/link-local IPv4 denies and disables IPv6 on existing and future VM interfaces with root-owned sysctl settings before writing the run configuration. Failure to apply those settings stops preparation before native launch; the unprivileged agent cannot re-enable IPv6. The application and reviewed-domain allowlist remains in force. A bounded staging probe verified the provider rejection, successful IPv4 provisioning, and removal of IPv6 interface addresses after the sysctl command.

The supervisor owns a protected control directory. Native state lives in `/agent-home`; user files live in `/workspace`. Before capture, the supervisor terminates processes belonging to the agent UID, including daemonized descendants. This separates a quiescent checkpoint from a copy made while agents are still writing. Cancellation and timeouts still enter the capture path. An agent failure is independent from persistence success.

Claude Code always receives the SDK's `claude_code` system-prompt preset, including when a run has no custom instructions. The adapter appends the persistent workspace path and explains that `/tmp` and other paths outside the workspace are excluded from project checkpoints, then appends any run instructions. The SDK's minimal default omits project context; setting the process working directory alone does not give the model that context. This guidance does not constrain unrestricted shell access or prove that a requested file exists: verify the published workspace contents separately from successful execution. See [the SDK prompt contract](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts).

All six adapters implement the [universal permission policy](permissions.md) through native tool restrictions and shared checked file tools. Native configuration is controller-owned; Codex profiles and temporary MCP endpoints are rebuilt on continuation, while native conversation state remains portable.

OpenCode server startup allows up to 30 seconds, capped by the remaining run deadline, and receives the run's cancellation signal. The SDK's default five-second startup window proved insufficient in the local native fixture on a busy host. This allowance does not retry prompt execution.

The runtime emits normalized output deltas, tool events, lifecycle metadata and provider-exposed reasoning summaries. It does not export private chain-of-thought blocks. Each event has a producer sequence; the database assigns the public durable sequence and deduplicates repeated ingestion. The supervisor writes bounded JSONL records and the cloud poller resumes by byte offset. Large tool payloads and oversized traces are explicitly marked as truncated.

## Harness adapters

Native adapters implement the **Unified Harness Interface (UHI)** through `HarnessAdapter` in `packages/runtime/src/types.ts`. The [UHI guide](unified-harness-interface.md) owns the shared contract and contributor workflow; this section describes harness-specific integration decisions.

`packages/contracts/harnesses.ts` owns the six harness identifiers and display metadata. Admission, CLI choices, dashboard controls and native dispatch use that registry; OpenAPI and all five generated SDKs carry matching enums, checked deterministically. The [public comparison](harnesses.md) describes supported model routes and tools.

Hermes runs the official Python `AIAgent` through a private JSONL bridge. Continuation explicitly loads active conversation history from `SessionDB`, including compaction ancestry. Its selected model and auxiliary compression calls use the run's gateway capability. The native tool-discovery bridge exposes granted MCP tools; unrelated upstream web providers and remote terminal backends are not enabled.

DeepSeek runs the unmodified `sdk-minimal` profile with a small driver plugin calling the official agent registry's create/resume methods. The upstream convenience SDK's named `run()` creates sessions and cannot reopen a persisted session in another process. Embedding the existing registry preserves native persistence without replacing its execution loop. Unrestricted runs include persistent Bash and the editor, with explicit gateway/MCP plugins; guarded runs disable those tool producers and use checked file tools; it does not enable the upstream web UI, job scheduler, subagents or independent model credentials. Committed assistant messages and tool events become the existing normalized events; private reasoning stays private.

Pi uses `createAgentSession`, the official `SessionManager`, in-memory runtime credentials, and a single gateway model registration. Local package extensions and automatic model discovery are disabled. Granted broker tools become Pi custom tools; discovery/authentication failures abort startup and tool failures retain error semantics. Missing requested sessions fail instead of starting fresh.

Hermes and DeepSeek share only their private process framing/cleanup helper. The existing supervisor still owns cancellation, deadlines, execution identity, process-tree shutdown and capture for every harness. No scheduler, hosting provider or public streaming system was added.

Native session files persist in `.hermes`, `.dsh/sessions` and `.pi/agent/sessions`. Temporary gateway/MCP configuration and recognized authentication files are excluded before capture and rejected on restore; they are rebuilt for each admitted run. Capability-bearing config is separate from project files, Git and exports. This is not an authentication vault, and cannot hide a credential from tools running as the same OS user.

Pinned versions, image cost and release checks are recorded in [dependency review](../../engineering/dependencies.md) and [harness acceptance](../../engineering/testing/harnesses.md).

## Portable persistence

The portable checkpoint includes regular files and symbolic links, including ignored files, Git's internal state and native session files. Symlinks are recorded without traversing them. Runtime sockets and FIFOs are excluded because they are process resources. Empty directories are not represented. Hard links restore as independent files with identical content. Restore creates ordinary files before links and rejects any entry that descends through a symlink, preventing a checkpoint from redirecting writes outside its restore root.

Files are split into 4 MiB content-addressed chunks. Each chunk is encrypted before object storage. An encrypted manifest records chunk hashes, complete file hash, size, mode and timestamp. The control plane verifies chunks and the complete file hash before atomically publishing a checkpoint. Large file verification streams chunks, bounding memory use. Public file transfer and editor limits remain separate from the internal checkpoint format.

The initial runtime limits are 10 GiB and 100,000 persistent file entries across workspace and native home. Exceeding a capture limit fails persistence explicitly. The last verified checkpoint stays available, the VM recovery snapshot is retained, and further writers are blocked until recovery or an explicit restore. Provider recovery snapshots expire after seven days by default; they are an emergency recovery mechanism, not the long-term source of truth. Successful portable publication permits VM and temporary snapshot cleanup.

Git data is stored separately from the dashboard's editable file collection. Native home state belongs to the session and is restored when that session continues. The same run model rate card is frozen at admission, so configuration changes cannot retroactively alter its retail token rates.

## Model and connector accounting

The model gateway supports the reviewed OpenAI Responses/chat, Anthropic Messages, and OpenRouter chat routes. It accepts text and client-executed tools. Hosted billable tools, media and server-side conversation references require separately reviewed accounting and are rejected by this route. Before every upstream request it reserves a conservative token bound plus the remaining compute allowance. Streaming usage settles that reservation; a missing final usage frame remains explicitly provisional. BYOK never falls back to managed credentials.

Codex's client-executed `tool_search` declaration is allowed only with explicit `execution: "client"`; absent or server execution remains rejected. This enables native tool discovery without admitting provider-hosted billable search. The complete Docker journey exercises the pinned Codex declaration, and gateway tests cover both allowed and denied forms. [OpenAI client-executed tool search](https://developers.openai.com/api/docs/guides/tools-tool-search).

The runtime MCP broker presents only tools granted to both the session and the current connection owner/organization. It rechecks grants on execution, validates the tool schema, and records a tool invocation before calling the external service. Composio toolkit versions and retail call fees must be configured. Tool results are encrypted for replay. Native MCP request IDs are scoped to a run for idempotency; an ambiguous request cannot be retried as a new action automatically.

The published compute rate currently covers the run's configured execution window. Bounded provisioning and checkpoint recovery overhead beyond that window is borne by the platform; it must be included in margin estimates and observed operationally. This is deliberately distinct from claiming the provider invoice has been measured. R2 request/storage expense, native snapshots, Workflow events and connector subscription fees remain operator costs until the billing integration records their actual dimensions.

## Local Docker execution

The [Docker development guide](../../getting-started/local-development/docker.md) connects public API admission to the same persisted phases through `DockerMachines` and the standalone SQL worker. Local infrastructure remains separate from simulated inference. The adapter keeps owned container identity, protected supervisor state, scoped gateway credentials and independent encrypted checkpoints. Successful runs remove their containers; failed persistence retains a stopped recovery layer. Docker is trusted contributor compute, while production retains Vercel microVM isolation. See [architecture and acceptance](../../engineering/development-modes.md).

## Validation boundary

The local native tests run actual pinned binaries in Docker with `--network none` against a loopback mock model server. They exercise native protocol compatibility, tools, filesystem capture, portable restore, and session continuation without paid inference. Fault tests use a fake machine provider with real PostgreSQL and encrypted local object storage to test duplicate launch acknowledgements, failed-agent checkpoints and unavailable-machine recovery.

These tests do not prove Vercel account quotas, image acceptance, production egress/TLS behavior, provider model entitlements or real invoice reconciliation. The launch guide must include those operator checks and keep inference disabled until the operator chooses a budget for a paid smoke test.

## Built-in model catalog

The [model catalog guide](models.md) owns discovery, compatibility, pricing, refresh and operator commands. Model configuration is bundled with the application and cached in PostgreSQL; routine availability changes do not require environment edits. Accepted runs keep their own prices, and reconciliation never substitutes a current catalog price.
