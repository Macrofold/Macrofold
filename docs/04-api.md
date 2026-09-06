# Public API, webhooks, and SDKs

Implemented contract version 0.9.0. [OpenAPI](api/openapi.json) drives AJV request validation, public response projection, generated TypeScript types and operation maps for both SDKs. The running app serves `/openapi.json`, `/reference` (Scalar) and `/docs` (quickstart). Provider identity/webhook/internal protocols remain separate from customer REST.

## Common behavior

Use HTTPS JSON under /v1; snake_case JSON fields; opaque UUIDv7 IDs; RFC 3339 UTC timestamps; decimal-string micro-USD and bigint counts. Authenticate customer calls with Bearer API keys, customer OAuth access tokens, or the dashboard session. Resolve organization from authorized key/token/session context; X-Organization-Id selects an authorized membership and cannot override a key binding. Keys can restrict scopes and projects.

All create/action POST operations support Idempotency-Key. Require it for run creation, session messages, billing checkout, file mutations, checkpoint restore, Git sync, transfer planning/apply, and checkpoint exports. Retain request fingerprints and results for 30 days. A key reused with a different canonical body returns 409 idempotency_conflict. Keys are scoped to principal, organization, and operation; retention expiry is documented and does not imply exactly-once forever.

Use cursor lists with limit default 25/max 100 and next_cursor. Errors contain error.code, message, request_id, details, and retryable. Expected codes include unauthenticated, forbidden, not_found, invalid_request, unsupported_combination, insufficient_credit, quota_exceeded, workspace_busy, stale_revision, idempotency_conflict, cursor_expired, connection_expired, provider_unavailable, and persistence_failed. Do not leak existence across tenant boundaries.

The shared HTTP rate limit defaults to 300 requests/minute per credential within its organization, configured by `API_RATE_LIMIT_PER_MINUTE`. It returns 429 with Retry-After. Per-plan and global execution ceilings are separate from HTTP rate and spending admission. Configure unauthenticated/IP abuse controls at the hosting edge; there is no claimed built-in 20-stream quota.

## Run request example

```json
{
  "prompt": "Read the project notes, update the weekly summary, and save the result.",
  "workspace_id": "019e1700-0000-7000-8000-000000000001",
  "harness": "codex",
  "model": "<model-id-from-GET-/v1/models>",
  "billing_mode": "byok",
  "provider_connection_id": "019e1700-0000-7000-8000-000000000002",
  "connection_grants": [
    {"connection_id": "019e1700-0000-7000-8000-000000000003", "tools": ["search"]}
  ],
  "limits": {"timeout_seconds": 900, "max_cost_micro_usd": "2000000"}
}
```

Return 202 with run_id, session_id, workspace_id, status, and URLs for status, events, stream, result and cancellation. Queue observations include waited seconds, reason, deadline and held funds. The caller selects either a session, workspace, or project. A session implies its existing workspace and pinned harness; a workspace with no session creates one; a project creates an isolated workspace/session. Reject contradictory selectors. A preset's configuration is resolved first and explicit run overrides are accepted only for documented overrideable fields; persist the resolved configuration.

BYOK requires a compatible provider connection. Managed mode requires an active credit balance and configured managed provider. Run connections reference pre-authorized resources; raw secrets and arbitrary OAuth grants are not accepted in prompts or run JSON.

## Endpoint inventory

