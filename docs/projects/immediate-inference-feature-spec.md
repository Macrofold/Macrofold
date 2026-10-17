# Immediate inference: feature specification

Status: approved implementation in progress. [Technical design and ordered checklist](immediate-inference-tech-design.md) owns mechanism; [central TODO](../maintainers/TODO.md#direct-inference-latency-follow-up) tracks delivery and remaining acceptance. Current source behavior belongs in the [decision implementation](../features/decisions/implementation.md) and [streaming implementation](../features/api/streaming-implementation.md); local verification does not establish hosted throughput.

The subsequent [execution-efficiency proposal](execution-efficiency-feature-spec.md) explicitly revisits full immediate-input persistence and the separate response checkpoint, and extends optimization to native/queued execution. Until implemented, this document's current three-boundary guarantees remain the shipped behavior; the new proposal owns the replacement design and its tradeoffs.

## Outcome

An application making one supported model or decision request receives the result on that same HTTP request, with as little Macrofold overhead as possible. A normal call needs no Worker, sandbox, scheduler wakeup, status polling, or separate billing lookup. The same behavior applies to Jev, other supported scoring models, provider-native LLM requests, and optional typed single-call decisions.

Synchronous describes delivery: the HTTP response waits for the provider. Implementation remains asynchronous, concurrent I/O. This must scale across API replicas; it must not serialize provider requests or keep a database connection checked out while a provider runs.

Macrofold still provides current authorization, exact BYOK selection, spending protection, durable request identity, saved results, cancellation, usage, and accounting. A result remains evidence for the caller's application, not authority to apply an action.

## Observed problem

An October 16 local investigation found eight recent successful caller requests averaging 16.389 seconds end to end. The underlying provider adapter averaged 455 milliseconds, including upstream HTTP and response parsing; seven of eight were under one second. One 25.187-second request overlapped 22.106 seconds of three worker claim operations. The caller forced `Prefer: respond-async`, polled Run status, then fetched result and billing separately.

These are local observations, not a controlled production benchmark. The worker observations include pool/lock/SQL time without separating them. They do not prove a particular PostgreSQL root cause. The source already contains immediate execution, but it repeatedly enters the general inference phase engine and retains unnecessary database work. Changing the caller header alone removes the observed queue path but does not establish the latency target.

## Product decisions

1. `POST /v1/inferences` always attempts immediate execution for one provider invocation. Keep its existing path, operation ID, model binding, native `input`, optional typed definition/context, finite limits, and idempotency mechanism.
2. Remove queued delivery from this endpoint. Explicit `Prefer: respond-async` is rejected before admission with HTTP 400 `async_inference_not_supported`; do not silently honor or ignore it. Remove its SDK parameter and queue-only request field from this operation. Native agents, bounded agents and Tasks retain their existing queued APIs.
3. `stream: true` delivers supported LLM deltas on the same request using the existing SSE protocol. Scoring protocols that cannot stream continue to reject the flag before side effects. Streaming is a delivery choice, not a different billing system.
4. Immediate execution may fail admission promptly when actual capacity, account limits, funding, policy or provider availability prevent dispatch. Do not accept a new inference into a hidden queue as a fallback.
5. Retain HTTP 202 only for an already accepted invocation whose result is still running or recovering. It is not a way to request queued execution. Preserve its Run ID and recovery URLs.
6. Preserve the existing completed-envelope behavior: HTTP 200 carries a terminal Run result, including terminal failed/cancelled/timed-out outcomes. Callers inspect `status` and `result.inference.outcome`. Pre-admission errors remain HTTP errors. SSE failures after headers are terminal/error events. Do not change these three cases into indistinguishable exceptions.
7. Include that invocation's authorized usage, Macrofold model charge, separate provider cost information, and timings in the completed receipt. Routine callers must not need organization-wide `usage:read` or a second request for their own invocation's accounting.
8. Make latency a release criterion with measured success rates and capacity. Do not claim literal zero overhead: network travel, validation, encryption, authorization and durable commits take time.
9. **Selected scheduling target:** immediate admission checks current capacity and account entitlements directly; it does not wait for a particular queued Run to take its turn. Weighted ordering remains within queued execution. Shared caps, reservations and execution fencing remain authoritative. This version reserves no capacity per mode and makes no cross-mode starvation guarantee; see the [policy tradeoff and review trigger](immediate-inference-tech-design.md#shared-policy-specialized-work).
10. SDK inference submission makes one transport attempt by default. Optional retries share one caller deadline and the original identity; every error retains that identity even if the response never arrived. Existing accepted work is recovered, never automatically replaced with a fresh paid request.

This is a coordinated pre-launch contract change, not a new compatibility mode. Update maintained clients and examples together. Existing local developer state must still be preserved, and already accepted work must finish or recover safely.

## User and agent journeys

### One scoring request

1. A backend uses its scoped Macrofold API key and stores a unique idempotency key for the intended invocation.
2. It submits the supported native scoring payload, exact model binding, funding mode and finite limits. Inline account-level inference does not acquire a mandatory workspace.
3. Macrofold validates and reserves authority/funding/capacity, calls the provider immediately, durably records the response, settles accounting and returns the completed envelope.
4. The backend reads `result.inference.value`, usage, charge and timing from that response. It validates the proposal against its own current application state before applying anything.

No status polling or `GET /v1/billing/usage` belongs in this happy path. Saved Run URLs remain useful for audit and exceptional recovery.

### LLM streaming

The backend uses the existing SDK stream helper. It receives `run.accepted`, then provider deltas promptly. The final event includes the same completed receipt as non-streaming. Deltas are not billed separately and do not create SQL rows per token. Closing the reader detaches delivery; explicit Run cancellation stops work on a best-effort basis and retains incurred/uncertain usage.

### Lost connection or duplicate request

The caller reuses its saved idempotency key and identical request. Macrofold returns the original completed result or an in-progress/recovery receipt; it never starts another paid request to reconstruct a lost response. Active stream replay retains the existing `stream_already_started` contract. Requests with a changed execution payload still conflict.

For JSON, a 202 receipt has `status: running`, no `result`, and exactly one `recovery_reason`: `in_progress`, `finalization_pending`, or `outcome_unknown`. Use the returned result URL after its `Retry-After` hint; do not create a new key. Result GET keeps the existing `final:false` pending contract. A normal completed call never needs this extra request. Same-key replay after content expiry returns 410 `content_expired`; keeping its identity does not make erased content recoverable. The [wire contract](immediate-inference-tech-design.md#terminal-and-recovery-envelopes) specifies fields, types and examples.

### Busy deployment

Before dispatch, Macrofold returns a documented HTTP 429 for a real rate/account/capacity constraint or HTTP 503 for unavailable local serving capacity/dependencies. An older queued job alone is not a refusal reason for immediate inference. Include a safe reason and actionable retry information. Neither creates a Run nor reserves money permanently. Applications may retry within their own finite deadline with the same key; SDKs must not disguise repeated rejections with minutes of automatic retries. A completed replay needs no new execution slot, even when new admissions are saturated.

The initial cumulative admission budget is one second, distinct from the model timeout and completion allowance. Reject a request before admission if its requested execution window cannot fit the host lifetime. If admission's commit acknowledgment is lost, report `inference_admission_unknown` and preserve identity; that exceptional 503 does **not** prove no Run or charge exists. The [HTTP matrix](immediate-inference-tech-design.md#http-refusal-and-recovery-matrix) defines the distinction.

### Timely answer, delayed bookkeeping

If the provider finishes before the accepted execution deadline, slow Macrofold settlement alone does not turn that answer into a model timeout. Preserve response evidence and return `finalization_pending` if necessary. Recovery settles the same invocation and publishes its result when authorized. Cancellation, retention and actual provider timeout remain independently enforced; incurred or uncertain usage remains accounted for even when a value cannot be returned.

### Multiple customers and mixed agents

Independent immediate calls execute concurrently across API replicas. Native machine restoration and bounded-agent steps do not occupy direct request dispatch slots. Shared account/fleet funding and capacity safeguards still apply. Queued work keeps weighted ordering among queued candidates. Immediate overload is controlled by account/rate/capacity limits, not a queue turn. Sustained immediate traffic can compete with bounded work for the lightweight ceiling; mixed-load acceptance must disclose that tradeoff rather than claim starvation freedom. Guaranteed capacity for each mode is deferred until a service guarantee or measured contention justifies reservations.

Cancellation and initiating-actor revocation are observed across replicas using bounded batches. The target is at most one-second-old authorization observations at supported load; a failed check aborts affected transports immediately, and a check more than two seconds old also aborts them. Abort is best effort and cannot retract transmitted provider work. Context expiry retains the existing `stale_input` meaning; it is not another automatic cancellation trigger.

## Scope

Included:

- Immediate non-streaming and supported streaming inference, including typed single-call definitions.
- Shared domain refactors needed to avoid duplicate billing, authorization, invocation and recovery implementations.
- Current-state capacity admission without native placement/history scans on ordinary direct calls.
- Removal of per-invocation cancellation polling as a scale bottleneck through a shared bounded observer.
- Complete receipts, SDK/MCP behavior, examples, caller guidance, public/internal documentation and deployment verification.
- Mixed-workload and multi-replica acceptance, including financial and failure invariants.

Excluded:

- Replacing native harness execution, bounded-agent tools, or Task coordination with synchronous HTTP.
- Promising arbitrary-duration HTTP requests or adding a detached inference endpoint in this project.
- Changing model quality, provider latency, prices, customer plan entitlements or supported vendor features.
- Redis, another queue service, a new microservice, per-token persistence or a durable trace store.
- Unlimited concurrency, removal of rate/spend limits, or globally distributed writes without measured need.

## Acceptance

| Requirement                | Passing evidence                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Immediate happy path       | Provider execution and terminal response succeed with all pollers stopped in an isolated fixture; zero dispatcher claims and caller status/billing fetches                                                               |
| Native passthrough         | Supported input/output preserved except documented routing, identity, transport and spending controls; no invented prompt/schema convention                                                                              |
| Durable response           | A settlement failure or process death during settlement cannot erase committed provider evidence; a local decoding failure preserves bounded available evidence and uncertain usage                                      |
| Exactly one dispatch owner | Concurrent duplicate requests and recovery never cause a second provider invocation for the same admitted identity                                                                                                       |
| Accounting                 | One usage record and idempotent balanced settlement; BYOK Macrofold model charge remains zero, provider cost remains separate, unknown remains unknown                                                                   |
| Streaming                  | Early deltas, bounded memory, complete final receipt, explicit interrupted result, unchanged detach/cancel semantics                                                                                                     |
| Current authority          | Revoked/wrong-tenant/wrong-scope credentials fail; context grants and explicit stop controls remain enforced                                                                                                             |
| Explicit client recovery   | Schema-validated success/failure/202/410 examples, active-stream 409, and all-five-SDK identity preservation on abort, HTTP, decode and stream failures; one transport attempt by default                                |
| Independent clocks         | Prompt bounded admission; execution timeout is unchanged by retries; timely provider completion can finalize after its deadline; lost commit acknowledgment never claims a confirmed rollback                            |
| Mixed execution            | Native/bounded execution, shared limits, queued fairness, cancellation and recovery regressions pass; an unstarted queue head does not block free immediate capacity                                                     |
| Low overhead               | Warm small inline requests target added server overhead p50 ≤10 ms, p95 ≤25 ms, p99 ≤50 ms under a declared sustainable load; no deliberate scheduling/polling wait                                                      |
| Scale                      | Multi-replica sustained/burst results include latency, accepted/completed/rejected counts, active calls, pool/lock waits, memory and recovery lag; the 10,000-in-flight target is tested separately from requests/second |
| Honest limits              | Cold/context-I/O/large-payload/provider-limited cases are reported separately, not removed from overall results; no unmeasured hosted SLA                                                                                |

The percentile numbers are engineering targets, not measured achievements or a promise that every topology can meet them. Do not lower them or report low latency by rejecting normal offered traffic. Report the measured sustainable envelope, identify the bottleneck, and optimize that owner.

The [acceptance workload table](immediate-inference-tech-design.md#reproducible-acceptance-envelope) fixes workload duration/distribution, payload classes, success/refusal thresholds, observer freshness, overload recovery, resource headroom and exact accounting invariants. I0 calibrates release budgets before implementation of the new lifecycle. A 10,000-connection result alone cannot establish requests-per-second capacity or a production SLA.

Delivery and recovery have separate clocks. Both JSON and SSE producers must remain owned after client disconnect within the supported host lifetime. A deployment restart or hard host termination can still interrupt execution; the same accepted identity recovers without repeating the paid call.

## Delivery sequence

The [technical checklist](immediate-inference-tech-design.md#implementation-checklist) delivers observation, shared lifecycle extraction, immediate execution, scalable controls, complete clients/docs, then fault/load/live acceptance. All stages are part of the target; partial completion does not satisfy the overall requirement. This revision completes the requested design updates; application implementation and changes to another checkout are outside this documentation task. Capability discovery for decision-only models remains a [separate future improvement](decision-model-routing.md#future-capability-discovery).
