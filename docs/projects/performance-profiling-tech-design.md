# Opt-in performance profiling: technical design

Status: **implemented locally; performance qualification in progress**. The [feature specification](performance-profiling-feature-spec.md) defines operator behavior; [maintainer work](../maintainers/TODO.md#execution-efficiency-optimization-proposals) tracks delivery. This design covers the optional performance collector only. It does not replace execution tracing, application error diagnostics, financial records, or clocks used to enforce deadlines and scheduling. Verification determines which performance budgets are met.

The [optimization verification record](execution-efficiency/optimization-verification.md) owns measured results and unverified budgets.

## Implemented owners

- [Collector](../../packages/core/src/performance.ts): default-off configuration, bounded ALS scopes, whole-root sampling, fixed numeric stages/counters and finite lifecycle. [Composition](../../packages/core/src/performance-composition.ts) owns one process instance and attaches the three owned pools.
- [Contracts](../../packages/contracts/performance.ts) define content-free records and the sink/ticket ports. [Database diagnostics](../../packages/db/diagnostics.ts) captures attribution at submission, wraps instances rather than prototypes, preserves driver overloads and detaches at expiry. [Transactions/groups](../../packages/db/index.ts) supply actual outcomes and proxy identity without extra SQL.
- [JSONL sink](../../packages/providers/src/performance-jsonl.ts) bounds queued plus in-flight records/bytes, batches writes, contains stream errors and limits drain time. Private local files enforce directory/file permissions; hosted output uses existing stdout logging.
- [HTTP](../../packages/core/src/http.ts), [native model gateway](../../packages/core/src/model-gateway.ts), [tool broker](../../packages/core/src/tool-broker.ts), [worker diagnostics](../../packages/core/src/worker-diagnostics.ts), [storage](../../packages/providers/src/storage.ts) and existing stream/background callbacks adopt the same collector. Application-route readiness/entry points and worker startup initialize their shared composition. Workflow orchestration remains deterministic; actual work is measured at step/job boundaries.
- [Inference fixture](../../scripts/performance/inference-profile.ts), [tool fixture](../../scripts/profile-tool-admission.ts), [runtime I/O fixture](../../scripts/profile-runtime-io.ts) and [multi-replica fixture](../../tests/fixtures/immediate-inference-api.ts) share submission-based attribution. The [inference peer](../../scripts/performance/inference-peer.ts) separates SDK and OTLP receiver CPU from the API; [fixture affinity](../../scripts/performance/fixture-affinity.ts) owns optional Linux peer pinning. Inspector, event-loop and memory diagnostics remain explicit fixture facilities. There is no global driver patch or mutable current-request index.

Ordinary deadlines, accounting, receipt/provider timings and dispatch budgets remain active with profiling off. Unknown query/result/wire bytes stay unknown; objects are not serialized solely for profiling. The implementation preserves startup defaults for execution tracing and HTTP observations. See the [operator guide](../features/observability/performance.md) for current behavior; the requirements below still govern qualification.

## Operator contract

Read configuration once per process composition, after the existing environment loader. Defaults:

| Setting                           | Default and bounds                          | Meaning                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PERF_PROFILING_ENABLED`          | `false`; accept only literal `true`/`false` | Enables this process's optional collector. Credentials and inbound headers cannot enable it.                                                                                                                                                |
| `PERF_PROFILING_SAMPLE_RATE`      | `1`; finite decimal from 0 through 1        | Whole-root sample probability, not independent random sampling of each stage/query. `0.01` is the documented production example. Bounds below apply even at `1`.                                                                            |
| `PERF_PROFILING_DURATION_SECONDS` | `300`; integer 1 through 3600               | Finite capture window from process collector initialization. On expiry stop admitting scopes and producing optional measurements; emit one final summary and mark open scopes truncated.                                                    |
| `PERF_PROFILING_OUTPUT_DIR`       | unset                                       | Default sink is bounded content-free JSONL to stdout. A private local directory is an optional sink only under the verified local profile. Hosted file output is unsupported rather than misleadingly promising durable filesystem storage. |

`PERF_PROFILING_ENABLED=true` is sufficient for a useful five-minute capture. Changing any setting requires restarting the specific API/worker process or redeploying it. There is no admin toggle endpoint, file watcher, database setting, signal protocol, or automatic cross-replica coordination. A worker started later gets its own window; every record identifies the process instance and capture window.

An invalid **optional profiling** setting emits one fixed `performance_profile_configuration_invalid` code and disables profiling for that process. It must not make a healthy application unavailable, silently enable tracing, or change any security/capacity setting. Strict validation errors are still surfaced by the standalone profiling CLI before it starts fixtures. Report the effective configuration in the collector's first record without secrets.

Expiry is not an application shutdown: do not cancel Runs, requests, exporter work belonging to Langfuse, or financial persistence. Flush only already admitted profiling buffers within a two-second lifecycle budget; drop the remainder with counters. Restart is the way to start another capture.

## Module ownership and dependency direction

Use existing packages; add no service or telemetry dependency.

1. `packages/contracts/performance.ts` (implemented) contains the small content-free event and summary types, closed stage/entry-kind enums, safe error-code fields, and sink port. It imports no Node/framework/pg/vendor module.
2. `packages/core/src/performance.ts` (implemented) owns startup configuration, the optional `AsyncLocalStorage` context, whole-operation sampling, active-context budgets, stage counters, and sink admission. It exports the process-level composition functions and entrypoint helpers. It imports neither the database implementation nor Next.js. Use ordinary functions and one configured instance, not a plugin registry.
3. Preserve `inference-timing.ts` as the inference-stage owner; change its stage argument to the relevant subset of the shared enum and have it call the common scope-aware timing helper. Do not retain two independent inference collectors.
4. `packages/db/diagnostics.ts` (implemented) owns instrumentation of the three **owned pool instances** and checked-out pg clients. Its configuration accepts a narrow callback to obtain a measurement ticket and a no-throw recorder from composition; it must not import `core/performance.ts` or customer authority. Preserve the existing `macrofold.database.group` hook as the pipeline group source, and extend it with an opaque group ID so individual statements are not counted twice.
5. `packages/providers/src/performance-jsonl.ts` (implemented) implements bounded JSONL writing using a supplied writable destination. It never receives SQL argument values or customer content. Local file opening and mode checks belong here; stdout is the hosted-compatible default.
6. `packages/core/src/performance-composition.ts` (implemented) wires these modules and the owned pools once, analogous to current tracing composition. No caller may construct its own independent collector. This module can depend on core configuration, DB diagnostics and the provider sink; policy remains outside those adapters.
7. Existing web route composition, Workflow **step** bodies and standalone worker startup initialize the composition. Do not instrument replayed Workflow orchestration with nondeterministic clocks. Isolated fixtures use the same collector contracts. Inference qualification uses the actual bounded JSONL sink; focused counter fixtures may use bounded numeric in-memory sinks and identify that narrower measurement boundary. The inspector remains a separate fixture-only option.

Before adding the proposed files, check whether an existing nearby module can own the same boundary without becoming a mixed-purpose utility. These names are the target layout, not permission to duplicate responsibilities.

## Off-path requirements

The disabled implementation must satisfy structural tests, not just a small benchmark:

- Do not construct `AsyncLocalStorage`, start timers, install subscribers, wrap pg methods, open files, allocate buffers, or start the inspector when profiling is off.
- `runPerformanceRoot` must branch before building a context, generating an ID, sampling, or reading a profiling clock. Reuse the existing server request ID when available; do not generate a second identifier solely for profiling. The off/unsampled entry helper invokes the existing action directly and returns its original return value/Promise; it must not introduce an extra async wrapper or await boundary.
- `startPerformanceStage` returns the shared no-op before any clock read or closure allocation when globally off or no sampled scope exists. Callers pass fixed stage IDs, not eagerly constructed metadata objects.
- Do not touch `pg.Client.prototype`, `pg.Pool.prototype`, global `fetch`, or global OTel state in serving code. Disabled pool/client methods remain the actual driver methods, not no-op wrappers.
- Normal clocks required for timeouts, financial receipts, throughput control and public receipt timings remain untouched. Do not claim turning profiling off removes them.
- Expired collectors take the same cheap first branch on new calls. Existing sampled operations may hold one small token until they return; no payload or indefinitely growing active map remains.

Node diagnostics channels remain an internal observation seam, not a customer control. Subscribers execute synchronously. Wrap each owned subscriber body in its own try/catch; guarding `channel.publish` alone does not contain subscriber exceptions scheduled by Node. Subscriber callbacks only update bounded counters/enqueue summaries, never perform I/O. Third-party subscribers are outside this guarantee and must not be installed by this collector. A sink failure is a diagnostics drop, never an execution failure.

## Correlation and attribution

A measurement context contains only `capture_id`, process `instance_id`, existing `request_id` when applicable, a random internal operation ID for jobs without an existing identity, safe route/operation enum, optional authorized organization/Run IDs, optional existing lease generation, start time, phase class, and a fixed set of numeric counters. It never contains the Request, Principal object, body, prepared invocation, headers, provider secret, tool arguments, output, or SQL parameters.

Expose distinct helpers `runPerformanceRoot(kind, identity, action)`, `runPerformanceChild(phase, action)` and `performanceBackground(action)`, plus `startPerformanceStage(stage)`. They return the action's value/Promise directly when disabled; do not add an `async`/`await` wrapper solely to return it. Root identity accepts existing generated IDs and closed labels only. Tests inject the clock/RNG/sink through one composition initializer, never through customer input.

An independent root replaces inherited profiling context when making its own sampling decision. With the collector enabled, an unsampled operation carries only a shared skip decision through ALS: no operation ID, retained identity, numeric state or timers. Nested worker jobs, children and deferred background inherit that skip instead of independently resampling or inheriting a sampled caller. Sampled deferred background receives copied correlation IDs and a separate bounded state; refused work carries the skip decision, and expired/disabled collectors run the business action directly. Do not make every function call a root.

Construct `AsyncLocalStorage` only when the collector is explicitly enabled. Enabled context holds either a sampled scope or the shared skip decision; disabled execution performs no ALS work. Independent concurrent HTTP requests each make one root decision, inherited by all direct children and background work. Root sampling is random local probability; do not hash customer-supplied idempotency keys or permit customers to choose samples.

A diagnostic ticket is captured synchronously **when work is submitted**, before an await or pg queue. Completion uses that immutable ticket. Reading the current async context only when a pg callback fires is incorrect: driver callbacks can run under a different queued query's async resource. The ticket contains a bounded reference to numeric aggregation state and the phase ID, never arguments. Finishing twice is a no-op.

Lifecycle categories are explicit:

- `foreground`: work awaited to return the JSON response or construct SSE response headers.
- `stream_owner`: retained producer/stream delivery after headers, including final financial publication. It is required work, not optional background.
- `background`: optional tracing/capture/request analytics/cleanup admitted through an existing retained callback, linked to the initiating request but separately counted.
- `job`: queued/native/bounded/Task/trigger work owned by the dispatcher or Workflow step.
- `unattributed`: owned-pool work with no sampled context. Keep aggregate process counters only; never assign it to whichever request overlaps in wall-clock time.

Wrap existing background callbacks at their common scheduling boundary using a child scope with `phase=background`; otherwise ALS naturally inherits `foreground`, falsely charging later trace SQL to admission. Background state must not retain a closed parent scope. Store only small copied correlation IDs; bound child scopes with the same total budget. Start a `job` scope when each concurrently dispatched operation begins, not once around a whole polling tick. Correlate resumed jobs by existing Run/job/generation IDs; do not persist new profiling state or add SQL solely for correlation.

For SSE, label `response_ready_ms` separately from `stream_ms` and `first_output_ms`. A handler returning a Response is not full stream delivery. Reuse existing producer/stream lifecycle hooks; do not add a per-token TransformStream solely to observe it. Count output bytes only where byte length is already known. Native source-to-SDK timing remains an explicitly synchronized/fixture boundary; different-machine monotonic clocks cannot be subtracted.

In ordinary serving, provider transport/adapter elapsed time includes network, provider waiting and any local adapter work inside that boundary. Provider computation-only time is unknown unless an independently trustworthy upstream measurement supplies it. Label the measured boundary explicitly; subtracting the entire adapter span does not yield pure platform overhead. The synthetic qualification can retain its independently measured upstream interval, with the exact subtraction formula in every report. Overlapping spans are not additive.

## Database measurement contract

Production profiling records bounded numeric facts and a closed operation/stage label. It does not export SQL text or derive labels from tenant data. The fixture may retain reviewed static query shapes separately for local developer diagnosis; general reports never do.

Measures per owned pool and context:

- checkout duration (from connect invocation through grant/error), peak checked-out/waiting counts sampled at submission/completion;
- transaction total/commit/rollback duration and explicit outcome (`committed`, `rolled_back`, `commit_unknown`, `failed`);
- statement count, query submission-to-completion duration and result row count;
- submitted query-group count/size and duration;
- sequential group count: one per ungrouped awaited statement and one per pipeline group, not statement count; do not add overlapping duration sums to request wall time;
- pool kind `domain | identity | credential`, transaction ID, existing optional closed semantic label, group ID;
- parameter byte count **only** for buffers with known length, strings up to 4 KiB, or sizes already supplied by their owner; larger strings are unknown unless an encoded size is already available; objects/arrays become `unknown_parameter_count`, never `JSON.stringify` just for profiling. Result bytes are unknown unless the owner already has encoded size. Do not describe these as PostgreSQL wire bytes.

Implementation sequence for pg:

1. Read pinned `pg@8.23.0` and `pg-pool` method signatures/source and declarations. It has no existing diagnostics-channel query emission to subscribe to.
2. Instrument only the three existing Pool instances after explicit profile composition and before serving. Use an instance-bound `connect` adapter preserving callback and Promise forms; it must return/release the same client and preserve callback return/exception behavior. Each granted client is instrumented once. Keep originals in a Map/Set of live clients bounded by the sum of the three pool maxima, removing entries on actual disconnect/end; a WeakMap alone cannot be enumerated for teardown. A client returned idle to its pool remains live and instrumented until expiry. The registry stores driver method references only, never query arguments or profile contexts. Do not replace the Pool object consumed by Better Auth.
3. Each instrumented client query adapter checks for a sampled ticket before starting a clock. Preserve `this`, arguments, Promise resolution/rejection, callback signature, and returned `pg.Query`/event-emitter shape where used. Implement one reviewed compatibility adapter with overload tests, not ad hoc wrappers in domain services. Unsupported driver query forms are counted as `unsupported_driver_form` and forwarded unchanged rather than changing runtime behavior.
4. `Pool.query` internally uses its client connection; verify it is observed once, not once at pool and again at client. Measure checkout at the pool; statement completion only at client.
5. Ensure managed transaction proxies (`budgetedClient`) call through this underlying observed client once and retain pipeline/drain/deadline semantics. Explicitly bridge the proxy to the raw client with a diagnostics submission ticket created by the database owner: `transact` supplies the current transaction ticket; `submitQueryGroup` supplies the group ticket around submission of every statement; the raw query adapter captures both before its await. Do not look up group identity by guessing that a `Tx` proxy equals its raw client, and do not read ambient context later in a completion callback. Group statements add statement counts, while only the group owner adds one wait-group count.
6. Explicit transaction context exists for BEGIN/setup/COMMIT/ROLLBACK, not only user callback statements. Emit actual transaction outcomes from `transact`, where a confirmed rollback versus unknown COMMIT is known; a generic query wrapper cannot infer them. Keep lifecycle count separate from domain row count. No extra SQL is introduced.
7. On window expiry detach channel subscribers, restore pool/connect and live-client methods from the bounded registry, and stop new optional callbacks; do not change/release in-flight DB work. Already-submitted completion closures safely see their capture closed and discard the record. Restore a method only if it still points to this collector's adapter; an unexpected instrumentation conflict leaves it inert and emits one fixed detach-conflict code rather than overwriting another owner. Clear the live-client registry/listeners after restoration. A disabled startup installs no wrappers at all; automatic expiry may retain an inert wrapper only in that explicitly reported conflict case.

Query duration includes driver queueing, database execution/lock wait, network and local scheduling. It is **not** isolated PostgreSQL CPU or lock wait. Lock-hold time can be measured only from an already known successful lock boundary through completion; authoritative server wait information requires a separate controlled database experiment. Keep these meanings explicit in reports.

## Bounded sink and window lifecycle

Initial engineering bounds (collector budgets, not customer request limits):

- 256 simultaneously sampled active scopes per process; at most 64 stage IDs and 8 nested active stage spans per scope. Per-stage count/total/min/max counters, no list of every stage/query. Process-level pool/query histograms, if needed, use at most 32 fixed buckets and report approximate quantiles explicitly; exact fixture cohort quantiles derive from bounded per-request summaries outside serving code. Beyond the scope/span cap, run normally and increment `scope_limit`/`span_limit`.
- One completed root/child summary at most 8 KiB encoded; truncate optional ID fields by omission, never untrusted text. A bounded schema limits tags to known enums and UUIDs. At most 128 optional exemplars across the capture, each containing only stage IDs/durations; per-query event arrays are fixture-only.
- Queue at most 256 encoded summaries **and** 1 MiB outstanding encoded bytes, counting queued plus in-flight batches. One writer, maximum 64 KiB per batch, no automatic retry on an ambiguous write. Flush only from the retained timer/completion lifecycle, never synchronously inside a stage/subscriber/request callback. Node stdout can itself perform a synchronous blocking write depending on its destination; do not promise nonblocking I/O from a queue alone. Qualify the actual stdout destination and recommend the private asynchronous file sink for local terminals that stall. Do not add worker threads to hide a failed sink benchmark. `write()` returning false applies diagnostics backpressure; drop new summaries until drained. Do not keep calling stdout/file writes and let Node's internal buffer become the real unbounded queue.
- A single unref'ed 1-second flush timer only while enabled, plus one finite capture deadline timer. No timer per request. Process-level event-loop histogram is optional inside the enabled collector at 20-ms resolution; disable/reset it at expiry. No CPU inspector or heap snapshot in this production mode.
- Serialize only after accepting space; bounded record shapes make an upper-bound byte reservation possible before serialization. Record accepted/queued/written/dropped totals and drop reason. Sink exceptions use a rate-limited fixed diagnostic code, no raw error/message/path/customer content.
- At duration expiry, reject new profiles immediately, snapshot unfinished numeric contexts with `truncated=true`, stop observing, and drain admitted bytes for at most two seconds through the existing lifecycle host. Do not keep the app alive indefinitely. Records are best effort and can be lost after process death.

These bounds are starting diagnostic resource budgets chosen to cap a short incident capture to a few MiB/process. The observer-effect matrix below must confirm the actual implementation is below the heap/CPU bounds; adjust downward if not. Raising them needs a demonstrated diagnostic need, not a production capacity change.

The default stdout record is `{component:"performance", version:1, capture_id, instance_id, operation, phase, request_id?, run_id?, started_at, duration_ms, sampled:true, counters, stages, dropped}`. Only fixed keys/closed labels and server-authorized opaque IDs are allowed. Exclude arbitrary error messages, URLs/query strings, SQL, arguments, results, customer IDs/names, connection IDs, filenames and model prompt/output content. Optional identities allow operational correlation but grant no access.

## App integration checklist

1. Initialize through the same application module graph that owns request scopes and database diagnostics. Self-hosted REST readiness calls the shared initializer; transports and Workflow steps retain idempotent first-entry initialization when readiness is not shared. Standalone workers initialize at startup. Do not also initialize through Next instrumentation: the qualified compiled build gives instrumentation separate collector/diagnostics module instances while sharing global database pools. Two collectors would wrap the same pools, separate their ALS attribution and interfere with ordered expiry cleanup. Do not initialize in client modules or introduce global collector state to work around duplicated host composition.
2. `handleApi` owns HTTP root profiles and the existing server request ID. Extract only the minimal inner helper needed to run its existing body within a scope; keep every existing try/finally/error response/cancellation branch.
3. Customer MCP wraps each actual domain operation rather than sampling its whole long-lived transport connection; preserve its current API operation mapping and authentication.
4. Native model gateway and broker entrypoints create root scopes linked to the already authenticated Run; don't run an extra identity query for measurement. Nested calls do not duplicate roots.
5. `scripts/worker.ts`, dispatchers and Workflow **steps** create operation scopes per dispatched phase. Maintenance owns separate `job` scopes and cannot be charged to an unrelated request. Runtime controller transport timings are recorded on its caller side first; don't require a controller image release merely for control-plane profiling.
6. Wrap retained callbacks (`after`, `waitUntil`, worker lifecycle tasks, fixture background owner) with the common background classifier at the point the operation is scheduled. Avoid double wrappers in `http.ts` and the web route.
7. Register profile drain using the existing request/step completion host hooks only when profiling has pending data. Add its bounded worker shutdown next to tracing shutdown. Do not await profile network/file writes before response/next phase.
8. Expose no public REST schema, SDK parameter, MCP capability, request header or dashboard toggle. Do not change public receipt timing fields.

## Fixture modernization

`scripts/profile-inference.ts` remains the operator-facing offline runner with disposable-database and unpaid-local guards. Its version-three child uses the shared collector and correlation IDs, preserves existing synthetic protocols, closed outbound transport, near-full payload, source digest, financial assertions, tracing on/off cohorts and actual arrival cadence. Existing latency/report fields remain; explicit CPU, sink and topology fields identify the changed boundary.

`PROFILE_INFERENCE_OBSERVER=off|light|cpu` defaults to `light` **only for the fixture**. `off` exercises completely disabled profiling with external caller/upstream timing; `light` uses the serving collector and actual JSONL private-file sink; `cpu` adds inspector separately and is never used for the primary latency target. Compare installed `light` at sample rates 0, 0.01 and 1 with `off`: unsampled requests still pass installed database wrappers. Record sink bytes/drops, and parse JSONL only after the CPU interval. Do not silently compare an instrumented baseline with an uninstrumented candidate or equate earlier in-memory-sink CPU with the current sink.

Measured calls accept 1–10000 (default 20); `PROFILE_INFERENCE_WARMUPS` accepts 0–200 (default 2), with 0 skipping warmup invocations. Use enough warmups for the declared qualification, such as 20, and retain their actual counts separately. Drain warmup callbacks/exports before starting API-process CPU and wall measurements while retaining warm HTTP connections. End after measured callbacks, trace exports and actual JSONL drain, before invariant SQL and report processing. Event-loop diagnostics are identical across observer modes. The SDK driver and loopback OTLP receiver run in a separate peer process; only API-process CPU enters this measurement, including the small synthetic upstream stub and fixture boundary instrumentation.

For a declared four-CPU Linux topology, the launcher can pin the API to CPUs 0–1 and PostgreSQL to CPU 2, with `PROFILE_INFERENCE_PEER_CPUS=3` pinning all peer threads before warmup. This strict optional fixture flag requires Linux and `taskset`, reports actual process affinity and never changes production scheduling. All compared modes must use the same topology. The [testing guide](../engineering/testing.md#independent-linux-qualification) owns cloud-account, fixed-performance, credential-free source and bounded-cleanup requirements; actual qualification evidence belongs in the [verification record](execution-efficiency/optimization-verification.md).

Add a concurrent open-loop workload with independently identified requests, bounded in-flight client requests and recorded intended/actual arrivals. Do not remove single-flight cohorts; use them for continuity. Background capture/analytics remain enabled at their actual selected configuration during measurement and tagged separately. Sum their CPU/SQL in process totals even when excluded from foreground attribution.

Reuse the shared collector in `tests/fixtures/immediate-inference-api.ts`; delete its duplicate pg timerify/shape logic after coverage is replaced. Inspector CPU and optional static query-shape experiments stay fixture-only. `profile-runtime-io.ts` and `profile-tool-admission.ts` adopt summary format/correlation when they touch the same path; do not rewrite unrelated load generators.

## Implemented commands

The package has `dev`, `worker`, `dev:docker`, `worker:docker`, and the direct `profile-inference.ts` script. These startup settings are implemented; the public [operator guide](../features/observability/performance.md) owns their reusable instructions.

```sh
# Normal operation: profiling remains off even with Langfuse configured.
PERF_PROFILING_ENABLED=false pnpm dev

# Five-minute capture, all requests up to collector bounds, content-free stdout.
PERF_PROFILING_ENABLED=true pnpm dev

# Production/long-lived worker example: sample whole operations at 1% for 10 minutes.
PERF_PROFILING_ENABLED=true PERF_PROFILING_SAMPLE_RATE=0.01 \
  PERF_PROFILING_DURATION_SECONDS=600 pnpm worker

# Local private files; implementation creates a new process/capture file, never overwrites.
PERF_PROFILING_ENABLED=true PERF_PROFILING_OUTPUT_DIR=.data/performance pnpm dev

# Existing isolated unpaid workload, upgraded to the shared observer.
PLATFORM_MODE=local EXECUTION_PROVIDER=simulator ALLOW_PAID_EXECUTION=false \
  PROFILE_INFERENCE_MODEL=jev PROFILE_INFERENCE_CALLS=100 PROFILE_INFERENCE_RATE=5 \
  PROFILE_INFERENCE_CONTEXT_BYTES=1494000 PROFILE_INFERENCE_OBSERVER=light \
  pnpm exec tsx scripts/profile-inference.ts
```

Never start an extra preview/worker on the user's occupied port to enable profiling. For a running local process, document its supervisor/port and ask no new permission when restart is already authorized; otherwise show the env change and normal restart procedure. Hosted activation is a deployment operation, not a dynamic flag update. Directory/file creation must use 0700/0600, refuse unsafe existing symlinks, use unique exclusive creation, and never print secret environment configuration.

## Implementation sequence

P0. Read current owner guidance and pinned Node/pg/Next APIs; inventory all profiling hooks and all selected app entrypoints. Add failing structural unit cases for disabled mode and correlation, without altering execution.

P1. Implement typed core scope/collector and bounded JSONL sink, clock injection for deterministic tests, configuration parsing and finite-window state machine. No database instrumentation yet. Verify default-off, expiry, malformed config, sink failure/overflow, repeated initialize/shutdown.

P2. Add owned-pool/checked-client diagnostics with capture-at-submission tickets; keep existing group owner. Verify actual driver boundaries and zero SQL additions. Do not proceed if callback/Promise/query forms or deadline/pipeline behavior regresses.

P3. Wire REST/MCP/native transport, poller jobs and Workflow steps; classify retained background and stream owners explicitly. Test concurrent attribution. Keep public contracts and Langfuse unchanged.

P4. Replace fixture-only global timerify/window attribution with shared collector; retain optional inspector behind fixture mode. Add external observer-off cohort, synthetic concurrent workload and per-mode financial checks.

P5. Run observer-effect matrix and remove obsolete duplicate instrumentation. Mark only actually passed gates. Do not lower existing latency acceptance just because the collector added overhead.

P6. Reconcile feature/technical design, observability and operations guides, `.env.example`, testing commands and maintainer gates. Record exact local acceptance versus unverified hosted lifecycle behavior. Activation is a separately authorized normal restart/redeploy, never a background side effect of generating reports.

Required tests and experiments:

| Boundary         | Specific evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disabled         | Spies assert no optional clock calls, ALS creation, subscribers, timer/file writes, pg wrappers, CPU inspector; exact current HTTP/provider/SQL counts and results remain. Operational deadlines still expire correctly.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Sampling         | 0/1 and deterministic injected RNG; all selected child stages stay together; 256-scope limit skips profiling only; unauthorized header/env-like payload cannot enable/choose profile.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Parallelism      | Two barrier-controlled requests plus background from a third; SQL/checkout/groups/stages assigned to their submission ticket, zero cross-attribution, background cannot mutate a closed root.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DB               | Actual PostgreSQL Promise and callback queries, Pool.query single observation, managed/deadline proxy, multi-statement pipeline, rollback, ambiguous COMMIT, late checkout, broken socket; unchanged business outcomes and no extra queries.                                                                                                                                                                                                                                                                                                                                                                                        |
| Stream/job       | Response-ready vs first-output vs finalization distinct; disconnect/cancel path finishes once; queued resumed step gets new local scope linked to existing ID; Workflow replay has no collector side effects.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sink             | Backpressure false/callback delay/error; queued+inflight counts/bytes never exceed bounds; no unbounded stdout buffer growth; expiry with active requests and shutdown deadline drop safely.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Privacy          | Synthetic secrets in SQL literal/parameter/body/header/tool result never appear in JSONL or diagnostics; output schema rejects arbitrary keys/labels. Test all error/drop paths too.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Observer effect  | Matched source/build/topology and actual JSONL sink, payloads 5 KiB/1,494,000 bytes, Jev/Anthropic/OpenRouter chat; observer off/light0%/light1%/light100%, trace content on/off independently. At least 100 calls per primary 5rps cohort plus bounded concurrent mixed workload; sustained one-percent CPU acceptance needs enough selected roots and paired repetitions. Report warmup/sample counts, mean/p50/p95/p99, errors, throughput, API-process CPU with explicit drain boundaries, heap/RSS, event-loop lag, foreground/background DB counts, capture drops and sink bytes. Interleave modes to reduce order/load bias. |
| Cost/correctness | Each cohort verifies one provider attempt and canonical result/usage per Run, zero leaked holds, unchanged account totals, no unexpected transport. Synthetic providers are not paid quality/hosting evidence.                                                                                                                                                                                                                                                                                                                                                                                                                      |

Acceptance targets for the collector are **design budgets, not measured claims**: disabled mode has zero allocated profile objects/timers/subscribers; light profiling at 100% should add no more than 2ms to mean handler overhead and 5ms to p95 on the declared near-full-context baseline, with <2% sustained CPU increase at 1% sampling. If measurement noise exceeds the budget, increase cohort size without paid calls and report uncertainty; do not certify it. The fixture must measure handler entry/exit externally and identically in off/light modes if it compares handler time; disabled production profiling cannot supply its own missing stage data. Keep those two fixture-only boundary clocks separate from optional profiler hooks in structural tests. External SDK latency is measured in every mode. The current <100ms server p95 requirement remains independently in force. Queue memory must be structurally bounded, and observed heap must return to baseline after expiry/drain; retained payloads are forbidden regardless of speed.

## Tradeoffs and explicit exclusions

- Startup flag/restart and finite windows are simple, auditable and adequate for the requested workflow; live reconfiguration, fleet capture scheduling and per-tenant switches are deferred.
- JSONL is portable and easy to retain in an existing log system. It is best effort and drops under backpressure, not a durable billing/tracing destination.
- Detailed production SQL text, exact payload/wire byte serialization, per-token spans, heap snapshots and inspector CPU collection are intentionally excluded. Those need a controlled offline experiment.
- A sampled operation can be skipped when collector capacity is full. Reports must expose sample/drop counts; absence of a profile is not evidence the request did not run.
- Turning profiling off preserves model tracing, mandatory application diagnostics, current authorization, reservations, durable results, replay and accounting. Optional history/analytics decisions are a separate design.

## Documentation and reference checklist

On implementation, update `.env.example`, `docs/features/observability/implementation.md`, `docs/operations/scaling.md`, `docs/engineering/testing.md` and the existing profiling commands in `docs/projects/execution-efficiency-verification.md`. Preserve past evidence with its old attribution boundary; do not rewrite old totals as correlated new results. Add the reusable operator instructions under the observability feature and link them from its README; publication through `docs/navigation.json` is a separate explicit choice, not automatic for this project proposal. No public API/SDK schema changes are planned.

The pinned runtime is Node 24.13.0 and the current driver is pg 8.23.0. Verify installed signatures during P0. [Node diagnostics channels](https://nodejs.org/docs/v24.13.0/api/diagnostics_channel.html) support subscriber-gated messages; their synchronous subscriber behavior is why callbacks must remain small and catch their own errors. [AsyncLocalStorage](https://nodejs.org/docs/v24.13.0/api/async_context.html) supplies async context, but explicit capture at queued I/O submission is still required. [pg pipelining](https://node-postgres.com/features/pipelining) is ordered on one client; it does not turn domain-dependent operations into safe independent queries. These references explain primitives; the verification record owns the measured observer effect and remaining acceptance limits.
