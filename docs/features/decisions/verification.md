# Explicit-context execution verification

Verification records distinguish the original September acceptance, later provider checks and the immediate-inference implementation below. Earlier test counts and feature-flag statements describe their recorded revisions, not current deployment readiness. Synthetic fixtures establish application behavior; only explicitly identified provider checks made paid calls. No preview data is used by these disposable fixtures.

## Test workload

The original fixtures in `examples/decisions/contracts.ts` model customer-exception triage and an actor choosing an action. They carry explicit unknown evidence and entity/query dependency tokens. They do not import another application's rules or private source. Conventional and Jev protocol fixtures use deterministic synthetic responses.

`tests/integration/inference.test.ts` exercises the actual API/domain against a disposable restricted-role PostgreSQL database, encrypted local storage and controlled provider transport: admission/idempotency, invalid output, exact limits, provisional usage, revoked/foreign audience bindings, immutable definitions/context, bounded read grants, task duplicate wakes/investigation/proposal/application rejection, concurrent dispatch, cancellation with late evidence, diagnostic expiry versus independent publication, HTTP/SSE and TypeScript SDK use. Real child processes are killed after dispatch and committed response to verify uncertain recovery and no duplicate external call.

`tests/unit/decision-protocols.test.ts` covers current vendor wire shapes, primitive validation, malformed/refused/missing-usage distinctions, confidence/ranges, schema complexity, snapshot/completeness semantics, both examples and synthetic shadow disagreement. `tests/integration/decision-scheduling.test.ts` uses mixed native/lightweight queues, account ceilings, reserved capacity and a throwing machine factory to prove lightweight execution never constructs native compute.

`tests/browser/decisions.spec.ts` seeds a completed task through the real domain, signs in through the optimized app, inspects proposal/receipt/lineage, checks native-only controls are absent, and runs accessibility checks. Shared SDK, domain, migration and load suites guard the existing native behavior.

## Results

| Check | Result and scope |
| --- | --- |
| `pnpm test:coverage` | **1,065 tests passed in 126 files** against a disposable PostgreSQL database with restricted runtime roles. Existing coverage floors passed. Includes representative pre-change native-row migration through 035–038, tenant/audience/scope boundaries, Jev choice/score settlement, real process kills, late-response retention, task limits/cancellation and duplicate wakes after evidence release. |
| `pnpm test:sdks` | All five language suites passed: actual TypeScript/API journey, Python 193 tests and Pyright, Go transport/resource tests, Rust transport/resource tests, Java Maven verification. Native accepted-run types and nullable lightweight resources compile through generated clients. |
| `pnpm test:dashboard:isolated tests/browser/decisions.spec.ts` | Optimized build, decision proposal/receipt/task lineage, exact sub-cent cost, readable timeout and axe passed. The same isolated application passed six built CLI tests, the real PTY journey and Python HTTP/SSE/session continuation. The rendered screenshot was visually inspected. |
| `pnpm test:load` | 11 tests in two files passed. Existing concurrent scheduling/Workflow recovery behavior remains covered; mixed native/lightweight capacity and unsupported-executor claims are also covered by the domain suite. |
| `TEST_POSTGRES_CONTAINER=none pnpm exec tsx scripts/test-install.ts` | Fresh installation, migration, vault rotation and paired encrypted database/object backup/restore passed using local PostgreSQL client tools. Restored 45 encrypted objects, native files/session continuation, decision receipt, task allocation, active evidence pin and proposal. The restore used an independent database/store; measured restore phase was 0.321 seconds for this fixture. |
| `pnpm sdk:generate:all`, `pnpm check`, `pnpm docs:generate`, `pnpm docs:check`, `git diff --check` | Passed. All five clients regenerated; 60 public pages and local documentation targets verified. |

The table records the original broader feature acceptance using synthetic identities, credentials and responses. No paid request, production migration or preview-data mutation was required for that pass; current admission follows normal paid-execution policy rather than that revision's opt-in flag. Local backup tooling also received a connection fix: native PostgreSQL clients use dedicated libpq environment fields and an explicit database name, keeping passwords out of command arguments.

### OpenRouter Jev acceptance

The OpenRouter extension regenerates all five clients and adds managed/BYOK route, missing/wrong-provider credentials, revocation, choice/score validation, request identity, price-ceiling and no-retry regressions. The focused protocol/inference suites pass **60 tests in three files**. The subsequent full `pnpm test:coverage` passes **1,078 tests in 126 files**, including existing coverage floors (50.09% statements, 43.90% branches, 51.26% lines across the full application source inventory). All five language SDK suites pass again, including 193 Python tests, Pyright, Go, Rust, Java and the TypeScript loopback API journey. `pnpm check`, `pnpm docs:generate`, `pnpm docs:check` and whitespace checks pass. This extension changes no UI, and the broader feature's browser acceptance above was not repeated.

