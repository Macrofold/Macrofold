# Native memory diagnostics and startup efficiency

Status: implemented and functionally qualified locally. M4 clean release-image, observer-budget and hosted qualification remain open.

Parent: [project index](README.md). Implementation: [technical design](native-memory-startup-tech-design.md). Tracking: [native memory and startup work](../maintainers/TODO.md#native-memory-and-startup-efficiency).

## Problem and evidence

A native OpenCode Run ended with `memory_limit`, after its stream closed without a final answer. Its allocation was 1,024 MiB. The retained model input was 74,138 bytes (about 72 KiB), but no process-level memory samples survived. That input size does not explain the allocation's total memory use, and the evidence does not establish a leak or identify the largest process. The [technical evidence](native-memory-startup-tech-design.md#2-current-flow-and-known-evidence) records the retained timing and request facts.

The supervisor sums resident memory reported for the allocation's Linux user. This is a safety measurement, not a measurement of unique physical memory: separate processes can share pages. The baseline worker imported all six adapters, including unrelated SDKs, before selecting one harness. The implemented loader removes that unnecessary loading; matched local measurements show lower startup time and observed RSS. Its share of the historical failure remains unknown.

The project makes the next failure explainable and removes that unnecessary loading. It does not raise limits to conceal the failure or promise that an OpenCode workload will fit in 1 GiB.

Macrofold owns generic execution, resource enforcement and diagnostics. The calling application owns game-world state, mechanics and interpretation of model output. Keep this feature independent of OpenLegend's characters, prompts and gameplay rules; its contribution is faster, explainable execution for any caller.

## Outcomes

1. A memory-limit failure explains the observed memory, allocation limit, measurement method and largest processes at the observation, even when optional profiling is off.
2. An operator can temporarily capture an allocation's memory over time and across startup stages using the existing profiler settings.
3. Selecting one harness loads its adapter and required SDKs only. A compatible warm follow-up retains the existing adapter, harness process and conversation.
4. Measured results distinguish cold startup, warm continuation, provider time and platform work. Missing data and observer overhead are visible.

## Journeys

### Diagnose a failed Run

An authorized caller retrieves the existing Run and events. The terminal code remains `memory_limit`. A `runtime.failed` event includes a small numeric summary, for example: limit 1,024 MiB; observed summed RSS 1,061 MiB; 4 processes; largest process 612 MiB. The message explains that summed RSS may count shared pages more than once.

The summary does not claim a unique-memory peak or a JavaScript heap leak. It is attributed to this allocation and Run, not neighboring tenants on the Host. Existing tracing receives the same safe summary. Prompts, arguments, filenames, environment variables and raw process command lines are excluded.

A generic stream-closed diagnostic may also exist. If checkpoint persistence also fails, retain that failure alongside the memory summary; do not hide it behind a memory-limit terminal code.

### Profile a reproducible workload

The operator enables the existing `PERF_PROFILING_ENABLED` flag on the workers that prepare and observe native Runs, selects its existing sample rate and finite duration, and restarts those processes through the normal operator workflow. There is no customer request parameter or new dashboard setting.

Eligible native turns receive internal capture settings. During the capture, the supervisor reuses its required memory observations. The operator receives bounded, content-free performance output correlated with the Run, including stage maxima, recent observations, selected-adapter loading duration and optional shared-page-aware measurements when available. The existing private-file/stdout output policy applies. Collection stops at expiry; a bounded ten-second receive window lets already-collected native reports reach the existing sink.

The operator disables the flag and restarts when finished. Expiry stops collection automatically. Profiling failure, saturation, unsupported kernel files or a slow export sink must never reject/cancel customer execution or become a dependency for resource enforcement or model dispatch. Optional capture has a measured observer budget rather than a promise of zero overhead. The normal memory guard stays enabled in every profiling mode.

### Start and continue a harness

A fresh OpenCode turn loads OpenCode's required SDKs, without first loading Claude or Pi. A warm compatible follow-up reuses that process and adapter while rotating per-turn capabilities. Changed permissions force a cold resume from the verified checkpoint. Cancellation and the remaining warm-session compatibility checks keep their existing behavior.

All supported harnesses remain installed in the reusable runtime image. The optimization changes when code loads, not which harnesses customers can select. An import failure produces the normal safe failure diagnostic, without a hidden prompt retry or a fallback harness.

## Scope

| Area                    | Required behavior                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required failure facts  | Allocation-only RSS measurement, configured limit, observed high-water mark, process count and bounded largest-process list. Survives ordinary trace truncation through the existing protected final-result path. |
| Optional native profile | Existing operator flag, finite window and whole-turn sampling; bounded memory/stage observations; no periodic database writes.                                                                                    |
| Memory interpretation   | Label RSS, partial proportional set size (PSS) and worker-only JavaScript heap separately. Do not add overlapping fields together.                                                                                |
| Startup                 | Literal selected-adapter loading and deferred external SDK imports that remain deferred in the built runtime.                                                                                                     |
| Warm lifecycle          | Fresh per-turn counters and capture settings; persistent adapter and native conversation; no profile state restored from checkpoints.                                                                             |
| Public clients          | Existing Run/event APIs and tracing; document the additional diagnostic payload. No new resource, endpoint, API parameter, permission or SDK convenience layer.                                                   |
| Verification            | Real built-image fixtures, memory failure reproduction, all-six harness acceptance and matched cold/warm observer comparisons.                                                                                    |

## Non-goals

- Change allocation defaults, RSS enforcement semantics, the 500-ms guard interval, host admission, billing or checkpoint integrity.
- Diagnose the historical process breakdown from data that was never captured.
- Eliminate sandbox creation, file restoration, harness server startup, provider latency or model context loading solely through lazy imports.
- Add an inspector, heap dump, CPU profiler, arbitrary process explorer, host agent service, cgroup hierarchy or another observability backend.
- Turn optional samples into a billing meter or a durable monitoring product. They may be lost after process death, capture expiry or output saturation.
- Attribute supervisor/root-controller memory or whole-Host kernel memory to one customer's allocation. That requires a separately justified Host investigation.
- Preload every harness or make speculative changes inside publisher SDKs.

## Failure and lifecycle requirements

| Condition                                 | Required result                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profiling disabled or turn not sampled    | No new process scans, PSS reads, heap snapshots, profile messages or profile-related SQL. Retain only cheap failure facts from the existing guard.                |
| RSS exceeds allocation limit              | Signal execution promptly using the current shutdown policy, then retain the already-observed numeric summary. Never wait for PSS, profile export or tracing.     |
| Process disappears during sampling        | Treat it as a vanished observation; never read or attribute a replacement PID from another allocation.                                                            |
| PSS unavailable, slow or partial          | Report coverage and age explicitly; continue RSS sampling and execution. Missing is not zero.                                                                     |
| Capture expires mid-turn                  | Finish one partial profile; stop optional observation. Accept its delivery during the bounded receive window, without extending collection or the Run's deadline. |
| Worker dies or kernel kills the container | Retain whatever ordinary failure evidence exists; do not fabricate a memory summary or classify a kernel OOM solely from a closed stream.                         |
| Native output/event log reaches its bound | Optional profile may drop. Required limit facts remain in the protected final result and are projected through normal event publication.                          |
| Poll/recovery repeats an observation      | No duplicate durable memory-limit event; optional output may repeat and carries a stable deduplication key. Never repeat the inference to obtain diagnostics.     |
| Warm turn changes profiling eligibility   | Reset measurement state without restarting an otherwise compatible harness.                                                                                       |

## Acceptance criteria

- **N1 — Explainable failure:** a real over-limit image fixture yields `memory_limit`, verified ordinary persistence behavior and one durable resource diagnostic containing this Run's measurement and limit. It still works with profiling disabled and after the normal event log is full.
- **N2 — Correct isolation:** concurrent allocations, including warm residents, never contribute foreign processes, heap metrics or private data to one another's reports. Diagnostic information grants no execution authority.
- **N3 — Bounded optional capture:** disabled mode performs no extra collection I/O; enabled mode obeys the exact bounds in the technical design, expires and degrades without affecting execution.
- **N4 — Selected loading:** built-image module-load evidence proves OpenCode does not initialize Claude/Pi SDKs, and equivalent isolation holds for all six selections. The adapter-load interval includes required selected SDK imports. Source-only import inspection is insufficient.
- **N5 — Warm behavior:** repeated compatible turns reuse the same adapter/native conversation, rotate capabilities normally and start a fresh profile when eligible. Cold restoration and cancellation still pass.
- **N6 — Measured improvement:** compare matched before/after cold and warm workloads, retaining first requests and misses. Report startup, observed RSS, PSS coverage and profiler overhead separately. No latency or memory-saving claim without measurements.
- **N7 — Integration:** authoritative runtime/observability guides and internal evidence explain the settings, diagnostic units, caveats and actual verification. No claim of hosted acceptance from local fixtures alone.

## Delivery and decisions

The [technical implementation stages](native-memory-startup-tech-design.md#7-implementation-order) are M0 baseline, M1 shared observations/failure summary, M2 optional capture/transport, M3 lazy loading and M4 qualification/documentation. M0 and M1–M3 implementation/local functional checks are complete. M4 retains the complete local timing, RSS and CPU measurements; clean Linux AMD64 release-image verification, observer-budget qualification and hosted acceptance are separate remaining gates. The stages do not replace one another's acceptance.

The [local qualification record](native-memory-startup-tech-design.md#diagnostic-and-lazy-loading-comparison) covers 54 focused runtime cases, all-six final-image native acceptance, 160 eager and 160 lazy timing turns, and 1,648 CPU-workload turns. No observer-budget claim follows from the noisy local results: the CPU confidence interval crosses the 2% target, and full-sampling latency bounds remain unqualified. PSS access was denied by the existing sandbox permissions; missing PSS is not zero.

The implementation follows the accepted choices: reuse the current profiler and transport, keep safety/accounting unchanged, sample PSS sparingly, defer only necessary SDKs and preserve the current bundle layout. Further measurements determine whether memory defaults, deeper OpenCode retention work or native phase scheduling deserve a separate change. None is presumed necessary by this project.
