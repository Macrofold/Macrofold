# Worker execution evidence

Evidence is commit-specific. A green build is not native recovery or paid-provider evidence, and simulated external boundaries are not actual cloud resource measurements.

## Execution efficiency

The working tree based on `2a7b7c59` adds shared event-page publication, a content-free SSE observer, revision-bound restore inventory pages, batched checkpoint progress, publication-scoped content verification and bounded warm-Host observations. Local checks use disposable restricted-role PostgreSQL/storage and synthetic model/tool responses.

- Event tests cover contiguous public order, replayed producer identities including sequence zero, conflicting payload rejection, source-cursor fencing, live SSE wake/cancel, tenant-separated shared observation, missed wake repair and bounded reader expiry.
- Storage tests cover stable inventory pages and revision rejection, no repeated PUT for a small/empty stored chunk, verification reuse only in its active publication guard, and preservation of an existing manifest after a malformed replacement candidate. Existing cloud recovery, guarded file preservation, checkpoint/session continuation, cancellation, orphan model accounting, Host fencing and public replay cases remain exercised.
- A private derivative image (`macrofold-efficiency-runtime:20261017`, `sha256:8d52e2d0aefa73822d3d3dd4a4ac85f0c05aae42e610092e866f926f024f398d`) combines the existing pinned runtime dependencies with current bundled runtime code. All six actual Docker harnesses pass simultaneous execution, independent capture/cancel, warm continuation, cold reload and continuation in a fresh container. The OpenCode, Hermes, DeepSeek and Pi fixture passes additionally assert released warm health's Session/checkpoint revisions and retained memory and use bounded event-wait requests. Model/tool traffic is loopback-only with external networking disabled. The developer's default image and preview are preserved.
- `DOCKER_RUNTIME_IMAGE=macrofold-efficiency-runtime:20261017 pnpm test:journey:docker opencode` passes the real loopback API/TypeScript SDK journey against disposable SQL/storage and the actual OpenCode executable. Runs `01a14aff-e1de-7778-a167-211f7f223589` and `01a14b02-0b67-7096-8a8a-471c540cd275` exercise poller termination/restart, restore inventory, verified checkpoint publication, fresh-container native continuation and released reservations. Responses are scripted; this recovery journey is separate from the latency profile below.

`scripts/profile-runtime-io.ts` compares 128 individual event publications with one shared batch, using ten measured cohorts plus warmup and checking every stored sequence. On the shared local host, individual publication measured mean **645.94 ms**, p50 **545.91 ms**, p95 **1,901.38 ms**; batch publication measured mean **12.66 ms**, p50 **11.37 ms**, p95 **30.53 ms**. All **2,817 events** persisted. These are restricted local SQL measurements under variable concurrent host load, not a hosted throughput or native-to-client latency guarantee. The script creates and removes its own database and invokes no paid provider.

`NATIVE_DELTA_PROFILE=1 DOCKER_RUNTIME_IMAGE=macrofold-efficiency-runtime:http-20261017 pnpm test:journey:docker opencode` sends forty timestamped synthetic SSE chunks per turn and observes all eighty markers through the real API SDK. It skips deliberate process termination so recovery delay does not contaminate transport timing. Private supervisor timestamps and content-free worker diagnostics correlate native producer sequences to public event sequences; customer event payloads remain unchanged. The final source-timed image is `sha256:d25752e8dbdba7ff3e1ac51a11fbceb3495d1a3080361a2e7a43b67fcb310411`.

The final local HTTP profile passes both complete Runs (`01a14b35-a1ed-7241-8d79-42e5481fc347`, `01a14b35-d9d4-7327-b0de-059f05d889db`) and all eighty markers with bounded same-class continuation, direct authenticated Docker Host HTTP and a shared local PostgreSQL notification listener:

| Interval | Mean | p95 |
| --- | ---: | ---: |
| Provider fixture → native event | 8.70 ms | 31 ms |
| Ready native event → probe start (scheduling only) | 2.50 ms | 23 ms |
| RPC after output becomes ready | 5.03 ms | 7 ms |
| Probe return → SQL event timestamp | approximately 0 ms | approximately 0 ms |
| SQL event → API SDK | 12.04 ms | 21 ms |
| Native event → API SDK | 18.64 ms | 37 ms |
| Complete provider fixture → API SDK | 27.34 ms | 69 ms |

The **250-ms native delivery p95 objective passes locally**, with maximum native-to-SDK **44 ms**. Docker Host creation publishes controller port 10000 on one inspected ephemeral `127.0.0.1` host port, and control calls use the existing authenticated HTTP endpoint. This removes the previously measured per-probe Docker CLI/Node process overhead. An earlier authenticated stdin/notification cohort measured native-to-SDK mean/p95 **192.79/344 ms**, with Docker RPC p95 **279 ms** and SQL-to-SDK p95 **32 ms**; that superseded implementation failed the objective. These are separate local fixture cohorts on a shared developer host, not production causal proof or an SLA. SQL and source clocks have millisecond granularity; the final post-probe SQL median is minus one millisecond, so its sub-millisecond mean is not treated as precise. The actual Linux file-wait function separately delivers thirty timed appends with p95 **5 ms**, maximum **9 ms**. An earlier profile overlapping full coverage measured provider-to-SDK p95 **1,514 ms** and is not a matched baseline.

