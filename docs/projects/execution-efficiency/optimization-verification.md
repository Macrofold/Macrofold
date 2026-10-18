# Remaining optimization verification

This record covers the shared profiler, transaction-owned SQL composition, request-local payload preparation, producer-aware tracing and optional HTTP observations. The [implementation design](remaining-optimizations.md) and [profiling design](../performance-profiling-tech-design.md) retain their acceptance budgets. It supplements the [earlier execution qualification](../execution-efficiency-verification.md); historical misses and open release gates remain valid.

## Source and topology

The earlier business comparison uses baseline `2cc8dcf87492b23954596fe1f7761de3c49f9657`. Candidate source was copied into an isolated Linux container, excluding environment files, credentials, developer objects, dependencies and unrelated binary marketing assets. Its file-manifest digest is `97fc947be43841f93e9e4ca12b513d25bc3643c6a628a5f9539353e667f92640`; measured business and in-memory collector paths match the working tree at that experiment. A later five-line composition fix disables profiling after private local file validation fails; it does not execute in those in-memory fixtures or the default-off path. Subsequent fixture modernization and the sampling correction below have a separate frozen source identity; the historical matrix is not final-source observer qualification.

Both variants use Node 24.13.0, frozen dependencies and disposable restricted-role PostgreSQL 17 on the same private Docker network. The baseline receives the exact shared observer/database adapter, inference fixture, HTTP fixture and narrow HTTP root/background/Run-correlation hooks. The nine-file overlay does not copy business SQL, payload, tracing or observation-policy changes. Independent private Git snapshots and per-file overlay digests make this a controlled business-before/after comparison under a common observer, not an unmodified historical binary.

Private manifests, scripts, logs and per-call reports live under `.data/remaining-optimizations-linux/`. Each report records source identity, configuration, payload, actual cadence, outcomes, CPU, memory, sampling/drops and financial assertions. Fixtures reject unexpected external transport, use synthetic credentials and make zero paid calls. No deployment or hosted acceptance follows from these results.

## Measurement boundaries

Server overhead is externally measured API-handler duration minus the fixture's independently measured synthetic upstream interval. Caller overhead is SDK request-to-response duration minus that interval. Neither is an estimate obtained by subtracting the entire adapter span. The synthetic provider waits nominally 20 ms; actual waits and scheduling delays are retained. Two warmups precede each hundred-call, five-offered-requests/second cohort. Arrival lag, actual rate and errors remain visible rather than dropping slow calls.

The normal profiler is off by default. Observer-off fixtures use the same two external handler clocks; optional stage/database measurements are null. Enabled fixtures use whole-operation sampling at 100% or 1% with the bounded fixture in-memory sink. This measures collector/database-adapter cost, not production JSONL serialization/private-file write CPU; sink correctness and bounds are tested separately. Group counts mean submitted sequential wait groups, not measured network round trips or database lock time. Foreground and retained background SQL are reported separately. Parameter bytes include only known short strings/Buffers; objects and result/wire byte sizes remain unknown.

CPU includes background drain and the final accounting verification; it is not pure provider or handler CPU. One hundred calls and sparse 1% samples cannot establish a sustained production CPU budget or a confidence interval. Local outliers, low sample counts and missed budgets remain part of the evidence.

## Shared-path correctness

Focused checks exercise real restricted-role PostgreSQL, process-loss/unknown-commit fixtures, exact balances, expiry, stale authority, reservation/settlement identity, replay, provider failure fences, event deduplication, webhook obligations and retained streams. They verify behavior, not only query counts. Prepared states cannot be reused across transactions even if a pool later returns the same physical client. Current principal and catalog facts are observed after lock waits; completion still observes fresh cancellation/deadline state after metering.