| Group | Routes and behavior |
|---|---|
| Identity | GET /me: principal, authorized organizations, effective scopes and CLI/API capabilities |
| Projects | GET/POST /projects; GET/PATCH/DELETE /projects/{id} |
| Workspaces | GET/POST /projects/{id}/workspaces; GET/PATCH/DELETE /workspaces/{id} |
| Files | GET /workspaces/{id}/files; GET/PUT/DELETE /workspaces/{id}/file?path=... |
| Diffs/transfers | GET /workspaces/{id}/diff; GET/POST /workspaces/{id}/transfers; GET /transfers/{id}; POST /transfers/{id}/apply |
| Checkpoints | GET/POST /workspaces/{id}/checkpoints; PATCH /checkpoints/{id} for pinning; POST /workspaces/{id}/restore; POST /checkpoints/{id}/exports |
| Git | GET /workspaces/{id}/sync; POST /workspaces/{id}/sync |
| Agents | GET/POST /agents; GET/PATCH/DELETE /agents/{id} |
| Sessions | GET/POST /sessions; GET /sessions/{id}; POST /sessions/{id}/messages |
| Runs | GET/POST /runs; GET /runs/{id}; POST /runs/{id}/cancel; POST /runs/{id}/input |
| Results | GET /runs/{id}/result; GET /runs/{id}/events; GET /runs/{id}/stream |
| Artifacts | GET /runs/{id}/artifacts; GET /artifacts/{id}/download |
| Connections | GET/POST /connections; GET/PATCH/DELETE /connections/{id}; POST authorize/test; GET tools; GET/PUT /connections/{id}/grants |
| Keys | GET/POST /api-keys; DELETE /api-keys/{id} |
| Webhooks | GET/POST /webhook-endpoints; PATCH/DELETE /webhook-endpoints/{id}; POST /webhook-endpoints/{id}/rotate-secret; GET /webhook-deliveries; POST /webhook-deliveries/{id}/replay |
| Usage | GET /usage; GET /requests |
| Billing | GET /billing; POST /billing/checkout; POST /billing/portal |
| Execution policy | GET/PATCH /organization/execution-policy; owner/admin can lower concurrency/runtime caps within Starter, Pro or Scale |
| Catalog | GET /harnesses; GET /models |
| Async operations | GET /operations/{id} |

In this table routes inherit /v1. File PUT is binary-safe application/octet-stream up to 4 MiB with path and If-Match; larger files use staged object transfer up to 25 MiB per file; deletion also checks revision. If-Match uses the workspace revision returned by the file listing, including when creating a new path. Both return an asynchronous operation while durable persistence finishes. List/preview responses identify active versus checkpoint data and last verified checkpoint time.

Connection grants use versioned structured subject/tools. Granting requires connection ownership or authorized organization administration. A run can select only a subset of those grants; it cannot escalate them by naming extra tools in run JSON.

Result retrieval always returns the current run outcome and available partial output, with final=true only after terminalization. Artifacts require authorization at access time and use short-lived download URLs. Cancellation is idempotent and returns current state, not a claim that external effects were undone.

## Events and webhooks

GET events uses an after sequence cursor. SSE supports Last-Event-ID and sends durable event IDs; reconnect is safe. Connections rotate after 55 seconds to fit bounded hosting; refresh credentials between connections and preserve the last delivered sequence. Read indexed event batches with released database connections (150 ms after events, 750 ms while quiet), not a pinned connection per idle stream. Measure database and stream concurrency at the hosting edge. Raw tool output can be large and referenced as an artifact. The final result is independently retrievable even if the client misses an event.

Users register webhook endpoints once and subscribe to run.completed, run.failed, run.cancelled, git_sync.updated, and connection.expired. Run configuration can reference registered endpoint IDs. Do not accept unchecked callback URLs in each prompt.

Sign timestamp + '.' + raw request body using HMAC-SHA256. Send Webhook-Id, Webhook-Timestamp, and Webhook-Signature. Document a five-minute freshness tolerance and constant-time signature comparison. Endpoint secrets are shown once and rotate with an overlap period.

Use a durable delivery outbox, 10-second request timeout, and retries at approximately 10 seconds, 1 minute, 5 minutes, 30 minutes, 2 hours, 8 hours, and 24 hours with jitter. Mark exhausted after the last attempt. Treat any 2xx as accepted; never follow redirects to bypass destination validation. Receiver deduplicates stable event ID; a replay has a new delivery ID and the same business event ID. Delivery failure does not alter run success.

## Documentation and client experience

Publish the bundled React quickstart, authentication/scopes, errors, limits, durable runs, project continuation, MCP authorization, files/Git, billing, metrics definitions, and webhook verification. Render generated reference with Scalar. Provide a request-ID copy button, CLI/cURL/TypeScript/Python examples, documented poll backoff, and complete failure examples.

Generate TypeScript schema types with openapi-typescript and operation maps with `scripts/generate-sdk.ts`; maintained Fetch/httpx clients implement requests, operation polling and durable SSE. This keeps the public schema authoritative without a second generated client framework. Test SSE reconnection and async pagination rather than generating a client that only handles CRUD. Package names and API origin are release configuration. Examples use fake IDs and environment variables, never credentials or paid calls on import.

