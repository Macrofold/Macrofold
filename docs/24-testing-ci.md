# Testing, coverage, and releases

For when and how to write tests, follow [the contributor testing rules](../TESTING.md). This document covers execution, reporting, configured CI gates, and release evidence.

## Implemented CI

GitHub Actions already existed in `.github/workflows/verify.yml` for pull requests, pushes to `main`, and manual dispatch. This update adds merge-queue events, V8 coverage reports and gates, optional public Codecov uploads, and a focused mutation job. Native runtime acceptance now runs separately so image builds do not delay other results.

| Job                                 | Verification                                                                                                                                                                                                                   | Provider boundary                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `acceptance`                        | Strict TypeScript, optimized web build, unit/integration/Git coverage, installation/restore, package installation, Python SDK/cost tests, documentation, generated contracts, audit, browser, CLI, and POSIX terminal journeys | Disposable PostgreSQL and local storage; upstream provider fixtures; no paid execution |
| `Native runtime image`              | Builds the current runtime Dockerfile, tests all three real harnesses, OpenCode input, and stdio MCP                                                                                                                           | Runtime containers use `--network none`; builds download public dependencies           |
| `Runtime capability mutation tests` | Deliberately alters runtime credential validation and checks whether tests detect the faults                                                                                                                                   | Temporary source copy, synthetic keys; no database or provider calls                   |

Jobs use GitHub-hosted runners, read-only repository permissions, pinned action commit SHAs, and checkout without persisted credentials. Fork tests receive no production secrets and never use `pull_request_target`. Dependabot proposes weekly action-pin updates for review.

This is implemented workflow configuration, not evidence of a successful GitHub-hosted run. The checkout has no GitHub remote at this update. CI does not deploy, publish packages/images, apply production migrations, or enable paid execution.

## Local commands and reports

After the README's one-time local setup:

```sh
pnpm check
pnpm test:domain
pnpm test:coverage
pnpm test:mutation
```

The database test wrapper refuses paid execution, creates an independent database and temporary object directory, migrates them, and removes them afterward. It does not reset the preview database or require stopping its worker.

`test:coverage` runs the same in-process TypeScript unit/integration/Git suite as `test:domain`. Open `coverage/index.html`; use `coverage/coverage-summary.json` for machine-readable totals and `coverage/lcov.info` for Codecov. CI retains coverage and mutation artifacts for seven days. Reports are generated after test failures too.

The large-upload test retains its six-megabyte payload and integrity assertions with a three-minute timeout. It passed without instrumentation and exceeded its old one-minute timeout under V8 coverage; the allowance addresses that measured overhead.

## Coverage scope and baseline

The report includes application source in core, database, providers, runtime, CLI, TypeScript SDK, and web directories, including untouched files. Generated API route metadata and declaration files are excluded; build outputs and configuration/scripts are outside the declared application-source scope.

Separate Playwright server/browser processes, CLI subprocesses, native Docker processes, and Python are **not instrumented by this report**. Their tests remain acceptance evidence, but their executed lines are not credited here. Low UI/native percentages expose missing in-process coverage evidence; they do not mean those features have no acceptance tests.

| Scope                                     |  Lines | Branches |
| ----------------------------------------- | -----: | -------: |
| All included TypeScript application files | 46.34% |   36.72% |
| Runtime capability validation             |   100% |     100% |
| Credit ledger                             |   100% |   90.32% |
| Run admission, input, and cancellation    | 95.69% |   90.36% |
| Snapshot capture/event probe              | 97.05% |   86.11% |
| Snapshot restore                          | 83.58% |   78.94% |
| Authentication integration                | 86.51% |   59.67% |

This is the September 6 local baseline, not a replacement for subsequent CI reports. Authentication's remaining branches still warrant expansion, especially email/OAuth/session failure combinations.

Vitest enforces measured global floors and stronger file-specific floors for security, the ledger, run/cloud lifecycle, and persistence. Ledger and run branches must remain at least 90%; runtime capability coverage must remain 100%. Raise floors as tests improve. Do not lower them or exclude untested source merely to pass CI.

When enabled, Codecov also compares overall coverage with the base commit, allowing a 0.1 percentage-point tolerance. Its changed-line target is 80%, initially informational because browser/subprocess instrumentation is absent. Local coverage floors remain mandatory without Codecov.

## Tests added

The update adds 122 independently reported cases in four unit files and three integration files. The TypeScript suite has 216 passing cases in 42 files, including 114 TypeScript unit cases. Four Python SDK and three Python cost cases remain separate.

- **Authorization/authentication:** Role/scope/project combinations; absent credentials; browser origins; foreign tenant selectors; operator audiences; expired/revoked keys and sessions; verification/membership changes; delegated execution grants; invitation identity and concurrent acceptance.
- **Money:** Exact limits, each financial hold, invalid amounts, concurrent duplicate funding/refunds/settlement, integers beyond Number precision, transaction rollback/retry, and expiration boundaries. PostgreSQL checks verify balanced journals and agreement between lots, debt, and balances.
- **Persistence:** Corrupt bytes/sizes/hashes, missing chunks, unsafe paths/namespaces, duplicate entries, symlinked roots, and byte/entry limits. Failed verification retains the previous destination and cannot publish a partial checkpoint index.
- **Execution:** Concurrent cancellation, preserved terminal results, expired queues, duplicate dispatch, competing/stale/late answers, timeout/budget limits, and incompatible or foreign BYOK credentials.