The dedicated ledger suite passes 29 tests with 100% statements, branches, functions and lines. These include explicit account concurrency/timeout policy and a zero-funded reservation that leaves wallet, financial events, journals and lots unchanged. The profiler boundary suite passes 23 tests covering default-off startup, invalid configuration, real expiry, scope/exemplar bounds, slow/failed writes, the two-second drain limit and private-file permissions/symlinks. Database diagnostics additionally cover real callback/Promise forms, concurrent submission attribution, rollback, ambiguous COMMIT and late checkout after detach.

All five SDK suites pass against the real API fixture: TypeScript, Python (217 tests and clean Pyright), Go, Rust (21 integration tests) and Java (18 tests). No public shape or generated schema change is required; report completeness semantics are checked through existing clients.

## Payload CPU experiment

The maintained `scripts/performance/payload-profile.ts` compares identical provider bytes, bounds and digests with and without request-local encoding reuse. It makes no database, network or paid calls. Two local 80-sample rounds use 1,494,445 context bytes. Aggregate CPU falls by **21.6% for Jev, 16.7% for Anthropic and 13.4% for OpenRouter chat**. Peak retained memo text stays below 6 MiB and is released synchronously before asynchronous execution. Wall times vary under host load, including no consistent OpenRouter wall-time gain; this is a CPU result, not an end-to-end latency promise.

## Coverage and application acceptance

The renewed complete domain coverage run passes **1,805 tests in 183 files**, with zero failures or skips and every unchanged global/module floor satisfied. It uses a fresh task-owned PostgreSQL 17 server, two disposable database clones, restricted runtime roles and a task-owned mail fixture. Its 320-connection ceiling is fixture-only; production and shared developer settings are unchanged. The run takes 230.49 seconds. Ledger, actor authorization, runtime authorization, plan policy and queue-wait modules retain 100% coverage. No additional application fixes are needed after the earlier focused repairs. Only profiling scripts changed during collection; application/test source remained stable. Owned databases, containers and volumes were removed afterward.

| Domain coverage      | Statements | Branches | Functions | Lines  |
| -------------------- | ---------- | -------- | --------- | ------ |
| Complete passing run | 57.11%     | 51.73%   | 50.17%    | 58.46% |

Private commands, source identity, the complete log and machine-readable result are under `.data/domain-qualification-20261017/`. This replaces the previous shared-database run's 1,640 passes, 100 failures and 52 skips as the current local domain result; shared connection exhaustion, stale model-selection seams and the concurrently landing native encoding fix explained that earlier failure. Assertions and coverage floors were not weakened. Full hosted CI/combined application/native coverage remains separate.

Final review then finds a profiler-only sampling defect: an unsampled worker root loses its decision, allowing a nested job to draw again. A singleton skip marker now propagates through async child jobs, deferred callbacks and scope-cap omissions; explicitly independent roots still sample independently. Default-off execution creates no collector or async context. The final correction passes 25 focused profiler cases, nine real-PostgreSQL diagnostics cases and TypeScript checking, with owned fixtures removed. The 1,805-case full pass precedes this narrow correction; it was not repeated afterward. The private `sampling-fix.json` records exact source hashes and checks, and clean timing uses the corrected source.

All 99 cases in the earlier nine-file affected integration slice also pass. The two-replica/eight-tenant open-loop caller passes its nine-wave, 168-offered-request check, with zero held reservations, duplicate usage or journal imbalance after each wave. It permits controlled refusals; this is not a claim that every offered request succeeded.

The first isolated browser build compiled successfully but its generated standalone server selected CommonJS because the nested isolated dist directory lacked the app's ESM package metadata. The acceptance harness now copies that metadata before the build; ordinary deployment packaging is unchanged. The next attempt reached Playwright but lacked its pinned Chromium headless-shell revision 1243; no browser assertion ran. Installing that revision into the ignored repository-local browser cache fixes the environment. A subsequent sandboxed launch was denied macOS Mach-port registration, also before page assertions. The authorized run outside that process sandbox passes both scoped browser journeys in 12.1 seconds: usage totals, keyboard controls, mobile layout, axe accessibility and operator account/report flows. Desktop/mobile screenshots were inspected. Its seven CLI cases, real PTY and Python HTTP/SSE/session continuation also pass; the wrapper exits zero, cleans its fixtures and publishes `coverage/full`. This selected application report is not a new domain/combined coverage gate. Scoped shared-state acceptance uses `--no-deps` to avoid inadvertently running the entire isolated dependency project. Static checking (`pnpm check`, including the TypeScript SDK build), the optimized application build and documentation checks pass on the final application source.