The final image also passes an actual controller-HTTP preflight in a separate network-disabled container: expected-secret authentication succeeds; wrong/missing secrets, mismatched boot IDs and the previous boot after restarting the controller in the same container all fail closed. A matching local secret file cannot bypass credential rejection, and the secret is absent from controller output. **61 focused Docker/Render/HTTP tests** pass for loopback-only publication, strict origin validation before credential transmission, immutable lifecycle identity, oversized request/response rejection, response-read deadlines and unchanged provider origin policies. Whole-root TypeScript checking passes. All-six-harness evidence above uses the earlier derivative image; the final shared-controller/transport is exercised by this preflight and complete OpenCode journey, without claiming another all-six HTTP-image matrix.

The API journey uses a **dedicated normal bridge**, because Docker suppresses published ports on internal-only networks. It is therefore not a kernel-network-disabled test. Synthetic keys, rejecting provider/broker transports and the fixed application relay remain in force, without host mounts, a Docker socket or private customer content. No paid provider is called. The earlier all-six image-only checks retain `--network=none`; these are distinct isolation/transport acceptance scopes.

Targeted notification tests use real restricted PostgreSQL to prove that the opaque organization/Run hint is delivered after event commit and suppressed by rollback. Unit checks cover one shared listener, malformed hints, disconnection/retry, hosted fallback and idle cleanup. The observer/stream/Docker slice passes **23 tests**, including stalled-reader backpressure and rejection of further page reads after the existing 55-second stream lifetime. Native fixtures, database and network are removed afterward; no cloud deployment is involved.

After confirming zero active developer Runs and zero Host allocations, the qualified HTTP image was activated under `platform-runtime:0.1.0`. The prior default `sha256:b554bf196b28b20cb7befd6a4025ccc0e16e794168737ee413d900b99ffb9ce0` is retained as `macrofold-efficiency-rollback:20261017`. This is local image activation only; no developer API or durable worker was started, and no hosted deployment is claimed. The retained image is a recovery artifact, not a standalone source/schema rollback: preserve current compact-record readers/recovery and fencing, pause new admission while reconciling versions, and never redispatch accepted work for convenience.