`LIVE_API_TESTS=1 pnpm test:live decisions` passed two actual requests through the SDK, loopback API, durable executor and OpenRouter's alpha Decisions endpoint, using synthetic evidence and a disposable restricted-role database:

| Question / funding | Receipt | Provider evidence | Recorded usage / settlement |
| --- | --- | --- | --- |
| Choice / managed | `unknown`, matching the explicitly unknown evidence | Nonempty OpenRouter generation ID, `typesafe/jev-1.13-20260917` | 734 input / 41 output tokens; 31 micro-USD charged |
| Score / BYOK | Schema-valid numeric `value` | Nonempty OpenRouter generation ID, same model revision | 701 input / 17 output tokens; 30 micro-USD estimated provider cost, zero managed charge |

Both usage records were complete. The combined rounded estimate was **$0.000061**, under the $0.004 combined test ceiling; invoices remain authoritative. No TypeSafe key was used, and the BYOK request succeeded with the managed OpenRouter key unavailable. Sanitized reports are in ignored `.data/live-checks/openrouter-jev-{choice,score}.json`. The disposable database and object directory were removed afterward. Test-account verification email delivery was unavailable locally; the fixtures explicitly verify their synthetic accounts, so this check makes no email-delivery claim.

This proves the configured account's two current Jev routes through the local application, not hosted enablement, arbitrary routing/model support, direct TypeSafe entitlement, model quality, or provider-side revocation. OpenRouter's documented endpoint is alpha. Real ambiguous transport completion remains a release acceptance item; deterministic no-retry/provisional-accounting fixtures cover its local behavior.

### OpenRouter Decision 1 acceptance

The October 15, 2026 extension adds `microsoft/microsoft-decision-1` to the shared decision-only registry without changing the public schema, SDK request shape, database schema or native runtime image. The focused protocol and disposable-database inference suites pass **84 tests** (26 protocol, 58 API/domain). The new cases verify native multi-question preservation and probabilities, typed choice/score validation, frozen managed rates, exact BYOK and dispatch-time revocation, provisional missing usage, no chat metadata refresh, and rejection of streaming/JSON/bounded-agent capabilities before admission. Existing Jev, Anthropic and OpenRouter chat checks remain included.

`LIVE_API_TESTS=1 LIVE_DECISION_MODEL=microsoft/microsoft-decision-1 pnpm test:live decisions` passed both real requests through the TypeScript SDK, loopback API, executor and OpenRouter. Both reported `microsoft/microsoft-decision-1-20261009` and nonempty generation IDs:

| Request / funding | Result | Usage / accounting |
| --- | --- | --- |
| Native noul + choice + score / managed | Complete native answers retained; receipt `value` | 89 input / 3 output tokens; 4 micro-USD Macrofold model charge |
| Typed score / BYOK | Schema-valid numeric `value`; managed key unavailable | 323 input / 1 output tokens; zero Macrofold model charge, 14 micro-USD request-budget consumption |

Both usage records were complete, with exactly one provider invocation per request. Rounded usage under the reviewed input rate totals **18 micro-USD**, under the combined $0.004 authorized fixture ceiling; provider invoices remain authoritative. No Azure credential or native compute was used. Reports remain in ignored `.data/live-checks/openrouter-decision-1-{choice,score}.json`; the disposable database/object directory was removed. These checks started no serving application or worker process. The fixture SMTP sink was unavailable, so this establishes no email-delivery behavior.

`pnpm check` (including TypeScript SDK build), compilation of the published Decision 1 example and `pnpm docs:check` passed. No public API schema or SDK transport changed, so other language SDKs did not require regeneration or local verification. Full verification remains in CI.

The base revision `49617906` already has failed CI acceptance/coverage, install/restore, audit, native dependency-scan and browser jobs. Targeted verification here is distinct from those existing full-release failures. Hosted rollout, provider quotas, other accounts and application-specific probability calibration remain separate acceptance work.

### Context-window correction

The local correction removes byte-as-token context rejection at both admission and invocation preparation, including bounded-agent follow-ups. Billing reservations and request byte limits remain unchanged. Regression cases exercise typed and native-payload Jev through both providers above the old 32KB boundary, conventional inference above the old 128KB boundary, insufficient budgets before dispatch, actual-usage settlement and provider rejection without retries.