## Matched protocol results

The primary matrix compares the common observer at 100% sampling, 1,494,000 context bytes and five intended requests/second. Each cell is **server-overhead mean / p95 in milliseconds**, from 100 measured calls plus two warmups. These are all six primary baseline/current pairs, including regressions. Host contention prevents causal timing or acceptance claims.

| Protocol        | Execution tracing | Baseline        | Current        | Foreground DB groups, baseline → current |
| --------------- | ----------------- | --------------- | -------------- | ---------------------------------------- |
| Jev             | Off               | 66.46 / 108.73  | 99.97 / 241.35 | 35 → 25                                  |
| Anthropic       | Off               | 76.02 / 116.71  | 68.21 / 113.94 | 35 → 25                                  |
| OpenRouter chat | Off               | 63.68 / 95.44   | 63.47 / 106.66 | 39 → 28                                  |
| Jev             | Full              | 73.35 / 129.56  | 69.73 / 145.25 | 35 → 25                                  |
| Anthropic       | Full              | 67.55 / 101.09  | 96.26 / 220.07 | 35 → 25                                  |
| OpenRouter chat | Full              | 117.15 / 187.77 | 80.25 / 117.57 | 39 → 28                                  |

The 24 primary cohorts also retain current observer-off and 1%-sampled measurements for each protocol/trace condition; missing disabled-mode SQL counters remain null. The staged 25/29-group target is met, while the original twelve-group target is not. The remaining four commits cover authentication, replay identity, admission A and completion F; batching does not remove those correctness boundaries. Full-trace background groups fall from 714 to 612 per 102 Runs and are not included in the foreground table.

Eighteen additional 5-KiB cohorts cover every current protocol × tracing-off/full × observer-off/100%/1% combination. Their server p95 ranges from 34.10 to 78.34 ms. This does not qualify near-full-context behavior or observer overhead. Three metadata-only near-full-context cohorts retain usage/cost/identity while avoiding optional content processing:

| Protocol        | Server mean / p95, ms | Full trace export, bytes | Metadata trace export, bytes |
| --------------- | --------------------- | ------------------------ | ---------------------------- |
| Jev             | 47.92 / 68.60         | 108,356,847              | 971,884                      |
| Anthropic       | 54.55 / 91.52         | 108,391,606              | 966,198                      |
| OpenRouter chat | 47.95 / 65.26         | 108,413,797              | 982,986                      |

Export reduction is 99.09–99.11%, measured through the official OTLP exporter fixture. Separate host-contended cohorts also use less CPU in metadata mode; they do not establish a controlled CPU speedup. Full tracing remains the configured default.

Four mixed-protocol concurrency-eight cohorts verify 102 successful Runs each, with one invocation/usage record per Run, no residual holds/in-flight capacity and exact wallet reconciliation. They submit back-to-back at roughly 22 requests/second rather than the primary five-request cadence. Server mean / p95 is 327.18 / 441.39 ms baseline versus 326.33 / 835.54 ms current with tracing off; full tracing measures 412.12 / 561.08 versus 356.68 / 435.09 ms. These are finite concurrent correctness probes, not sustained capacity qualification.

The final bounded reverse-order diagnostic repeats Jev near-full-context/full-trace execution with 200 measured calls per condition: 1% sampling p95 55.70 ms, 100% sampling 57.02 ms, observer off 87.25 ms. These faster results do not replace the primary misses. An observer-off cohort being slower demonstrates the variance; it does not establish negative observer cost.

