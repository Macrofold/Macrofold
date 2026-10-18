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

## Settings and output

| Setting | Default | Accepted values |
| --- | --- | --- |
| `PERF_PROFILING_ENABLED` | `false` | Literal `true` or `false` |
| `PERF_PROFILING_SAMPLE_RATE` | `1` | Number from 0 through 1; the whole operation is selected together |
| `PERF_PROFILING_DURATION_SECONDS` | `300` | Integer from 1 through 3600 |
| `PERF_PROFILING_OUTPUT_DIR` | Unset; stdout | Optional private local directory; unsupported on hosted processes |

Invalid optional settings emit `performance_profile_configuration_invalid` and leave profiling disabled. They do not prevent the application from serving requests.

For private local files:

```sh
PERF_PROFILING_ENABLED=true PERF_PROFILING_OUTPUT_DIR=.data/performance pnpm dev
```

The directory must be private and free of symlink components. Newly created directories/files use modes 0700/0600 and unique file names. Hosted captures should use the deployment's existing log collection; an ephemeral filesystem is not durable storage.

Profiles contain fixed operation/stage names, generated request/Run correlation IDs, timings and numeric counters. They exclude prompts, answers, tool arguments, file paths, SQL text/parameters, raw errors and credentials. Restrict access to logs separately from customer API access.

## Read the measurements

- Operation records distinguish foreground request handling, retained stream producers, jobs and optional background work. Background records link to their initiating operation without adding their SQL to its foreground count.
- Database counters distinguish submitted statements, ordered wait groups, actual transaction outcomes and pool checkout. Group/transaction examples are bounded; aggregate counts continue after their example budget is exhausted.
- Query and checkout durations include queueing, network and local scheduling. They do not isolate PostgreSQL lock wait or CPU. Unknown parameter sizes remain unknown; profiling never serializes objects just to count them.
- A provider span measures the adapter/transport interval. Provider computation time is normally unknown. Subtracting that entire interval does not establish pure Macrofold overhead; the synthetic performance fixture separately measures its upstream wait.
- Stream response readiness and retained producer completion are separate lifetimes. Returning response headers is not completion of a streamed answer.
- Capture summaries expose sampling, unattributed statement/checkout totals and drops. Missing profiles are not evidence of zero traffic. Reports may be incomplete after overload, expiry, a slow sink or process death.

Collection admits at most 256 active scopes, eight simultaneous stage spans per scope and bounded group examples. Output admits at most 256 records and 1 MiB including writes in flight, with an 8-KiB record ceiling and one writer. Expiry detaches instrumentation and drains for at most two seconds. Overflow loses diagnostics rather than delaying or rejecting customer work. Stdout itself may block depending on its destination; use the asynchronous private-file sink for a slow local terminal.

## Other diagnostic choices

Full execution tracing remains the default when configured. `TRACING_CAPTURE_CONTENT=false` keeps execution timings, IDs, usage and costs while avoiding optional content capture. `TRACING_ENABLED=false` disables that integration. Both are independent of performance profiling.

`REQUEST_ANALYTICS_ENABLED=false` disables optional retained HTTP request observations. `API_PRODUCT_EVENTS_ENABLED=false` disables successful API-operation observations. Both default to true. These settings preserve billing, authorization/rate accounting, administrative audits, actor activity and durable domain milestones. Request reports describe observed activity and cannot establish exact total traffic, especially after collection is disabled.

Restart all affected processes when changing diagnostic policy. Customer input cannot enable profiling or change these settings.
