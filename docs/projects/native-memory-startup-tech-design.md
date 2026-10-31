# Native memory diagnostics and startup efficiency: technical design

Status: proposed; implementation has not started under this design.

Parent: [project index](README.md). Behavior/acceptance: [feature specification](native-memory-startup-feature-spec.md). Work: [maintainer tracker](../maintainers/TODO.md#native-memory-and-startup-efficiency).

## 1. Decisions and boundaries

Use three small extensions to existing owners:

1. Return a reusable allocation-memory observation from the existing Linux process inventory. The supervisor keeps enforcing its current RSS limit and records a compact failure summary.
2. Extend the existing optional performance collector with trusted native-turn capture settings and bounded native-profile import. Reuse protected runtime transport, polling, correlation and the current JSONL sink.
3. Load the selected adapter and its SDKs lazily. Keep the existing bundle format, image contents and warm adapter lifetime.

These changes require no schema migration, new dependency, customer parameter, public endpoint or private-protocol versioning system. Macrofold supplies reusable execution mechanics; game-world state and rules remain in the caller. Keep the existing safety, accounting and checkpoint owners, without adding compatibility machinery for hypothetical users.

## 2. Current flow and known evidence

Relevant implemented owners:

| Owner | Current responsibility | Proposed change |
| --- | --- | --- |
| [agent-processes](../../packages/runtime/src/agent-processes.ts) | Shared in-flight `/proc` inventory, effective-UID filtering, memory sum, writer quiescence | Return the existing observation without another scan; optional bounded PSS reader. Preserve quiescence behavior. |
| [supervisor](../../packages/runtime/src/supervisor.ts) | Guard every 500 ms, cancellation, child protocol, protected result and snapshot | Retain failure facts; aggregate optional samples; accept narrow diagnostic frames. |
| [native-worker](../../packages/runtime/src/native-worker.ts) | Adapter selection, permissions, model bridge, warm turn loop | Selected lazy adapter, optional stage/own-heap markers, unchanged per-turn capability rotation. |
| [runtime types](../../packages/runtime/src/types.ts) | Native configuration, adapter interface and result | Internal capture settings and structured resource failure. |
| [performance contracts](../../packages/contracts/performance.ts) | Content-free collector record and sink types | Optional `native_memory` payload on an operation record. |
| [core performance](../../packages/core/src/performance.ts) | Sampling, finite capture, attribution and bounds | Capture-settings factory, bounded late delivery and native-record import. |
| [worker machines](../../packages/core/src/worker-machines.ts) | Authorized allocation configuration and Host control | Attach operator-generated capture settings at prepare. |
| [cloud engine](../../packages/core/src/cloud-engine.ts) | Native polling, event ingestion, persistence and final publication | Consume private profiles; publish one safe memory-failure event from the protected final result. |
| [Host runtime](../../packages/core/src/host-runtime.ts) | Validate provider observations | Preserve/validate the new optional result field instead of stripping it. |
| [runtime build](../../scripts/build-runtime.ts) | Bundled ESM entry points with external packages | Keep layout; verify that required SDK imports remain dynamic in the artifact. |

Retained facts from the investigated October 31 OpenCode Run:

| Observation | Value and interpretation |
| --- | --- |
| Allocation | 1,024 MiB RAM, 250 CPU millis; the latter is a quarter-core allocation, not evidence of measured CPU throttling. |
| Model request | OpenRouter `meta/muse-spark-1.3-contributor`; one captured request, 74,138 JSON input bytes, two messages and two tools. No token usage was captured. |
| Created → Run started | 8.590 s; includes scheduling/placement, not model computation. |
| Run started → runtime started | 7.857 s; a broad lifecycle interval, not a measured SDK-import duration. |
| Runtime started → stream-failure event | 7.657 s; the captured model-request interval was 6.121 s and overlaps this interval. Do not add them. |
| Failure event → Run completed | 4.596 s; includes shutdown/persistence/publication. Total created-to-completed: 28.700 s. |
| Final state | `memory_limit`, with verified persistence; no surviving process samples or actual RSS peak, and the runtime had been removed. |

The trace cannot reconstruct uncaptured memory. OpenRouter performs inference remotely; these processes are not loading Muse's model weights. SDK heaps, native processes, retained history and shared pages remain candidates to measure. A stream closing proves neither a provider retry nor an OOM. No historical leak or exact memory culprit is established.

The current guard uses `ceil(sum(VmRSS KiB) / 1024) > configured MiB`. Preserve that exact comparison, including rounding and strict greater-than. Sum-of-RSS is not unique physical memory. `smaps_rollup` offers PSS for explanation, not a silent change to enforcement. [Linux memory definitions](https://docs.kernel.org/filesystems/proc.html).

## 3. Shared observation and required failure facts

### 3.1 One process inventory

Add `agentMemorySample(uid)` beside `agentMemoryMiB`. It uses the current `inventory()` promise, effective UID, zombie exclusion and disappearing-process handling. Return:

```ts
type AgentMemorySample = {
  observedAtMs: number; // supervisor monotonic clock, after the inventory completes
  rssBytes: number;
  processCount: number;
  unavailableProcessCount: number;
  processes: ReadonlyMap<number, {
    rssBytes: number | null;
    kind: 'node' | 'opencode' | 'bun' | 'python' | 'other';
  }>;
};
```

Convert parsed KiB to bytes once. Classify only exact allowlisted values of the already-read `/proc/PID/status` `Name`; everything else becomes `other`. Names are diagnostic hints, never authority. Do not read `cmdline`, environment, maps or filesystem paths. A missing or unparseable RSS contributes zero to the guard sum as today, but is `null` in the diagnostic view and increments `unavailableProcessCount`. Optional reports describe incomplete coverage rather than claim an exact zero observation. Largest-process lists include only valid observed RSS values.

`agentMemoryMiB(uid)` becomes a wrapper over this view using the current rounding. Quiescence and signal functions keep their behavior, including fresh inventories and UID-restricted signals. Keep sharing limited to a scan already in flight: do not add a TTL cache or reuse an old sample to prove writers stopped. Do not retain every process map after the tick; profiles retain only bounded projections.

### 3.2 Guard ordering

In the existing non-overlapping 500-ms check:

1. Check cancellation and deadline as today.
2. Where the current allocation memory guard exists, obtain one `agentMemorySample(UID)` and compute the same rounded comparison.
3. Maintain a numeric per-turn `peak_observed_rss_bytes` from these guard observations.
4. If over limit, set the existing resource failure and signal the child **before** any optional collection, sorting, PSS read, event write or export. Preserve the existing grace and writer-quiescence rules.
5. Using the retained observation, select the five largest processes with a single bounded top-five pass. Save the failure summary in memory for final-result publication. No fresh scan is required.
6. Otherwise, give the observation to the optional collector through a non-throwing synchronous method. It may schedule bounded enrichment; it must not return a promise the guard awaits.

If the underlying required inventory fails, retain its existing execution failure behavior. Do not hide a safety-monitor failure inside the optional collector's best-effort exception handling.

### 3.3 Required failure schema and publication

Create one small shared contract owner, `packages/contracts/native-diagnostics.ts`, for the runtime/core boundary. Use existing Zod conventions for bounded runtime validation and export inferred types; do not maintain duplicate handwritten types and validators. Move the existing fixed `RuntimeStage` definition there, add `adapter_load`, and re-export its type from `failure-diagnostic.ts` so contracts never import runtime implementation. `process_start` is a supervisor-only profile stage; `resource_enforcement` is the core-published resource diagnostic stage. The allocation UID and original Run identity come from authenticated assignment/configuration, not a child frame.

Extend `NativeResult` with optional `memoryFailure`:

```ts
type MemoryFailure = {
  measurement: 'process_rss_sum';
  limit_bytes: number;
  observed_rss_bytes: number;
  peak_observed_rss_bytes: number;
  process_count: number;
  unavailable_process_count: number;
  largest_processes: {
    pid: number;
    kind: 'node' | 'opencode' | 'bun' | 'python' | 'other';
    rss_bytes: number;
  }[]; // at most five, descending RSS; tie-break by PID
};
```

All numbers are finite nonnegative safe integers; PIDs are positive integers. Maximum serialized summary is 2 KiB. It is numeric metadata, not a new general error body. The supervisor owns it: ignore any `memoryFailure` supplied by the child and attach only the guard's value to the protected `result.json`. A child-reported failure code alone cannot create this trusted resource summary or raise limits.

Update all existing result validators/projections, including `HostRuntime`, to retain this field. In the cloud engine's existing transaction that accepts the terminal native result and moves the Run to persisting, also emit:

```json
{
  "type": "runtime.failed",
  "data": {
    "stage": "resource_enforcement",
    "code": "memory_limit",
    "message": "The allocation exceeded its summed process RSS limit; shared pages may be counted more than once.",
    "memory": { "measurement": "process_rss_sum" }
  }
}
```

The example abbreviates `memory`; send the complete validated summary above. Use producer ID `runtime-resource:<assignment_id>` and sequence `1`, taking the assignment from the validated machine binding (`sessionId` in `WorkerMachines`). It is stable across poller lease changes. Batch this event with `run.persisting` in one `emitBatch` call in the existing transaction. Emit only for a supervisor result with `failureCode: "memory_limit"` and a valid summary. A subsequent checkpoint failure can still determine the Run's terminal code; preserve both facts.

Do not also emit this resource event from the supervisor's ordinary event stream; there is one canonical publisher. A separate child `event_stream_closed` event may remain. Existing Run authorization and the existing trace exporter handle the resulting `runtime.failed` event; inspect their bounded metadata projection so numeric facts reach Langfuse without new credentials or a native tracing client.

The event arrives when the protected native result is ingested, not necessarily at the exact moment of the kill. If the entire Host dies before writing that result, ordinary recovery may have no memory summary. Do not manufacture one or infer kernel OOM from an exit code alone.

## 4. Optional profiler integration

### 4.1 Operator control and capture settings

Reuse `PERF_PROFILING_ENABLED`, `PERF_PROFILING_SAMPLE_RATE`, `PERF_PROFILING_DURATION_SECONDS` and the existing output policy. No additional flag is needed. Enable all worker replicas that may prepare or probe the Run so any normal observer can import the report; separately enable the API process when HTTP profiling is wanted. Enabling only a preparer can lose reports later observed by a disabled replica.

Add `nativeProfileCapture(runId)` to the existing core collector. When inactive, expired or sample rate zero, return `undefined`. Otherwise use SHA-256 of `capture_id + ":" + run_id`; interpret its first four bytes as an unsigned big-endian integer divided by `2 ** 32` and select when below the sample rate. This selects whole turns without another draw on each poll or multiplication by the enclosing job's sampler. No per-Run registry is needed.

Capture settings contain only `capture_id`, `origin_instance_id`, `sample_rate` and absolute `expires_at_ms`. Expiry is the earlier of the collector's expiry and the Run deadline. IDs are UUIDs; sample rate is finite in `(0, 1]`. Clamp remaining duration at receipt to `[0, 3,600 seconds]`, then use a monotonic deadline. Do not renew it on retries or reuse; these settings are diagnostic correlation, not an authorization grant.

Add optional `performance` to trusted `NativeConfiguration` and its schema. Attach it in `WorkerMachines.prepare` from operator composition, never by spreading public Run input. Do not forward environment variables, output directories, tracing keys or profiler credentials into the agent. Treat invalid diagnostic configuration as disabled, with a fixed warning, without rejecting otherwise valid execution configuration. Keep authoritative runtime-configuration validation strict as before.

Keep capture settings out of public Run config, checkpoints, the prepare fingerprint and `warmSessionKey`. Repeated prepare returns the first accepted assignment configuration. Each warm turn receives its own settings, possibly absent, without invalidating the harness. Recovery never replays execution to obtain diagnostics.

### 4.2 Runtime collector and exact bounds

Add `packages/runtime/src/memory-profile.ts` with a small `MemoryProfileAccumulator` that accepts observations, stage markers and a monotonic clock, and returns the bounded `NativeMemoryProfile` data below. Keep `/proc` reads in `agent-processes.ts` and transport in the supervisor. Use `observe`, `stage`, `finish` and idempotent `dispose` methods; no timers or I/O inside the accumulator. The supervisor owns its lifecycle and the Host's small active-profile/PSS-read counters; release a profile slot on finish or exception. This keeps aggregation independently testable without another collector framework.

| Bound | Initial value and reason |
| --- | --- |
| Active optional profiles per Host process | 8; limits observer memory/I/O independently of customer admission. Extra profiles are skipped, not Runs. |
| RSS profile observations | At most 1 per second, reusing guard observations; no extra inventory or timer. Guard remains every 500 ms. |
| Retained recent samples | Ring of 16; aggregates and observed peak continue after older examples are replaced. |
| Stages | Fixed enum: `process_start`, `adapter_load` and existing `RuntimeStage` values. No user-defined labels. |
| Largest processes | Five at the observed RSS peak; five separately in a limit-failure summary. |
| PSS enrichment | At most one attempt per profiled allocation per 5 seconds; largest eight currently observed processes; two reads in flight across the Host; no waiting queue. |
| Per-process PSS read | Maximum 16 KiB from `smaps_rollup`; unavailable/oversized data is omitted, not truncated into a valid number. |
| Native diagnostic frame | Maximum 1 KiB; fixed stage/heap schema; at most 32 accepted frames per turn. Excess is dropped. |
| Profile publication | One private profile record per turn, on expiry or turn end, whichever occurs first. Maximum 7 KiB payload so the outer record fits the existing 8-KiB sink limit. |
| Output/replay bounds | Existing sink caps: 256 records, 1 MiB outstanding, one writer. Native event/probe byte caps remain unchanged. |

These are diagnostic work budgets, not application capacity defaults. Qualify their observer cost before shipping; lower optional detail rather than raising customer latency or weakening the memory guard.

For each retained RSS observation store relative supervisor time, last known stage, RSS bytes and process count. Keep each stage's observation count, maximum RSS and elapsed duration; the recent series supplies individual values. Mark the series `sampled`, not an exact instantaneous peak. Repeated stages aggregate into one entry. Stage durations use supervisor receipt times; worker-relative timestamps are separately labeled and never subtracted from the supervisor's clock.

On each eligible RSS sample, the optional PSS attempt may start only if its interval and global in-flight budget permit. Skip contention without a global waiting queue. An admitted attempt walks its fixed list of up to eight candidates with at most two concurrent reads; it starts no further read after its observation deadline or if another allocation occupies the available slots. This is a bounded local walk, not a deferred backlog. Read only the allocation's already-observed PIDs. Open each process's rollup file and verify its file owner matches the allocation UID before reading; use that same descriptor for the bounded read so PID reuse cannot redirect it to a different process. If ownership cannot be established, the process exits, access is denied or a read fails, omit it. Do not grant new kernel capabilities to make profiling work.

An asynchronous enrichment never blocks the guard, lifecycle, checkpoint or finalization. Keep its in-flight slot occupied until its actual read settles, even after a soft deadline; do not use repeated timeout races that leak unbounded reads. A 100-ms observation deadline marks unfinished results unavailable. Late completions may only release their slot; they cannot mutate a finalized profile or the next warm turn. Use a per-turn token/run ID to reject stale callbacks.

Keep one PSS snapshot with observation time/age, read duration, covered/observed process counts, covered RSS and PSS bytes. `complete` means all processes in that inventory were covered, not an atomic memory snapshot. Otherwise the sum is partial. RSS and PSS are separate measurements, not additive or interchangeable peaks. No per-mapping parsing or `smaps` fallback.

When the current path has no allocation memory monitor, report `memory_status: "allocation_monitor_unavailable"`; do not introduce a new scan or safety policy just for profiling. Selected-adapter timing/own-heap markers can still be available. This is a capability report, not a new fallback execution path.

### 4.3 Stages and JavaScript heap

Route every worker/adaptor stage transition through the existing `setStage` callback, extended by one common worker helper; do not scatter separate profiling calls across adapters. When capture is enabled, send a private `diagnostic` frame containing `run_id`, `capture_id`, `kind: "stage"`, the fixed stage and `worker_offset_ms`. Require both IDs to match the active supervisor turn before accepting a frame: they are correlation checks, not authority. This prevents delayed warm-turn frames from contaminating the next Run. Attribute RSS to the last stage received; timing can lag and is not causal allocation tracing.

Use `kind: "heap"` frames with the same IDs and one heap mark: before factory loading, after loading, and at turn end. The after-load frame additionally carries `adapter_load_ms`, covering the entire awaited factory including selected SDK imports. Sending the before mark separately preserves a baseline if loading fails. Warm turns send start/end marks and omit loading time; reuse comes from the supervisor, not a child flag.

Capture worker `heapUsed`, `heapTotal`, `external`, `arrayBuffers` and RSS at loader boundaries and turn end only. On a reused turn capture turn start/end instead of loader boundaries. These values describe the native-worker Node process only, not an OpenCode/Bun server, Python child or all processes combined. `arrayBuffers` overlaps `external`; heap metrics do not sum to RSS. No forced GC, heap snapshot, inspector, SDK object serialization or periodic full `memoryUsage()` call. [Node 24 memory semantics](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage).

Validate frames with the shared schema and bounds; derive authority from the supervisor regardless of supplied IDs. Drop unknown keys/stages, invalid numbers and stale/oversized frames. Use a non-awaiting stdout write only when it is not backpressured, with a handled callback error. Do not add a second write queue. Expired/absent capture settings suppress optional frames and heap collection; ordinary failure-stage tracking remains active.

### 4.4 Transport, correlation and expiry

The supervisor writes the completed aggregate as a private `runtime.memory_profile` record through its existing protected event writer. Do not append every sample. The record contains the original capture/instance IDs, Run ID from trusted configuration, profile ID `(run_id, capture_id)`, harness, cold/warm status, measurement bounds, coverage and drop counts. It contains no paths, prompts, provider bodies, native session IDs or environment values. Reserve this event name to the supervisor: discard attempts to publish it through a child `event` frame.

Finalize the accumulator synchronously and offer its single bounded record to the supervisor's existing event-dispatch owner outside the guard's awaited work. Add one `tryAppendDiagnostic` operation: reject when the writer has a backlog, is closing or is truncated; otherwise serialize the append with ordinary event writes. Catch its failure separately so it cannot enter the child-termination error handler. This optional local append has measurable observer cost; no PSS or remote export is awaited. Close/drain the existing writer before publishing a terminal result so a late diagnostic cannot appear behind the terminal cursor. Do not create a separate writer, queue or publication retry.

At the cloud engine's existing probe ingestion, validate/extract this record **before** `observeRuntimeEvents` and public filtering. Call a non-throwing collector importer, then exclude the private event from tracing and `emitBatch`. The ordinary event cursor still advances transactionally. Do not insert the profile or its samples into PostgreSQL, expose it on public SSE, export it as full tracing content or create another provider probe. The ordinary protected runtime log is already part of execution scratch storage and is removed by its existing cleanup; it is not a worktree/home checkpoint.

The importer maps capture/Run IDs, `origin_instance_id` → `instance_id`, start/duration and sample rate onto the existing `PerformanceRecord` envelope. Add optional `receiver_instance_id` and put only the remaining measurements in `native_memory`, avoiding duplicate correlation fields. Use `operation: "run"`, `phase: "job"`, trusted organization identity and empty ordinary counters/stages. Loader timing remains a native measurement. Reuse the sink/drop counters without resampling or a correlation registry.

Import does not require sticky routing: a receiving worker collector may write another instance's native record after authenticated Run/Host validation. Preserve origin capture/instance IDs and add the receiver instance ID separately. Validate payload `run_id` and harness against the bound Run; take organization identity from the control plane. This report is excluded from ordinary SQL/foreground counters. Capture IDs never authorize access.

Use one finite collector lifecycle: **collecting → receiving → closed**. At the configured deadline, disable sampling/new settings, run the existing instrumentation-detachment callbacks and finish ordinary scopes. Stop the native accumulator on expiry or turn end, using the existing check loop even without a memory monitor. Keep only native-record import and sink flushing available for **10 more seconds**, then emit the capture summary and use the existing two-second bounded sink close. The receive timer is unref'ed; explicit shutdown closes immediately with that bounded drain. No request/replay extends either deadline. `active()` becomes false at collection expiry, not after the receive interval.

This avoids closing the sink at the same instant the runtime emits its expiry report. Late/backlogged reports can still drop. The capture summary excludes receive/drain time from collection duration. Import only schema-valid frozen native aggregates in the receive state; no new collection/scopes. Bound reported duration to one hour, but do not compare independent machines' wall clocks to establish elapsed time. Keep origin IDs and use `(run_id, capture_id)` for offline deduplication after cursor rollback. No registry, database deduplication or additional receive setting is needed.

### 4.5 Profile payload

The shared schema owns this internal payload; runtime and core import the same inferred type. Keep the existing outer `PerformanceRecord.version`; do not add an independent native version or compatibility adapters:

```ts
type NativeMemoryProfile = {
  capture_id: string;
  origin_instance_id: string;
  run_id: string;
  harness: HarnessName;
  sample_rate: number;
  reused: boolean;
  started_at: string; // supervisor wall time, correlation only
  duration_ms: number; // supervisor monotonic interval
  ended_by: 'turn_end' | 'capture_expired';
  memory_status: 'observed' | 'not_observed' | 'allocation_monitor_unavailable';
  limit_bytes: number | null;
  peak_observed_rss_bytes: number | null;
  samples_seen: number;
  recent: { offset_ms: number; stage: MemoryStage; rss_bytes: number;
    process_count: number; unavailable_process_count: number }[]; // <=16
  stages: { stage: MemoryStage; observations: number; duration_ms: number;
    rss_max_bytes: number | null }[]; // one per fixed enum value
  largest_processes: MemoryFailure['largest_processes']; // observed RSS peak
  pss_unavailable_reason?: 'permissions' | 'unsupported' | 'busy' |
    'deadline' | 'vanished' | 'read_failed';
  pss?: { offset_ms: number; age_ms: number; read_ms: number;
    covered_processes: number; observed_processes: number;
    covered_rss_bytes: number; pss_bytes: number; complete: boolean };
  adapter_load_ms?: number; // absent for a reused adapter or incomplete load
  heap_marks: { kind: 'before_adapter_load' | 'after_adapter_load' |
    'turn_start' | 'turn_end'; worker_offset_ms: number;
    rss_bytes: number; heap_used_bytes: number; heap_total_bytes: number;
    external_bytes: number; array_buffers_bytes: number }[]; // <=3
  dropped: { frames: number; pss_reads: number; recent_samples: number };
};
```

`MemoryStage` is the fixed supervisor/worker stage set above. Durations are finite nonnegative milliseconds; memory/counts are safe integers. `null` means unobserved. A monitored turn ending before its first sample uses `not_observed`, not a zero peak. `samples_seen` counts one-second observations; `recent_samples` counts overwritten examples. The required failure peak covers every guard observation, so it can exceed the optional sampled peak. PSS coverage/`complete` and an optional failure reason express status without a redundant state field. Retain the last usable snapshot with its age after a failed attempt; no snapshot/no failure means no attempt completed. Never export raw exceptions.

At serialization, remove oldest recent examples until the 7-KiB payload bound is met; preserve aggregates, units and coverage. If the remaining fixed projection still exceeds the bound, drop the optional record and increment the collector's oversize/drop counter where available. Do not truncate JSON or raise a Run failure. The sink's outer 8-KiB bound is still final authority. Make empty counts/arrays explicit so missing records can be distinguished from empty observations.

## 5. Selected-harness startup

### 5.1 Loader and lifetime

Create a literal exhaustive `Record<HarnessName, () => Promise<HarnessAdapter>>` in `packages/runtime/src/harness-adapters.ts`. Each entry imports its known local adapter, then awaits that module's `createAdapter()` factory. The factory dynamically imports required external SDKs and constructs one adapter with those references. No module path from configuration, runtime discovery, global instance cache or dependency-injection framework.

Remove the six static imports from `native-worker.ts`. After environment/HOME setup, await the factory inside `try`/`finally` and retain its instance outside the warm loop. Time the local import through factory completion, including SDK evaluation. Factories only import/construct; resources start in `run`. Cleanup uses `adapter?.close()` and existing bridge/file-server cleanup. Check cancellation before `run`; never reset an aborted startup controller while entering the first turn. A fresh controller belongs only to a newly accepted turn.

Keep `HarnessAdapter.run/close` and the current warm-session key as the abstraction. The loader does not initialize a conversation or call a model. Do not move per-turn credentials, permissions, attachments or model-bridge state into a module cache. Continue using the current compatibility key to reject an incompatible warm conversation; a profiling toggle is not part of compatibility.

### 5.2 Defer SDKs in the actual bundle

The build uses `bundle: true`, external packages and no splitting. A local esbuild reproduction confirmed that dynamic local imports with static external SDK imports can still yield top-level external imports. Local loader changes alone therefore do not meet acceptance. [esbuild splitting/import behavior](https://esbuild.github.io/api/#splitting).

Move external SDK value imports into its awaited `createAdapter()` factory; keep types as type-only imports. Update internal direct constructor callers/tests to use the factory instead of retaining a compatibility constructor:

| Adapter/owner | Required treatment |
| --- | --- |
| Claude | Import the Claude agent SDK in its factory; retain query, MCP-server and tool helpers on that instance. |
| Pi | Defer Pi AI/coding-agent values; defer Pi-only MCP client/transport values in its tool bridge. |
| OpenCode | Defer the existing v1 client/v2 server/v2 client values until selected initialization. Preserve their current protocol roles. |
| Codex | Audit its transitive values and defer only dependencies exclusive to its selected path. Preserve native RPC startup. |
| Hermes/DeepSeek | Preserve their selected subprocess/bridge boundaries. Do not eagerly load their language runtimes or optional SDKs from the common worker. |
| Shared permission service | Keep genuinely common policy code shared. Defer MCP server value imports until that service is actually requested; no need to ban shared MCP dependencies required by the selected configuration. |

Use type-only imports or `typeof import("package")` aliases. The native module cache handles SDK reuse; the warm loop retains the adapter. Helpers used only when tools are enabled may import their own optional SDK on first use; attribute that to tool setup, not `adapter_load_ms`. Do not add top-level `await import()` in unconditionally initialized modules or change SDK versions/publisher internals for this optimization.

Keep the current ESM/no-splitting build and stable neighbor paths, including `document-worker.mjs`, Python bridge and source maps. Broad code splitting would create unnecessary asset-location work. The build-artifact test must fail if future bundling changes hoist an unused SDK again. Do not warm every SDK to hide a first-call measurement.

## 6. Performance, correctness and privacy budgets

- **Normal path:** no extra `/proc` reads, timers, remote calls or SQL groups with profiling off. Required guard observations gain only a numeric peak update and, on failure, a bounded projection. Preserve current cancellation latency and scan coalescing.
- **Profiled path:** fixed-size state, bounded enrichment, no per-sample serialization/write and no wait for PSS or remote export. Include the single optional local log append in observer cost. Reuse the sink's drop policy.
- **Cold path:** remove unused SDK evaluation, not required selected SDK/harness setup. Measure source entry, adapter loading, server readiness, restored-session loading, first model dispatch, first delta and final response independently.
- **Warm path:** reuse loaded modules/adapter/process; reset all measurement and capability state per turn. Do not accidentally turn resume into cold reinitialization.
- **Accounting:** allocated-memory-time remains the billing meter. RSS/PSS/heap samples do not affect prices, credits, usage, financial reservations or uncertain provider outcomes.
- **Persistence:** preserve output/checkpoint guarantees; capture settings, samples and stage frames stay outside user files and native history.
- **Tenant safety:** effective UID filtering and trusted assignment identity remain authoritative. Never widen process access or export another allocation's data. Raw process names/arguments are not profile labels.
- **Observer limits:** benchmark against the existing profiler targets, not an invented claim of zero cost: <2% CPU at 1% sampling, ≤2-ms mean and ≤5-ms p95 added full-sampling request latency on a declared clean topology. Report startup-specific observer latency too. If PSS exceeds budget, reduce its optional frequency/detail; retain RSS and correctness.

Cold Host acquisition, restoration, selected harness startup and upstream calls can remain substantial. The [native scheduling project](native-scheduling-latency.md) owns queue/cross-pool work and its local qualification. Reuse those timing boundaries; do not add a scheduler bypass here or interpret its sub-100-ms scheduling result as a cold native-response guarantee.

## 7. Implementation order

Read the current feature owners and scoped instructions before coding. Preserve the main preview and unrelated edits. Each stage includes its focused checks; no stage closes acceptance for another.

### M0 — Baseline and fixtures

1. Use the current native acceptance harness, a separate runtime image tag and isolated output directory. Record source/lockfile/image identity, Node/SDK versions, CPU/memory limits and host topology.
2. Retain matched cold and warm runs for OpenCode, Claude and Pi; smoke all other harnesses. Use synthetic content, explicit provider fixtures and no paid retry to reproduce failure.
3. Reproduce a guard-enforced memory failure with bounded fixture allocations and verify current persistence/accounting outcomes. Do not exhaust the development Docker VM or change the running preview's resource limits.

### M1 — Shared observation and failure summary

1. Add the shared diagnostic schema, memory view and preserved `agentMemoryMiB` wrapper. Keep UID, rounding and quiescence tests unchanged except necessary reuse.
2. Update supervisor guard ordering and trusted final-result summary. Update result validation in every actual provider/core projection.
3. Publish the idempotent resource event in the existing terminal-result transaction, and verify safe trace metadata. Do not add a database migration or round trip.
4. Prove normal profiling-off, event-log-full, cancellation, checkpoint-failure and replay behavior before proceeding.

### M2 — Optional native collection

1. Add collector capture/import methods and bounded receive state. Attach trusted settings during prepare; exclude them from fingerprints/warm compatibility.
2. Implement the bounded runtime accumulator/PSS reader and native stage/heap frames. Wire expiry/finalization without a second guard timer or awaited observer.
3. Consume profiles before tracing/public filtering; verify expiry delivery, shutdown, multi-worker import, drops and duplicate IDs.
4. Verify disabled mode has no extra collection I/O; overflow, late reads, malformed frames and expiry cannot stop a Run.

### M3 — Lazy adapter and SDK initialization

1. Add the exhaustive selected loader; move construction inside safe cleanup/failure boundaries.
2. Defer exclusive SDK values and optional permission-service values, preserving SDK types and per-turn state owners.
3. Add compiled-artifact/module-load assertions and run all-six native acceptance, including two warm turns and a fresh-container continuation.

### M4 — Qualification and documentation

1. Run the matrix below on a clean isolated Linux topology, retain unsuccessful/cold samples, investigate regressions and update measured limits if necessary.
2. Update [runtime](../features/execution/runtime.md), [profiling guide](../features/observability/performance.md), [harness verification](../engineering/testing/harnesses.md) and implementation status with actual behavior/evidence. Keep customer instructions short and link detailed semantics. Do not publish this internal proposal in public navigation.
3. Build matching control-plane/runtime artifacts; coordinate activation through the normal workflow rather than replacing an in-use image or restarting the preview. Close only verified tracker items.

## 8. Verification matrix and commands

Use [TESTING.md](../../TESTING.md) for required coverage/gates. Extend existing tests rather than build another native acceptance runner.

| Layer | Cases that must detect regressions |
| --- | --- |
| Process reader/unit | KiB conversion, exact rounding boundary, zombies/foreign UID, missing values, vanished PIDs, concurrent inventory sharing, no stale quiescence proof; PSS descriptor ownership/reuse, oversized/unavailable data and partial coverage. |
| Collector/unit | Off/unsampled no-op, deterministic selection, immutable expiry/ten-second receive window, immediate explicit shutdown, bounded observations/reads, stale callbacks, finalize/dispose once, warm reset and no fake zeros. |
| Supervisor/native | Guard signals before enrichment/export; exact failure summary survives event truncation; malformed/forged frames cannot change result/limits; cancellation/deadline, grace and quiescent checkpoints remain intact. |
| Core integration | Capture cannot be customer supplied/renewed on replay; private profiles advance cursor without public/SQL sample storage; one resource event even after lease change; checkpoint-error precedence; safe tracing; sink closed/full/foreign capture handling. |
| Built artifact | Test-only module-load hooks verify unselected SDK absence and selected SDK loading inside the timed factory; no production hooks. Exercise assets, abort during loading and safe import failure in the actual image without source mounts. |
| Native harnesses | All six selections; cold startup, two warm turns, changed permissions, fresh-container restored conversation, cancellation, SDK/tool bridge cleanup and no hidden inference replay. |

During implementation use verified repository commands, with concrete affected filenames once added:

```sh
pnpm exec vitest run tests/unit/performance.test.ts
pnpm build:runtime
pnpm test:native
pnpm sdk:build
pnpm exec tsc --noEmit
pnpm docs:check
```

Add the new targeted unit/integration files to that run and follow native runner prerequisites in the linked harness guide. Run required domain/CI gates per testing policy. This design adds internal contracts and an existing open diagnostic payload, not a shared REST schema change: skip all-language SDK regeneration/tests unless implementation actually changes a public closed schema/transport; if it does, follow the full affected contract workflow. Keep the TypeScript SDK build required by the app.

### Matched performance qualification

Use identical dependencies, limits, synthetic input and host for four cohorts: eager/lazy loader × profiler off/on. Freeze the M2 image (profiler implemented, loader still eager) as the comparison baseline, then compare with M3; do not add a production eager-loading flag. Retain M0's original unprofiled baseline separately to check overall overhead introduced by the feature. For OpenCode, retain 20 cold starts and 30 warm turns **per cohort**. For Claude/Pi, five cold starts and ten warm turns per cohort suffice for regression screening; expand for a regression or a claim about their performance. Others need functional/module-load and startup smoke checks. Alternate cohort order; separate fresh-process and fresh-container costs. Keep first calls/failures; no forced GC or hidden model warmup.

Use a deterministic upstream delay long enough to retain multiple samples, and separately a representative bounded real provider request if authorized. Exercise three simultaneous allocations to check isolation and observer contention. Export raw private measurements and a content-free report containing p50/p95, sample counts/misses, start-to-ready, loader duration, first dispatch/delta, full response, observed RSS peaks, largest processes, PSS coverage/age, worker heap and capture drops. Native process diagnostics are not a measurement of root-controller/whole-container RAM.

Compare before/after with the same observer mode to establish startup savings; compare on/off within the same build to establish observer cost. Use the existing isolated load harness for the profiler's 1%-CPU and full-sampling latency budgets; a handful of native turns cannot qualify high-traffic CPU overhead. If no trustworthy baseline or clean machine is available, mark the affected result unverified instead of substituting local noise or mathematical estimates.

### Completion and rollout

Link evidence for N1–N7. Build matching application/runtime artifacts and coordinate activation through normal Host lifecycle controls while preserving the shared preview. With no users, no migrations, dual-format readers or rolling-version negotiation are required. Isolated test fixtures may be recreated. Verify the complete image, not just a source overlay; report local versus hosted results separately. A rollback uses the previous qualified image and disables optional capture, leaving safety enforcement active.

## 9. Deliberate deferrals and evidence triggers

| Opportunity | Reason to defer; trigger |
| --- | --- |
| Change memory defaults or enforce PSS/cgroup totals | Would change admission/isolation semantics. Consider only after representative RSS/PSS and real OOM evidence, including shared pages and all supported providers. |
| Heap allocation stacks or snapshots | High overhead and potential customer-content disclosure. Consider a separate isolated debugger only if sampled RSS/heap identifies a reproducible heap-retention problem. |
| Per-allocation kernel cgroups | Additional provider/privilege/lifecycle complexity; does not remove the need for portable diagnostics. Revisit for an explicit hard-isolation requirement. |
| Replace broad `/proc` inventory with a process index | Existing shared scans also prove quiescence. Revisit only if clean multi-allocation profiles show scan CPU is material; preserve fresh fork/exit proof. |
| Persistent host-memory dashboards/diagnostic storage | Not required to explain one Run; adds retention, access and operational scope. Revisit if operators need continuous fleet monitoring. |
| Native queue/phase handoff changes | Existing [scheduling project](native-scheduling-latency.md); remaining hosted/tail acceptance belongs there. |
| Deeper publisher-runtime tuning | Requires evidence after unused loading is removed. Preserve upstream APIs and native session semantics; do not assume a leak from a large RSS sum. |

No unanswered product decision blocks this proposal. Real memory savings, observer cost, the adequate allocation size and provider-specific hosted behavior remain measurements to establish during implementation, not claims this design can supply.
