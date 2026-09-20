# Decision execution implementation

Contributor reference. Start with the [public contract](README.md), [context semantics](context.md), and [task behavior](tasks.md). [Verification](verification.md) separates local evidence from release acceptance.

## Ownership and entry points

| Concern                                      | Owner                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| Public inputs, receipts, limits and scopes   | `docs/api/openapi.json`; generated contracts and five SDKs                  |
| Domain types and provider/context ports      | `packages/core/src/decision.ts`, `context-artifacts.ts`                     |
| Context/schema validation                    | `explicit-context.ts`                                                       |
| Exact model eligibility and frozen terms     | `decision-models.ts`; native capability policy remains separate             |
| Workspace-bound application authority          | `decision-authority.ts`                                                     |
| Shared credential resolution                 | `model-credentials.ts`; native gateway and direct executor reuse it         |
| Admission and immutable configuration        | `inferences.ts`, `decision-definitions.ts`                                  |
| Durable provider invocation and settlement   | `inference-engine.ts`, existing `model-gateway.ts` and `ledger.ts`          |
| Trusted evidence tool loop                   | `bounded-decisions.ts`                                                      |
| Sequential task allocations and coordination | `decision-tasks.ts`, `decision-task-engine.ts`                              |
| Vendor HTTP and response parsing             | `packages/providers/src/decision-protocols.ts`                              |
| Shared claiming and mode dispatch            | `engine.ts`, `cloud-engine.ts`, `portable-dispatch.ts`, `local-dispatch.ts` |
| Retention and reachability                   | `artifacts.ts`, `deletion.ts`, existing storage preparation/collection      |
| Presentation                                 | `inference-result.tsx`, `task-lineage.tsx`, existing run page               |

There is one run identity, wallet, event stream and scheduler. Internal native/lightweight run variants prevent nullable native resources from entering harness code. Lightweight dispatch occurs before machine-provider construction. Providers own wire formats; core owns authorization, context, limits, receipts and accounting. The native runtime receives no new shared-process execution responsibility.

## Provider routing

`decision-protocols.ts` implements Anthropic Messages, direct TypeSafe SystemOne and OpenRouter's alpha Decisions endpoint. The two Jev routes share choice/score request construction and answer validation; OpenRouter adds its exact model ID, generation identity and provider price ceilings. `openrouter-pricing.ts` converts frozen micro-USD rates to the same USD-per-million ceilings used by native chat requests, including zero per-request fees. No route permits implicit fallback or retries after uncertain dispatch.

