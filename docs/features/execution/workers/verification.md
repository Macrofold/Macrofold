# Worker execution evidence

Evidence is commit-specific. A green build is not native recovery or paid-provider evidence, and simulated external boundaries are not actual cloud resource measurements.

## Post-merge lifecycle and dashboard review — September 26, 2026

Working-tree fixes on `9d1ff962922bdcd6568620b93a2ebb0f71ea65a6` preserve the public schema and existing billing/ownership boundaries:

- Disabled paid execution no longer blocks Render/Vercel observation and confirmed shutdown. Provisioning remains gated; Vercel cancellation, recovery and final metering can complete without authorizing new launches.
- Vercel creation receives the accepted offering region explicitly.
- Recovered Host errors clear independently; a failing sibling remains visible. Capacity errors are recomputed, and stopped historical failures do not remain on a healthy Worker.
- The dashboard can edit a Worker whose accepted offering supplies stronger isolation without silently changing its requested policy.

Executed with Node 24.13.0 and pinned dependencies: **35 provider tests, 78 policy/scaling tests, 26 database/API tests, and two Chromium journeys passed**. Browser acceptance uses actual Next.js/HTTP/database paths, includes the existing desktop accessibility/mobile layout checks, and verifies the new settings save through the real PATCH endpoint. Its synthetic settings screenshot was visually inspected. TypeScript checking (including the app's TypeScript SDK build), documentation generation/integrity and diff whitespace checks passed. No schema or SDK transport changed; unrelated language SDK verification was not rerun locally.

The bounded workload completed **128/128 Runs**, with verified persistence, three peak Hosts, eleven peak synthetic executions and **zero ownership violations**. It exercised loopback HTTP, the TypeScript SDK, scheduling, PostgreSQL and the ledger with simulated compute/model boundaries. Observed elapsed time was 89.9 seconds, listing p95 471.63 ms and admission p95 982.69 ms while a separate development dashboard was compiling on the same machine. These contended measurements are functional evidence, not a controlled performance comparison or production capacity claim.

Verification used a separate disposable PostgreSQL container/database and dashboard port. The existing preview was preserved. Initial browser attempts exposed missing local browser binaries, cold development compilation exceeding a journey deadline, and a new test incorrectly expecting 201 instead of the documented Worker-create 202. Installing the pinned browser, compiling development routes before interaction measurement, and correcting the assertion resolved these fixture issues without relaxing application checks. The local mail sink was stopped; fixture accounts were explicitly verified by the existing seeder, so email delivery was not tested. No paid provider calls were made; actual hosted region placement and shutdown remain release acceptance work.

## Cross-repository engineering review — September 25, 2026

The [review](review.md) records findings, caller compatibility and decisions; [implementation](implementation.md) owns the corrected behavior. No new unit tests were authored. Existing tests and CI were preserved. Manual scenarios below execute actual application code without a test runner.

### Database, CLI, controller and browser

Actions **36199822335**, source **7b6e41acfb907ea2249c5de6b41dad58f31c0d72**, Node **24.13.0**, pnpm **10.33.0**, frozen repository dependencies:

| Executed surface | Observed result |
| --- | --- |
| `pnpm check` | Documentation generation, SDK build and application type checking passed |
| Native runtime and portable CLI builds | Passed |
| Forward migration 047 in disposable PostgreSQL | Applied successfully |
| Overdue allocation-time shutdown | Exactly one confirmed provider stop; zero physical allocations left; unsettled reservation retained |
| Resource final receipt exceeding available funding | Exactly one stop; final cumulative CPU receipt retained independently from settlement |
| Unbound preparation cleanup | Failed release retained SQL writer/resource ownership; confirmed release completed; duplicate cleanup was harmless |
| Built CLI subprocess against real loopback HTTP API | Destroy/recreate/name lookup selected the live replacement; explicit revision update succeeded with a Worker-restricted write-only key |
| Compiled Host controller in network-isolated Linux container | Late prepare after unknown release rejected; launch queued behind release rejected; zero active assignments remained |
| Actual Next.js Worker form in Chromium | Isolated default, optional name, explicit trusted-sharing choice and finite retention after switching away from dedicated capacity verified; real API creation succeeded; zero uncaught page errors |
| Paid API calls | 0 |

This run's application exercises all passed, but the job was not green: documentation integrity found that the new `review.md` was not linked from the documentation tree. The subsequent implementation/guide/follow-up updates link it and document the changes. A later full-tip documentation check must be used for that result, not this run. Browser evidence is artifact **10891846821**, `worker-review-browser`; its 1440-by-1100 screenshot was visually inspected.

The shutdown providers and prices are explicit fixtures. SQL transactions, RLS, application reconciliation, HTTP handlers, generated SDK transport and built CLI are real. The controller scenario uses the actual compiled implementation in a disposable root-owned Linux container, without launching a model. Chromium operates the actual local dashboard and server, not mocked components. These are focused exercised paths, not complete browser/CLI or hosted-provider acceptance.

The pre-fix source **8956c5fb7bf0ea620ed91b1c671f092cdb2a0ef9**, Actions **36196706790**, reproduced the funding bug: three reconciliation passes left one physical fixture allocation running with no stop and `host_funding_exhausted`. Subsequent **36197367289** and **36198614866** runs independently exercised corrected allocation/resource shutdown. Their results are not substituted for the later source above.

### Native concurrency, warm reuse and fresh-container continuation

Actions **36199524224**, source **8b9c599b0b00fd8d28ea88e7469f0871c4224de7**, completed successfully using the pinned native runtime image. Artifact **10891771940**, `worker-native-performance`, contains all twelve load/cold result files plus the image log. The runtime/cleanup source in that run is unchanged in the later CLI/browser source above.

| Harness | Successful load turns | Peak concurrent turns | Warm-process hits | Fresh-container continuation |
| --- | ---: | ---: | ---: | --- |
| Codex | 12 | 3 | 6 | 1 passed |
| Claude Code | 12 | 3 | 6 | 1 passed |
| OpenCode | 12 | 2 | 6 | 1 passed |
| Hermes | 12 | 3 | 6 | 1 passed |
| DeepSeek | 12 | 3 | 6 | 1 passed |
| Pi | 12 | 3 | 6 | 1 passed |

Total: **72 load turns, 36 warm hits and 6 fresh-container continuation turns**, all successful, with **zero paid API calls**. These are actual native executables, scoped controller operations, capture and restore with loopback model protocol fixtures and containers without external networking. They do not establish live-model quality, hosted-provider recovery or production concurrency limits.

A performance qualification matters: Hermes' fresh-container turn took **29,098 ms**, and its warm turns **202–208 ms**. Profiling cold startup/contended startup remains a follow-up rather than asserting an unmeasured root cause. OpenCode's logical Host fixture declares **6,144 MiB**, while this workflow's container memory limit is **4 GiB**. Its success is functional evidence, not a validated 6-GiB capacity benchmark; align these limits before drawing density conclusions. No production default or retail rate was changed using these measurements.

## Demand-aware idle retirement — September 25, 2026

GitHub Actions run **36102148430**, source **dd44fb56fab02365eead0d216cd346663e1fa768**, completed successfully with Node **24.13.0**, pnpm **10.33.0**, and the repository's frozen dependency lockfile. Implementation semantics and safety boundaries are documented in [implementation](implementation.md#demand-aware-idle-scale-down).

| Check | Executed result |
| --- | --- |
| `pnpm check` | Passed documentation generation, TypeScript SDK build, and application type checking |
| `pnpm build:runtime` | Passed |
| Worker policy and queued-capacity unit suites | 78 / 78 passed: 47 policy and 31 scaling cases |
| `pnpm test:domain tests/integration/workers.test.ts` | 18 / 18 passed against disposable PostgreSQL |
| `pnpm exec tsx scripts/workers/stress.ts` | Passed the bounded loopback HTTP/SDK workload |
| `pnpm docs:check` | 64 generated public pages, 209 Markdown files, and 54 requirement mappings verified |
| Paid API calls | 0 |

The regression-only source **745a2ed0d6d14312427374f7f2e09df3425f2523**, Actions run **36101800606**, first reproduced both idle-capacity failures against the prior implementation. Its 15 existing database cases passed, while the two new cases failed: an idle spare stayed `ready` instead of `draining` behind a Worker concurrency limit, and two idle Hosts remained when only one was selected for queued work. Source **5b4fd457408138e613c0d7c473846d494991ce8e** changed reconciliation to use the existing per-Host demand plan; the successful source above also extends unpublished-state coverage.

The database suite verifies that the selected Host remains usable, excess idle capacity can retire despite a nonempty queue, active assignment identity and queued Runs are preserved, and provider-unconfirmed release does not become a stopped allocation. The complete-generation recovery fixture places one older `recovery_required` entry outside the 256-entry placement cache window. Both idle replacement and ordinary idle scale-down preserve that Host; ordinary retirement proceeds after the fixture explicitly marks recovery/publication complete. Provider control is a test implementation, not proof of real hosted shutdown or native process isolation.

The successful run retained the following stress measurements in the `worker-runtime-evidence` artifact:

| Measurement | Observed |
| --- | ---: |
| Accepted/completed Runs | 128 / 128 |
| Peak concurrent synthetic executions | 32 |
| Peak backing Host records | 3 |
| Resource ownership violations | 0 |
| Scheduling deferrals | 0 |
| Admission p95 | 183.92 ms |
| Worker listing p95 | 53.60 ms |
| Event-loop p99 | 21.43 ms |
| Elapsed workload | 16,057 ms |
| Paid API calls | 0 |

These are bounded-fixture observations, not production throughput or a causal performance comparison with earlier workloads. HTTP, the generated TypeScript SDK, admission, scheduling, PostgreSQL, persistence, and the ledger are real; external compute provisioning and model execution are explicit simulator boundaries. The full monorepo regression suite, native Docker recovery, browser/CLI journeys, and paid-provider acceptance were not run in this earlier verification slice. No production migration, deployment, or merge was performed.

## Earlier bounded API/database workload

GitHub Actions run **35963569941**, source **6532654b65d0a681185a19026577c098abcc545c**, Node **24.13.0** completed the loopback HTTP/SDK workload with the repository's pinned dependencies:

| Measurement | Observed |
| --- | ---: |
| Accepted/completed Runs | 128 / 128 |
| Peak concurrent synthetic executions | 8 |
| Peak backing Host records | 3 |
| Resource ownership violations | 0 |
| Admission p95 | 196.41 ms |
| Listing p95 across 21 Workers | 45.79 ms |
| Event-loop p99 | 21.04 ms |
| Elapsed workload | 144,556 ms |
| Paid API calls | 0 |

The workload exercised real admission, fair scheduling, PostgreSQL claims, filesystem publication, ledger, listing, pause, and destroy. Native model execution and external compute provisioning were explicit simulator boundaries. It deliberately offered many competing claims; 34,147 deferrals show that this is not a throughput benchmark for a production dispatcher using candidate hints.

The preceding run at `77aa30f0a271861af0644be85a6a94785e1d1c66` exposed database connection starvation. Nonblocking background advisory claims removed that observed failure without increasing the five-connection domain pool. Further contention and I/O work should preserve this result rather than enlarge the pool to conceal it.

That earlier successful action compiled the application and native runtime, regenerated all SDKs, and validated 64 generated public pages plus local documentation targets. No unit/integration suite was run during that earlier continuation at the user's request; the later focused suites above have their own source-specific evidence.

## Hosted boundaries

Live Render, Vercel, model, and hosted-storage checks require explicit configuration and spending authorization; no success is inferred from their stubs or offline native execution. The current deferred regression inventory is in [maintainer TODO](../../../maintainers/TODO.md), with concrete caller/operator dependencies in [Worker follow-up](TODO.md). Historical acceptance counts for the retired execution resource are not evidence for the Worker cutover.