Existing provider protocol, billing-event, interrupted execution, fencing, restore, and browser tests remain. Local coverage does not replace authenticated vendor acceptance in the pre-deployment checklist.

## Enable GitHub checks and a live coverage badge

1. Publish the repository with `main` as its default branch. Enable Actions with read-only default permissions. Retain approval requirements for first-time external contributors; do not send secrets or write tokens to forks.
2. Inspect the first Actions run. In branch protection/rulesets, require `acceptance`, `Native runtime image`, and `Runtime capability mutation tests`. Review changes to permissions and coverage configuration. The workflow also supports merge queues through `merge_group`.
3. Connect the public repository to Codecov. Enable its documented tokenless public uploads in organization upload-token settings. Set the GitHub Actions repository variable `CODECOV_ENABLED` to `true`. This workflow supplies no Codecov secret and uploads only for public repositories. Private repositories need a separately reviewed authenticated configuration.
4. Run CI on `main` to establish the base report. Check its repository, commit, branch, and `typescript` flag. An enabled upload fails CI if publication fails.
5. Copy the coverage badge from Codecov's repository **Settings → Badges & Graphs** into the README, linked to the detailed report. Add an Actions badge if desired. Templates below require the actual owner/repository; none is invented in this checkout.

```markdown
[![CI](https://github.com/OWNER/REPOSITORY/actions/workflows/verify.yml/badge.svg)](https://github.com/OWNER/REPOSITORY/actions/workflows/verify.yml)
[![TypeScript coverage](https://codecov.io/gh/OWNER/REPOSITORY/branch/main/graph/badge.svg)](https://codecov.io/gh/OWNER/REPOSITORY)
```

A badge is a useful current summary and link to evidence, not a correctness or production-readiness certificate. Keep the scope explanation and branch/changed-line reports alongside it. Until the repository is connected and receives coverage, retain the README setup link instead of a fabricated percentage or broken URL.

## Mutation testing

Coverage asks whether code executed. Mutation testing asks whether tests notice an introduced defect. Changing `expires > now` to `expires >= now` should fail the exact-expiry test; removing production-configuration enforcement should fail its security test.

Stryker runs the existing Vitest tests in a temporary source copy (`inPlace: false`). A mutant is _killed_ when a test fails, _survives_ when tests still pass, or has _no coverage_. Review survivors: they may indicate missing assertions, equivalent behavior, or changed error wording. The report separately lists kills, timeouts, survivors, uncovered mutants, and errors.

The initial scope is `packages/core/src/runtime-auth.ts`, with a 90% minimum mutation score. This small check runs on every supported CI event. Open `reports/mutation/mutation.html` or its JSON counterpart. Additional tests followed the first report's missing production-configuration and authorization-header cases. The score describes this single module only.

The verified local result is **40 of 44 mutants killed (90.91%)**, with zero timeouts, uncovered mutants, or errors. The four remaining survivors replace explanatory error-message strings; authorization decisions and stable error codes are asserted. A deliberately incomplete coverage run also verified that unmet coverage floors exit unsuccessfully even when its tests pass.

Expand into other isolated security/financial functions gradually. Whole-application mutation on every push would repeatedly need clean databases, deterministic time, and proof that no real external action can occur. A later scheduled job can cover broader scopes. Never run mutations against preview/production data.

## CD plan and the local preview

The local preview needs no architectural upgrade. It runs the optimized standalone web application and source worker on the host with PostgreSQL/Mailpit. Docker images are independent snapshots: source edits do not refresh an older image.

For the accepted **Vercel-first topology**, Vercel builds web/Workflow from the selected commit, while the native agent runtime is built for Linux AMD64 and published to Vercel Container Registry. Web/worker Docker images serve the standalone alternative; rebuild and test them when deploying that topology. Record the release commit and immutable runtime digest together.

The planned release sequence after account/infrastructure setup is:

1. Merge a reviewed commit after all required CI checks pass. Use that exact commit as the release candidate.
2. Build the selected artifacts from it. Test the resulting native image without source overlays; smoke-test freshly built web/worker images for standalone hosting.
3. Deploy staging with separate data/credentials and migrations applied through the migration role. Verify health, login/email, callbacks, API/CLI streaming, persistence/restore, and account configuration. Keep paid execution off until a separately budgeted vendor test is authorized.
4. Configure a GitHub `production` environment with required reviewers. A future deployment workflow should accept only verified release artifacts, use narrowly scoped credentials, and record deployment identity, runtime digest, migration version, and smoke-test evidence.
5. Promote that artifact set. Retain the previous deployment/digest for application rollback; follow migration forward-recovery guidance instead of blindly reversing data/schema changes.

Automatic production deployment is not enabled by this update. Accounts, domains, credentials, registry publication, and cloud acceptance remain operator steps. Once configured, CD should build once, verify, and promote the same artifacts, addressing the old-image discrepancy without changing the preview architecture.

## References

- [Vitest coverage](https://vitest.dev/guide/coverage.html)
- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)
- [Codecov action and tokenless public uploads](https://github.com/codecov/codecov-action)
- [Codecov badges](https://docs.codecov.com/docs/status-badges)
- [Stryker Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)

The scheduler update adds `pnpm test:load` as a separate CI command. It creates a fresh PostgreSQL database so intentionally unfinished lifecycle fixtures cannot influence fairness measurements. It runs three independent simulated-worker processes, burst/sustained traffic, later arrivals, cancellation/expiry, actual worker termination, restart, and a 50-slot cohort. It produces no provider charges. Run heavy builds and load measurements sequentially; host contention changes observed latency and is not a product SLA.