The OpenRouter route is `typesafe/jev-1.13`, distinct from direct TypeSafe's `jev-1.13.0`. It uses `OPENROUTER_API_KEY` for managed funding or the exact owner-bound OpenRouter connection for BYOK. It requires no TypeSafe credential. Eligibility and cost terms stay in `decision-models.ts`; transport and endpoint details stay in the provider adapter. Both routes remain decision-only and outside the native harness catalog. The alpha endpoint's API stability is a provider dependency; run the opt-in [live decision check](../../engineering/testing/live-integrations.md#run-the-checks-deliberately) after protocol updates.

## Durable request boundary

Admission freezes the resolved definition/context, exact provider/model/credential selection, effective limits, transformation identity and customer/provider cost terms. The initial implementation derives application namespace from a backend key restricted to exactly one workspace. Audience semantics remain the application's responsibility. Object reads happen outside SQL; commit and each subsequent disclosure reauthorize the reference.

Each invocation records a shared gateway request and a decision receipt. `prepared` commits a credential-free request body and digest. `dispatch_started` commits before HTTP. `responded` commits sealed response and usage before validation/publication. Unfinished dispatched calls become `uncertain`; no worker repeats them. A committed response is replayed locally after restart. Cancellation/deadline fences publication and additional steps, with HTTP abort as best effort. A late response is retained as invocation evidence without reviving or settling a terminal run twice.

Settlement reuses the gateway journals and run reservation. Missing usage conservatively consumes the request bound provisionally. Late evidence is available for operator reconciliation; automatic delta correction is deliberately deferred. Provider cost is an estimate under frozen rates, not an invoice. Managed customer charges never exceed the admitted ceiling. BYOK remains an exact connection with no managed fallback.

Bounded model requests are finite and their output allowance is aggregate. The only tool is `read_context` over preauthorized immutable artifact references. It rechecks file grants/audience/expiry and declared snapshot consistency, persists the read receipt, and feeds that exact evidence into later invocations. This is a trusted broker, not arbitrary customer code or remote-MCP multiplexing. Adding tools requires an explicit request shape, authorization and recovery semantics.

## Tasks and evidence

Tasks are sequential recipes with an optional exact-value investigation branch. Wake IDs and body digests deduplicate observations under a task row lock. Child admission counts committed consumed budget plus outstanding ceilings, then uses the ordinary run wallet reservation. Task allocation is a ceiling, not another financial journal. Cancellation cannot free ambiguous liability before settlement. Waiting/review holds no run capacity.

The existing maintenance outbox advances task transitions; it does not promise immediate scheduling. Publication stages immutable bytes under the storage-preparation lease, then atomically registers the artifact, evidence pin and task transition. Publication rechecks task identity, horizon, principal and workspace. Unreferenced staged bytes can be collected after the existing grace period. Artifact row locks serialize pin/release races.

Run diagnostics, independently published artifacts/definitions and active-task evidence have different roots. History expiry preserves published artifacts; explicit release is forbidden while an active task pins them. Closure releases pins and redacts wake content. Workspace purge removes detailed decision/task content and published objects while retaining financial identity. Application acceptance/rejection is a separate immutable receipt and never overwrites provider evidence.

## Rollout and rollback

Migrations 035–038 add run kinds/shape constraints, mode-aware scheduling projection, RLS-protected invocation/definition/tool/task records, and ownership links. Existing runs default to `native_agent`. Do not alter an applied migration or discard an environment based on the old pre-launch note.

1. Deploy the compatible schema and all readers/workers together; decision execution is supported without an opt-in flag.
2. Drain or fence old native-only pollers and durable Workflow invocations. Verify the deployed web, poller and Workflow code all route lightweight kinds before worktree access.
3. Rehearse mixed queues, cancellation, provisional settlement, retention/restore, and the two contract fixtures on staging.
4. Configure provider credentials and paid-execution authorization. Admission, scheduling and dispatch support lightweight runs by default.
5. To stop new work while draining, set `RUN_ADMISSION_ENABLED=false` and keep compatible dispatchers running to finish already admitted work. Never roll back to a native-only reader while lightweight rows remain.

Optional lower bounds: `DECISION_INPUT_MAX_BYTES` (262144), `DECISION_CONTEXT_MAX_BYTES` (2097152), `DECISION_CONTEXT_MAX_ITEMS` (64). Invalid or expanded values fail configuration checks. `LIGHTWEIGHT_CONCURRENT_RUN_LIMIT` adds a class ceiling under the existing global cap; `LIGHTWEIGHT_RESERVED_SLOTS_PER_ORG` defaults to zero and withholds that many account slots from native claims. It never expands account/global capacity or preempts an active run. Reserving all account slots prevents new native claims, so choose this deliberately.

## Measurements and deliberate limits

Receipts expose admission preparation, context resolution, queue wait, provider duration, response persistence and validation milliseconds. Admission preparation excludes the final ledger/admission commit; bounded receipts report the final invocation's provider/persistence timing, while every invocation stores its own timings. Missing measurements after process death remain missing. These are stage observations, not an end-to-end hosted SLA or provider first-token measurements; the adapters return complete bounded responses.

The fixture benchmark measures the whole local submission/execution path, SQL statement/write counts, row bytes and artifact count against a 5-second application fixture budget. See actual results in [verification](verification.md). No VM startup, worktree hydration or object output is needed for the small inline decision.

Remote context-provider registration, arbitrary bounded tools, generative streaming, model aliases, warm native pools, mutable definition aliases, a DAG builder and automatic late-charge correction are intentionally absent. The current typed ports support replacing provider transport or context reads without moving policy into vendor adapters. The byte-based token bound is deliberately conservative; a reviewed tokenizer can replace it without changing the contract. Shadow fixtures demonstrate adapter disagreement/provenance, not model quality.

## Decision tracing

The [observability integration](../observability/README.md) records every platform-mediated decision invocation as a generation, including Jev through OpenRouter/TypeSafe. Explicit context reads are retriever observations; actor, task, definition and request identities travel on every observation. Committed settlement supplies charges, budget cost, usage and provider estimates without another SQL trace store.
