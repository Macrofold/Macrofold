# Repository review and acceptance

This record covers the repository-wide review and its local acceptance. [Testing and CI](../testing.md) owns current coverage and gates; [release TODO](../../maintainers/TODO.md) owns deferred improvements and cloud acceptance.

## Scope and method

The first pass read authored application code, tests, scripts, migrations and configuration, tracing authentication, accounting, execution, persistence, streaming and user journeys across their callers. The working inventory contains 418 files: 410 authored files and eight schema/generated/data artifacts. The inventory excludes installed dependencies, third-party skills, build output, credentials, and private runtime/customer data. OpenAPI was reviewed as a contract; generated declarations, routes, documentation, the connector catalog and lockfile were checked through their owners and validation rather than treated as handwritten application logic.

The second pass focused on the resulting changes and sibling integrations, generated contracts, stale scope/scaling documentation and the new browser test’s request-interception cleanup. This was a focused follow-up, not another complete repository-wide pass. The third full pass remains outstanding in the [review follow-ups](../../maintainers/TODO.md#review-follow-ups). Passing tests do not establish that every possible defect has been found.

Changes preserve the existing provider/domain boundaries, PostgreSQL scheduler, Vercel topology, detailed run replay and financial journal. No service, queue, production dependency, migration or infrastructure change was needed. Existing unrelated working-tree changes are preserved.

## Corrected behavior

| Area | Correction and regression evidence |
| --- | --- |
| Admission and billing | New runs snapshot the compute rate and reject budgets below their compute window before reserving funds. Integer rounding, the admission boundary, cancellation release, operator rate changes and single settlement are tested. |
| Stripe accounting | Invalid top-ups fail before external customer creation. Complete/expired checkout identities cannot open another checkout. Dispute reconciliation fetches authoritative status under the accounting lock; equal-timestamp and out-of-order events, interrupted lookup and refund overlap preserve balances. |
| Identity and consent | Malformed OAuth cookies return invalid state before a provider call. GitHub and MCP flows accept framework request proxies, preserve browser/user binding and reject replay. CLI logout shares the refresh lock and revokes the current token before local removal. |
| Files and Git | Editor saves and staged replacements preserve existing executable modes. New-file creation checks the authoritative path, including files outside the current listing. Selection and mutation controls remain disabled through save/refetch completion. Content and Git tree modes are asserted. |
| Execution and streaming | Cancelled input requests reject late answers. Detailed SSE prefetch is bounded to one event page, with ordered replay and abort/timeout/cancel cleanup. Native startup failures reject cleanly without an unhandled parallel promise. |
| CLI | Success requires verified persistence. Omitted runtime uses the account-capped server default. File pulls preserve existing permissions; uploads have a bounded timeout and release response bodies. |
| Dashboard | Failed grant reads prevent accidental permission changes and offer retry. Shared clipboard handling reports success only after the write succeeds. Persistence copy reflects verified state. Documentation lists retain bullets/numbers and duplicate selector styling is consolidated. |
| API and query cost | Malformed route escapes return a client error. Diff pagination selects paths before reading their content and replaces repeated linear lookups with maps. OpenAPI security references/scopes and CLI queue/exit metadata match current behavior. |

Relevant behavior is maintained in the [billing](../../features/billing/implementation.md), [identity](../../features/identity-integrations/implementation.md), [workspace](../../features/workspaces/implementation.md), [execution](../../features/execution/implementation.md), [CLI](../../features/cli/implementation.md), and [dashboard](../../features/dashboard/implementation.md) references.

## Acceptance evidence

The complete domain suite passes **458 tests in 66 files**, including unit, PostgreSQL integration and Git tests. A subsequent six-case contract run also verifies the added CLI scope-catalog assertion. Coverage includes **193 application files**, including untouched files: **51.08% lines, 49.76% statements, 40.15% branches and 41.32% functions**. Python is measured separately: **21 tests**, **95.26% statements / 82.81% branches**, and a **92.13%** combined coverage.py score.

The rebuilt native image passes all three harnesses' execution, checkpoint restore and conversation continuation, plus OpenCode input and stdio MCP isolation/duplicate-dispatch prevention, with external networking disabled. Fresh installation and a separate database/object/key restore pass, as do portable CLI/TypeScript SDK tarball installation. The private fixture environments are disposed of after use.

Strict TypeScript, document/link checks, generated contracts and the dependency vulnerability audit pass. The audit reports no known vulnerabilities in the resolved dependencies; this is not a guarantee against undisclosed vulnerabilities. Fast mutation testing kills **70/75 mutants (93.33%)**, with five explanatory-string survivors and no timeouts or uncovered mutants.

Fresh application acceptance passes **35 browser journeys**, four CLI subprocess cases, a real terminal journey and Python HTTP/SSE continuation. Combined TypeScript coverage is **69.65% lines / 54.34% branches**, with required browser, server, worker, CLI and native observations. Extended mutation testing scores **90.74%**: 293 assertion kills, one timeout and 30 survivors across 324 mutants. See the [testing summary](../testing.md) for full report scope and the [mutation record](mutation.md) for survivor interpretation. Initial browser runs found a save/dialog race, an inherited Composio discovery credential, an obsolete clipboard assertion, and a race in the new test's interception cleanup. Those failures were retained as evidence and corrected; failed runs are not represented as successful acceptance.

All **11 load/dispatch cases** pass with the existing timeout gates: the 93-job mixed workload reaches eight shared slots with no violations in 1,594 samples; four newly arriving accounts wait 390–677 ms locally. The 60-job Scale cohort reaches 50 active slots without exceeding the ceiling. Cancellation, expiry, worker loss and recovery preserve execution identity and settlement. See [scheduling measurements](../../features/execution/scheduling.md#verification-and-measured-limits) for scope and timing.

## Measurement and deployment limits

Local fixtures use disposable PostgreSQL databases/filesystems, independent server builds/ports and simulated providers. They do not attach to or stop the running preview. No paid provider call was made. One initial free catalog metadata lookup exposed inherited developer credentials; ordinary acceptance now explicitly disables live catalog discovery as well as paid execution.

Coverage uses canonical source maps and a conservative union of observations. Native vendor internals, compiler-unmappable branches, abrupt process termination and unexercised code remain subject to the [measurement limits](coverage.md). Runtime-container acceptance here is local Linux ARM64; hosted Linux AMD64 CI and Vercel/Neon/R2 behavior require the [pre-deployment checklist](../../operations/pre-deployment.md).

Deferred work includes large individual-file diff memory, browser Back/Forward draft recovery, device-login interruption during polling, and legacy runs accepted before compute-rate snapshots. These remain in [review follow-ups](../../maintainers/TODO.md#review-follow-ups); their existence is not a reason to add speculative abstractions now.
