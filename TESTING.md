# Testing rules for contributors and coding agents

Use this policy when adding features, fixing bugs, or reviewing changes. It supplements [AGENTS.md](AGENTS.md); the [testing and CI reference](docs/engineering/testing.md) describes commands, report scope, configured gates, and release verification. Requirements below apply to the behavior affected by a change, rather than requiring every suite for every edit.

The current stack is strict TypeScript on Node 24, Next.js 16/React 19, Vitest 4 with V8 coverage, Playwright with axe, PostgreSQL with `pg`, and Stryker. The Python SDK uses pytest and HTTPX; cost checks use `unittest` and `Decimal`. Use the pinned dependencies and existing helpers. Official documentation can describe newer versions: check compatibility before copying APIs or configuration.

Go, Rust, and Java SDK changes also require their HTTP/SSE transport fixtures and `pnpm test:sdks`, which creates a disposable database, actual API handler, and simulator worker. Install Go, Rust, JDK 21, and Maven first. API contract changes require `pnpm sdk:generate:all`; see [SDK ownership and testing](docs/features/api/sdks/implementation.md).

When testing authentication libraries, explicitly enable the serving-mode protections being asserted: Better Auth disables origin checks under Vitest. Restore modified test context afterward. Crash-recovery tests should kill a real fixture process at a known publication boundary; thrown exceptions alone cannot demonstrate recovery after abrupt process death.

## When to add or update tests

- **New or changed behavior:** include tests in the same pull request. Identify the observable success result, meaningful rejection/failure cases, and relevant boundaries before implementing. Cover existing behavior that the change could break.
- **Bug fixes:** add a regression case reproducing the defect. Where practical, confirm it fails against the original behavior and passes with the fix. Do not alter a shared checkout to demonstrate this; use an isolated reproduction if needed.
- **Cross-component features:** cover the actual integration boundary. Add a browser or terminal journey when the feature changes an important user workflow; keep the detailed input/error matrix in faster tests.
- **Refactors:** run existing behavioral tests. Add tests for previously unprotected behavior that the refactor puts at risk; avoid tests of private function structure merely because a function was extracted.
- **Docs, copy, and purely visual changes:** automated behavioral tests are generally unnecessary. Check links, rendering, or the affected UI as appropriate, and record why no new tests were needed. Changes to interaction, accessibility, or validation are behavioral changes.

