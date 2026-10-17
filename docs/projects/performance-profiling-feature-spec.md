# Opt-in performance profiling: feature specification

Status: **proposed; design only**. No flag or application behavior described as proposed here is implemented by this documentation change. [Technical design](performance-profiling-tech-design.md) specifies the implementation. This complements the [remaining execution optimizations](execution-efficiency/remaining-optimizations.md); it does not replace execution tracing or the existing [qualification record](execution-efficiency-verification.md).

## Outcome

An operator can temporarily profile the ordinary API and worker processes with one environment switch, reproduce a slow request, and see where time and database work went. Normal execution leaves the profiler off. Profiling must not change authorization, timeouts, billing, provider retries, result durability, or request success.

The report distinguishes request processing, provider waiting, database checkout/query/group/commit waits, payload preparation, and optional background work. Concurrent requests remain distinct. Background work is linked to its initiating operation but never counted as that operation's foreground SQL merely because their clocks overlap.

## Current capability and gap

The existing `macrofold.inference.timing` and `macrofold.database.group` channels guard timing work with `hasSubscribers`. Without subscribers, those hooks do not collect samples. The inference fixture additionally wraps database methods with `performance.timerify`, observes event-loop/GC behavior, and optionally starts the inspector. Its global active-request index and timestamp windows are appropriate only for its declared single-flight experiment; they do not provide reliable concurrent request attribution.

There is no single normal-application profiling switch. `PROFILE_INFERENCE_*` settings configure the disposable benchmark; `WORKER_DIAGNOSTICS` covers worker diagnostics; `TRACING_ENABLED` controls execution observations sent to Langfuse. These are separate responsibilities. Ordinary deadline, accounting and public receipt timing still run and must remain active when profiling is off.

## Operator journeys

### Reproduce locally

1. Start the API and any worker needed by the workload with proposed `PERF_PROFILING_ENABLED=true`.
2. Use the normal caller and existing credentials; do not add a profiling header or change the customer request.
3. Reproduce the workload within the default five-minute collection window. Read structured, content-free profiling records from the process output. A local private-file destination is optional.
4. Compare request wall time, phase timings, database work and background work using the same operation identifier. Report missing/incomplete samples explicitly.
5. Collection stops automatically at the window boundary. Unset the flag or set it to `false` and restart to return the process to its normal configuration; restart with the flag to open another window.

The default enabled sample rate is 100% for a bounded diagnostic window. Busy deployments may choose a lower rate. Bounds may drop diagnostic samples, never requests. Reports expose drops and sampling so a quiet report cannot be mistaken for low application load.

### Profile a deployed process

Set the flag through the deployment's existing environment configuration and restart/redeploy the selected API or worker process. Each process has its own bounded window and instance identifier. Collect its JSONL output through the existing logging infrastructure. Files on an ephemeral serverless filesystem are not promised durable. Enabling the flag does not grant production access, trigger test traffic, or authorize paid calls.

No customer-facing endpoint, administrator mutation API, open inspector port, or new profiling service is introduced. A runtime toggle without restart is deliberately excluded from this first version.

### Investigate an optimization

Use the same synthetic workload with profiling disabled, enabled without CPU sampling, and separately with fixture-only CPU sampling. Keep execution tracing on/off a separate experimental dimension. Preserve source/configuration/topology identity, measured arrival rate, errors and accounting assertions. Do not subtract instrumentation cost from the reported request result to claim the target was met.

## Scope

Instrument existing owners, not every function:

- Shared REST/customer-MCP HTTP processing and immediate JSON/SSE execution.
- Database transactions, explicit ordered groups, commit/rollback and pool checkout across the three existing pools.
- Queued/native/bounded dispatch steps, model/tool I/O, storage operations and maintenance work at their existing bounded entry points.
- Optional capture, analytics and cleanup as background operations.
- The actual source-to-client native fixture, preserving its distinct process/clock and transport boundaries.

The first version uses a small shared profiling API and bounded local collector. No distributed tracing platform, profile database, general-purpose metrics registry, arbitrary SQL capture, heap dump, or automatic cloud profiler is required. Langfuse remains the execution-content/cost diagnostics integration; the profiler remains content-free operational instrumentation.

## Information and privacy

Allowed fields are enumerated IDs, operation/stage names, process-local correlation, outcomes, durations, byte counts already known to the caller, row/statement/group counts, queue state and coarse runtime health. No SQL text/parameters, prompts, model output, file paths, arbitrary URLs, credentials, request bodies, raw errors or caller-supplied labels enter a profile.

Profile identifiers are generated by the service. They confer no authority and are not accepted as instructions or control state. Resource identifiers, if needed for local diagnosis, follow the technical design's explicit allowlist and private-output rules; no new tenant-wide reporting endpoint is added.

## Failure and completion behavior

- Disabled: no profiling context allocation, subscriptions, sampling clocks, event-loop monitors, timers, exporter or output work. Small branch/function-call overhead remains and must be measured; do not claim literal zero overhead.
- Enabled but unsampled: skip stage/query sampling and collector records; avoid creating a profile tree merely to discard it.
- Expired window, exhausted buffers or slow output: stop accepting diagnostic work and count omissions. Do not delay business operations or grow memory without bound.
- Sink failure: discard diagnostics safely, release their resources, and issue a bounded safe diagnostic. Never fail a transaction/request because profiling failed.
- Request finishes or disconnects: close its delivery measurement; retained provider/finalization and background lifetimes remain distinct. Durable results/accounting continue under their existing owners.
- Process death: profiles may be incomplete/lost. No recovery queue is created for them. Durable execution and billing are unaffected.

## Acceptance criteria

1. A fresh API/worker process with no flag behaves as today and installs no profiling subscriber, monitor or inspector. Existing operational deadlines and receipts remain correct.
2. The single enable flag produces usable stage/database records from normal REST, MCP and worker execution; disabling and restarting removes collection. Automatic expiration releases collection resources.
3. Concurrent requests, nested operations and background tasks have correct attribution, including database work after the foreground response. No cross-tenant content or authority is inferred from diagnostic context.
4. One pipeline counts its real statement count and one local submitted wait group; one transaction counts one actual commit. Metrics are not relabeled as measured network round trips or server lock time when those are unavailable.
5. Queues, active contexts, per-operation samples, output bytes and flush lifetime have tested bounds. Slow/broken sinks, thrown internal callbacks and full buffers cannot alter application outcomes.
6. The matched fixture quantifies off-path and on-path overhead, CPU, memory, event-loop lag and dropped samples. Enabled profiling must not undermine the existing under-100-ms server-overhead p95 qualification; missed gates remain visible rather than increasing the budget silently.
7. Existing inference/runtime/tool benchmark scripts use the shared instrumentation and retain their workload/accounting assertions. Reports identify synthetic versus live providers and limitations of provider-time attribution.
8. Operator instructions are copyable, distinguish proposed versus implemented settings, and explain restart, finite windows, sampling, output location and cleanup. No deployment, paid execution or runtime process change occurs merely by writing this design.

## Delivery and decisions

Implement profiling first so later SQL/payload changes can be measured with reliable correlation. Follow stages P0–P6 in the [technical design](performance-profiling-tech-design.md#implementation-sequence). Default-off profiling is recommended; detailed execution tracing remains unchanged. Local benchmark inspector use stays explicit and isolated.

Implementation approval is still required. This document resolves routine design choices; it does not authorize application edits or the optional reduction of trace content or request analytics.