Run the event SQL profile from the unpaid local profile with `PLATFORM_MODE=local EXECUTION_PROVIDER=simulator ALLOW_PAID_EXECUTION=false pnpm exec tsx scripts/profile-runtime-io.ts`. Actual hosted control/wake behavior and sustainable mixed-load rates remain deployment acceptance work; the direct inference overhead profile is recorded separately in [decision verification](../../decisions/verification.md#near-full-context-profiling).

## Resource-specific capacity

The [capacity implementation record](../../../projects/resource-capacity.md#decisions-and-verification), based on `132d549b` plus the working tree, covers independent resource/fleet admission, full transfer-pool isolation, more than twenty concurrent phase steps, session queue bounds, separate HTTP buckets, bounded refill/drain and maintenance isolation. Existing scheduling/load, Worker, storage, decision, trigger and delivery regression slices pass after updating obsolete quota expectations and test setup. All five SDK checks, TypeScript, the isolated production build and documentation integrity pass. Policy mutation verification passes at 93.33%. Migration 051 is applied locally; the idle API/poller were restarted, health and Docker diagnostics pass, and the authenticated billing response confirms the new plan caps. Local native capacity remains explicitly ten, independently of 2,000 lightweight slots. These are local functional results with scripted provider boundaries, not measured hosted throughput or a completed caller journey.

## Independent poller progress

The [poller progress record](../../../projects/poller-progress.md#verification), based on `132d549b` plus its change, covers bounded independent steps, stalled checkpoint/maintenance barriers, unchanged scheduler limits and local asynchronous GPT-5 execution. The worker was restarted only after confirming no active or queued work. Historical October 11 records establish pre-execution cancellation, but do not identify the precise blocking operation. Full caller-scenario and hosted acceptance remain separate.

## Bounded work and recovery

The [bounded-work audit](../../../projects/bounded-work.md), based on `9948ba64` plus the working tree, has these local results:

- Fault-injection checks cover eight-failure dispatch/Host budgets, native recovery exhaustion, monotonic cursor/page progress, cancellation deadlines, preserved checkpoints/holds and no prompt replay. The final recovery slice passed 33 tests, including restricted reporting access and detailed SSE closure. A separate transport/UI/helper slice passed 71 tests, including a cancellation promise that never resolves. Counts describe separate executed slices, not unique total coverage.
- Existing connection cleanup, named connection access, deletion, decision scheduling, inference, maintenance, reporting, storage, Workflow load and Git-sync domain suites passed. A new reporting-grant assertion initially referenced an absent fixture column; after correction, the grant regression passed with only `kind`, `resource_id` and `state` readable by the reporting role.
- `pnpm test:sdks` passed for all five maintained SDKs: actual API/helper checks, TypeScript build, Python 211 tests plus static checking, Go tests, Rust checks/tests and Java verification. CLI acceptance passed seven real loopback API/disposable database cases. The actual Pi executable passed two warm tool-enabled turns with the scripted model and isolated network.
- Migrations 048–049 applied to the loopback development database. The restricted reporting views now query successfully; the existing preview remains running. No paid model call, cloud migration or deployment was made.
- The runtime image rebuilt as `platform-runtime:bounded-work` (`sha256:b42e51332fff9723717902d7c3fa8fe3970aaf165d64aa704f6cb3eb0d8bbb20`). Image-only OpenCode tool execution, two warm turns and fresh-container continuation passed with the actual executable and scripted network-isolated model. The verified image also supplies the local default tag. Only the idle owned Docker poller restarted; `pnpm doctor:docker` and the retained preview health check pass.
- `pnpm test:journey:docker opencode` also passed with that rebuilt image and the current bounded engine: actual loopback API/TypeScript SDK, isolated database/storage, native OpenCode tool execution, poller termination/restart, verified publication and fresh-container continuation. The two disposable Run IDs were `01a10ff3-60b4-718e-9778-d27a4ac33e36` and `01a10ff3-afc4-75d8-8495-0679de355fee`. Responses are scripted; no external model call or game reflection journey is inferred.
- Two Chromium journeys passed against isolated Next.js/HTTP/PostgreSQL fixtures: recovery attention without waiting/replay/reconnect and revoked-stream reconnection stopping. The recovery screenshot was visually inspected. Initial setup needed the pinned browser binary and route warming to exclude cold development compilation from interaction deadlines; the stopped fixture mail sink was not email-delivery acceptance. Application checking (including the TypeScript SDK build), documentation integrity and diff whitespace checks passed.

The subsequent actionable-notice change adds specific dispatch/checkpoint/billing/finalization/cleanup diagnostics and migration 050:

- 55 targeted cases passed across executed slices: actual publication/dispatch/billing/cleanup exhaustion, safe dashboard messages, stream stopping and scheduling. The dispatch fixture first reproduced a blocked queued Run preventing healthy claims; the fix excludes only blocked queued work. Active uncertain Runs retain capacity, Worktree ownership and financial holds. Cancellation and expiry settle unstarted blocked Runs without reviving dispatch.
- Two isolated Chromium journeys passed, including failed-step/cause/count disclosure, stopped waiting, View events and no replay action. The screenshot was visually inspected. A synthetic three-poller workload completed 60 jobs, reached 50 active executions and recorded zero capacity violations in 12.8 seconds. This is bounded local functional evidence, not a production latency claim.
- Migration 050 applied to the loopback database and its reporting flag queries successfully. The owned poller restarted only after confirming no active Runs; the existing preview was preserved. `pnpm check` passed. Current SDK verification passed the TypeScript API journey/build and 211 Python tests, then stopped because this shell's Python lacks Pyright; Go/Maven are also absent from PATH. The earlier complete SDK result above remains separate evidence, not a current full-suite pass. No OpenAPI shape or generated method signature changed.

Hosted pooled PostgreSQL timeout options, real provider-outage cleanup and the caller's complete draft/approval journey remain explicit acceptance work in [maintainer TODO](../../../maintainers/TODO.md#bounded-operations-and-recovery).

## Native publication and local Docker recovery

The [recovery change](../../../projects/native-run-recovery.md), based on `9948ba64` plus the working tree, has these local results:

- All four new guarded checkpoint failure cases reproduced nontermination before the fix. Afterward, **42 targeted tests passed** across cloud lifecycle, Docker ownership/reconciliation and Docker command diagnostics. Restore failure, lost execution, rejected verified output and cancellation preserve the verified checkpoint; session state, single settlement and no prompt replay are checked. Transport cases cover bounded stderr/output, stdin failure, missing binary, fixed diagnostic privacy and both command deadlines.
- `pnpm check` passed, including the application TypeScript SDK build. No public schema or SDK transport changed.
- `pnpm test:journey:docker opencode` passed against the real runtime image, generated SDK, loopback HTTP API, disposable PostgreSQL/storage and actual OpenCode executable. It verifies dispatcher restart, durable file publication, native Session continuation in a fresh container and released reservations. Model responses are scripted, and the network is isolated; this is not a live-model quality check.
- Local setup inspection found the configured default image tag absent. Its verified compatible runtime image was tagged explicitly, and `pnpm doctor:docker` passed. A missing-image override separately verifies actionable diagnostics without raw stderr disclosure.
- Two previously stuck local cancelled Runs finalized through the existing engine without relaunch. Last verified files and checkpoint identities stayed unchanged; each Run settled once and organization reservations returned to zero. REST checkpoint restoration then returned both Worktrees to idle with the same file bytes. Only the idle poller was restarted; the existing application preview was preserved.

No paid provider calls or cloud deployment were performed. The caller's complete draft/approval journey and hosted runtime rollout remain separate acceptance checks; see [maintainer work](../../../maintainers/TODO.md#native-home-persistence).

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
