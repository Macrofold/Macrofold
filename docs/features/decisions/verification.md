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