Choose the smallest test boundary that can detect the real defect. A unit test cannot prove database isolation; a browser test is usually unnecessary to enumerate a pure parser's invalid inputs. Test outcomes through public contracts so behavior-preserving refactors do not require rewriting the suite. [Google's guidance on testing behavior](https://testing.googleblog.com/2013/08/testing-on-toilet-test-behavior-not.html).

## Choose the right test level

| Change                                                                  | Required evidence when applicable                                                                                                     | Existing location or example                                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain rules, parsing, authorization decisions, adapter transformations | Focused Vitest cases with explicit inputs and outcomes                                                                                | [Unit tests](tests/unit), [authorization cases](tests/unit/authorization.test.ts)                                                                   |
| Transactions, tenant isolation, auth lifecycle, orchestration, storage  | Vitest integration tests using disposable PostgreSQL and temporary storage; deterministic upstream fixtures                           | [Integration tests](tests/integration), [ledger boundaries](tests/integration/ledger-boundaries.test.ts)                                            |
| HTTP, MCP, provider protocols, SDK contracts                            | Exercise serialization, validation, credentials, errors, and compatibility at the real transport boundary; validate generated clients | [Gateway tests](tests/integration/gateway.test.ts), [SDK tests](tests/unit/sdk.test.ts), [package acceptance](scripts/test-packages.ts)             |
| Dashboard interactions and application wiring                           | Playwright against the local application, with assertions on user-visible results and persisted changes                               | [Browser tests](tests/browser), [usage examples](tests/browser/usage.spec.ts)                                                                       |
| CLI commands, output, streams, or signals                               | Built CLI subprocess tests; POSIX PTY checks for interactive behavior                                                                 | [CLI tests](tests/cli/terminal.test.ts), [terminal acceptance](scripts/test-terminal.py)                                                            |
| Native harness or runtime image                                         | Actual image and harness acceptance against local protocol fixtures                                                                   | [Native acceptance](scripts/test-native.ts)                                                                                                         |
| Git, checkpoints, migrations, or recovery                               | Real temporary repositories/files, failure cases, and restore/upgrade evidence                                                        | [Git tests](tests/git-sync.test.ts), [snapshot failures](tests/unit/snapshot-failures.test.ts), [installation and restore](scripts/test-install.ts) |
| Scheduling, quotas, or worker concurrency                               | Deterministic lifecycle tests; isolated multi-worker load acceptance for capacity/fairness changes                                    | [Scheduling load test](tests/load/scheduling.test.ts)                                                                                               |
| Python client or cost calculations                                      | pytest with HTTPX transports; exact decimal expectations for costs                                                                    | [Python SDK tests](sdk/python/tests/test_client.py), [cost tests](tests/test_costs.py)                                                              |

Do not duplicate the full case matrix at every level. For example, a new cancel action needs domain lifecycle/error cases, concurrent database evidence if cancellation semantics change, and a focused UI journey proving the button reaches the API and displays the terminal result.

## Write tests that detect defects

1. Name the condition and expected outcome, such as “rejects an expired key without creating a run.” Arrange explicit fixtures, perform the action, then assert the contract. Keep each case focused; multiple assertions supporting one invariant are useful.
2. Check returned values and important state changes. For a rejected action, also check that protected state and external side effects remain unchanged. Assert stable error codes/statuses; assert exact prose only when wording is itself a contract.
3. Use parameterized cases for meaningful boundaries: absent/empty/malformed input, just below/at/above a limit, valid/expired/revoked credentials. Each case should be independently reported. Avoid large loops that obscure which scenario failed.
4. Await asynchronous actions and rejection assertions. Never swallow an exception to let a test pass. A mock call count or “did not throw” alone rarely proves the intended outcome.
5. Use typed fixture builders with explicit overrides and fresh identities. Avoid `any` or broad casts that hide invalid setup. Put intentionally malformed data at the untrusted input boundary being tested.
6. Keep expected results independent of the implementation. Do not calculate an expected balance using the same production function under test. Avoid large snapshots of incidental DOM, timestamps, or generated output; targeted assertions give clearer failures.

## Isolation, mocks, clocks, and concurrency

Use provider ports or transport handlers for deterministic external fixtures. Do not mock the domain service whose behavior is under test. Integration checks should exercise real local database, filesystem, and Git behavior where those semantics matter. Reject unexpected outbound requests in fixture transports; synthetic credentials must never fall back to real credentials. Explicitly override optional live discovery credentials in fixture subprocesses as well; disabling paid execution alone does not isolate free metadata requests.

Restore spies, replaced implementations, environment variables, globals, and timers after each test. Clearing a mock's call history does not restore its implementation. Be aware that `vi.mock` is hoisted before imports, and reset fake time with `vi.useRealTimers()`. Prefer explicit dependency injection over brittle import-order tricks. [Vitest mocking guidance](https://vitest.dev/guide/mocking.html).

Each test must own its mutable fixtures: tenant IDs, temporary directories, ports, subprocesses, and caches. Use teardown/finally blocks, release database connections, and terminate only processes created by the test. Do not delete shared preview data or stop somebody else's preview worker. Keep [Vitest](vitest.config.ts) and [Playwright](playwright.config.ts) concurrency settings unchanged unless fixture, pool, and port isolation have been demonstrated.

Inject clocks or use explicit timestamps for expiry tests. JavaScript fake timers do not advance PostgreSQL time. For races, use separate connections/transactions and barriers or observable events that establish the ordering being tested. `Promise.all` alone does not prove competing operations overlapped. Test committed outcomes after both operations finish; arbitrary sleeps are not synchronization.

### PostgreSQL and authentication

Run database tests through `pnpm test:domain` or `pnpm test:integration`. The [wrapper](scripts/test-domain.ts) provisions and removes a disposable database/object directory, including migrations and authentication setup. Calling Vitest directly for these tests bypasses that isolation. The preview worker can stay running against its separate database.

Use the restricted application role and the repository's tenant transaction helper for resource operations. An owner connection is appropriate for provisioning, not for proving tenant authorization: superusers and `BYPASSRLS` roles bypass row security, and table owners normally do too. [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

Prove fixtures exist before testing denial: verify authorized access succeeds and check affected row counts on setup updates. Otherwise, a filtered or missing row can produce a misleading “access denied” success. Exercise Better Auth integration with real isolated database state for session, membership, and revocation changes; mocked authentication alone cannot prove the login lifecycle.

All statements in one transaction must use its assigned client, with rollback/release on failure. Do not substitute independent `pool.query` calls inside a transaction. Follow the [database module instructions](packages/db/AGENTS.md), including credential-refresh pool separation. [node-postgres transaction guidance](https://node-postgres.com/features/transactions).

## Framework-specific rules

### Next.js, React, and dashboard data

Keep domain tests independent of Next.js. Exercise async Server Components through browser/application acceptance: Next.js documents that Vitest does not currently support them. Directly invoking a page function is not evidence of routing, hydration, or a working browser workflow. [Next.js Vitest guide](https://nextjs.org/docs/app/guides/testing/vitest).

The current rendered UI suite is Playwright. React Testing Library, user-event, and a DOM test environment are not installed. If focused synchronous component/hook tests become necessary, add shared support within Vitest, including `.test.tsx` discovery, DOM cleanup, and CI execution. Prefer DOM interactions to component internals. [Testing Library principles](https://testing-library.com/docs/guiding-principles/).

For isolated TanStack Query tests, create a fresh `QueryClient` per test and dispose of its cache. Disable query retries in the test client when testing a single failure; explicitly enable and assert retries when they are the behavior under test. Query-level settings can override client defaults. [TanStack's testing guide](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/testing.md).

For changed dashboard workflows, cover relevant loading, empty, success, error, and permission states. Test optimistic rollback and duplicate submission prevention when present. Check tenant/account changes cannot expose stale cached data. These are feature-specific cases, not a requirement to repeat every state for every presentational component.

### Playwright and accessibility

When a test holds requests behind an async barrier, release the barrier and wait for in-flight route handlers before removing interception. Removing a route while its handler still owns the request can create a test-only double-continuation failure.

Use role/accessible-name or label locators. Prefer `await expect(locator).toBeVisible()` and similar retrying assertions over immediate booleans. Avoid structural CSS selectors, positional selectors without a semantic reason, and fixed sleeps. Isolate browser contexts and account data, and investigate failure traces before changing timeouts or retries. [Playwright best practices](https://playwright.dev/docs/best-practices).

Exercise keyboard navigation, focus, accessible names, and error feedback for changed interactive controls. Use the existing axe integration for affected screens; automated scans do not replace interaction checks. Route mocks are useful for deterministic UI failures, but include an actual application-to-API journey for new workflows. Screenshots and traces must contain synthetic data only.

### API, clients, and Python

For contract changes, update OpenAPI, regenerate clients with `pnpm contracts`, and test actual requests/responses plus package entrypoints. Include applicable status codes, headers, validation errors, pagination, and authorization. For streams, cover split chunks, termination, reconnection/cursors, and cancellation. Compile-time types do not validate incoming JSON or prove transport compatibility.

Use pytest fixtures to own and clean up Python test state, and HTTPX `MockTransport` for deterministic client requests and errors. Verify request construction and response/error handling, including streaming where affected. Keep financial expectations exact with integer units or `Decimal`. [pytest fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html), [HTTPX transports](https://www.python-httpx.org/advanced/transports/).

## Critical behavior requires failure evidence

Apply the relevant rows whenever these responsibilities change:

| Area                         | Cases and invariants to protect                                                                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and tenant security | Valid access plus absent, expired, revoked, wrong-scope, wrong-project, and foreign-tenant credentials; applicable origin/OAuth/session boundaries; no secret disclosure; management MCP stays read-only. |
| Billing and spending         | Exact-limit boundaries, invalid amounts, duplicate and concurrent events, rollback, balanced immutable journals, reconciliation, and no platform-key fallback for BYOK.                                   |
| Runs and scheduling          | Duplicate dispatch, cancellation races, stale leases/fencing, worker failure, queue/plan limits, and terminal-state preservation; ambiguous side effects must not be replayed automatically.              |
| Persistent files and Git     | Partial writes, corruption, missing objects, unsafe paths/symlinks, restore failure preserving previous data, conflict/branch protection, and execution status independent of Git-sync status.            |
| Providers and connectors     | Local protocol success/error cases, credential selection/refresh, signed callback validation, timeouts/rate limits, and duplicate delivery; retry only operations whose semantics permit it.              |
| Reporting and administration | Accurate aggregates, date-window boundaries, tenant/operator authorization, duplicate-event handling, and exclusion of prompts, files, secrets, and raw bodies.                                           |

Schema changes also need migration and forward-recovery notes, plus verification against representative pre-migration data. Persistence changes need restore evidence, not just a successful write.

## Coverage and mutation testing

Treat coverage as a map of missing evidence. Inspect changed lines and branches, especially rejection and recovery paths; executing a line does not show that assertions detect a defect. There is no universal percentage that proves correctness. [Google's coverage guidance](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html).

Preserve the enforced global and module floors in [Vitest configuration](vitest.config.ts). Aim for at least **90% branch coverage of new or substantially changed critical logic**, with explicit tests of its invariants. This is a review target; it does not change current CI thresholds or impose 90% across the existing repository. Explain meaningful gaps and raise module floors as stronger evidence becomes stable. Do not lower gates, exclude application code, or add assertion-free tests to improve the score.

Run the complete `pnpm test:coverage` command when evaluating aggregate coverage; a targeted run is not a comparable baseline. Untouched application files remain included. [Vitest coverage guidance](https://vitest.dev/guide/coverage.html). The fast report covers in-process TypeScript. Use `pnpm test:coverage:all` for source-mapped browser, application server, worker and CLI observations, and add the native fixture observations as documented. Python remains a separate report. Label those evidence scopes accurately; [the CI reference](docs/engineering/testing.md) explains reporting limitations and the currently informational Codecov patch target.

Run `pnpm test:mutation` when changing its configured target or related tests. The fast [Stryker scope](stryker.config.json) covers runtime capabilities and execution-plan policy with a 90% gate. The separate scheduled/manual [critical scope](stryker.critical.config.json) covers delegated authority, financial logic and the restore routine with disposable PostgreSQL/files and an 85% gate. Review surviving and uncovered mutants for missing assertions. Record equivalent behavior or non-contract wording changes when they do not merit tests. Investigate timeouts/errors separately instead of treating them as demonstrated defect detection. Broaden mutation scope deliberately with deterministic fixtures; never mutate shared source or preview/production data. [Stryker configuration](https://stryker-mutator.io/docs/stryker-js/configuration/).

## Contributor workflow and completion

After [local setup](README.md#try-it-locally), start with the affected test file, then broaden to the suites justified by the change:

```sh
# Example: isolated database-backed regression checks
pnpm test:domain tests/integration/ledger-boundaries.test.ts

# TypeScript checking and complete unit/integration/Git coverage
pnpm check
pnpm test:coverage

# Documentation links and requirement evidence
pnpm docs:check
```

Add `pnpm test:e2e` for browser workflows, `pnpm test:cli` for CLI behavior, `pnpm test:packages` for distributable clients, `pnpm test:native` for runtime changes, or `pnpm test:load` for scheduling/capacity changes. Browser and CLI journeys require an explicitly configured local app/worker with synthetic test data; they do not use the disposable domain wrapper. Use `pnpm build` when Next.js routing, server/client boundaries, or build configuration changes. See [CI](.github/workflows/verify.yml) for installation/restore, Python, POSIX terminal, and image-specific invocations and prerequisites.

Run full acceptance before merging as configured in CI; do not repeat expensive suites after successful checks unless further edits, failures, or unresolved concerns justify it. Docs-only changes need documentation checks, not a new behavioral test or a local full-suite run.

A pull request should state:

- Which behaviors and failure cases changed, and which tests protect them; explain when existing tests suffice or no new test is appropriate.
- Commands actually run and their results, including meaningful coverage changes and any unexecuted checks.
- Remaining reproducible gaps or flaky failures with a concrete follow-up. Do not silently skip tests, weaken assertions, or add retries to conceal failures.
- Contract, migration, recovery, or provider-acceptance implications when applicable.

Default verification must make no paid model, sandbox, search, or connector calls and must need no production secrets. Live tests must be explicitly cost-free, isolated, and labeled separately from protocol fixtures. If credentials or spending authorization prevent vendor acceptance, record the exact operation, setup, expected result, and evidence still needed in the [pre-deployment checklist](docs/operations/pre-deployment.md). Passing simulation tests must never be reported as live provider verification.