Across **52 cohorts, 5,500 measured calls and 104 warmups**, all 5,604 Runs succeed with exact financial reconciliation, zero duplicate invocations/usage, zero residual reservations/in-flight capacity, zero trace-export rejections, zero profile drops and zero paid calls. The complete matrix, per-call outcomes and observer comparisons are in `.data/remaining-optimizations-linux/summary.json` and `reports/`; source manifests, private source snapshots and run scripts accompany them. Memory observations are start/end RSS and heap, not peak process memory. The payload memo's own explicitly counted high-water bytes are a separate measurement.

## Host contention

A read-only host sampler found load averages around 144 on ten CPUs while the Linux VM reported load around one. Later samples showed 34–53% host CPU busy, 13 GiB compressed memory and multiple stuck processes. Load alone does not prove CPU saturation, but the host was not a clean isolated timing environment. A sanitized process inventory found no high-CPU abandoned test/server process belonging to this task. Only the private cohort runner was briefly paused; unrelated applications and the developer preview were preserved.

The remaining cohorts retain this contention and overlap with final static/browser verification explicitly. Their result/accounting/SQL/export-byte checks remain useful; latency and observer-budget misses are not attributed solely to the application or collector. A bounded reverse-order 200-call repeat is diagnostic, not a replacement for the original hundred-call results or a clean-host acceptance claim.

## Remaining acceptance

The original twelve-group SQL criterion, sustained hosted/multi-replica capacity, actual hosting lifecycle and full CI/combined coverage remain separate gates. The clean experiments below qualify the collector's +2-ms mean and <2% CPU-at-1%-sampling budgets on their declared topology/load; the +5-ms incremental p95 budget remains inconclusive. None follows from structural tests or a selected faster cohort. Current operator flags change no defaults until deliberately configured and the relevant processes restarted.

### Clean Linux primary qualification

The October 17 follow-up freezes the corrected application and version-three fixture source: file-manifest digest `aedaa4a9353255e46567e98bc15060fd71b07422f7e1b34b4460e60a5dd62f2d`, source archive `6f02a89d57d98dd1f61a9f011d3a2ee281931684e073fd2e3ca0fc1028b9dfdb`. Per-file verification and a private fixture Git identity map the measured copy to the original checkout without committing or modifying its Git state. Later documentation edits do not change the measured application.

The operator-selected `macrofold` AWS profile is verified before provisioning in `us-east-2`, with a $10 authorization minimized to one disposable C7g.xlarge. Its four fixed-performance ARM cores and eight GiB memory run native Node 24.13.0, pnpm 10.33.0 and PostgreSQL 17.11. API threads use CPUs 0–1, PostgreSQL CPU 2 and the separate SDK/OTLP peer CPU 3. The app/peer container has four GiB, PostgreSQL two GiB, leaving host headroom. No application or database port is public; SSH accepts only the operator's address. Credentials, developer data and environment files are excluded. Guest and independent operator termination watchdogs bound lifetime to two hours; expected maximum gross cost is about $0.33 before tax. AWS initially rejects fixed-performance compute under the new account's Free plan; the owner enables the Paid plan, and the successful attempt uses the declared topology. Setup failures and the original rejected attempt remain in the private journal.

All 48 fixed cohorts use 1,494,000 context bytes, full trace-content mode with its existing field bounds, both default HTTP observations, five intended requests/second, one in-flight client request, 20 warmups and 200 measured requests. Four balanced Williams orders interleave profiling off, installed/0%, 1% and 100% across Jev, Anthropic and OpenRouter chat. Each cohort has a fresh API process and restricted-role fixture database. Warmups and their retained work drain before measurement. Enabled modes write through the actual production JSONL sink to private files; parsing happens after measurement. API-process CPU includes measured business, trace and JSONL drain, excludes the separate SDK/receiver processes and subsequent financial-verification/reporting work, and still includes the small synthetic upstream stub and identical fixture diagnostics. This is steady serving-path qualification, not a comparison of startup configuration or provider CPU.

