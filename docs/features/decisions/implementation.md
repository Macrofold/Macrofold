# Decision execution implementation

Contributor reference. Start with the [public contract](README.md), [context semantics](context.md), and [task behavior](tasks.md). [Verification](verification.md) separates local evidence from release acceptance.

The [immediate-inference plan](../../projects/immediate-inference-tech-design.md) owns the implementation checklist and performance acceptance. Direct requests now execute within their HTTP owner; native agents, bounded agents and Task children retain queued execution. Hosted capacity and lifetime acceptance are separate from source implementation.

The [execution-efficiency design](../../projects/execution-efficiency-tech-design.md) owns compact immediate admission, atomic completion, bounded optional capture and the shared database/runtime improvements. Its verification record distinguishes implemented behavior from latency and hosted qualification.

## Validation and admission capacity

`explicit-context.ts` keeps at most 128 compiled validators, keyed by canonical schema content. Every call still checks the finite-schema policy before using the cache; schemas are compiled from immutable JSON snapshots with no coercion, defaults or property removal. Eviction also removes Ajv's internal schema retention. This caches pure compilation, never customer evidence, permissions or resolved definitions. The 32 KiB schema bound limits retained schema text to 4 MiB; compiled code has additional memory cost.

Workspace admission takes a shared `workspace-deletion` advisory transaction lock. Concurrent admissions may proceed together; deletion takes the same lock exclusively and waits for admissions to commit before archiving/cancelling. Wallet reservations and scheduler admission retain their own exclusive financial/capacity locks.

Native cancellation/heartbeat checks allow only one outstanding check per Run. Immediate and bounded provider requests share a process observer over the content-free `reporting.inference_control` view: pages of 256, two concurrent reads, 500 ms cadence, immediate-admission backpressure before healthy freshness exceeds one second, and abort after the first failed page or two seconds without fresh evidence. Registration cleanup is synchronous and never delays response persistence. A local monotonic timer owns the provider deadline; the observer checks current API-key principal, generation and cancellation. See [capacity calibration](../../engineering/capacity/upper-bounds.md) for measured workloads and deployment limitations.

Immediate request-body/replay readers and active producers have independent process counters, each bounded by `IMMEDIATE_INFERENCE_CONCURRENCY`. A new request transfers to its producer permit before context preparation; a completed replay never needs that permit. This bounds concurrent buffered bodies without letting busy provider calls prevent retrieval of existing results. SQL preflight/admission has a separate smaller gate, released during upload and external preparation; no database client is held for either. Per-request byte limits still apply, and the combined memory envelope needs calibration on the intended deployment.

Live admission and completion return narrow SQL projections rather than repeatedly
transferring accepted context and encrypted request bodies. The confirmed owner
already holds those immutable values; every publication still reads current
generation, cancellation, retention, authority and financial state. Recovery loads
the full persisted evidence. Provider request preparation reuses one canonical
JSON encoding for its byte bound, digest and existing-format encryption.

## Ownership and entry points

| Concern                                         | Owner                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Public inputs, receipts, limits and scopes      | `docs/api/openapi.json`; generated contracts and five SDKs                  |
| Domain types and provider/context ports         | `packages/core/src/decision.ts`, `context-artifacts.ts`                     |
| Context/schema validation                       | `explicit-context.ts`                                                       |
| Exact model eligibility and frozen terms        | `decision-models.ts`; native capability policy remains separate             |
| Workspace-bound application authority           | `decision-authority.ts`                                                     |
| Shared credential resolution                    | `model-credentials.ts`; native gateway and direct executor reuse it         |
| Admission and immutable configuration           | `inferences.ts`, `decision-definitions.ts`                                  |
| Immediate execution and evidence recovery       | `direct-inference.ts`, `inference-invocations.ts`                           |
| Queued/bounded invocation and shared settlement | `inference-engine.ts`, `model-gateway.ts` and `ledger.ts`                   |
| Shared final publication authorization          | `inference-publication.ts`; immediate and queued completion reuse it        |
| Shared execution capacity and current controls  | `execution-admission.ts`, `inference-control.ts`, `actor-authorization.ts`  |
| Trusted evidence tool loop                      | `bounded-decisions.ts`                                                      |
| Sequential task allocations and coordination    | `decision-tasks.ts`, `decision-task-engine.ts`                              |
| Vendor HTTP and response parsing                | `packages/providers/src/decision-protocols.ts`                              |
| Shared claiming and mode dispatch               | `engine.ts`, `cloud-engine.ts`, `portable-dispatch.ts`, `local-dispatch.ts` |
| Retention and reachability                      | `artifacts.ts`, `deletion.ts`, existing storage preparation/collection      |
| Presentation                                    | `inference-result.tsx`, `task-lineage.tsx`, existing run page               |

