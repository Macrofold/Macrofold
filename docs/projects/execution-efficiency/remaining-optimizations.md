# Remaining execution optimizations: implementation design

Status: **implemented locally; performance qualification in progress**. This is the detailed follow-up to the existing [feature specification](../execution-efficiency-feature-spec.md) and [technical design](../execution-efficiency-tech-design.md), not a second execution architecture. Implementation was approved in chat; actual completion and measurements are tracked below and in the maintainer checklist. [Maintainer work](../../maintainers/TODO.md#execution-efficiency-redesign) keeps original unfinished qualification separate from these proposals.

The [optimization verification record](optimization-verification.md) owns source provenance, actual checks, matched measurements and remaining acceptance gaps.

## Decisions and order

1. Implement the [opt-in profiler](../performance-profiling-tech-design.md) first so foreground, provider and background work can be measured reliably under concurrency. Capture the unchanged baseline with the new instrumentation before optimization.
2. Reduce sequential SQL waits through existing transaction-aware policy owners. Preserve compact admission A, one provider invocation, final accounting/result F, and the exceptional evidence path. Do not create a universal executor or move money into background work.
3. Remove duplicate payload traversal and serialization within a single owned request. Preserve canonical fingerprints, input bounds, exact provider bytes, context checks and immutable prepared facts. No cross-request prompt cache is needed.
4. Resolve the existing tracing content policy before producers retain/copy content. Keep full tracing the default. Make metadata-only mode actually avoid optional content work while retaining cost, usage, attribution and meaningful failure observations.
5. Offer explicit opt-out for HTTP request/product observations with truthful reporting. Keep it enabled by default. Defer statistical sampling until its reporting contract can represent sample rates and gaps correctly.

Steps 2–3 preserve customer behavior. Step 4 preserves the existing operator policy but makes its implementation consistent. Step 5 intentionally loses diagnostic detail only when an operator chooses it. Each stage has its own verification gate; implementation must migrate all affected callers before claiming that stage complete.

## Baseline and non-negotiable boundaries

The [verified Linux cohorts](../execution-efficiency-verification.md#co-located-linux-hundred-call-cohorts) measured server-overhead p95 of 60–85 ms with full tracing for 1.494-MB context at five requests/second. This is a healthy local fixture result, not a production guarantee. Traced Jev caller-overhead p95 was 112.678 ms. The same-source macOS misses remain recorded.

The pre-change foreground dependency graph was approximately **35 waits for Jev/Anthropic and 39 for OpenRouter chat**, including current HTTP protection, replay, A and F. Diagnostic-window totals additionally include background overlap. Do not compare those windows to future correlated foreground counts as if their definitions were identical. The original 12-wait target remains unmet; no stage here declares it achieved or changes it silently.

Traced near-full-context preparation averaged about 15–17 ms and request fingerprinting about 5–6 ms on the Linux fixture. These entire durations are not removable: schema validation, canonical identity, protocol adaptation and financial bounds are necessary. Savings below are hypotheses to measure, not latency promises.

Preserve:

- Restricted tenant transactions, current principal/resource/credential authority and revocation fences after lock waits.
- Global/organization admission, existing lock ordering, exact credit expiry, immutable journals, uncertainty and financial deduplication.
- Same-key replay before new-execution eligibility checks; changed-content conflicts; one confirmed dispatch permit.
- Settled usage/result before final success, strict model-error fences, durable webhook/replay obligations and no paid redispatch after ambiguity.
- Queued/native executable input, verified checkpoints, retention/purge fencing and cold continuation.
- Finite memory/work/SQL/host budgets; neither larger pools nor missing checks are performance optimizations.

No database migration is expected for the core SQL/payload refactors. If source inspection proves one necessary, specify its invariant and activation/rollback procedure before adding it; do not change migration 055 in place. All original CI, pooler, hosted and sustained mixed-load gates remain open until actually verified.

Current correlated profiles measure **25 foreground groups for Jev/Anthropic and 28 for OpenRouter chat**, meeting this stage's 25/29 target while preserving the original unmet twelve-group criterion. See the verification record for timing and observer-effect limitations.

## Dependency and delivery map

| Stage | Depends on | Deliverable | Exit evidence |
| --- | --- | --- | --- |
| O0 | Profiler P0–P6 | Correlated baseline, lock/dependency graph and source identity | Foreground/background counts reconcile; no fixture-global attribution under concurrency |
| O1 | O0 | Transaction-owned SQL composition in existing owners | Real PostgreSQL races, rollback/unknown-commit and shared caller tests; measured waits/lock holds improve |
| O2 | O0; may develop independently of O1 | Request-local immutable preparation reuse | Canonical/provider-byte equivalence, bounds, no mutation after preparation; reduced scans/allocations |
| O3 | O2 where prepared content is reused | Producer-aware trace content policy | Off/metadata/full matrix across immediate/native/bounded/tool/recovery; no content capture in metadata mode |
| O4 | O0; operator choice remains separate | Optional HTTP-observation controls and honest report semantics | Default unchanged; disabled mode omits only named observations; billing/security intact |
| O5 | O1–O4 | Matched complete qualification and documentation | Actual results and remaining gaps published; no fixture result called hosted acceptance |

The implementation checklist and exact owner contracts below are normative for this proposal. Named interfaces are internal module boundaries, not public endpoints; the current implementation guides own exact exported names. Keep implementation in existing packages and preserve the current public API unless a documented reporting semantic change requires regeneration and full SDK verification.

## SQL batching

Optimize the existing transaction-aware domain owners, not a special low-latency endpoint. Public contracts, authoritative records, financial semantics and actual provider dispatch count remain unchanged. Do not add a stored-procedure execution engine, generic SQL planner, second transaction manager, Redis, wallet escrow or process-local authoritative permission cache.

The ordinary inline, managed, API-key, idempotent, successful immediate path has the following source-derived dependency graph. It excludes optional background diagnostics, context references, BYOK connection reads, OAuth authority checks, expired credit work, metering-bound breaches, duplicate completions and configured webhook fan-out; profile those separately. Counts are application-submitted wait groups, not SQL statement counts or directly measured network round trips.

| Boundary | Current groups | Ordered operations |
| --- | ---: | --- |
| Authentication/rate | 3 | Transaction setup; combined current key/rate facts; commit |
| Cheap replay | 3 | Transaction setup; read-only existing identity; commit |
| Admission A | 14 | Setup; idempotency advisory+lookup; organization advisory; wallet lock+expired-lot reads; reservation write; circuit-breaker read; global-capacity advisory; capacity observation; Run+recovery-job insert; current actor check; gateway+invocation writes; accepted/prepared event append; HTTP idempotency insert; commit |
| Completion F | 15 | Setup; Run lock+invocation evidence; response evidence write; publication actor check; Run/gateway locks; model-accounting writes; usage event; fresh Run/clock; terminal Run+job writes; wallet lock+settlement dedup; consume lots; journal+balance+expiry observation; terminal event; webhook eligibility; commit |
| OpenRouter current catalog | +4 | Preparation transaction setup/read/commit; admission current-revision observation |

Total: approximately 35 groups for Jev/Anthropic and 39 for OpenRouter. Background setup overlapping a request's diagnostic window is not foreground work; do not use the present process-wide window sum as its exact attribution. Keep the existing successful financial post-drain checks.

## Shared ownership and limited new interfaces

Retain `packages/db/index.ts::queryGroup` as the sole ordered pipeline facility. It already enforces managed transactions, at most 64 statements, no overlapping groups, result drain, failure propagation and no COMMIT submission inside a group. Extend domain modules using ordinary named functions and `pg.QueryConfig`; do not create an operation graph DSL.

The necessary new interfaces are narrow read/plan/apply boundaries at existing owners. Names below are proposed exact targets, subject only to normal collision/name checks before implementation:

1. `ledger.ts`: `creditStateQueries(org)` owns the ordered account and expired-lot SQL; `creditStateFromResults(tx, org, results)` validates row shapes and returns a transaction-bound `LockedCreditState`; `prepareReservation(state, amount)` owns current billing-hold checks, expiry allocation, available-balance validation and immutable delta preparation; `applyReservation(tx, prepared)` owns all resulting lot/journal/wallet SQL. Existing `reserve(tx, org, amount)` remains the convenience composition of these same functions. Existing Host/tool/native callers continue to get exactly its old return semantics.
2. `execution-admission.ts`: `executionCapacityQuery(org, kind, policy)` and `capacityDecision(result)` extract its existing SQL/predicate decoding, while `executionCapacity` remains the query-owning wrapper. It must not acquire the global lock itself or change fair-turn scheduling semantics.
3. `actor-authorization.ts`: a narrow `actorAuthorizationQueries(subject, scopes)` and decoder can expose already owned current facts for ordered composition. Preserve all principal variants, OAuth resource/client/session checks and Worker restrictions. The present `actorAuthorized` remains its ordinary wrapper. Use an array of scopes to avoid repeating the same API-key/member lookup for SSE `runs:write` plus `runs:read`; policy must require every requested scope. This is not a cached authorization decision.
4. `model-gateway.ts`: expose the existing narrow gateway settlement lock statement and a typed decoder creating `LockedModelSettlement`. Its identity is `(tx, organization, Run, request)`; the immutable accepted rates and incoming usage are separate. Add an internal `settleLockedModelRequest(tx, state, model, usage, ...)` called by both the existing transaction-opening wrapper and `settleModelRequestInTransaction`. Only a loader that executes the ordered lock statements creates this state. The F composition may combine those statements with its existing invocation read. Callers must not supply an ordinary JSON object or an admitted Run as proof of current settlement authority.
5. `events.ts`: split existing event preparation, append SQL and post-append effects into module-owned operations. `prepareEventAppend` performs bounded input/producer deduplication preparation; the append query still owns sequence allocation and persisted source cursor; `finishEventAppend` checks row counts/producer identity and registers effects. The convenient `emit/emitBatch` continue to use these operations. These are domain operations, not arbitrary caller-built SQL plans. Do not expose an `emit=false` or `skipEffects=true` flag.
6. `webhooks.ts`: add `enqueueWebhookBatch` and its module-owned eligibility query plus bulk outbox publication. Keep `enqueueWebhook` as its one-item wrapper. One batch contains prepared public webhook envelopes associated with actual inserted event IDs. Reuse the existing delivery uniqueness index and dispatch owner.

Constructors/decoders should remain private to each policy owner wherever possible. When batching requires an exported owner decoder, it is a trusted internal composition interface with typed results, not proof that arbitrary supplied rows came from locks; do not describe it as a security capability. Only the reviewed coordinator feeds it results from the owner's query descriptors. Preserve normal server-side/RLS authority independently.

Prepared financial/settlement plans are single-use: claim their consumed marker before applying any mutation, check transaction/resource identity and expected current version/status/affected-row counts, and reject reuse. A failed apply must roll back and reload through the owner; the same plan cannot be retried after another mutation even in the same transaction. Return separate immutable receipt data for later readers. This prevents a same-transaction stale balance/request from being used twice.

Transaction-bound values may be represented by an unexported symbol/private state and the exact `Tx` reference, with runtime checks for transaction and resource identity. Keep this implementation small; no globally reusable capability hierarchy. They never survive commit/rollback, cross a worker boundary, enter a cache or authorize a later transaction. The managed transaction must expose an active-transaction assertion if needed; callers cannot establish liveness merely by retaining a pooled-client object, since the pool may reuse it. A per-transaction opaque identity created in `transact` and cleared in `finally` is sufficient; it is not a new transaction manager.

The lower-complexity fallback is to retain an extra narrow read rather than introduce elaborate proof plumbing. If implementing these few typed boundaries requires a generalized execution framework, stop and simplify the proposed interface before changing callers.

## Admission A sequence

Implement in this order, retaining the current early replay and final locked idempotency check:

1. Before opening A, prepare immutable provider bytes, canonical digests, model terms, UUIDs and candidate principal identity. This is already mostly implemented. Do not resolve mutable authority from those values.
2. In A, keep `http.ts::cachedResponse` advisory lock+lookup first. A completed or in-progress identity returns without a new liability or dispatch permit.
3. Group the organization advisory lock, account `FOR NO KEY UPDATE` query and expired-lot `FOR UPDATE` query in that exact statement order. Use `clock_timestamp()` when the expiry query executes, after the account lock. Do not place expiry before that lock or use transaction-start time as the current expiry boundary.
4. Decode/validate the returned state; compute account policy, expiry allocation and reservation delta using the ledger owner. Freeze the ledger decision time from this account-locked observation, as the current code reserves before waiting for global capacity. Credits expiring during the later capacity wait remain protected by that same financial decision, exactly as in the current reserve-before-wait transaction; holding an opaque transaction token does not freeze time. Keep this as one atomic transaction. If existing owner behavior cannot be reproduced with the prepared delta, retain the original reservation timing instead of inventing a new expiry policy. Check billing holds, available funds and account timeout/storage policy before proceeding. Do not yet mutate the wallet.
5. Submit one ordered guard group: global-capacity advisory; shared capacity observation using the already protected account policy; current circuit-breaker read; current actor facts. Actor facts must run **after the potentially slow global lock acquisition**, not earlier in the account group. Maintain the existing organization revocation guard. This preserves the authority recheck after waits. Saved references and exact BYOK/current-catalog checks retain their current fresh-check semantics; batch them only where their own locks/revisions permit it.
6. Decode every guard result and reject on any failure before applying the prepared reservation or inserting a Run. Check remaining host/deadline budget after these waits. A denied guard rolls back all work and leaves no Run, durable reservation or dispatch permission.
7. Group `applyReservation`'s ordered mutation(s) and the existing Run/recovery-job insertion after all required decisions succeed. All inputs are now known. Require the Run insert's expected row counts; any subsequent SQL failure drains the group and rolls back everything. Keep one organization projection update for expiry/reservation deltas where the shared ledger owns that calculation; never modify the same organization twice in sibling data-modifying CTEs expecting visibility between them.
8. Keep the gateway/invocation mutation, event append, HTTP idempotency save and COMMIT under their established owners initially. Only after qualifying steps 1–7 consider composable event append with known-ID writes. Do not move the HTTP idempotency row into inference-only SQL, because ordinary mutations and their scopes use the same transport owner.

Ordinary-path estimate: A14 → approximately9 groups. The potential five saved groups are organization+wallet setup (2→1), breaker/global-lock/capacity/actor (4→1) and reservation+Run insertion (2→1). This is an estimate to verify against actual query groups; expiry, references, BYOK, OAuth and catalog checks can add work. The estimate is not permission to remove a semantic decision simply to match it.

Queued/native admission should use the same reservation boundary wherever it already holds an organization/worktree policy guard. Do not introduce an organization→existing-Run lock edge that reverses completion's Run→wallet order. In particular, `host-allocations.ts`, `tool-broker.ts` and ordinary `reserve` consumers must not start acquiring a new organization advisory solely because immediate admission uses one. Keep the special ordering in the admission coordinator; the ledger owns only financial locks and policy.

## Completion F sequence

The same finalizer serves original completion and evidence-only recovery. Preserve timely-response timestamps, output-retention decisions, uncertainty and the exceptional evidence checkpoint.

1. Extend `inference-invocations.ts::currentInferenceState`'s initial ordered group to include the narrow gateway-request lock after the Run lock and invocation evidence observation. Decode identity, generation, current terminal/purge status and request ownership before mutation. Pass only the typed same-transaction settlement state to the gateway owner. Native standalone settlement uses the same loader; bounded completion composes it under its existing Run-first lock.
2. For a nonterminal, nonpurged Run without saved response, response evidence and publication authority observations may share an ordered group: their inputs are already known after step1. Current behavior permits storing incurred evidence before disclosure authorization; a denied principal still cannot receive the value. Do not group a response write before checking the actual saved invocation identity or purge flag. References/bounded evidence keep their separate validation barriers where results are needed.
3. Compute billing using the existing single model-accounting owner, including known/unknown usage, retail/provider split, capped liability and bound breach. Make the ordered gateway update, Run budget delta and usage insert one group as today. Prepare the `usage.updated` event using the same committed amount; append it in this group only through the shared event owner and only when no intervening result-dependent decision is needed. Check all mutation row counts and then process event effects. Native streaming still cannot release its terminal tail until this transaction commits.
4. Preserve a **fresh post-settlement Run/clock observation**. Settlement can set `cancel_requested` for a metering breach, update budget/cost counters, and cross the deadline. Do not substitute the initial Run snapshot. This read can be the last ordered statement in the model accounting group, after the updates, with its result returned as `updatedRunControl` by the shared settlement owner. It must use `clock_timestamp()`, not a stale JS timestamp. SQL execution order is crucial; this is not a sibling CTE read of a changed row.
5. Determine the final status/receipt from that updated control and trusted provider completion timestamp. Group the terminal Run+dispatch-job writes and current wallet/settlement-dedup observation where every input is now known and the existing Run→wallet ordering remains. Native per-model settlement does not terminalize the parent or release its whole reservation.
6. Preserve shared lot consumption, immutable settlement event, balanced journals and released-reservation projection. Do not merge credit-allocation math into inference code. A duplicate settlement returns the existing financial receipt without reapplying deltas. The zero/zero BYOK path still records its financial identity.
7. Append the terminal event and observe matching webhook endpoints in the same ordered group, using the shared event/webhook owners. Build/publish any outbox rows afterward from the actual inserted event identities. Promised webhooks and Task wakes remain in F; delivery/trace export remains after commit.
8. Check all facts then COMMIT. Any unknown COMMIT acknowledgment follows the existing readback/evidence-only recovery path. No pipeline may prequeue COMMIT ahead of row validation.

Ordinary-path estimate: F15 → approximately10 groups with four straightforward batching reductions (initial lock reuse, evidence+actor, accounting+usage append, terminal mutation+wallet), plus terminal event+webhook eligibility (one more). Returning the fresh control from the accounting group could save a sixth group; qualify it independently and do not count both a separate refresh and a returned refresh as removed. A conservative combined target is **≤25 foreground groups** (auth3+replay3+A9+F10), and **≤29 with current OpenRouter preparation**, before further independently measured improvements. This is a staged engineering target, not a revision of the original twelve-group criterion. Report a measured dependency map before deciding whether that older goal should be replaced.

## Webhook fan-out and event effects

Current `enqueueWebhook` performs one endpoint read and two sequential writes per selected endpoint. This is a meaningful scalability problem even if the zero-endpoint profile passes latency.

1. Filter enabled/not-deleted/event-matching endpoints and optional endpoint-ID ceiling in one tenant-scoped query. Return IDs only; publication does not need endpoint secrets or arbitrary `data` bodies.
2. For each authorized `(eventId, endpointId)` pair, allocate delivery/job UUIDv7 IDs and prepare the existing content-free envelope in TypeScript. Preserve current endpoint selection: omitted/empty `endpointIds` currently means all matching endpoints, not zero. Do not accidentally change that semantics.
3. Bulk insert deliveries with a bounded `jsonb_to_recordset` input and `ON CONFLICT DO NOTHING`. Use `RETURNING` identities to insert jobs only for newly created deliveries, in the same data-modifying CTE. This is an actual data dependency, not an assumed sibling order. Preserve migration012's uniqueness `(organization, endpoint, event)` for non-replay deliveries; replay remains a distinct explicit operation.
4. Bound statement input using existing event batch/resource limits or conservative byte pages; no arbitrarily large array. Chunking stays in the same source transaction, with all resulting required obligations durable at acknowledgment. Report pages/bytes so large fan-out is visible. Do not silently omit endpoints at a limit.
5. Existing `emitBatch` is the owner of event sequence/source cursor, event-specific Task wake and trace effects. Refactoring must preserve duplicate-producer payload conflict checks and return shape; only actual inserted terminal rows create effects. Keep Task's wake identity in the source transaction, and its bounded nudge after commit. Do not bulk-append application events without running this shared effect path.

Typical selected-endpoint cost becomes a bounded eligibility read plus bulk delivery/job write per page, rather than1+2N serial operations. The no-endpoint path can share its read with terminal event append. This benefits native, bounded, Task and Git/connection webhook producers through `enqueueWebhook`, not only direct inference.

## OpenRouter catalog and the six HTTP groups

Keep the current authoritative catalog revision read and correct enabled-model decision. Frozen price-object parsing is already cached. Do not promise eliminating all four catalog groups: the warm preparation snapshot and fresh A revision check serve different purposes. First place the A revision statement in the already necessary current guard group, saving at most one group; preserve conditional refresh outside SQL. Combining preparation lookup with cheap replay is a separate change requiring exact replay-before-new-model semantics and cannot cause completed replay to fail because a model is now disabled.

Leave authentication/rate and cheap replay as separate transactions in this stage. Invalid/abusive traffic must still consume its rate accounting; replay must work when new-execution admission is saturated or model credentials are unavailable. Removing these six groups by keeping a transaction open across JSON parse/model preparation or moving rate accounting into rollback-prone admission would trade away meaningful behavior. Profile their residual cost before proposing a separate narrowly scoped transport change.

## Adoption map and explicit non-changes

| Owner/caller | Required adoption |
| --- | --- |
| `inferences.ts`, `direct-inference.ts`, `inference-invocations.ts` | A/F composition and current transaction-bound facts; no route-local financial SQL |
| `model-gateway.ts` | Shared settlement loader/apply; native success/failure/SSE terminal barrier and strict-error fence unchanged |
| `inference-engine.ts` | Bounded/queued response+settlement reuses same facts; generation and durable intermediate evidence unchanged |
| `runs.ts`, `engine.ts`, `cloud-engine.ts` | Native/queued reservation and final release use ledger wrapper; only adopt combined groups where existing lock order permits |
| `host-allocations.ts`, `tool-broker.ts` | Shared reservation/settlement behavior; do not grant a stale locked balance or change fixed-fee dispatch semantics |
| `events.ts`, `webhooks.ts`, `decision-task-wakes.ts` | All batch effects and outbox obligations preserved, with set-based fan-out; durable Task wake remains |
| REST/customer-MCP and all SDKs | No public shape change; actual replay/errors/stream semantics must remain equivalent |

No new persisted schema is inherently required. If a SQL projection or supporting index proves necessary, add a normal forward migration after EXPLAIN evidence; do not silently modify migration055. The design does not change compute topology, provider retries, limits or optional tracing defaults.

## Verification sequence and stop conditions

1. Record source revision+dirty digest, exact group/statement/byte counts, lock order and transactions for managed/BYOK, API-key/OAuth, JSON/SSE, direct/queued/bounded/native paths before editing. Include zero/one/many webhook endpoints and expired/unexpired lots. Use the maintained disposable DB/profile wrappers; no paid provider call is required.
2. Implement one owner extraction at a time. First prove wrapper equivalence using existing ledger/gateway/event tests, then adopt sibling callers. Do not do a large callsite rewrite before the shared owner preserves its contract.
3. Real PostgreSQL barrier races: long organization/account/global-lock waits followed by key revocation, membership demotion, billing hold and catalog disable; separately assert credits expiring before the ledger decision are rejected/expired and credits expiring during the later capacity wait match existing reserved-credit semantics; no unauthorized Run or unpaid liability. Preserve authority-after-waits ordering. Test concurrent capacity admission, one hot tenant/many tenants and idempotent duplicate first submissions.
4. Financial cases: expiration partially protected by reservations; zero-cost BYOK; managed usage; partial/unknown usage; over-bound cancellation; duplicate/stale completion; credit debt; many lots; model failure fence followed by another attempted model request. Assert journals sum zero, one usage/settlement, and no stranded holds. Do not merely assert fewer function calls.
5. Faults: statement failure in every new group, server timeout, pipeline socket loss, lost COMMIT acknowledgment, actual process death after A/provider/F; no redispatch and correct uncertainty. Cross-transaction reuse of a locked-state value must reject before mutation, including when a pool returns the same physical client later.
6. Publication cases: purge/revocation while provider runs; already purged/terminal late accounting; context expiry; returned post-settlement controls showing breach cancellation and current clock; exact output replay. In native SSE, no terminal success before accounting commit.
7. Event/webhook cases: contiguous per-Run sequences, producer duplicate exact/conflicting payload, source cursor fence, zero/one/large endpoint sets, duplicate delivery insertion, explicit replay, endpoint disabled before selection, rollback, Task duplicate/out-of-order wake and no committed source event lacking required outbox jobs.
8. Retake matched Linux protocol cohorts with 1.494MB contexts,100 calls,5rps, tracing on/off, plus a bounded mixed-load cohort. Publish mean/p50/p95/p99, full foreground counts, optional background separately, transferred bytes, lock/pool waits and failure counts. Compare the same code/config/topology and keep Mac/hosted limits explicit. Target server p95<100ms without worsening tails/lock hold, and the staged≤25/29 groups; do not claim millisecond savings from counts alone.
9. Stop/rework a stage for changed balances/status/output semantics, increased lock hold that defeats the gain, unbounded fan-out/parameter pages, any new lock inversion, or a pipeline requiring an unresolved domain decision. Never drop current-authority reads, weaken replay, make settlement async or disable tracing to force a pass.

Rollback is source-level reversal to the prior owner composition, preserving admitted identities/receipts and current recovery. No database cleanup or destructive reset is needed. Do not run two competing settlement implementations behind a permanent feature flag; qualify staged changes then retain one authoritative implementation. Deployment/provider qualification and existing full-CI gates remain open independently.

## Payload and diagnostic boundaries

The co-located Linux traced cohorts measured mean preparation 15.42/16.34/17.31 ms and HTTP fingerprinting 5.99/5.17/5.59 ms for Jev/Anthropic/OpenRouter at 1.494 MB context. These stages include necessary validation, normalization and hashing; the figures are not promised removable time. Full traces also exported about 108 MB per hundred-call cohort. A disabled exporter can reduce background work but does not remove required accounting.

Current preparation already does important work correctly: `prepareInvocation` canonicalizes the provider body once, derives its digest/length from that text, reuses the exact text for the HTTP transport, and only encrypts queued executable input. Keep that behavior. `TRACING_ENABLED=false` already prevents trace attribution/capture at many call sites. Before this follow-up, `TRACING_CAPTURE_CONTENT=false` applied inside `LangfuseTraceSink`, too late to prevent some producer allocations and retention SQL. HTTP request observations were bounded/best effort but had no disable flag and retained the enclosing handler scope. The implementation now applies content policy at producers and extracts scalar HTTP observations into an independently configurable owner; the documented non-background fallback remains synchronous and bounded.

Do not merge these different identities:

| Identity | Current meaning | Must remain |
| --- | --- | --- |
| HTTP fingerprint | SHA-256 of method, path, query string, If-Match and canonical submitted body | Detects changed requests under the same principal/route/idempotency key; independent of model eligibility and resolved references |
| Definition/context digest | Accepted definition and context including platform-added provenance | Explains the actual evidence used; raw submitted context and resolved context are different objects |
| Provider request digest | Canonical final transformed provider request | Identifies exactly dispatched bytes, including bounded tools and billing controls |
| Invocation ID | One accepted paid intent | Two keys with identical content remain two intentional invocations |

No global cache of prompts, mutable authorization, wallets, request results or caller-provided digest strings is introduced. No new service, Redis, worker-thread pool, trace database or durable diagnostic queue is needed.

## Payload CPU reductions

### C1. Avoid provably unused fingerprint work

Owner: `packages/core/src/http.ts`, shared by REST and customer MCP.

Compute the existing fingerprint only when `idempotencyKey` is nonempty. Its only consumers are the key lookup/conflict check and key insertion. Keep the original expression byte-for-byte for keyed calls. Do not use raw HTTP bytes: whitespace/object property order currently normalize, and preserving that behavior matters. `createInference` requires a key through its public contract, so this saves unrelated unkeyed operations, not the measured inference fingerprint stage. No change to authorization/rate limiting or early replay order.

Do not special-case away inference validation for replay. Existing completed identities remain readable after model disable/credential rotation; new prepared provider bytes must still be built only after the early replay lookup misses.

### C2. Remove native provider deep-copy cost without allowing mutation

Owner: `packages/providers/src/native-inference.ts` with `model-protocols.ts`.

`nativeInferenceBody` currently runs `structuredClone(z.record(...).parse(request.input))`. Every current write is at the body root: model, stream, token fields, replacement stream_options/reasoning/provider, and `requireClientTools` root field deletions. Nested messages, tools and state are inspected, not mutated.

Replace the deep clone with one validated top-level copy. Explicitly copy any nested object before mutating it in future; existing OpenRouter provider preferences are already spread into a new object. Type protocol input as read-only at the boundary where practical; do not recursively freeze/clone a large graph on every production request. Add a nearby why-comment explaining that only top-level rewrite ownership permits sharing nested input. Do not change `nativeInferenceBody` transforms or provider version when resulting wire bytes are identical. If inspection finds any nested writer during implementation, copy that exact branch rather than relaxing immutability.

This primarily helps native passthrough bodies; it is not evidence that typed-context preparation becomes 15 ms faster.

### C3. Reuse text-only reservation encoding

Owners: `core/model-content.ts`, `decision.ts`, `inference-invocations.ts`, `model-gateway.ts`.

`modelInputBound` currently validates media while constructing a complete projected copy and then stringifies it. For text-only payloads, the copy is unnecessary. Refactor into a validation traversal that counts supported images and detects whether a media projection is necessary. Accept an optional trusted already-encoded byte count at the internal function boundary, not from public input. For an image-free validated JSON graph, use that count plus the existing 1,024 allowance; canonical and ordinary JSON encoding must have identical UTF-8 lengths for that graph. For internal values with undefined members, custom toJSON, nonfinite numbers or other non-JSON semantics, preserve the existing encoder/fallback rather than assume equivalence; JSON key order does not change encoded byte length. If no trusted length is supplied, `JSON.stringify(payload)` remains the fallback. For actual images preserve existing validation, image count/dimension/base64 limits, projection semantics and 32,768/image bound. Do not count base64 as text or discard rejection of unsupported media/tool forms.

`inferenceInputBound` passes `Buffer.byteLength(serialized)` from `PreparedInvocation`; no additional full encoding. The native gateway currently calculates reservation before `protocol.prepare` mutates top-level billing fields and later sends `JSON.stringify(payload)`. Preserve that timing/meaning: do not reuse a pre-transform count as final wire bytes, or move reservation across a transform without proving the existing bound remains conservative. The gateway receives the no-clone validation improvement initially; its final send serialization stays where it is.

Only reuse canonical length when the inspected value is a JSON graph with the same string/number/omission behavior as JSON.stringify; internal undefined/function/toJSON cases must use the existing fallback. Test this qualification explicitly rather than treating unknown TypeScript values as JSON. The optional length must originate from the same immutable object being inspected. Use a small `EncodedJson` object binding `value` identity and bytes, or keep the optimized caller inside `prepareInvocation`; never pass a free numeric length from arbitrary callers. Do not skip the media validation walk when an encoding exists.

### C4. Share prepared evidence encodings inside one preparation lifetime

Owners: `core/crypto.ts` (canonical algorithm), `explicit-context.ts` (validation), `inferences.ts`, `inference-invocations.ts`, `decision.ts` (port), `providers/decision-protocols.ts` (wire preparation), and `bounded-decisions.ts` (transformation).

Problem: `validateContext` separately canonicalizes input and context to count bytes; `inferenceConfiguration` canonicalizes the accepted context for a digest; typed provider adapters canonicalize input/context again for the user message; `prepareInvocation` then canonicalizes the final body. Some passes are semantically different (raw versus injected context, nested JSON string escaping), but repeated identical subtrees can be reused.

Add one small request-owned encoding owner in `core/prepared-json.ts`:

```ts
export type EncodedJson<T> = Readonly<{ value: T; json: string; bytes: number }>;
export interface JsonPreparation {
  encode<T>(value: T): EncodedJson<T>;
  // Remember only explicitly selected immutable roots, not every nested node.
  remember<T extends object>(value: T): EncodedJson<T>;
  dispose(): void;
}
```

Implementation requirements:

1. Keep `canonical(value)` as the shared algorithm. Extract its recursive visitor so an optional object-identity lookup can provide an already encoded subtree; `canonical` without that lookup remains unchanged. Do not introduce a competing sorted-JSON library/algorithm or change localeCompare ordering, number/string encoding, undefined handling or array behavior in this optimization.
2. `JsonPreparation` owns a Map keyed by exact object identity, no module-global state. It stores only explicit roots: large input, context.items, raw context, accepted context and final body, plus bounded-step context roots when actually used. Scalars are not memoized. Memoization is an optimization: on budget exhaustion call the original encoder and retain no new entry. Never reject an otherwise valid request because the optimization budget is full.
3. Bound retained encoded fragments at 16 entries and 8 MiB per active preparation. These are a memory envelope, not request/API limits. Nested selected roots may retain duplicate bytes, so count each retained string; do not pretend WeakMap makes byte accounting unnecessary. Report retained/peak bytes only in opt-in profiling. Keep the existing admission/request concurrency bounds.
4. `validateContext` accepts an internal encoder or creates one, obtains byte counts from encoded input/raw context, performs all existing validation, and returns a prepared-evidence value usable by the same caller. No public request can supply prepared bytes or bypass validation. Existing callers may ignore the returned value; adopt reused artifacts in immediate, queued and bounded preparation owners explicitly.
5. Create this scope only after asynchronous reference/catalog/credential reads have completed. Its encoding work is a synchronous pure preparation segment with no await while memoized fragments remain live; release intermediate fragments before entering SQL, provider I/O or deferred callbacks. This avoids multiplying the extra 8-MiB budget across waiting requests.
   Before validating the raw context, remember `context.items` so augmented accepted context can reuse the largest subtree after organization/workspace/application namespace/admitted_at are injected. Raw and accepted context each get their own root encoding/digest. Never reuse the raw context digest for accepted context.
6. `inferenceConfiguration` consumes the internal preparation owner to obtain existing definition/context digests. `prepareInvocation` uses the same owner through `boundedRequest` and provider preparation. Add a narrow optional canonical-encoder argument to `DecisionProtocol.prepare` (default the existing canonical implementation), rather than embedding caching in provider adapters. Anthropic/OpenRouter decisionPrompt and user-context JSON use this supplied encoder. Jev body nesting is naturally reused by final body encoding. Keep bounded-step evidence and transformed output schema separate from base evidence.
7. After final provider body construction, retain its `EncodedJson` as the sole provider encoding; size/digest/queued encryption/send consume those exact bytes. Release intermediate memo roots before provider I/O. `InvocationPermit` can keep its existing body/bodyJSON/bytes representation or replace those three fields together with `EncodedJson<Record<string, unknown>>`; do not maintain competing triples across callers.
8. Queued execution prepares anew per invocation/loaded immutable snapshot. Bounded steps create a new preparation scope after new evidence; no reused memo survives changed steps, context expiry, process recovery, or generation. A Task's existing immutable wake input remains its durable input owner.
9. Assert no root/nested writer occurs after remembering an object. Use readonly internal types and frozen-fixture tests to enforce the contract, not a production second deep-copy/freeze traversal. Mutable provider envelope construction must finish before `remember(body)`. Release memo in `finally` on preparation error, replay winner, rejected A and successful dispatch handoff.
10. Do not share HTTP fingerprint and accepted/provider digest as a single hash. The initial version intentionally keeps the independent 5–6 ms keyed HTTP fingerprint pass. Sharing raw parsed subtrees across transport/domain requires another lifetime parameter and should be attempted only if this simpler scope remains a measured bottleneck.

Before retaining C4, measure it against C1–C3 alone. If retained memory/GC or maintenance complexity outweighs repeated encoding savings, stop at the simpler stages and record the unchanged bounded preparation cost. No arbitrary millisecond improvement is guaranteed.

The maintained [payload CPU qualifier](../../../scripts/performance/payload-profile.ts) runs with `pnpm exec tsx scripts/performance/payload-profile.ts`. It compares the same validation, context digest and provider encoding with and without request-local reuse across Jev, Anthropic and OpenRouter chat, asserts identical final provider bytes, and reports four alternating 80-call cohorts per route. It makes no database, network or paid calls. A Node 24.13.0 local run with 1,494,445 context bytes reduced aggregate CPU by 21.6%/16.7%/13.4% respectively; peak retained memo text stayed below 6 MiB and was released synchronously. Concurrent host load made wall-time results variable, including no consistent OpenRouter chat wall-time gain. These CPU fixtures justify retaining C4; they do not establish end-to-end or hosted latency.

## Producer-aware trace policy

### Current gap

`providers/langfuse.ts` reads `TRACING_CAPTURE_CONTENT` only when constructing the sink. `direct-inference.ts` still calls `scheduleInferenceCapture` with input/response sizes and closures when tracing is on; `inference-capture.ts` still performs the guarded retention transaction. `model-gateway.ts` constructs `ModelOutputCapture` whenever trace context exists and serializes every frame for its byte cap. Queued inference decrypts `body_ciphertext` solely for trace input. Tool/retriever/root hooks still attach content. The sink then discards that content. This is privacy-safe at the final export filter, but not an efficient producer-level off switch.

### One configuration owner; existing flags

Use the existing flags; do not add an overlapping TRACING_MODE or per-request override:

| Effective mode | Configuration | Behavior |
| --- | --- | --- |
| Full (default when configured) | Existing credentials/backend; neither flag false | Current full diagnostics, bounded capture/redaction/retention |
| Metadata | `TRACING_CAPTURE_CONTENT=false` | IDs, timings, safe metadata, token usage and costs; no input/output capture work |
| Off | `TRACING_ENABLED=false` | No attribution lookup, producer capture or trace export; ledger/replay unchanged |

`core/tracing.ts` resolves and owns a startup `TracePolicy { enabled, captureContent }`. Existing `tracingEnabled()` delegates to it; add `tracingContentEnabled()`. Resolve only after composition selects credentials/custom sink and before serving. Restart processes to change flags; no runtime endpoint/hot-reload needed. Explicit false continues to override credentials and configured sink. Extend test/composition injection as `configureTraceSink(sink, { captureContent? })`, where explicit environment disable still wins. Pass the effective content policy to `LangfuseTraceSink`; remove its independent environment policy resolution. Keep its redaction/bounds as defense in depth. Do not change production defaults.

`recordTrace` applies the policy before calling any TraceSink, deleting input/output in metadata mode. It also preserves the current content-free application usage/cost log. Metadata is not a route for customer content: only bounded current identity/digest/status/timing/cost fields go there. Do not stringify whole requests into metadata to evade the policy. Custom sinks receive the same policy as Langfuse.

### Call-site adoption, in order

1. **Immediate live and recovery generation:** build a compact observation from copied usage/receipt fields first. In metadata mode record it directly; never allocate a content-retaining closure, consume capture capacity or issue retention SQL. In full mode use the existing bounded capture/SHARE guard and add payload references only after capture admission. Preserve missing/purged/budget-refused content markers and exactly one observation on failed guard commit acknowledgement. Recovery may already need to unseal response for final accounting, but must not unseal request data solely for metadata traces.
2. **Native gateway:** construct `ModelOutputCapture` only in full mode. Keep accounting parsing, response validation, stream gating and settlement always on. Extract its small first-output predicate into a shared helper so first-output timestamp remains available without retaining/serializing frame payloads. Full capture and metadata timing use that same predicate; no duplicate first-output interpretations.
3. **Queued/bounded inference:** only unseal request ciphertext and attach provider response for full traces. Normalization failure evidence required for accounting/recovery remains persisted regardless of tracing mode. Suppress only diagnostic raw-response copies and trace closures.
4. **Run/tool/context hooks:** in `run-tracing.ts` and `bounded-decisions.ts`, avoid attaching prompts, tool arguments/results and context bodies in metadata mode. Construct a compact observation before registering afterCommit/background callbacks so metadata closures cannot accidentally retain the full Run config or tool/context result through lexical scope. Keep required tool/source event reads, billing lookup and attribution. If a query exists solely to recover diagnostic input, gate that query. Do not remove durable run events or context reads needed for the agent.
5. **Composition/tests/docs:** existing server/worker lifecycle callbacks still drain enabled sinks; off mode must not initialize Langfuse/OTel. Mode is process-level and independent of profiling. Update observability README/implementation and deployment env reference with restart instructions and exactly what is lost.

Full-mode content admission stays 16 jobs / 32 MiB encoded input plus sealed-response bytes. Export stays 64 outstanding observations, 1 MiB per payload, bounded network timeout. This work does not increase limits, change retention guarantees, put trace input into SQL, or guarantee external deletion after enqueue.

## Optional HTTP request and product observations

### Proposed controls and shared owner

Add startup booleans `REQUEST_ANALYTICS_ENABLED` and `API_PRODUCT_EVENTS_ENABLED`, both default true. They control only the HTTP observations now produced by `http.ts`; they do not turn off all analytics or security auditing. The second name deliberately distinguishes API activity observations from durable domain product events. Existing POSTHOG_ENABLED controls export only and must not be repurposed.

Extract `core/request-observations.ts` accepting a compact copied `RequestObservation` record: request ID, tenant/principal/user IDs, principal/client type, method, route template, status, duration, optional successful API operation name. It never receives Request, body, secret, response, invocation permit or handler closures. It owns current bounded concurrency (at most four and pool-headroom check), 500-ms deadline, safe failure code and retained-background scheduling. Check enabled flags before scheduling any callback. Preserve current no-background fallback initially for non-inference calls when enabled; changing its observable incomplete-request behavior is separate from the disable option. When both flags are false, no starter/enrichment/final request-observation SQL or callback is scheduled.

Gate api_requests starter/enrichment/final writes with REQUEST_ANALYTICS_ENABLED. Gate only `http.ts` successful-operation product_events insertion with API_PRODUCT_EVENTS_ENABLED. If request analytics are off but API product events on, insert the API event through the same bounded background owner. Keep their independent choices explicit.

Do not gate/remove:

- Authentication/rate-limit counters, idempotency identities, current authority reads, admin/operator audit or actor-activity facts.
- Run/invocation/model_usage/ledger/financial events, billing usage endpoints, or capacity/recovery state.
- Durable domain product events in `auth.ts` (`user.registered`), `organizations.ts` (`organization.created`), `engine.ts`/`cloud-engine.ts` (`run.completed`). Existing PostHog delivery retries and deletion/retention rules remain.

### Truthful reporting is part of this change

`api_requests` is already best effort on retained-background paths and is not a financial audit trail. A flag must not make the dashboard claim zero traffic when collection is off or incomplete.

Affected consumers:

- `reports.ts`: usageReport's requests/request_errors/requests_incomplete, raw requests pagination, infrastructure incomplete observation count.
- `growth.ts`: active_service_principals derived from observed successful API requests.
- `apps/web/components/usage.tsx`: currently says “Every API and dashboard request” and calls it an audit trail; change to observed request activity with explicit best-effort collection.
- `apps/web/components/management.tsx`: service-key counts must be labeled observed activity, not an exact active-user denominator.
- `analytics-export.ts`: fewer API operation events when API_PRODUCT_EVENTS_ENABLED=false; durable registration/org/completed events continue.
- Operations README/implementation and example operator reports: correct universal starter-row and every-request claims.

Use existing Metric.status/missing_sources/report filters to mark request-derived figures as incomplete observations, even when collection is currently enabled, because queue drops/process death already make them incomplete. Do not extrapolate them into estimated totals or change authoritative run/token/cost metrics. Retained raw rows remain queryable after disabling collection; empty results mean no retained observations, not no requests. Current mode can be shown in report filters, but it must not be represented as the historic policy for the requested interval. A static request-list note describes that limitation without another hot-path history store. Keep metric names for current consumers; mark status appropriately and update user-visible labels.

No probabilistic sampling in this initial design. Sampling plus totals/unique active principals requires retained policy windows, sample probability per observation and correct estimators; unique-principal counts cannot be multiplied by 1/p. A separate sampling design would need those contract/reporting changes and a demonstrated reason to prefer it over whole-source off/best-effort collection. Do not add dormant sampling flags or pretend a percentage is just a cheaper insert switch.

## Payload and diagnostics verification sequence

1. Capture a fresh source/protocol/CPU baseline with the maintained profiler. Keep same Linux topology, 1.494 MB context, all three protocols, 5/s, identical trace mode. Synthetic upstream only; zero paid calls needed. Record CPU, GC/event-loop lag, RSS/heap, payload operation counts and server/caller mean/p50/p95/p99, including background drain cost.
2. Implement C1–C3 as independent owning-layer changes. Add focused canonical/fingerprint and media/native-wire equivalence cases. Measure; retain only demonstrated simplification/performance gains with identical behavior.
3. Implement C4 with the explicit request-owned lifetime only if remaining repeated preparation is still significant. Test byte-for-byte encoded JSON/digests against the existing canonical implementation across ASCII, Unicode, numeric/string edge cases, reordered objects, nested arrays, empty/null values, bounded evidence steps and provider-native shapes. Test memo eviction/budget exhaustion yields identical output, not request rejection. Include changed-context/step/generation cases proving stale encodings are never reused.
4. Test actual replay before eligibility, same-key/different-body conflict, concurrent same-key winner and distinct-key identical-input separate invocation. Do not change A/F settlement or durable receipt. Run exact required media bound comparison for text/image paths and malformed/unsupported media rejection.
5. Implement effective trace policy and producer adoption together; no intermediate claim that sink-only masking removes capture cost. Verify full/metadata/off with a recording sink and official SDK fixture: metadata retains costs/usage/first-output/IDs but has no payload, capture jobs, request-only decryption or retention transaction; off has no initialization/attribution/capture/export. Full retains purge races, cap refusal and failed-ack single observation cases. Poison producer content getters/capture constructors in metadata tests to prove they are not evaluated, not merely absent in final export.
6. Introduce HTTP observation owner/flags, update all writes and reporting labels/status in the same change. Verify four flag combinations, success/auth failure/rate refusal/replay, pool pressure, background scheduling failure, and no-background fallback. Assert protected audit/rate/financial/domain product events still exist when optional sources are off. Verify post-toggle historical rows remain accessible and missing metrics are not zeros.
7. Run targeted tests, TypeScript and doc checks. Regenerate SDKs only if the owned schema changes. Run full SDK verification for shared API-contract/transport behavior changes, including changed report semantics; an unchanged JSON shape does not waive that gate. Pure internal encoding changes use affected checks plus the required TypeScript SDK build. UI disclosure changes require a focused usage/management browser check. Do not rerun unrelated all-language suites for pure internal encodings alone.
8. Repeat matched cohorts full, metadata, off. Report actual changes and variance; distinguish provider time, payload CPU, optional background CPU/SQL and bytes exported. Include representative native stream and queued/bounded path to verify shared adoption. Keep under-100-ms server p95 as the existing workload target, not a universal SLA; no hard universal claimed gain from disabling diagnostics.
9. Update canonical decisions/observability/operations guides and central tracker only after verified behavior. Defaults remain full tracing and enabled HTTP observations. Operators may then opt into metadata/off knowingly; all processes must restart for consistent startup policy.

## Payload and diagnostics tradeoffs

Metadata mode loses prompt/answer/tool/context diagnosis but preserves cost/usage queryability. Off tracing loses even external timing/cost visibility, while authoritative API accounting remains. Request-observation off loses recorded request/service-key activity; it does not lower billed cost or alter execution success. API-product off reduces exported behavior insights but preserves durable domain milestones. Background changes can improve contention without reducing a particular request's measured hot path.

C4 trades bounded per-request encoding memory and a small ownership interface for less repeated CPU. It is optional if simpler changes suffice. Do not add cross-request immutable-body caching, request-body hashing directly from network bytes, compression/worker threads, provider prompt changes, cheaper-but-different reservation estimates, or reduced current authorization/recovery/accounting guarantees as part of this work.

## Source map and handoff checklist

Read the current functions rather than copying these proposal snippets blindly. Relevant existing owners:

- [Database transactions/query groups](../../../packages/db/index.ts), [budgeted client](../../../packages/db/budget.ts), [ledger](../../../packages/core/src/ledger.ts), [capacity](../../../packages/core/src/execution-admission.ts), [actor authorization](../../../packages/core/src/actor-authorization.ts).
- [HTTP](../../../packages/core/src/http.ts), [admission/preparation](../../../packages/core/src/inferences.ts), [invocation state](../../../packages/core/src/inference-invocations.ts), [immediate completion](../../../packages/core/src/direct-inference.ts), [model gateway](../../../packages/core/src/model-gateway.ts).
- [Events](../../../packages/core/src/events.ts), [webhooks](../../../packages/core/src/webhooks.ts), [Task wakes](../../../packages/core/src/decision-task-wakes.ts), [queued inference](../../../packages/core/src/inference-engine.ts).
- [Canonical encoding](../../../packages/core/src/crypto.ts), [context validation](../../../packages/core/src/explicit-context.ts), [native request preparation](../../../packages/providers/src/native-inference.ts), [model content bounds](../../../packages/core/src/model-content.ts), [provider protocols](../../../packages/providers/src/decision-protocols.ts).
- [Trace policy/composition](../../../packages/core/src/tracing.ts), [immediate capture](../../../packages/core/src/inference-capture.ts), [trace content sink](../../../packages/providers/src/langfuse.ts), [run traces](../../../packages/core/src/run-tracing.ts), [reporting](../../../packages/core/src/reports.ts), [growth](../../../packages/core/src/growth.ts).

Before handoff, update current decision/billing/observability/operations guides and the central tracker with only shipped behavior. Record the actual wait graph per caller, all measured gains/misses and operator choices. Preserve the [existing unresolved full-CI/hosted qualification](../../maintainers/TODO.md#execution-efficiency-redesign); documentation completion is not performance completion. A blanket implementation approval can enable the new controls without turning diagnostics off: full content and both HTTP-observation sources stay enabled until the operator explicitly selects otherwise.