Authentication provider protocol routes, provider webhook ingress, internal runtime ingestion, and management MCP JSON-RPC are separate contracts; they are not public customer-key endpoints. Their ownership and validation are defined in [security](05-security-integrations.md) and [operations](08-analytics-operations.md).

## Customer OAuth and CLI contract

The [CLI specification](14-cli.md) and [command mapping](api/cli.json) define the terminal client. Use Better Auth protocol routes under /auth for device authorization/token refresh/revocation, with RFC 8628 and protected-resource discovery; OpenAPI 3.1 does not natively express a device grant, so CustomerOAuth includes an extension for its endpoint. Its authorization-code representation is not an instruction to embed a confidential secret. The customer resource audience is the configured API origin plus /v1; operator REST and MCP use separate audiences/scopes.

GET /me returns effective identity, authorized organizations/project restrictions, server API version, minimum/recommended CLI version, feature flags, transfer limits, and stream rotation. Authentication and permissions still apply server-side after this handshake. A CLI release cannot override incompatible server behavior through its client version header. Each customer operation declares required scopes; transfers and asynchronous operations additionally authorize their stored direction/kind/resource. Default CLI consent excludes key management, billing mutations, operator access, and connector changes. Connection setup requests additional connections:write consent.

## Remote worktrees, continuation and explicit transfers

WorkspaceCreate accepts a source of kind git_ref or checkpoint and a requested branch name. Resolve the source only within the authorized project, validate Git ref syntax and branch collision, and record the immutable commit/checkpoint in the result. The legacy checkpoint_id field is mutually exclusive with source. Creating a workspace returns an operation; its successful result supplies workspace_id. PATCH changes its display name only. Remote workspaces are independent clones; optional local Git worktree checkout is implemented by the CLI from a verified exported bundle.

SessionCreate fixes harness and initial funding/model/tool configuration without executing inference. Continuing uses the session configuration plus supported message overrides. queue_if_busy=true admits a FIFO follow-up and returns RunAccepted immediately; at most ten queued per session, expiring after one hour. Reserve liability before accepting, revalidate authority at dispatch, and release on pre-execution cancellation/expiry. The active writer index excludes queued rows. Queue expiry is failed with queue_expired and persistence_status=not_required; generic run creation into a busy explicit workspace stays a 409. Run lists filter by session/workspace; queued run IDs use the normal cancellation endpoint.

A transfer plan supplies push/pull direction, expected remote revision, selected paths, and local/baseline SHA-256 inventory. Plans expire in 30 minutes. Enforce 1,000 files, 250 MiB total, 25 MiB/file, normalized unique paths, and regular-file-only transfers; backups independently preserve symlinks. Explicit paths are required for ignored-file inclusion and deletions require opt-in. Unknown baseline and known absent file are different states. Conflicting edits receive no destructive grant. Dry-run transfers disclose paths/actions without content upload, issue no object capabilities, and cannot apply.

Presigned staging URLs expire within the plan; authorized GET can refresh them without extending the plan's lifetime. Do not forward a platform Bearer token to these URLs. Applying a push rechecks ownership, grant, hashes, writer lease and revision, persists the replacement state, and atomically publishes it. Applying a pull records client-reported completed paths; it never claims that the server verified the laptop's filesystem. The client maintains its own preconditions and partial-apply journal.

Checkpoint exports return an asynchronous operation with a typed CheckpointExport result, artifact hash, manifest hash, expiry and download links. Git bundles contain tracked objects/refs; portable archives include permitted ignored project files. Native session state remains in internal encrypted backups, not the public file archive. Bounded trusted control-plane code decrypts authorized content into temporary export objects; these are short-lived bearer downloads over TLS, not raw encrypted backup repositories or vault keys. Require tenant content access, rate/storage/size quotas, and scheduled staging cleanup. No export/transfer invokes a model.


The [scheduler contract](25-scheduling.md) documents `queue_timeout_seconds` (default 86400, maximum 86400), `scheduling_class`, the run waiting fields, distinct execution deadline, three-tier limits and read-only operator metrics. Queue expiry preserves history and emits an explicit failure; reservations are released exactly once. No global position or start-time estimate is emitted.