Continuous host samples and per-cohort cgroup evidence show zero steal, swap, OOM, memory-limit events or CPU throttling. Minimum available host memory is 5.47 GiB; app/peer container peak is 1.056 GB and PostgreSQL peak 145 MB, including cohort setup. Actual cadence is 4.999871–5.000002 requests/second; worst cohort p95 arrival lag is 1.073 ms. All source identities and actual CPU affinities match. The clean idle baseline is 99.834% CPU idle; the complete primary interval is 85.06% idle. Installation-related pressure from the earlier setup container is retained separately and its counters are reset before the clean baseline.

Each table cell is pooled **mean / p95 server overhead in milliseconds**, from four cohorts and 800 measured requests. Overhead subtracts the independently clocked synthetic upstream interval from handler duration; it does not subtract adapter preparation or parsing. All 48 individual cohort p95 values and all twelve pooled conditions are below 100 ms. Fixed-seed hierarchical process-block/request-chunk bootstrap sensitivity has an upper one-sided 95% p95 bound no higher than 62.84 ms. Nineteen individual requests exceed 100 ms and remain in the data; this is a p95 qualification, not a per-request deadline guarantee.

| Protocol        | Profiler off  | Installed, 0% | 1% sampling   | 100% sampling |
| --------------- | ------------- | ------------- | ------------- | ------------- |
| Jev             | 42.87 / 57.22 | 42.68 / 56.74 | 42.97 / 57.13 | 43.44 / 57.91 |
| Anthropic       | 44.91 / 54.98 | 45.25 / 57.80 | 45.28 / 59.06 | 46.02 / 59.46 |
| OpenRouter chat | 46.59 / 59.41 | 46.87 / 60.57 | 46.80 / 60.18 | 47.33 / 60.20 |

The upstream timer is inside the API process and can include event-loop scheduling delay. A conservative sensitivity calculation subtracting only its nominal 20 ms instead leaves every pooled p95 below 61.1 ms. Full-sampling mean increments remain below 2 ms by the same paired confidence criterion. Neither calculation proves actual provider latency or deployed network/database performance. Profiling off remains the production default; this experiment changes no product defaults.

Full-sampling mean-overhead increments satisfy the +2-ms budget. Added p95 latency remains **inconclusive** under the prespecified paired-process analysis, even though point estimates meet +5 ms. Four process blocks give limited precision; 800 request samples are not 800 independent process replicas. Confidence bounds are separate one-sided 95% Student-t bounds with three degrees of freedom, without a fleet-wide or multiple-comparison guarantee. The retained moving-chunk bootstrap sensitivity does not replace the prespecified test with a more favorable result.

| Protocol        | Full sampling mean increment / upper bound, ms | Paired p95 increment / upper bound, ms | Initial 1% CPU estimate / upper bound |
| --------------- | ---------------------------------------------- | -------------------------------------- | ------------------------------------- |
| Jev             | +0.565 / +1.139 — pass                         | +2.665 / +7.902 — inconclusive         | −0.005% / +5.13% — inconclusive       |
| Anthropic       | +1.109 / +1.388 — pass                         | +4.394 / +7.820 — inconclusive         | +2.756% / +5.43% — inconclusive       |
| OpenRouter chat | +0.740 / +1.406 — pass                         | −0.325 / +8.374 — inconclusive         | −1.262% / +3.16% — inconclusive       |

All **9,600 measured requests plus 960 warmups** succeed: 10,560 Runs, one invocation/usage record each, zero remaining reservations/in-flight capacity, exact wallet reconciliation, zero trace-export rejections, zero profiler drops and zero paid provider calls. One-percent cohorts select only eight, seven and eight measured roots respectively. The prespecified longer paired CPU experiment follows separately to improve precision; it does not replace primary latency results or pool selected primary blocks.

