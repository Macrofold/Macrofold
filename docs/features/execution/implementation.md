# Agent runtime and public execution semantics

Contributor reference. Start with the [feature guide](README.md) for user workflows.

The API invokes an actual multi-turn harness, not one model completion. Harness and model are separate choices. The current native adapters are Codex app-server, Claude Agent SDK and OpenCode's authenticated local server/SDK. The exact versions are pinned in `packages/runtime/package.json`; the implementation details and provider-source references are in [17-runtime-implementation.md](runtime.md).

[Scheduling](scheduling.md) explains waiting and limits; [Workflow history](workflow-history.md) explains adaptive SQL waiting, bounded orchestration, recovery and deployment checks.

## Compatibility and catalog

Codex accepts reviewed OpenAI routes; Claude Code accepts reviewed Anthropic routes; OpenCode supports reviewed OpenAI/Anthropic/OpenRouter protocol mappings. This is not an all-to-all promise or support for every model a provider offers. `GET /v1/harnesses` and `/v1/models` describe configured choices. The local simulator presents `fixture-model`, labels its output and uses zero model tokens. Production never substitutes that model.

Each configured model has ID, display name, provider, allowed harnesses, enabled flag and retail input/output micro-USD per million. Configuration is validated, then frozen on admission with funding mode, deadline, maximum charge and connection grants. Unsupported hosted tools/media/passthrough endpoints are rejected because their liability is not covered by this gateway. Provider-exposed reasoning summaries can be shown; hidden chain-of-thought is neither reconstructed nor promised.

## Trust boundary and process supervision

The immutable Linux image contains Node 24, Python, Git, curl/ripgrep, three native harnesses and the reviewed filesystem MCP server. It does not contain a universal preinstalled browser desktop. Web search is the Brave broker tool; browser automation can be added as an explicitly reviewed MCP/runtime extension. Do not claim a screenshot/desktop product that the UI does not implement.

One microVM executes one admitted run. Its root supervisor owns `/platform-control`; the native process tree runs as UID 10001 with `/workspace` and `/agent-home`. No database, object-store, Vercel, Stripe or long-lived model/connector key enters that environment. Native processes receive a short-lived run capability for the exact gateway/tool grants. Package network access is controlled by the sandbox allowlist. Untrusted project instructions cannot expand these permissions.

`MachineProvider` in `packages/core/src/ports.ts` defines provision, prepare, stage, restore/restored, launch, probe, answer, cancel, snapshotPage, chunk and close. `SandboxTools` defines approved stdio invocation. The durable engine owns retries and publication; a compute adapter owns VM I/O. `providers/machines.ts` is the production composition boundary.

## Run lifecycle

| State                 | Meaning                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| queued                | Admission and funding reservation committed; waiting for writer/capacity                |
| provisioning          | Claimed with fresh generation; preparing VM and restoring persisted state               |
| running               | Native harness executing                                                                |
| waiting_for_input     | An exposed native question requires a matching answer                                   |
| persisting            | Native execution stopped; snapshot publication/verification in progress                 |
| succeeded             | Successful execution with verified persistence                                          |
| failed                | Known failure, revocation, queue expiration or persistence problem; inspect result code |
| cancelled / timed_out | Execution stopped by cancellation/deadline; inspect persistence separately              |

The runtime has a hard maximum of two hours per run, with shorter defaults and model-request deadlines. Generic run creation rejects a busy explicitly selected workspace. Session messages can opt into `queue_if_busy`, with at most ten pending messages per session and a default 24-hour queue deadline (shortenable per request). A queued message reserves budget immediately, preserves workspace ordering within the fair organization scheduler and revalidates authority before launch. Queue expiry currently terminalizes as `failed` with `queue_expired` and `persistence_status=not_required`; it does not pretend the agent executed. Cancelling one run does not cancel every queued follow-up.

Claiming serializes organization and workspace admission, checks per-plan concurrency, then takes the shared global-capacity lock. The default global active limit is 50; blocked jobs are deferred so an ineligible first page cannot starve other work. Capacity settings do not override provider quotas or funding. PostgreSQL owns the run even if a Workflow start is missed or duplicated.

## Cloud orchestration and recovery

`apps/web/workflows/run.ts` uses bounded Workflow steps and durable sleeps. The standalone poller invokes the same `advanceCloudRun` engine. Phases include input preparation, provision, restore, launch, probe, snapshot indexing, chunk verification, publication and cleanup. Each phase uses a database lease. The VM name derives from the run UUID; its actual session ID is stored separately. The native atomic execution marker prevents duplicate launch after an acknowledgement is lost.

Probe reads use `resume:false` and session-bound VM I/O. The application does not automatically wake a stopped computer for diagnostics. A lost VM, ambiguous launch or uncertain external tool result enters explicit recovery handling; retrying scheduling is not permission to repeat native side effects. Preservation is attempted after failure/cancel/timeout. The latest verified checkpoint remains available even if new capture fails. Emergency provider snapshots expire after seven days by default, and failed publication stays visible rather than silently discarding the only recent copy.

The supervisor stops all native writers before final capture. Captured workspace/Git/native home state is paged into independent encrypted object storage. Checkpoint commit and execution outcome are distinct from later GitHub publication. See [workspace semantics](../workspaces/README.md) for crash-consistency, format limits and loss windows.

## Streaming and interaction

Events include stable UUID, schema version, run ID, monotonic decimal-string sequence, type, occurrence/ingestion timestamps and data. Producer identity/sequence deduplicate retries; public order is database commit order. Native adapters normalize output deltas, tool start/completion/failure, exposed reasoning, input requests and lifecycle events. Large payloads are bounded/truncated explicitly.

Clients poll `/runs/{id}`, page `/events`, stream `/stream`, or subscribe to signed completion webhooks. SSE IDs are durable sequences. Reconnect with `Last-Event-ID` or `after`, rotate after 55 seconds, refresh auth when needed and independently fetch final status/result. A stream disconnect detaches; it never cancels the run. The server supplies at most one 100-event page ahead of the reader, releases each query connection immediately, and cleans up timers on cancellation, disconnect, or stream expiry. Detailed history stays in PostgreSQL for replay. The browser avoids frequent detail polling while its stream is connected. Expired detailed history retains terminal identity so replay still completes; the result explains missing content.

Input is a POST tied to the pending request ID; stale/duplicate answers cannot answer a different question, and cancellation-requested runs reject new answers. Interactive CLI queues follow-ups while streaming. HTTP commands and SSE cover this product cleanly; raw remote PTYs, simultaneous shared text editing and voice would justify a future WebSocket transport, not an unused launch socket server.

## Acceptance boundary

Actual pinned binaries run in local Docker with external networking disabled and a loopback model protocol fixture. Tests exercise tools, native session identity, capture, restore into fresh folders and continuation. Cloud fault tests use real SQL/encrypted files and an injected machine provider. These establish protocol and recovery behavior without inference spending. They do not establish Vercel image acceptance, live provider entitlement, TLS/egress policy or provider invoice amounts; the operator runs those after account setup and an explicit smoke-test budget.