That revision's focused run passed eight selected cases; the broader inference/protocol run passed 66 of 69. Its remaining failures concerned obsolete duplicate tracing, a client cancellation fixture and exact model-error wording. Current phase fixtures use actual internal queued admission; public `/v1/inferences` no longer supports an async preference. Current acceptance is recorded separately below rather than presenting those old failures as current source behavior.

An explicitly authorized direct OpenRouter probe used only synthetic repeated greetings, fixed `typesafe/jev-1.13`, no retries or fallback, and price ceilings of $0.042/M input and zero output/request fees. Five attempts reserved a combined $0.10 test ceiling:

| Input shape | Result |
| --- | --- |
| 60,000 greeting repetitions in state, one short question | HTTP 400, upstream `max_tokens_exceeded` |
| 10,000 in state, 24,500 in each of two questions | HTTP 400, upstream `max_tokens_exceeded` (each state/question pair also exceeds 32K) |
| 100 and 1,000 in state, short question | HTTP 200; 414 and 1,314 input tokens, confirming one additional token per repetition for this fixture |
| 2,000 in state, 29,000 in each of two questions | HTTP 200; **60,369 input tokens**, 59 output tokens, reported cost **$0.002535498**, 829 ms for this sample |

Sanitized reports are retained in ignored `.data/live-checks/openrouter-jev-60k-*.json` and `openrouter-jev-token-calibration.json`. Successful calls reported $0.002608074 combined; rejected calls reported no usage, so no zero-charge claim is made for those attempts. These direct probes establish the configured route's observed limits, not a hosted Macrofold deployment or a latency guarantee. [TypeSafe documentation](https://docs.typesafe.ai/models) specifies 64K total and 32K for state plus the longest question.

### Coverage review

The in-process aggregate covers the full configured source inventory, including unexercised application UI: 50.05% statements, 43.89% branches and 51.23% lines. This is not combined browser/native coverage. New authority, admission, credential, model, task-allocation and context-artifact modules have 100% branch coverage; explicit context validation has 94.73% and provider protocols 96.66%.

The 90% critical-branch review target is **not fully reached**: the direct executor is 84.24%, bounded loop 86.20%, and task coordinator 76.92%. Remaining gaps include the abort polling tick, some repeated-tool/competing-publication branches, revocation/expiry during object publication, and maintenance retry/backoff. Core cancellation, uncertain dispatch, recorded-response restart, authorization before later children, exact allocations and late diagnostic redaction have direct assertions. These figures do not establish exhaustive race coverage. Existing mutation targets were unchanged by this implementation; mutation suites were not rerun and no new mutation score is claimed.

### Small inline workload measurement

One synthetic Anthropic choice with one inline evidence item and one provider call passed the declared **5-second local application fixture budget**. The recorded sample was **61 ms end to end**, with 167 SQL statements (41 writes), no output artifact and no native compute. Persisted row sizes were 3,178 bytes for the run and 2,310 bytes for the invocation; these exclude shared event, financial and index storage.

| Recorded stage | Milliseconds |
| --- | ---: |
| Admission preparation | 19.16 |
| Queue wait | 24 |
| Context reference resolution (inline here) | 0.00033 |
| Synthetic provider transport | 0.40 |
| Validation | 9.46 |
| Response persistence | 0.71 |

This is a single local sample, not a percentile, hosted capacity claim or model latency measurement. Stage clocks have different boundaries and are not an additive profiler; admission preparation excludes the final admission commit. Reproduce with `DECISION_MEASUREMENT_FILE=/tmp/decision-measurement.json pnpm test:domain tests/integration/inference.test.ts`, using the documented disposable test-database setup. The JSON contains timings/counts/bytes, not customer content.

## Immediate inference

The implementation replaces the direct phase loop with immediate A/provider/B/C ownership and evidence-only recovery. It retains native/bounded dispatch and shared financial rules. Tests exercise the real API, restricted-role PostgreSQL, all five SDK transports and controlled upstreams. No native image change is required.

Focused evidence includes shared gateway/accounting/provider regressions, independent nullable usage, bounded normalization-failure evidence, current-key authorization, same-key duplicate suppression, unknown COMMIT acknowledgment, cancellation before response persistence, timely response settlement after the execution deadline, C failure with actual poller recovery, generation fencing and real retention tombstones. An actual HTTP stream delivers an early delta before the provider finishes, then the settled receipt; completed replay emits no new deltas. The full five-language SDK workflow passed with paid execution disabled. A 276-check run passed 272 and exposed four outdated fixtures; corrected catalog/HTTP checks pass 17 checks, and the final financial/fault cohort passes 56 checks. `pnpm check` passes.