Private protocols, exact commands, all outcomes, source/image identities and cleanup records live under `.data/clean-performance-20261017/`. `primary-final/` contains the complete results archive, strict analyzer output, host/cadence review and nominal-upstream sensitivity. The twelve-group SQL criterion, full CI/combined coverage and actual hosted lifecycle/multi-replica acceptance remain open independently of this clean under-100-ms result.

### Independent CPU qualification

The prespecified supplemental experiment completes all 48 cohorts: eight paired process blocks per protocol, alternating off/1% sampling order, rotating protocol order, 500 measured requests and 20 warmups per cohort, ten intended requests/second and one in-flight request. Source, context, full trace capture, actual JSONL sink, CPU affinity and accounting checks match the primary experiment. This independent experiment does not pool primary blocks, select favorable subsets or replace primary latency results.

Each protocol has 4,000 measured requests per condition. Paired log CPU ratios use separate one-sided 95% Student-t bounds with seven degrees of freedom. All three upper bounds are below 2%; this qualifies that CPU budget for the declared finite serving workload, not every workload or deployment. Bounds assume independent process blocks and have no multiple-comparison guarantee.

| Protocol        | API CPU off / 1%, ms per request | CPU increment | Upper 95% bound | Measured roots selected at 1% |
| --------------- | -------------------------------- | ------------- | --------------- | ----------------------------- |
| Jev             | 42.415 / 42.724                  | +0.730%       | +0.994% — pass  | 42                            |
| Anthropic       | 45.442 / 45.495                  | +0.114%       | +0.955% — pass  | 39                            |
| OpenRouter chat | 46.923 / 47.067                  | +0.308%       | +0.751% — pass  | 40                            |

All **24,000 measured requests plus 960 warmups** succeed with one invocation/usage record per Run, exact wallet reconciliation, no residual reservations/in-flight capacity, no trace-export rejections, no profile drops and zero paid provider calls. Actual cadence is 9.999794–10.000001 requests/second. Worst cohort p95 arrival lag is 8.970 ms; maximum individual lag is 53.098 ms and remains in the reports. Host samples show 79.03% CPU idle, zero steal/swap/OOM/throttling and at least 5.31 GiB available memory. App/peer container peak is 1.194 GB; PostgreSQL peak is 174 MB. All per-file source/affinity checks pass. A final original-checkout comparison finds only the three updated qualification/status documents changed since the measured source freeze.

Across the primary and supplemental experiments, **33,600 measured requests and 1,920 warmups** succeed. `supplemental-final/` retains strict analysis, host/cadence checks, selected sample counts, complete reports and a private results archive with digest `b6ce1292dd46535dd0ded1a6478778f1d4b1b9324d8450bb045f4f91351ef78a`. The +5-ms full-sampling p95 increment remains inconclusive; this CPU result does not close it. No additional cohort or selective rerun was used to change that outcome.

## Post-qualification implementation review

The October 17 review covers the complete uncommitted optimization, with separate passes over transaction/financial ownership, payload and trace producers, profiler lifecycle and bounds, and API/fixture integration. Preserve the measured source identity above and the developer preview. Repairs must retain current authorization, exact accounting, replay and default diagnostic policy; speculative architecture and another cloud qualification are outside this review.

Review sequence: inspect each owning flow and its callers; reproduce concrete failures; apply narrow fixes with focused regressions; run affected checks and reconcile the feature guides and central tracker. Any application changes after the frozen experiment must be identified separately rather than represented as measured by that experiment. Completion requires review of the final affected diff and explicit recording of remaining acceptance gaps.

The completed review repairs four issues without changing API shapes or diagnostic defaults:

