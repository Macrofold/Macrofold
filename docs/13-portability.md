# Vercel-first architecture and portability

Accepted revision: September 5, 2026. This supersedes the original Railway/E2B/BullMQ/LiteLLM launch topology. The public product, persistent workspaces, three harnesses, billing, analytics, and read-only management MCP remain required. The terminal CLI is an additional launch client.

## Initial implementation and replacement boundaries

| Domain-owned boundary | Launch implementation | Replacement path |
|---|---|---|
| HTTP application | Next.js Route Handlers on Vercel Functions | Same Next.js standalone Node/Docker build |
| SandboxProvider | Vercel Sandbox | E2B or another isolated compute adapter |
| HarnessAdapter | Native Codex app-server, Claude Agent SDK, OpenCode SDK | Tested AI SDK HarnessAgent adapter where it provides complete semantics |
| ExecutionScheduler | Workflow SDK on Vercel World | Same SQL run state machine driven by the standalone poller |
| CredentialBroker | Optional Composio; direct MCP OAuth; versioned encrypted vault | Another broker/vault; users may need reauthorization |
| ModelAccess | Application-owned native-protocol model gateway; direct provider routes for managed and BYOK | LiteLLM or other model adapter without changing public contracts |
| ObjectStore / WorkspaceArchive | R2, encrypted versioned archives and manifests | Another S3-compatible object store |
| Database | PostgreSQL on Neon | Another PostgreSQL host using normal export/restore |
| OperationsReader | Application-owned queue/run/finance/storage facts; live provider telemetry is missing | Another provider reader; same admin API/MCP |

The interfaces expose product behavior, not every vendor SDK method. Provider-specific machine name/session ID and runtime state remain in internal execution records; the API exposes product IDs. A generic provider-binding registry is a future multi-provider extension, not a current table. Bind a workspace/session and execution to a provider revision; switching a default never moves active executions implicitly. Public UUIDs do not change when a backend changes.

Keep domain functions, validation, ledger, Git integration, metrics, and authorization independent of Vercel imports. Framework routes resolve identity, validate input, invoke domain services, and serialize responses. Workflow entrypoints and use-step directives are a thin orchestration layer around those services. The portable SQL poller reuses the domain state machine; it adds no second workflow-history database. This accepted revision is explained in ADR 23. [Workflow portability](https://vercel.com/blog/a-new-programming-model-for-durable-execution)

## Product truth and durability

PostgreSQL owns accepted runs, events, sessions, pending messages, credits, usage, connections/grants, projects, requests, and audit trails. Workflow history is execution infrastructure; its retention is not customer run-history retention. R2 holds portable file archives, manifests, artifacts, and exported compatible harness state; provider-native snapshots are an acceleration layer.

Vercel persistence saves filesystem state when stopping and starts another VM session when resumed. Explicitly set native snapshot expiration/retention, keeping the latest usable snapshot until independent recovery is verified. Do not confuse preserving files with transferring live RAM or a running process to another provider. [Sandbox persistence](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes)

## Deliberate credential boundaries

Application-owned OAuth registrations are supported for direct MCP connections; Composio is an optional auth/tool adapter. The platform binds each connected account to an organization and user and owns its tool grants. The vault contains encrypted model/API secrets and refresh credentials where the adapter supports them. Connector portability may still require user reauthorization; token export is not assumed.

Both managed and BYOK inference use a metered native-protocol gateway. Managed calls use the explicitly configured operator provider credential; BYOK calls use exactly the selected customer credential. Failed BYOK does not fall back to managed funding. This supersedes the original Connect/AI Gateway recommendation after implementation exposed the need for precise provider protocol and liability handling.

## Procedure for a future compute-provider migration

The standalone scheduler switch is implemented. The following is the required engineering/operator procedure when adding a second compute adapter; it is not a delivered one-click migration endpoint.

1. Select an organization/project migration and stop admission of new writers to its workspaces. Existing queued prompts remain durable.
2. Drain active work or explicitly cancel it; do not replay an ambiguous external action.
3. Stop writes, export and verify files including ignored files, Git objects, permissions, and sanitized compatible harness session state.
4. Restore to the destination and validate manifest checksums, workspace revision, Git refs, session compatibility, and broker access.
5. Resolve credentials: reuse application-owned data where supported, otherwise mark reauthorization_required and let the user reconnect.
6. Atomically update provider bindings using a migration generation. Route subsequent runs to the destination; public IDs/history stay unchanged.
7. Keep the source recovery copy during a defined seven-day rollback window, then retire it only after destination verification. A rollback after new destination edits first preserves those edits; never point back to stale files.

Changing workflow infrastructure normally drains old workflows and starts new runs on the new scheduler. Moving live Workflow histories between schedulers is not promised. Changing harness versions or harness families may require starting a new conversation from preserved files and an explicit summary; do not pretend that all native session formats are interchangeable.

## Launch scope and proof

Build one production sandbox adapter and one fixture/local adapter. Build the standalone Node application and prove core flows on the standalone SQL poller with simulated compute. This tests framework independence without implementing a second production cloud. A self-hosted installation initially still needs Vercel for Sandbox unless those adapters are replaced or an existing direct route is selected.

Run common adapter contracts for lifecycle, event replay, cancellation, filesystem export/import, grants, and spending. A migration fixture exports from one adapter instance, restores into another, and preserves public IDs and file hashes. Runtime capabilities such as memory snapshots, region placement, and supported models remain explicit; never silently degrade requested capabilities.

The expected benefit is less infrastructure to operate at launch with a practical exit path. Portability is engineering work plus data/credential migration, not an instant provider switch or a claim of zero lock-in.
