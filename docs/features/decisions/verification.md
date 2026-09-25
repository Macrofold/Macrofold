# Explicit-context execution verification

Local acceptance record, September 19, 2026. The feature is gated off by default. The original application acceptance used synthetic provider responses; the separate OpenRouter check below exercised two real, budgeted Jev requests. No production deployment or preview-data mutation was performed.

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

The table above records the original broader feature acceptance using synthetic identities, credentials and provider responses. No paid request, production migration or preview-data mutation was required for that pass. The feature remains disabled by default. Local backup tooling also received a connection fix discovered by this rehearsal: native PostgreSQL clients use dedicated libpq environment fields and an explicit database name, keeping passwords out of command arguments.

### OpenRouter Jev acceptance

The OpenRouter extension regenerates all five clients and adds managed/BYOK route, missing/wrong-provider credentials, revocation, choice/score validation, request identity, price-ceiling and no-retry regressions. The focused protocol/inference suites pass **60 tests in three files**. The subsequent full `pnpm test:coverage` passes **1,078 tests in 126 files**, including existing coverage floors (50.09% statements, 43.90% branches, 51.26% lines across the full application source inventory). All five language SDK suites pass again, including 193 Python tests, Pyright, Go, Rust, Java and the TypeScript loopback API journey. `pnpm check`, `pnpm docs:generate`, `pnpm docs:check` and whitespace checks pass. This extension changes no UI, and the broader feature's browser acceptance above was not repeated.

`LIVE_API_TESTS=1 pnpm test:live decisions` passed two actual requests through the SDK, loopback API, durable executor and OpenRouter's alpha Decisions endpoint, using synthetic evidence and a disposable restricted-role database:

| Question / funding | Receipt | Provider evidence | Recorded usage / settlement |
| --- | --- | --- | --- |
| Choice / managed | `unknown`, matching the explicitly unknown evidence | Nonempty OpenRouter generation ID, `typesafe/jev-1.13-20260917` | 734 input / 41 output tokens; 31 micro-USD charged |
| Score / BYOK | Schema-valid numeric `value` | Nonempty OpenRouter generation ID, same model revision | 701 input / 17 output tokens; 30 micro-USD estimated provider cost, zero managed charge |

Both usage records were complete. The combined rounded estimate was **$0.000061**, under the $0.004 combined test ceiling; invoices remain authoritative. No TypeSafe key was used, and the BYOK request succeeded with the managed OpenRouter key unavailable. Sanitized reports are in ignored `.data/live-checks/openrouter-jev-{choice,score}.json`. The disposable database and object directory were removed afterward. Test-account verification email delivery was unavailable locally; the fixtures explicitly verify their synthetic accounts, so this check makes no email-delivery claim.

This proves the configured account's two current Jev routes through the local application, not hosted enablement, arbitrary routing/model support, direct TypeSafe entitlement, model quality, or provider-side revocation. OpenRouter's documented endpoint is alpha. Real ambiguous transport completion remains a release acceptance item; deterministic no-retry/provisional-accounting fixtures cover its local behavior.

### Context-window correction

The local correction removes byte-as-token context rejection at both admission and invocation preparation, including bounded-agent follow-ups. Billing reservations and request byte limits remain unchanged. Regression cases exercise typed and native-payload Jev through both providers above the old 32KB boundary, conventional inference above the old 128KB boundary, insufficient budgets before dispatch, actual-usage settlement and provider rejection without retries.

The focused disposable-database run passed all eight selected cases (seven new regressions and the existing bounded-evidence loop); `pnpm check`, documentation generation/checks and whitespace validation passed. The broader inference/protocol run passed 66 of 69 tests. The remaining failures concern an expected `decision.response` trace event, a generated-client cancellation test that does not request asynchronous execution, and an exact error-message assertion for unsupported OpenRouter models. Those behaviors were not changed by this correction. The asynchronous test helper now explicitly sends `Prefer: respond-async` so admission and executor phases can be exercised separately.

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

## Remaining release gates

- Apply/rehearse 035–038 through the normal migration/backup-restore procedure on staging; fence old pollers/Workflow histories before enabling the executor.
- Run explicitly budgeted hosted decision acceptance, direct Anthropic/TypeSafe decisions and real ambiguous completion. Local OpenRouter managed/BYOK acceptance above does not establish other accounts, direct-provider entitlement or cloud behavior.
- Measure hosted queue, provider and UI delivery latency with representative context sizes and concurrency. The local small-fixture budget is not a hosted SLA.
- Verify cloud object-store collection and restoration of independently published context/proposals and active task evidence, separately from expired diagnostics and workspace purge.
- Review provisional late-usage receipts operationally; automatic financial corrections remain deferred.