There is one Run identity, wallet and accounting owner. Internal native/lightweight variants prevent nullable native resources from entering harness code. Immediate capacity checks share aggregate caps with queued execution but do not consult queue ordering, record scheduler turns or construct native compute. Weighted ordering remains for queued work; shared capacity does not guarantee per-mode progress during sustained saturation. Providers own wire formats; core owns authority, context, budgets and receipts.

## Provider routing

OpenRouter generative inference resolves an enabled model from the shared catalog; Jev and Microsoft Decision 1 use the exact reviewed decision-only registry in `decision-models.ts`. That registry also classifies endpoint selection, metadata refresh, input reservation and chat-only parameter validation, avoiding model-name exceptions in each consumer. `prepareInference` uses `prepareOpenRouterModel` to read freshness and the selected immutable model from one snapshot. Missing/expired chat pricing triggers the existing refresh owner outside SQL, followed by a fresh selection; registered scoring models do not require chat discovery. The metadata adapter, SQL refresh claim, failure backoff and price-expiry policy remain authoritative. Fresh requests make one preparation read and no discovery request; admission still checks the exact revision and current expiry before freezing rates under its normal authorization/accounting checks. See [catalog recovery](../execution/models.md#refresh-and-caching).

`decision-protocols.ts` implements Anthropic Messages, direct TypeSafe SystemOne and OpenRouter's alpha Decisions endpoint. Jev and Decision 1 share typed choice/score construction and answer validation. Native requests preserve arbitrary named noul/choice/score questions and the complete provider response without injecting definition/context guidance or chat-only fields. OpenRouter adds the bound model, generation identity and provider price ceilings. `openrouter-pricing.ts` converts frozen micro-USD rates to the same USD-per-million ceilings used by native chat requests, including zero per-request fees. No route permits implicit fallback or retries after uncertain dispatch.

OpenRouter routes are `typesafe/jev-1.13` and `microsoft/microsoft-decision-1`; direct TypeSafe uses `jev-1.13.0`. OpenRouter routes use `OPENROUTER_API_KEY` for managed funding or the exact owner-bound OpenRouter connection for BYOK, requiring no TypeSafe/Azure credentials. Reviewed input rates are 42,000 micro-USD per million tokens, with zero output charge; accepted customer/provider terms remain frozen by the existing executor. Eligibility and cost terms stay in `decision-models.ts`; transport and endpoint details stay in the provider adapter. Scoring routes remain outside the native harness catalog and reject streaming, bounded-agent execution and typed JSON generation before admission. The alpha endpoint's API stability is a provider dependency; run the opt-in [live decision check](../../engineering/testing/live-integrations.md#run-the-checks-deliberately) after protocol updates. See the [routing plan](../../projects/decision-model-routing.md) for sources and verification.

## Durable request boundary

Admission freezes resolved definition/context, exact provider/model/credential selection, limits, transformation identity and customer/provider terms. API keys can make stateless inline calls without a workspace; restricted keys must identify an authorized workspace. Saved references require a workspace. Audience semantics remain the application's responsibility. Object reads happen outside SQL; commit and final disclosure reauthorize references.

`POST /v1/inferences` normally uses two execution commits around provider I/O. A commits compact accepted identity/terms, the funding reservation, gateway request, request digest, idempotency receipt and bounded recovery fence. Only its confirmed original owner receives an in-memory dispatch permit holding the executable input. F stores validated encrypted response evidence, settles model usage and the Run reservation, and publishes the terminal receipt/events atomically. No transaction or SQL connection remains checked out while the provider runs. Lost commit acknowledgments cause identity readback, never provider redispatch.

If F fails, the original owner attempts an exceptional evidence-only checkpoint before handing recovery the same invocation. A crash after provider completion but before F or that checkpoint can lose the output; recovery reports uncertainty and preserves conservative liability rather than repeating the request. This deliberate tradeoff removes an unconditional response-preservation commit. A stored `validated_receipt` excludes the value: the encrypted invocation response owns the output once; Run history and idempotent replay hydrate that value only for result consumers. Missing retained content is an integrity error, never a successful empty result.

Immediate input is absent from required SQL writes. `inference-capture.ts` may export the prepared input and output to the existing tracing backend after delivery, with at most 16 retained captures and 32 MiB of encoded input plus sealed-response bytes per process. It adds no second input-history store. Hosts without a retained background callback, overloaded capture queues, exporter failure and process loss may omit it. Live completion and recovery use the same capture owner. A delayed callback rechecks retention under a shared Run lock and synchronously enqueues the trace before releasing that guard; external delivery remains asynchronous. A purge that commits first prevents full capture, while a successful enqueue cannot be retracted from an external backend by a later purge. Missing/purged rows, queue refusal and failed retention checks still emit one compact generation with cost/usage and omitted-content metadata. Full input history is therefore best effort, independent of final accounting/result durability. Queued/native input remains durable; Tasks share their existing encrypted wake payload. No authority, wallet balance or mutable policy is cached.

The host supplies an absolute lifetime budget (300 seconds in the web adapter). Provider execution supports at most 240 seconds, admission has a cumulative one-second database budget, completion has 30 seconds and delivery reserves five seconds. Evidence persistence retries only transient local database failures, at most three attempts of ten seconds within the remaining completion window. SQL checkout and statements share a deadline; only an attempted COMMIT with unknown acknowledgment is classified as ambiguous admission. These are infrastructure safety bounds, not throughput claims.

Authentication/rate/replay SQL shares bounded process admission headroom; body upload and catalog/context preparation do not retain that permit. Replay reads and A start separate database budgets. Preparation propagates its latest-start deadline and cancellation through catalog, context and object reads, leaving the accepted execution/completion/delivery window intact. Current API-key facts are read together, with `last_used_at` sampled at most once per minute to avoid serializing every call on a diagnostic timestamp. This does not cache authority. Best-effort request-summary writes have bounded concurrency and a 500 ms deadline and may drop under pressure; durable billing, events and actor journals do not.

Provider completion uses a monotonic transport marker translated onto the accepted database deadline. A timely response can settle after its execution deadline without becoming timed out merely because Macrofold was slow. The existing recovery job is fenced through execution plus completion allowance. A failed F with confirmed saved evidence advances the generation and makes evidence-only recovery due; missing durable response evidence after the fence is settled provisionally without another provider call. Cancellation aborts transport through the observer but does not let maintenance discard metering during the live owner's completion allowance.

Direct output bypasses replay storage. JSON returns a terminal 200 with embedded usage/billing; exceptional 202 receipts contain identity and a recovery reason. SSE starts with a receipt, forwards transient deltas and ends with the same settled result. Async preference and queue-only input are rejected for this endpoint. The private `execution_owner` field distinguishes the request owner from actual queued Task children; it is not a customer delivery mode.

Each queued invocation records a shared gateway request and decision receipt. `prepared` preserves its credential-free executable body and digest; `dispatch_started` commits before HTTP. Immediate admission combines dispatch intent with A and retains executable input in memory. `responded` records sealed response and usage; immediate F combines it with validation/accounting/publication, while bounded steps combine it with step settlement before advancing. Unfinished dispatched calls become `uncertain`; no worker repeats them. A committed response is replayed locally after restart. Cancellation/deadline fences publication and additional steps, with HTTP abort as best effort. A late response is retained as invocation evidence without reviving or settling a terminal run twice.

Settlement reuses the gateway journals and run reservation. Missing usage conservatively consumes the request bound provisionally. Late evidence is available for operator reconciliation; automatic delta correction is deliberately deferred. Provider cost is an estimate under frozen rates, not an invoice. Managed customer charges never exceed the admitted ceiling. BYOK remains an exact connection with no managed fallback.

Bounded model requests are finite and their output allowance is aggregate. The only tool is `read_context` over preauthorized immutable artifact references. It rechecks file grants/audience/expiry and declared snapshot consistency, persists the read receipt, and feeds that exact evidence into later invocations. This is a trusted broker, not arbitrary customer code or remote-MCP multiplexing. Adding tools requires an explicit request shape, authorization and recovery semantics.

The retained bounded/queued owner continues ready transitions for at most 16 transitions or five seconds between durable boundaries, then yields. Every model dispatch still wins its own persisted invocation compare-and-swap under the current Run generation; the owner cannot adopt a replacement generation. Intermediate response evidence and shared model settlement commit together. Evidence/context object reads occur outside SQL before their separately authorized publication. Current control reads reuse accepted immutable configuration rather than downloading it on every transition. Optional persistence-timing enrichment runs only when a retained background callback is available.

Immediate and queued final publication share the same locked current-authority guard: expected owner generation, initiating actor, referenced context and actually used bounded evidence grants, context expiry and retention. A revoked grant removes the result value while preserving already incurred usage and charges. A displaced owner cannot finish; its successor may finalize the saved response without making another model call. The final control refresh remains necessary after settlement because metering review can request cancellation and the deadline can pass during accounting.

## Tasks and evidence

Tasks are sequential recipes with an optional exact-value investigation branch. Wake IDs and body digests deduplicate observations under a task row lock. Child admission counts committed consumed budget plus outstanding ceilings, then uses the ordinary run wallet reservation. Task allocation is a ceiling, not another financial journal. Cancellation cannot free ambiguous liability before settlement. Waiting/review holds no run capacity.

Terminal child events make the existing parent Task job ready in the same commit. A bounded process hint accelerates progress (four active Tasks, at most 64 queued IDs); lost hints and process death fall back to the durable maintenance job. Task row locks serialize duplicate/out-of-order wakes, cancellation and publication. A concurrent terminal wake cannot be overwritten by a later five-second repair schedule. Graceful maintenance shutdown drains the accelerator. Publication stages immutable bytes under the storage-preparation lease, then atomically registers the artifact, evidence pin and task transition. Publication rechecks task identity, horizon, principal and workspace. Unreferenced staged bytes can be collected after the existing grace period. Artifact row locks serialize pin/release races.

`task-run-payload.ts` owns shared executable Task input. A wake stores input/context once; each child stores its wake identity, digests and accepted provenance, plus the investigation's additional decision record. Explicit payload reads bulk-load and verify tenant/Task/wake/Run bindings and digests. Task/trigger linkage is included in initial Run admission rather than rewriting large configuration afterward. Closure releases evidence pins; wake bytes remain while retained child history still depends on them and are erased after the last dependent history expires. Workspace purge removes detailed decision/task content and published objects while retaining financial identity. Application acceptance/rejection is a separate immutable receipt and never overwrites provider evidence.

## Rollout and rollback

Migration 055 replaces per-update payload shape checking with an input/identity-change trigger, extends content-free scheduling views, indexes unsettled gateway requests, and adds the restore inventory journal kind. Apply schema and compatible API/recovery/runtime producers together after draining or fencing affected active local work. It never rewrites or deletes accepted identities. Migrations 035–038 add run kinds/shape constraints, mode-aware scheduling projection, RLS-protected invocation/definition/tool/task records, and ownership links. Existing runs default to `native_agent`. Do not alter an applied migration or discard an environment based on the old pre-launch note.

1. Deploy the compatible schema and all readers/workers together; decision execution is supported without an opt-in flag.
2. Drain or fence old native-only pollers and durable Workflow invocations. Verify the deployed web, poller and Workflow code all route lightweight kinds before worktree access.
3. Rehearse mixed queues, cancellation, provisional settlement, retention/restore, and the two contract fixtures on staging.
4. Configure provider credentials and paid-execution authorization. Admission, scheduling and dispatch support lightweight runs by default.
5. To stop new work while draining, set `RUN_ADMISSION_ENABLED=false` and keep compatible dispatchers running to finish already admitted work. Never roll back to a native-only reader while lightweight rows remain.

Optional lower bounds: `DECISION_INPUT_MAX_BYTES` (262144), `DECISION_CONTEXT_MAX_BYTES` (2097152), `DECISION_CONTEXT_MAX_ITEMS` (64). Invalid or expanded values fail configuration checks. `LIGHTWEIGHT_CONCURRENT_RUN_LIMIT` defaults to 2,000 lightweight Runs independently of the 200-native fleet ceiling; the total emergency ceiling defaults to their sum; `LIGHTWEIGHT_RESERVED_SLOTS_PER_ORG` defaults to zero and withholds that many account slots from native claims. It never expands account/global capacity or preempts an active run. Reserving all account slots prevents new native claims, so choose this deliberately.

## Measurements and deliberate limits

[Direct generative streaming](../api/streaming-implementation.md) adds a transport-neutral output sink to the existing executor. Provider adapters assemble a full response; the invocation owner persists and settles it once. Bounded-agent output is coalesced into existing run events; direct output bypasses the event store. Interrupted provider streams retain partial evidence and incomplete usage without repeating dispatch.

Receipts expose admission, context resolution, queue wait, provider duration,
response persistence and validation milliseconds. Immediate admission includes
SQL checkout, locks and the A commit; queued receipts retain their preparation
timing. Bounded receipts report the final invocation's provider/persistence
timing, while every invocation stores its own timings. Missing measurements after
process death remain missing. Provider duration includes adapter serialization,
network transport and response normalization, not isolated model compute.

For detailed local profiling, `inference-timing.ts` publishes numeric stage
durations through Node's opt-in `macrofold.inference.timing` diagnostics channel.
HTTP stages cover authentication, rate limiting, body reading/validation,
fingerprinting, replay, preparation and admission; the executor separately
measures evidence preservation and finalization. Ordinary requests without a
subscriber retain no profiling entries. The channel never publishes payloads,
credentials, SQL arguments or customer content. These observations and the
receipt stages are not a hosted latency SLA; see [measured evidence](verification.md#near-full-context-profiling).

The fixture benchmark measures the whole local submission/execution path, SQL statement/write counts, row bytes and artifact count against a 5-second application fixture budget. See actual results in [verification](verification.md). No VM startup, worktree hydration or object output is needed for the small inline decision.

Remote context-provider registration, arbitrary bounded tools, model aliases, warm native pools, mutable definition aliases, a DAG builder and automatic late-charge correction are intentionally absent. The current typed ports support replacing provider transport or context reads without moving policy into vendor adapters. The byte-based input bound is exclusively a conservative billing reservation, never a context-window validator. Admission still prepares and validates the provider payload; dispatch still authorizes its bounded cost. Providers enforce actual token windows, including Jev's total and per-question limits. A provider-accurate tokenizer or counting API could add preflight validation later; an approximate byte count cannot safely reject a request as too many tokens. Existing no-retry and provisional-liability handling applies to provider failures. Shadow fixtures demonstrate adapter disagreement/provenance, not model quality.

## Decision tracing

The [observability integration](../observability/README.md) records every platform-mediated decision invocation as a generation, including Jev through OpenRouter/TypeSafe. Explicit context reads are retriever observations; actor, task, definition and request identities travel on every observation. Committed settlement supplies charges, budget cost, usage and provider estimates without another SQL trace store.

## Shared SQL ownership

`queryGroup` pipelines at most 64 ordered statements on an existing managed transaction when no intervening domain decision is needed. It owns no checkout, COMMIT or retry, drains all submitted results before rollback, and discards broken sockets. Set-based ledger operations consume a freshly locked account snapshot and preserve immutable deduplication/journal identities even for zero-cost settlement. Domain helpers accepting current Run/account state require the caller to own its lock or initial insertion; callers must not pass an old status snapshot. Provider preparation and encryption happen before shared financial/Run locks.

The source-level warm-path budget remains above the design target of 12 sequential database waits. For an inline, managed, non-streaming request using an API key and idempotency key, with no workspace, expired credits, webhooks, or exceptional recovery: authentication uses 3 groups, early replay 3, admission 14 and finalization 15, totaling **35**. OpenRouter chat adds 3 for preparation and 1 for the admission revision check, totaling **39**. Each setup pipeline and commit counts as one group. Optional capture adds its own 3-group transaction after delivery; request analytics uses a separate 4-group transaction. These are source estimates for that specific path, not universal counts or measured wire round trips. Diagnostic window totals can include overlapping background transactions. Saved references, streaming read authorization, OAuth, current funding expiry, webhooks and failure handling require their own work. The [verification record](verification.md) owns measured latency; a local latency pass does not satisfy the still-open 12-wait target.
