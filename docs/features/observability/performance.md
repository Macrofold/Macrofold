# Profile application performance

Temporarily measure ordinary API and worker execution with content-free process profiles. Profiling is **off by default** and independent of Langfuse execution tracing. Required deadlines, billing and public receipt timings remain active in every mode.

## Capture a slow operation

1. Set `PERF_PROFILING_ENABLED=true` in the environment of the API or worker you want to inspect.
2. Restart that process through its existing supervisor or redeploy it. Reproduce the operation using its normal API and credentials.
3. Collect JSONL records with `component: "performance"` from the process output. Collection stops automatically after five minutes. Each process has its own capture and instance IDs.
4. Set the flag back to `false` and restart to restore the normal configuration. Restart with it enabled when another capture is needed.

For a local API started directly from source:

```sh
PERF_PROFILING_ENABLED=true pnpm dev
```

For a busy worker, collect one percent of whole operations for ten minutes:

```sh
PERF_PROFILING_ENABLED=true PERF_PROFILING_SAMPLE_RATE=0.01 \
  PERF_PROFILING_DURATION_SECONDS=600 pnpm worker
```

Use the existing process and port; do not start a competing preview or worker. Changing environment values does not alter an already running process. There is no customer request flag or live administrator toggle.

The capture window begins when its serving composition initializes: during self-hosted API readiness, at the first transport/step entry when no shared readiness ran, or at standalone worker startup. Repeated readiness probes and requests reuse that collector; expiry does not start another window. Next instrumentation does not create a second collector, because its separately compiled module graph could wrap the same database pools twice and interfere with cleanup.

## Settings and output

| Setting                           | Default       | Accepted values                                                   |
| --------------------------------- | ------------- | ----------------------------------------------------------------- |
| `PERF_PROFILING_ENABLED`          | `false`       | Literal `true` or `false`                                         |
| `PERF_PROFILING_SAMPLE_RATE`      | `1`           | Number from 0 through 1; the whole operation is selected together |
| `PERF_PROFILING_DURATION_SECONDS` | `300`         | Integer from 1 through 3600                                       |
| `PERF_PROFILING_OUTPUT_DIR`       | Unset; stdout | Optional private local directory; unsupported on hosted processes |

Invalid optional settings emit `performance_profile_configuration_invalid` and leave profiling disabled. They do not prevent the application from serving requests.

For private local files:

```sh
PERF_PROFILING_ENABLED=true PERF_PROFILING_OUTPUT_DIR=.data/performance pnpm dev
```

The directory must be private and free of symlink components. Newly created directories/files use modes 0700/0600 and unique file names. Hosted captures should use the deployment's existing log collection; an ephemeral filesystem is not durable storage.

Profiles contain fixed operation/stage names, generated request/Run correlation IDs, timings and numeric counters. They exclude prompts, answers, tool arguments, file paths, SQL text/parameters, raw errors and credentials. Restrict access to logs separately from customer API access.

## Read the measurements

- Operation records distinguish foreground request handling, retained stream producers, jobs and optional background work. Background records link to their initiating operation without adding their SQL to its foreground count.
- `http.total` starts inside the API handler, after the framework loads the route. It excludes framework compilation/module evaluation and socket delivery. `http.parameter_validation` includes first-use header/path schema compilation; `http.body_validation` measures body validation; `http.response` aggregates response projection and JSON construction. These stages are contained in `http.total`, not additional latency to add to it.
- `trace.initialize` measures synchronous first-use tracing-backend construction. `trace.record` measures synchronous enqueue/serialization and application logging, separately from initialization. SDK module loading before route entry and asynchronous network export are outside these stages.
- Database counters distinguish submitted statements, ordered wait groups, actual transaction outcomes and pool checkout. Group/transaction examples are bounded; aggregate counts continue after their example budget is exhausted.
- Query and checkout durations include queueing, network and local scheduling. They do not isolate PostgreSQL lock wait or CPU. Unknown parameter sizes remain unknown; profiling never serializes objects just to count them.
- A provider span measures the adapter/transport interval. Provider computation time is normally unknown. Subtracting that entire interval does not establish pure Macrofold overhead; the synthetic performance fixture separately measures its upstream wait.
- Stream response readiness and retained producer completion are separate lifetimes. Returning response headers is not completion of a streamed answer.
- Capture summaries expose sampling, unattributed statement/checkout totals and drops. Missing profiles are not evidence of zero traffic. Reports may be incomplete after overload, expiry, a slow sink or process death.

Collection admits at most 256 active scopes, eight simultaneous stage spans per scope and bounded group examples. Output admits at most 256 records and 1 MiB including writes in flight, with an 8-KiB record ceiling and one writer. Expiry detaches ordinary instrumentation immediately, then allows ten seconds for protected native reports to arrive through normal probes before the sink's bounded drain. Explicit process shutdown closes immediately. Overflow loses diagnostics rather than delaying or rejecting customer work. Stdout itself may block depending on its destination; use the asynchronous private-file sink for a slow local terminal.

