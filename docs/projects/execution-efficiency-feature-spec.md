# Efficient execution: feature specification

Status: shared application changes, capture/runtime refinement and local activation are implemented. Six co-located Linux cohorts meet the server-overhead p95 target; the sequential SQL budget, full CI and hosted qualification remain open. The [verification record](execution-efficiency-verification.md) distinguishes passing modules from unmet acceptance. [Technical design](execution-efficiency-tech-design.md) owns mechanisms and delivery stages; [maintainer work](../maintainers/TODO.md#execution-efficiency-redesign) retains the open gates. This extends the [immediate inference design](immediate-inference-feature-spec.md) across native and queued work; hosted deployment is not established.

## Outcome

Macrofold should add only the work needed to safely serve a request. A simple passthrough call must not pay for a general agent lifecycle, repeated large database transfers, repeated discovery, or administrative reporting. Native and queued execution should use the same efficient authorization, accounting, transport and persistence owners without losing their stronger continuation and file guarantees.

The primary target is less than 100 ms of added server overhead at p95 for near-full-context immediate inference on a declared healthy topology and supported load, including enabled tracing. Provider time, caller network time and cold starts are reported separately. This is an engineering target, not a measured SLA or a promise of zero overhead. Small-input targets and the mixed-load acceptance requirements in the earlier design remain separate.

## Caller experience

### Immediate inference

The caller submits one existing `POST /v1/inferences` request and receives the existing result with usage and settled billing. No new performance flag, background-billing mode, polling loop, worker or alternate endpoint is needed. Supported streaming forwards deltas promptly and ends with the same durable receipt. Unsupported provider capabilities still fail before dispatch.

The ordinary execution has two short commits: admit/reserve, then save the result and settle. The provider call runs between them without a database connection. Authentication/rate protection and conditional saved-context or credential resolution may require additional bounded reads; two execution commits does not mean two total SQL commands.

The final result, financial facts and duplicate-request identity are durable before a final response. Input-history capture, trace export and analytics do not delay it. A caller can immediately retrieve the saved result or repeat the same key without causing another paid request, even if reporting/export workers are unavailable.

### Input history and recovery

For immediate calls, retain compact execution metadata, input digests, relevant context identities and frozen terms synchronously. Keep the full request in the live owner's memory; do not require both full context in `runs.config` and an encrypted provider-body copy merely for recovery. Recovery must never resend an ambiguous paid request, so those copies are not needed to restart execution.

Full immediate input capture becomes bounded asynchronous export to the configured tracing backend under the existing content-capture/retention policy, rather than a second unused history store. It may be missing after process loss or overload; a digest cannot reconstruct it. The current dashboard renders results/events and has no original-input viewer; this project adds no input-history API or UI. Consumers must not fabricate an empty prompt to represent missing captured input. This does not remove saved definitions, published artifacts, native conversation history or required queued input. No new customer capture-policy control is required for this project.

Combining response saving and settlement deliberately changes one guarantee: if the process dies after receiving an answer but before the combined commit, that answer may be lost. The current separate evidence commit narrows that window. The new owner attempts an evidence-only checkpoint when ordinary completion fails and the process survives. An unrecorded answer remains explicitly uncertain; it is never reconstructed by another paid call. This tradeoff must be documented before activation.

### Queued and agentic execution

Acknowledging a queued job means its execution input, identity and dispatch record have been saved. Native model requests reuse efficient metering but do not finish their parent Run. Bounded agents continue ready steps without unnecessary scheduler handoffs while retaining finite execution budgets and durable continuation boundaries.

Tool calls resolve the selected tool without rediscovering every connection on every call. Current grants still apply. Tool retries cannot repeat an uncertain external action. Native output should reach a connected caller promptly instead of waiting through stacked polling intervals.

File restoration and checkpoints transfer and verify necessary data in bounded batches. Successful durable completion still means files and required Session state have been published safely. Already received text can be displayed sooner; the UI must distinguish that from completed persistence. Warm Workers may reuse compatible handles; caching does not change the isolation or retention contract of automatic allocations.

## What waits and what does not

| Work                                                                                  | Required boundary                                                                                                      |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Current caller/resource permissions, exact route and funding checks                   | Before granting dispatch; publication/read checks remain current                                                       |
| Duplicate-call identity, reservation and capacity ownership                           | Commit before the external paid action                                                                                 |
| Final output, independently known usage, authoritative charge and unused-hold release | Commit before reporting a final immediate result                                                                       |
| Queued input and outbox identity                                                      | Commit before acknowledging queued acceptance                                                                          |
| Native continuation state and file checkpoint                                         | Verify/publish before claiming durable Run completion                                                                  |
| Durable replay events and webhook delivery obligations                                | Commit with their source transition or derive deterministically from a durable source; delivery itself is asynchronous |
| Detailed input diagnostics, trace export, request/product analytics                   | Bounded background work; failures do not fail an otherwise successful request                                          |
| Temporary-object deletion                                                             | Background cleanup with the existing lifecycle-expiry backstop                                                         |
| Optional Git publication and expensive report aggregation                             | Independent durable jobs when promised; no added delay to model delivery                                               |

“Recovery” is not one category. A compact record preventing a second paid call protects the current request; a full prompt copy for later debugging does not. There should be no generic instruction to persist everything synchronously or move everything to an untracked promise.

## Scope and limits

Cover REST and customer MCP hosts, immediate JSON/SSE, native and bounded model execution, queued admission/dispatch, brokered tools, hydration/checkpoints, warm placement, event delivery, billing projections and observability. Reuse the current modular application, PostgreSQL, object store and provider ports. Preserve exact BYOK, stop-on-model-error, tenant isolation, cancellation, retention, integer money, fair queued ordering and file integrity.

Do not add Redis, a new queue platform, a generic repository/cache framework, cross-tenant prompt caching, asynchronous financial settlement, wallet escrow or a second billing engine. Do not promise unlimited capacity or increase limits to hide inefficient work. Global capacity sharding remains conditional on measured contention after large writes and repeated scans are removed.

## Acceptance

1. The same immediate HTTP/SDK request returns a final usable result and charge with all optional consumers stopped; same-key replay and result retrieval succeed immediately. No provider retry occurs after ambiguous dispatch.
2. Near-full input appears in no mandatory immediate admission write and is not returned by lifecycle/financial queries. The response is durably stored once, rather than copied into several results/evidence records. Frozen small terms remain recoverable.
3. Count SQL statements, dependency round trips, commits, bytes and lock holds independently. The [SQL budget](execution-efficiency-tech-design.md#database-round-trips-and-locks) is measured, including authentication/rate checks; hiding work in a background queue or function is not a performance pass.
4. Crash/lost-ack, concurrent spending, same-key, cancellation/revocation/purge and uncertain-usage fixtures prove the new contract. Native file and queued-input durability remain unchanged. Model-error fencing prevents subsequent paid calls before a failed request returns.
5. Tool warm-catalog calls perform no unrelated remote discovery. Restore performs no redundant upload of an already stored simple chunk. Event ingestion and progress writes are batched without dropping distinct facts.
6. Measure native first-output, per-model/per-tool overhead, cold restoration, warm continuation and checkpoint completion separately. A fast direct call is not acceptance for those paths.
7. Background outages are bounded in memory/concurrency and cannot starve completion. Durable jobs recover after restart; optional diagnostic loss is visible in aggregate counters without storing customer content in general logs.
8. Update public REST/SDK examples only for actual semantic changes, explain input-history and uncertainty limits, and keep internal diagrams, migrations, owner docs and release checks aligned. No speculative endpoint or performance guarantee is published as working.
9. Efficiency is the default of shared owning operations, not a caller option. Immediate, bounded and native paths share model accounting; event producers share batch publication; all inference result readers use one content owner. Preserve distinct tool-fee, schema-validation and continuation policies rather than forcing them into a universal executor. The [module contracts](execution-efficiency-tech-design.md#shared-contracts-and-safe-defaults) identify the owners and required caller migrations.

## Delivery

The [ordered implementation stages](execution-efficiency-tech-design.md#implementation-stages) first preserve the measured baseline, then remove payload duplication and query round trips, implement compact completion, and apply the same discipline to agent/tool/storage/event paths. Correctness and performance evidence are both required; stages do not silently exclude the latter paths.

## Remaining optimization proposal

A design-only follow-up specifies [shared SQL batching, request-local payload reuse, producer-aware trace capture and optional HTTP observations](execution-efficiency/remaining-optimizations.md). The distinct [profiling specification](performance-profiling-feature-spec.md) and [profiling technical design](performance-profiling-tech-design.md) define an easy default-off operator switch and accurate concurrent attribution. These proposals do not change the implemented durability contract or close the original SQL/CI/hosted gates.

Additional acceptance: behavior-preserving optimizations must improve measured work through shared owners; full tracing remains the default; metadata-only tracing must avoid producer-side content capture; explicitly disabled HTTP observations must be represented as incomplete diagnostics in reporting, never as authoritative zero traffic. Financial facts, current authorization, durable output/replay and required execution input remain mandatory. No optional diagnostic setting may change them.

## Changelog

- This proposal responds to the October 17 near-full-context investigation: repeated large SQL returns were fixed, but the roughly 178 ms mean remained above target. It replaces the earlier proposal's unconditional three execution commits with two normal commits and exceptional evidence capture, explicitly accepting the larger pre-completion response-loss window. The [measurement record](../features/decisions/verification.md#near-full-context-profiling) and technical design retain the evidence and original command breakdown.