- Composed ledger settlement could expire funds protecting a reservation added between its read/apply phases in the same transaction. A real PostgreSQL reproduction demonstrated balance 100 with 120 still reserved. The existing wallet update now returns the actual post-release reservation balance for expiry, preserving balance 200/reserved 120 until the second hold is released. No extra statement, group or lock is added; expiry-row decoding is shared.
- An idle JSONL stream error could leave outstanding diagnostic debt unaccounted for. One idempotent failure owner now clears/counts queued and in-flight records, warns once and ignores late acknowledgments. Database-wrapper coexistence also emits the specified fixed detach-conflict diagnostic while preserving the newer wrapper.
- Ordinary disposable tests inherited developer HTTP-observation opt-outs, making required request-history assertions depend on local settings. The general fixture now restores enabled defaults; intentional profiling experiments explicitly reapply their selected overrides.
- Profiling reports now include effective trace-content and HTTP-observation policies. Primary/supplemental qualification used full/default policies as recorded above, but future reports no longer require setup-script inspection to establish that fact. The public context-retention guide also distinguishes optional immediate input history from required queued input and final results.

Verification: 32 ledger-boundary tests pass on disposable PostgreSQL 17, including deterministic interleaved-reservation expiry and rollback/retry after missing or malformed wallet results. Ledger coverage is 100% for lines, statements, branches and functions. This targeted coverage run retains the canonical inventory and thresholds; its aggregate gate fails for deliberately unrun modules and is not a whole-domain acceptance result. A separate seven-file slice passes 93 API, gateway, immediate-control, SQL-composition, real-driver and fixture cases, including ordinary request recording with both developer opt-outs set false before fixture startup. Pure profiler checks pass 28 focused cases; the separate payload/tracing/observation slice passes 40 cases. These overlap existing coverage and are not another full-domain or combined-coverage result.

A three-measured-call plus one-warmup end-to-end profiler smoke run verifies metadata-only tracing and both HTTP observations disabled, with the effective policies reported correctly, four successful Runs, exact accounting and no residual holds. It uses synthetic upstreams and no paid calls. The contended macOS run overlaps static verification; server-overhead p95 is 138.47 ms and is retained as a functional smoke result, not a clean timing comparison or replacement for the Linux qualification. Private logs and the report location are indexed under `.data/optimization-review-20261017/`. These review changes follow the frozen clean experiment; no new cloud or sustained-load qualification is claimed.

The TypeScript SDK build, final TypeScript check, documentation validation, focused formatting and diff checks pass. Documentation validation retains the existing Claude loader-precedence warning. The task-owned PostgreSQL containers and disposable volumes were removed; developer preview processes and databases were preserved. No paid calls were made.

## Activation and reversal

This follow-up has no migration, generated public contract or runtime-image change. Application/worker code follows ordinary release procedures; no hosted deployment was performed. Preserve the existing preview and restart its supervisor only when intentionally activating the new source. The [operator guide](../../features/observability/performance.md) documents independent profiling, trace-content and HTTP-observation flags. To end a capture, set `PERF_PROFILING_ENABLED=false` and restart the affected process; expiry also detaches it automatically. Returning to the original code is a normal code rollback without database reversal. Full tracing and both HTTP observations remain enabled by default when their existing prerequisites are configured.

The earlier local profiling application/PostgreSQL containers, their private network and sampler were removed after verified source bundles and reports were copied out. Shared images, the developer database, unrelated applications and the running preview were preserved. Reproduction commands, topology, artifact digests and cleanup are retained in `.data/remaining-optimizations-linux/setup-and-results.md` and `artifact-manifest.json`; the [testing guide](../../engineering/testing.md) owns reusable profiler/acceptance commands. The later AWS experiment has separate source/result manifests and resource cleanup records under `.data/clean-performance-20261017/`.

After both AWS result archives were independently verified locally, the task-owned instance was terminated. Readback at 23:29:54 UTC confirms its encrypted volume, network interface, public address and security group are gone; no other billable service was created. The conservative launch-request-to-cleanup interval is 6,356 seconds. Estimated gross compute, IPv4 and storage cost is about $0.27; including the declared $0.02 transfer/miscellaneous reserve gives about **$0.30 before tax**, with no credits assumed and no paid model calls. This is an estimate, not an invoice. The private `cleanup-proof.json` and `cost-estimate.json` retain exact resource checks, rates and assumptions. The developer preview and shared database remain unchanged.