### Native turns

The same settings optionally select whole native turns. Selection is stable for a Run within its capture, independent of the surrounding request's sampling. Settings expire at the earlier of the capture window and Run deadline; replay cannot renew them. A polling process can receive another instance's report, preserving the originating capture/instance IDs and adding its own receiver ID.

An operation record's `native_memory` contains bounded stage durations, sampled process RSS, up to five largest processes, worker heap marks and optional PSS coverage. The safety guard's existing process inventory supplies RSS; optional PSS reads never delay the guard. Missing, partial or denied PSS is explicitly reported. Summed process RSS double-counts shared pages and is not whole-container physical memory. A short turn may finish before any memory sample; that is unobserved, not zero.

Native profiles are private diagnostic output: they are consumed before public Run events, never included in checkpoints or stored as per-sample SQL rows, and do not change billing. Compatible warm continuations keep the loaded adapter while resetting measurements and Run credentials. Profiling neither warms a model nor keeps a Session alive. See the [native design and qualification](../../projects/native-memory-startup-tech-design.md#8-verification-matrix-and-commands) for bounds and evidence limitations.

## Separate startup, HTTP and application latency

Keep the first request in your report. Measure the caller's POST through full body decoding, correlate its `X-Request-Id` with the API profile, then measure any caller-side journaling, retrieval or result processing separately. A terminal inference already carries usage/billing and does not require another Run or billing request. Use `result.inference.timings_ms.provider` for the adapter interval; Run `completed_at - started_at` also contains platform work and is not provider latency.

`next dev` compiles routes on demand and can spend seconds before entering the handler, including after its initial readiness message. Compare a fresh process's first call and subsequent calls in both development and a [compiled local server](../../getting-started/local-development/docker.md#measure-api-latency-with-a-compiled-server). Do not remove the cold sample or report handler-only timing as full HTTP timing. A warm synthetic p95 below 100 ms is a qualification for that workload and topology, not a cold-start or per-request guarantee.

Next’s startup “Ready” log is not an HTTP readiness probe. Self-hosted `/health` checks the database/configuration, awaits the shared REST handler dependencies and initializes trusted contract validators before returning success; probe each serving instance before routing traffic to it. A self-hosted rewrite routes health through the same compiled REST wrapper and one shared health-response owner, including its Next/background dependencies without registering work. Matched route parameters distinguish the operational path; health bypasses API authentication, trace flushing and dispatch. It also initializes the configured trace sink without recording/exporting a span; disabled tracing remains a no-op and configuration failures retain best-effort handling. This pays reusable compilation/setup costs during startup. Caller-supplied schemas still undergo bounded validation on each request and use the existing compilation cache. Vercel skips that eager initialization because its route functions need not share a process. Measure process start through readiness separately, then keep the first inference in the request report: new transport connections, caller schemas and runtime code can still initialize on first use. Any non-2xx health result fails readiness, including framework module-load failures outside the health handler. Never send a hidden model warmup or discard that first inference to meet a budget.

Synthetic upstream fixtures must keep their own observation work outside the timed response path. Buffer bounded timing records and drain them after measurement; a synchronous file write between the upstream timer stopping and the response returning falsely increases measured platform overhead. Report observer changes and retain earlier results with their limitations.

When the framework-to-handler gap is large, profile framework startup and module evaluation in an isolated source/build and port. The ordinary profiler intentionally does not install a global framework tracer or CPU inspector. SDKs used only for connectors or remote object storage load at their provider port's first actual use, and the Workflow dispatcher loads its optional runtime only for a matching deployment; unrelated inline inferences do not pay that initialization cost. Preserve authorization, financial settlement, validation and default tracing when comparing changes.

## Other diagnostic choices

For native scheduling, include admission commit, candidate/claim queries and
phase publication in the measured interval. `phaseTimings.activeMs` excludes
the initial claim and final transaction; it cannot establish scheduling overhead
by itself. Poller `admission`, `candidates`, `claim` and `advance` jobs use the same
optional collector. The [native qualification](../../projects/native-scheduling-latency.md)
compares an actual API/separate-poller path and full cross-pool boundaries, with
small and near-limit prompts, rather than treating provider work as total latency.

Full execution tracing remains the default when configured. `TRACING_CAPTURE_CONTENT=false` keeps execution timings, IDs, usage and costs while avoiding optional content capture. `TRACING_ENABLED=false` disables that integration. Both are independent of performance profiling.

`REQUEST_ANALYTICS_ENABLED=false` disables optional retained HTTP request observations. `API_PRODUCT_EVENTS_ENABLED=false` disables successful API-operation observations. Both default to true. These settings preserve billing, authorization/rate accounting, administrative audits, actor activity and durable domain milestones. Request reports describe observed activity and cannot establish exact total traffic, especially after collection is disabled.

Restart all affected processes when changing diagnostic policy. Customer input cannot enable profiling or change these settings.