The separate process-loss fixture passes both actual SIGKILL boundaries: after provider dispatch and after B has durably saved a timely response. It preserves the original execution deadline, waits the real completion allowance, recovers from another process lifetime and replays the same identity without a second provider call. Dispatch loss ends uncertain; saved response loss completes with the original value. Final occupancy and reservations drain to zero. This is one focused process-loss test with two boundaries; the separate arrival-ramp and waiting-cohort load tests were not rerun as part of that pass.

All five SDKs also pass immediate JSON, identical replay and SSE against the actual API with no worker, in addition to their ordinary file/native/customer journeys. The final complete SDK run passes Python's 217 checks, Rust's 21 checks, Java's 18 checks and the TypeScript/Go journeys; Python type checking is clean. A subsequent TypeScript-only credential-deadline fix passes its build and 28 focused transport tests.

Cross-replica revocation uses two held upstream calls and directly revokes their shared API key without cancellation flags. Both sockets close within 505 ms, and failed terminal receipts return within 569 ms. Restored-key replay on the opposite replicas does not redispatch; active occupancy, reservations, duplicate usage and unbalanced journals all remain zero. A separate unread-reader fixture overflows the bounded SSE delivery queue while preserving the successful final result and its one settlement. These are bounded correctness fixtures, not a sustained freshness or capacity certification.

Migration 054 passes a rollback-only rehearsal on populated disposable data: prior Run/gateway/invocation fields remain unchanged, historical `provider_completed_at` stays NULL, and the actual runtime role can read only the intended cross-tenant control projection while ordinary Run RLS and secret-column restrictions remain enforced. Fresh installation is also exercised by every isolated suite. The optimized application build passes; existing runtime filesystem tracing warnings remain outside this control-plane change.

The existing loopback local Docker profile was migrated from 052 through 054 after verifying zero active Runs. Its web process was preserved; health remains ready and the new API rejects async inference as specified. Existing standalone pollers still need coordinated replacement with this source before local recovery acceptance: two older processes were discovered, including Node 22. No claim is made that migration alone updates their already-loaded recovery code. Hosted activation remains separate.

Two isolated live OpenRouter Microsoft Decision 1 calls completed on the original HTTP request on October 17. Native managed choice returned complete usage of 89 input/3 output tokens and a 4-micro-USD Macrofold charge. Typed BYOK score returned 327 input/1 output tokens, zero Macrofold charge and 14 micro-USD of metered budget usage. Each dispatched once, and its embedded receipt matched the saved result. The fixture reserved at most 4,000 micro-USD in total and used a disposable database; it did not change the running preview or hosting. This establishes selected provider behavior, not throughput or a hosted SLA.

Load tooling in `tests/load/immediate-inference.test.ts` uses independent API processes, real HTTP/SQL, open-loop arrivals, bounded synthetic providers and controlled process termination. It records offered/completed/refused rates, latency, pool/SQL/lock timings, memory, event-loop lag, host load and reservation reconciliation. Set `IMMEDIATE_REPORT_PATH` to retain a private JSON report; environment parameters are documented in that test. It does not bypass account/fleet caps or call paid models.

A separate HEAD `f7cf9f5` export measured the old async submission plus polling path at 2 arrivals/second: four completed calls, p50 1,078 ms and p95 1,330 ms, approximately 197 SQL commands and 18 commits per call. A preliminary immediate profile after event batching measured 77 commands per call, but subsequent source optimizations changed the tree. Do not treat these as a matched final latency improvement or certified throughput.

The final local calibration was stopped with host load above 366 on ten CPUs and only 59 MiB reported free memory. Earlier overload fixtures reconciled all accepted reservations and occupancy, but had refusals and missed the latency target. No 10,000-concurrent, 15-minute, hosted-lifetime or production-capacity pass is claimed. Repeat the declared workload on a quiet provisioned topology, freeze measured release headroom and retain the target as an open release gate.

## Remaining release gates

- Apply/rehearse 035–038 through the normal migration/backup-restore procedure on staging; fence old pollers/Workflow histories before enabling the executor.
- Run explicitly budgeted hosted decision acceptance, direct Anthropic/TypeSafe decisions and real ambiguous completion. Local OpenRouter managed/BYOK acceptance above does not establish other accounts, direct-provider entitlement or cloud behavior.
- Measure hosted queue, provider and UI delivery latency with representative context sizes and concurrency. The local small-fixture budget is not a hosted SLA.
- Verify cloud object-store collection and restoration of independently published context/proposals and active task evidence, separately from expired diagnostics and workspace purge.
- Review provisional late-usage receipts operationally; automatic financial corrections remain deferred.
