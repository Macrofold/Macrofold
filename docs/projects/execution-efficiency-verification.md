# Execution efficiency verification

The redesign is implemented in the local working tree based on `2a7b7c59`. All six co-located Linux immediate cohorts meet the **under-100-ms server-overhead p95** target, and local native delivery passes. The macOS misses, unmet sequential SQL budget and incomplete full CI/hosted qualification remain explicit. This record separates observed local results from the [feature acceptance criteria](execution-efficiency-feature-spec.md#acceptance); it is not a complete release pass or a hosted SLA. [Maintainer work](../maintainers/TODO.md#execution-efficiency-redesign) tracks the remaining gates.

## Delivered boundaries

- Immediate inference normally commits compact admission A, invokes its exact provider once, then commits result/accounting F. An exceptional saved-response checkpoint enables local recovery; a process death before either F or that checkpoint may lose the answer and leaves explicit uncertainty. No recovery path buys another answer.
- Queued/native input remains durable. Immediate response content has one canonical invocation owner. Status, list and authorization readers use typed summaries without hydrating input or output; result readers retain integrity errors for missing content.
- Immediate, native and bounded callers reuse shared model settlement. Current actor, generation, context grants, retention and cancellation fence publication. Known incurred usage survives disclosure denial.
- Optional capture/export/analytics and staged deletion have bounded owners. Tool catalogs cache raw definitions while current grants remain authoritative. Bounded ready steps, durable Task wakes and independent trigger admission/reply pools avoid unnecessary scheduler barriers.
- Restore/checkpoint metadata, verified-content publication and event ingestion use shared batches. Warm observations remain placement hints, not authority. Runtime transport qualification is described below.

The dashboard renders results/events and has no original-input viewer. No new input-history API/UI is introduced merely to represent best-effort trace capture, and missing input is never fabricated as an empty prompt.

Current behavior is owned by the [decision implementation](../features/decisions/implementation.md), [billing implementation](../features/billing/implementation.md), [integration implementation](../features/identity-integrations/implementation.md) and [execution implementation](../features/execution/implementation.md).

## Profiling method and topology

The immediate profile uses Node **24.13.0**, the real loopback HTTP API and TypeScript SDK, disposable restricted-role **PostgreSQL 17** on local Docker, and the ordinary admission/ledger/result code. Provider HTTP is replaced with an explicitly synthetic protocol response delayed **20 ms**. Managed Jev selects provider `openrouter`, model `typesafe/jev-1.13`; no actual provider is called. Each request supplies **1,494,000 bytes of explicit context** in a roughly **1,495,226-byte request**. Two warmups precede each measured cohort: fifty calls in earlier observations and one hundred in the final matched comparison. Each successful request must retain one invocation, one usage record and a usable final result.

Tracing-enabled cohorts use the official Langfuse/OpenTelemetry exporter and a real loopback OTLP/JSON collector, including serialization and HTTP export. They do not call the hosted Langfuse account. Export drains and financial verification run outside the measured request windows; concurrent background work still consumes real CPU. Each final cohort verifies all 102 calls, including warmups: 102 successes, no invalid invocation/usage identities, no in-flight requests, zero model/wallet holds and wallet debit matching charged cost. Earlier fifty-call cohorts verify the equivalent invariants across 52 calls.

The shared macOS host has ten logical CPUs and variable, sometimes severe, contention. These cohorts do not certify a healthy production topology or thousands of concurrent customers. The five-request/second generator is paced single-flight, not an open-loop concurrent saturation test; actual submission rate and arrival lag are reported rather than assuming the configured rate was achieved.

Reproduce with the pinned Node version and the existing local database/storage setup:

```sh
PLATFORM_MODE=local EXECUTION_PROVIDER=simulator ALLOW_PAID_EXECUTION=false \
  PROFILE_INFERENCE_CALLS=100 PROFILE_INFERENCE_CONTEXT_BYTES=1494000 \
  PROFILE_INFERENCE_MODEL=jev PROFILE_INFERENCE_RATE=5 PROFILE_INFERENCE_TRACING=1 \
  pnpm exec tsx scripts/profile-inference.ts
```

Use `anthropic` or `openrouter-chat` for the other synthetic protocol shapes; omit tracing or set it to `0` for the disabled comparison. Private reports under `.data/inference-profile/` contain the base commit, working-diff digest, configuration, host pressure, per-call samples, SQL groups and phase timings. Reports contain synthetic data and omit credentials. The collector is a transport fixture, not evidence of hosted exporter availability.

## Immediate latency observations

Server overhead is time inside the API handler minus actual synthetic upstream wait. Caller overhead is full SDK request/response time minus upstream wait, including loopback networking and client work. End-to-end includes the upstream wait. Keep these boundaries distinct; a server result below 100 ms does not mean the caller received an answer within 100 ms.

Each timing cell below gives **mean / p50 / p95 / p99 in milliseconds**. The median averages the middle samples; tail percentiles use nearest rank. With fifty samples, p99 is the maximum; even one hundred samples do not establish production tail latency.

### Matched macOS hundred-call cohorts

All six macOS cohorts use the post-review implementation at five offered requests/second, the same near-full context and the same synthetic upstream delay. They supersede earlier macOS observations without erasing their misses. The Linux topology below measures the same workload with the app and database on one Docker network.

| Cohort                    | Tracing      |                      Server overhead |                       Caller overhead |                            End-to-end |
| ------------------------- | ------------ | -----------------------------------: | ------------------------------------: | ------------------------------------: |
| `eeCNHI`, Jev             | OTLP enabled |   75.428 / 70.306 / 98.077 / 139.319 |   85.322 / 77.133 / 141.780 / 268.564 |  106.734 / 97.578 / 163.043 / 289.808 |
| `2Fpxux`, Jev             | Disabled     |   77.729 / 74.120 / 91.136 / 240.617 |   87.392 / 82.730 / 100.048 / 256.516 | 108.357 / 103.278 / 121.033 / 279.501 |
| `kIgyUY`, Anthropic       | OTLP enabled |  86.856 / 83.877 / 112.733 / 138.112 |   94.764 / 90.434 / 129.340 / 215.389 | 115.758 / 111.315 / 150.012 / 235.194 |
| `itCu6m`, Anthropic       | Disabled     |  88.468 / 80.147 / 119.673 / 251.212 |  105.358 / 87.236 / 213.898 / 406.785 | 126.177 / 108.144 / 234.446 / 428.508 |
| `96OiYv`, OpenRouter chat | OTLP enabled | 104.129 / 94.824 / 167.355 / 236.284 | 119.521 / 103.566 / 214.413 / 295.942 | 140.692 / 124.750 / 235.058 / 315.596 |
| `NZvsFm`, OpenRouter chat | Disabled     | 102.846 / 96.742 / 138.738 / 164.635 | 110.800 / 103.307 / 155.954 / 177.784 | 131.679 / 124.188 / 177.643 / 199.302 |

Jev meets the server-overhead p95 target with tracing both on and off. Anthropic and OpenRouter chat do not. No macOS hundred-call cohort establishes caller-overhead p95 below 100 ms. Actual submission rates range from 4.986 to 5.000 requests/s; arrival-lag p95 is 5.272/2.056 ms for Jev on/off, 1.210/34.458 ms for Anthropic and 35.080/1.367 ms for OpenRouter chat. Host contention and serial cohort order limit causal comparisons; the slower tracing-disabled Anthropic sample is not evidence that tracing improves performance.

### Co-located Linux hundred-call cohorts

The app runs on **Linux ARM64 Node 24.13.0** with **PostgreSQL 17.11** on the same dedicated Docker bridge. Source and frozen-installed Linux dependencies are copied onto the Linux filesystem; there is no macOS source mount. The VM exposes ten CPUs, approximately 2.6–2.8 GB free memory during the cohorts and load averages around 1.0–1.6. This is a declared healthy local topology, not a cloud or saturation result. Context, synthetic provider delay, tracing transport, sample count, rate and financial assertions are unchanged.

Each cell is again **mean / p50 / p95 / p99 ms**, calculated from the retained per-call samples.

| Cohort | Tracing | Server overhead | Caller overhead | End-to-end |
| --- | --- | ---: | ---: | ---: |
| Jev | Disabled | 49.975 / 45.321 / 80.785 / 105.509 | 59.903 / 53.687 / 92.333 / 142.120 | 81.521 / 74.900 / 117.064 / 164.169 |
| Jev | OTLP enabled | 54.279 / 46.880 / 84.697 / 220.580 | 64.783 / 53.979 / 112.678 / 242.866 | 86.117 / 75.351 / 135.172 / 265.674 |
| Anthropic | Disabled | 48.766 / 47.141 / 60.875 / 67.741 | 55.920 / 54.446 / 69.330 / 75.580 | 77.535 / 75.949 / 90.329 / 98.898 |
| Anthropic | OTLP enabled | 47.795 / 46.392 / 60.031 / 71.726 | 55.005 / 52.881 / 68.579 / 78.851 | 75.874 / 73.887 / 89.622 / 101.295 |
| OpenRouter chat | Disabled | 53.468 / 48.218 / 63.471 / 219.375 | 63.559 / 55.011 / 70.483 / 264.465 | 84.543 / 75.711 / 91.511 / 286.707 |
| OpenRouter chat | OTLP enabled | 50.864 / 47.853 / 65.784 / 72.897 | 59.830 / 55.563 / 74.173 / 152.125 | 81.219 / 77.157 / 98.814 / 171.679 |

All six meet the specified **server p95** target. They do not establish every request below 100 ms: p99 still exceeds it in several cohorts, and traced Jev caller-overhead p95 is **112.678 ms**. Actual submission rates are 4.9995–5.0000 requests/s. All **612 calls including warmups** succeed with one invocation and one usage record each, no in-flight requests or outstanding holds, and wallet debit matching charges. The official exporter sends approximately 108 MB per tracing cohort, with no rejected batches and peak active export one. No actual model provider or paid execution is involved.

Private evidence is `.data/execution-efficiency/linux-topology-20261017-145712/`: `summary.json`, six `reports/*/report.json` files, the source manifest and exact fixture procedure. The copied source is bound by manifest to this working tree and committed only inside the disposable fixture as `a422b20506b2770628b911ffdf307223592601c7`; all six report source digests are `c4415110290cb3f89186421c512ab563bf795657d7a705f22dd7d83032e2887c`. This is fixture provenance, not a repository commit or push. Both owned containers, the disposable PostgreSQL volume and the bridge were removed afterward. The topology comparison changes several environmental factors, so it does not isolate database transport as the sole cause of the macOS misses.

### Earlier fifty-call observations

| Cohort                              | Tracing / offered load     |                     Server overhead |                     Caller overhead |                            End-to-end |
| ----------------------------------- | -------------------------- | ----------------------------------: | ----------------------------------: | ------------------------------------: |
| `KUVSQK`, Jev, 50 calls             | Disabled, closed-loop      |             Not separately recorded |  76.265 / 70.823 / 98.139 / 204.945 |   96.680 / 91.277 / 119.159 / 224.989 |
| `6whjuG`, Jev, 50 calls             | OTLP enabled, closed-loop  |             Not separately recorded | 79.824 / 74.256 / 113.138 / 147.738 |  100.583 / 95.052 / 133.525 / 168.261 |
| `uCpy3C`, Jev, 50 calls             | OTLP enabled, 5 requests/s |   72.646 / 71.569 / 89.604 / 98.569 |  78.953 / 77.122 / 96.630 / 105.006 |  100.076 / 98.155 / 118.059 / 125.251 |
| `pHBImC`, Anthropic, 50 calls       | OTLP enabled, 5 requests/s |  76.436 / 73.122 / 97.308 / 139.088 | 84.629 / 80.325 / 107.456 / 144.690 | 105.328 / 101.097 / 127.942 / 165.860 |
| `fKV61U`, OpenRouter chat, 50 calls | OTLP enabled, 5 requests/s | 81.151 / 77.625 / 102.681 / 148.481 | 88.119 / 83.412 / 111.657 / 153.916 | 108.938 / 104.241 / 131.924 / 175.172 |

The paced cohorts achieved approximately 5.000 actual requests/s. Arrival-lag p95 was 2.544 ms for Jev, 1.976 ms for Anthropic and 2.390 ms for OpenRouter chat. Jev and Anthropic meet the server target in these earlier cohorts; OpenRouter chat's **102.681-ms** server p95 misses it. The tracing-enabled closed-loop cohort's **113.138-ms** caller-overhead p95 remains part of the evidence; it must not disappear behind a selected faster sample. Use the hundred-call cohorts above for final immediate qualification.

The first two reports counted about 61/66 SQL statements and 42/45 sequential wait groups per request with tracing off/on. Their 5/6 total commits include authentication, replay, optional tracing-retention checks and background administration; they are not five or six paid-execution commits. The ordinary execution contract is A and F. SQL parameter traffic was approximately 11.5/11.6 KB per request, with no mandatory near-full-context input write. Later SQL-group changes require their own matching report; do not treat earlier counts as final-tree measurements or hide separate statements inside the wait-group count.

The design's initial **12-sequential-wait-group budget is not met**. The final source dependency graph still has approximately 35 foreground groups for Jev/Anthropic and 39 for OpenRouter with catalog preparation: authentication/rate 3, early replay 3, A 14, F 15, plus OpenRouter preparation/revision checks 4. Authentication/replay and the A/F setup/COMMIT envelope alone consume ten groups before substantive admission/accounting decisions. This explains why twelve was optimistic; it does not make the remaining groups irreducible. Further shared-owner batching can combine capacity observations, current gateway facts and event/webhook work. It requires explicit transaction-owned interfaces and preservation of lock order, current authorization, financial deduplication and post-settlement freshness; moving required facts into background work or a monolithic SQL function merely to meet a count is not accepted.

Measured windows additionally include overlapping background setup groups: Linux means are about 37/38 for Jev and Anthropic with tracing off/on, and 41/42 for OpenRouter. Report these separately rather than interpreting them as foreground-only counts. Safe shared query batching is implemented, but latency passes alone do not close this SQL-budget criterion.

The OTLP closed-loop cohort exported seven batches totaling 55.2 MB with no rejected batch and one peak active export. The paced Jev cohort exported ten batches with the same approximate total. Full-content tracing consumes real serialization/memory/transport resources even when its I/O is asynchronous. Bounded omission, compact cost observations, retention races and exporter pressure remain part of acceptance, not grounds for disabling tracing to pass the target.

## Native, tool and storage observations

The [reusable tool/native admission profile](../maintainers/evidence/tools-security.md#execution-efficiency-verification) exercises a 70 KB prompt, nine admissions and eleven actual loopback MCP calls. Cold selected-tool discovery occurs once; ten warm calls and an unrelated granted connection cause zero further discovery. Explicit tool authority projections reduce returned SQL data from 75.7 KB to 5.2 KB per call. It measures 32 admission and 33 tool-call statements including context/transaction commands. Initial native admission mean/p95 was 47.9/78.8 ms and warm tool mean/p95 49.3/67.8 ms; later concurrent verification produced noisy timing and is not a controlled speedup claim. Admission excludes HTTP authentication; tool timing includes the synthetic upstream.

The [runtime evidence](../features/execution/workers/verification.md#execution-efficiency) records ten measured 128-event cohorts: individual publication mean/p95 **645.94/1,901.38 ms**, shared batch **12.66/30.53 ms**, with all **2,817 events** preserved. Storage fixtures verify revision-bound paging, no repeated PUT for a stored simple chunk, publication-scoped proof reuse and preservation after invalid replacement input.

The final actual Docker/OpenCode HTTP profile observes **80 timed markers across two completed Runs** through the API SDK: native-to-SDK mean/p95 **18.64/37 ms**, maximum **44 ms**, meeting the **250-ms local p95 objective**. Native-to-SQL p95 is **26 ms**, controller RPC **7 ms**, and SQL-to-SDK **21 ms**; complete synthetic-provider-to-SDK p95 is **69 ms**. Docker now publishes its existing authenticated Host controller on one inspected ephemeral loopback port instead of starting Docker/Node processes per probe. A shared bounded HTTP helper also serves Render while each provider retains its independent origin policy. Lifecycle identity/start-time checks, expected-secret authentication and controller boot fences remain intact.

The superseded authenticated stdin/notification cohort measured native-to-SDK p95 **344 ms** and Docker RPC p95 **279 ms**, failing the objective. The final private image additionally passes wrong/missing HTTP-secret and restarted-controller boot rejection; strict origin, loopback publication, byte/deadline and lifecycle checks pass **61 focused tests**. The API journey uses a dedicated normal bridge because Docker does not publish ports on internal networks; synthetic credentials, rejecting provider/broker transports and fixed application relay prevent live API calls, but this journey does not establish kernel network isolation. Earlier six-harness image-only checks retain `--network=none`. The final HTTP image is qualified through the shared controller and complete OpenCode journey, not an unrun all-six final-image matrix. Hosted latency remains unmeasured. [Runtime evidence](../features/execution/workers/verification.md#execution-efficiency) retains exact Runs, images and earlier misses.

## Multiple replicas and admission load

A separate correctness fixture uses two independent Node API processes, eight disposable tenants, real loopback HTTP and PostgreSQL, and synthetic Anthropic responses. Its 5,420-byte requests and 1,131-byte responses are much smaller than the immediate latency cohorts. Each replica uses a fixture domain pool of 32 connections; this is not a new production default or a hosted capacity claim.

- Nine two-second ramp waves combine 4/8/16 offered requests/s with 0/300/500-ms upstream delays. All **168 requests succeed with exactly 168 provider calls**, no transport/terminal failures and no recovery retries. Caller-overhead p95 reaches 367 ms in a short wave, so success does not establish the under-100-ms latency target.
- A held cohort reaches **64 concurrent provider calls**, each invoked once, and completes without refusals, outstanding holds, duplicate usage or unbalanced accounting.
- Two held requests on separate replicas observe direct API-key revocation without cancellation flags or provider retries. Both transports close within **496 ms** of the revocation operation; terminal receipts appear within **516 ms**. Restoring the key permits two historical replays without new provider calls. Accounting ends with no active calls, holds, duplicate usage or imbalance.

These are bounded local probes, not a sustained thousands-of-customers qualification. The actual process-kill fixture was filtered out of this load command and passed separately in the 14-case crash slice below.

## Correctness and integration evidence

Counts below describe executed slices with overlap, not a unique total or a substitute for a complete final-tree CI pass.

| Surface                                               | Observed result                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared ledger, native gateway and immediate inference | 76 passing cases after ledger batching, including duplicate settlement, rollback, expiry barriers, 1,000 retained lots and strict stop-on-model-error                                                                                          |
| Restricted PostgreSQL query groups                    | Five query-group cases plus one catalogue case pass: ordered/dependent writes, rollback/drain, cumulative deadlines, invalid group rejection and real wire-timeout/socket recovery                                                             |
| Final capture/catalog/database integration            | Five-file current-tree slice passes 67 cases after retention-race fixes, covering capture/recovery, model catalog, query groups, platform and connection HTTP behavior; whole-root TypeScript checking passes                                  |
| Ambiguous commits and process loss                    | Existing transaction-budget/lost-COMMIT checks pass; a 14-case catalogue/crash slice includes actual child-process SIGKILL after dispatch and after exceptional saved-response fallback, with no second provider call and zero remaining holds |
| Queued/bounded inference and Tasks                    | 66 cases pass; final three race cases independently pass after durable response revocation, replacement generation and prepared-owner loss. Usage remains settled once and stale owners cannot release replacement ownership                   |
| Broker and catalogs                                   | 21 actual database/official-MCP broker cases pass; catalog/control unit slices pass 26 cases, including invalidation, current grants, exact account, budgets and unknown-effect protection                                                     |
| Scheduling and independent dispatch                   | Three-file scheduling/portable slice passes 22 cases; cloud/scheduling slice passes 41. The revised fixture holds an actual synthetic provider call, and cloud fixtures retire only their own live recovery work                               |
| Public status/result boundary                         | Six evidence cases pass, including real HTTP status/list/events/artifacts/SSE with missing canonical output, full result before corruption, explicit integrity failure afterward and tenant/workspace/scope denial                             |
| Customer use-case callers                             | Customer-agent, immediate and customer MCP slice passes 36 cases; separate status/customer slice passes four                                                                                                                                   |
| Five SDKs                                             | Final `pnpm test:sdks` rerun exits successfully for TypeScript, Python, Go, Java and Rust, including actual immediate JSON/replay/SSE API journeys and single-attempt transport behavior; Python reports 217 passes                            |
| Native execution and files                            | All six actual Docker harnesses pass warm/cold/fresh-container continuation in a private derivative image; real API/SDK/OpenCode recovery passes deliberate poller termination/restart                                                         |
| Runtime checks                                        | Runtime SQL slices pass 78 and later 46 cases; notification SQL adds an eight-case slice. Observer/stream and provider slices pass 23 and 61 focused cases, respectively. Scoped manifest verification passes 63 cases with 100% functions and 98.07% lines                                                                    |

The initial full domain/coverage run was **not green**: 1,675 passed, ten failed and one unhandled SDK rejection across 173 files; the manifest function floor also failed at 92.85% against 100%. Followups corrected obsolete phase assumptions, fixture occupancy leaks and affected timing/SDK checks; isolated portable tests did not reproduce the concurrent local database connection exhaustion. The later scoped manifest run meets its floor. These focused passes do not turn that original full run into a green run. Final-tree full CI/combined coverage remains a separate gate.

The base revision already has failures in [Actions run 39053341402](https://github.com/Macrofold/Macrofold/actions/runs/39053341402): domain/coverage, scheduling load, installation/restore, dependency audit, native dependency scan and application-fixture readiness. Distinguish these pre-existing failures from regressions introduced by this working tree. Final `pnpm check` and optimized `pnpm build` exit successfully after the shared publication/status and Docker HTTP changes, including the required TypeScript SDK build. Documentation-only reconciliation follows these code checks.

## Activation and remaining qualification

Migration **055** was applied locally only after confirming no active Runs. Disposable databases also exercise fresh migration and populated upgrade behavior. Actual SQL tests use direct local PostgreSQL, not a hosted transaction pooler. The final qualified private native image is `macrofold-efficiency-runtime:http-20261017` (`sha256:d25752e8dbdba7ff3e1ac51a11fbceb3495d1a3080361a2e7a43b67fcb310411`); its local native delivery profile passes at 37-ms p95. After rechecking zero active developer Runs and zero Host allocations, that image was activated under the configured `platform-runtime:0.1.0` tag. The previous default `sha256:b554bf196b28b20cb7befd6a4025ccc0e16e794168737ee413d900b99ffb9ce0` is retained as `macrofold-efficiency-rollback:20261017`. Image rollback alone does not roll back compact accepted records/schema: pause new admission and preserve matching current readers/recovery before reconciling versions; never redispatch accepted work for rollback. No development API or durable worker was started outside disposable fixtures; unrelated containers and the local PostgreSQL service are preserved. No hosting deployment is established by this work.

The local server-overhead target passes on the declared co-located Linux topology; the macOS misses and unmet sequential-query budget remain. Capture retention/recovery fixes have the focused 67-case pass and are included in both six-cohort comparisons. Full CI/combined coverage, hosted pooler/deployment behavior, compatible hosted API/recovery/controller activation, mixed-mode sustained load, slow readers and exporter failure/pressure remain open qualification gates. The bounded two-replica probes above do not close those broader gates. Keep these limitations explicit without relabeling incomplete agreed work as a future optional improvement.

## Changelog

- The earlier profile found about 82 commands and 16.96 MB returned SQL data for a 1.49 MB request. Narrow reads reduced repeated transfer but still left roughly 178 ms mean overhead. The redesign replaces mandatory large input writes and three normal execution commits with compact A/F execution and an explicit larger response-loss window; [design provenance](execution-efficiency-tech-design.md#changelog) retains the original breakdown.
