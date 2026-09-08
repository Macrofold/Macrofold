# Testing and CI

Follow [TESTING.md](../../TESTING.md) for test selection, isolation, failure assertions and review evidence. [Implementation status](../status/README.md) distinguishes implemented behavior from hosted vendor acceptance. This pipeline verifies the application; it does not deploy production infrastructure.

## Where to start

- [Run and test](../getting-started/local-development.md): the short developer path, three execution environments, and what each test level proves. [Implementation](development-modes.md) and [acceptance evidence](testing/development-modes.md) cover the shared Docker/cloud journey runners.
- [Coverage collection](testing/coverage.md): measured source inventory, browser/server/CLI/native collection, source-map validation, merging, fallback limits and commands.
- [Repository review](testing/repository-review.md): review scope, corrections, local acceptance and deferred improvements.
- [Gap audit](testing/gaps.md): existing protection, meaningful new tests and remaining failure paths.
- [Resource SDK acceptance](testing/sdk-resources.md): generated methods in five languages, typed inputs/responses, constructor defaults, and local API journeys.
- [Trigger acceptance](testing/triggers.md): signed Slack intake, authenticated webhooks, scheduled prompts, isolated dashboard journeys and remaining hosted checks.
- [SDK and autosave acceptance](testing/sdk-and-draft-acceptance.md): current focused verification, installed packages, process-kill recovery, and remaining limits.
- [Mutation testing](testing/mutation.md): fast versus scheduled scopes, assertions added from survivors and remaining equivalent or unproven cases.
- [Live integration acceptance](testing/live-integrations.md): explicitly budgeted provider calls, measured adapter behavior, reusable commands and remaining account/deployment checks.
- [Pre-deployment checks](../operations/pre-deployment.md): authenticated vendor and deployed infrastructure acceptance that local fixtures cannot establish.

## Commands and report scope

```sh
pnpm check
pnpm test:domain
pnpm test:coverage
COVERAGE_DIR=coverage/my-run pnpm test:coverage:all
pnpm test:mutation
pnpm test:mutation:critical
pnpm docs:check
```

The domain wrapper creates and removes a disposable database and object directory. Complete coverage adds a separately built standalone server, simulator worker, browser contexts and CLI subprocesses on an independent loopback port. It does not attach to or stop the preview. Complete runs require a new report directory; reused artifacts or source-map contents from another source revision are rejected.

`coverage/domain` is the fast in-process report. A complete run writes canonical coverage, raw observations and `merged` HTML/LCOV/JSON beneath its `COVERAGE_DIR`. Python XML/JSON stays in `coverage/python`. Reports preserve untouched application files. See the collection reference for conservative matching and Chromium/native-worker limitations.

## Current focused verification

The trigger follow-up passes **571 domain tests in 77 files**, including 33 focused trigger tests, all five local SDK journeys, three focused browser journeys plus preserved dashboard/stream coverage, four CLI subprocess cases, real terminal and Python HTTP/SSE continuation, and strict type checks. The domain report is **48.04% lines, 46.74% statements, 39.89% branches, and 37.35% functions**. The unchanged 38% function floor remains a CI blocker; other global/module floors pass. Browser observations were not merged and Python coverage was not recomputed. [Trigger acceptance](testing/triggers.md) records source isolation, successful reruns, report limits and live checks. [Resource SDK acceptance](testing/sdk-resources.md) retains the separate packaging, generation, streaming and Python coverage evidence.

## Previous SDK and autosave verification

The SDK, autosave, diff-memory, and failure-path changes pass **499 domain tests in 67 files**, eight focused dashboard journeys, four CLI subprocess cases, the real PTY journey, and Python HTTP/SSE continuation. Fresh Python installation passes 21 tests. Go/Rust/Java pass 7/6/4 tests respectively, including real local API/simulator execution. Strict TypeScript and the dashboard's production build pass. [Acceptance details](testing/sdk-and-draft-acceptance.md) record source scope, Docker/SMTP limitations, and concurrent marketing edits.

The complete domain report for that change covers 200 application files: **51.01% lines, 49.74% statements, 40.50% branches, and 40.66% functions**. Existing global/module floors pass. Full combined coverage and mutation scores were not recomputed; the broader measurements below belong to the preceding full repository review.

## Previous full repository verification

The [repository review](testing/repository-review.md) passes **465 tests in 67 files** in the complete domain suite. The isolated optimized application build passes **47 browser journeys**, including all ten marketing concepts, four CLI subprocess cases, the real POSIX terminal journey and Python HTTP/SSE/continuation acceptance. Strict TypeScript, fresh installation and independent backup/key/object restoration, package installation, documentation and generated-artifact checks pass.

| Report                                   | Lines/statements                | Branches | Functions    |
| ---------------------------------------- | ------------------------------- | -------- | ------------ |
| TypeScript domain, 200 application files | 50.93% lines; 49.60% statements | 39.98%   | 40.61%       |
| TypeScript combined                      | 69.51% lines; 67.62% statements | 54.24%   | 54.28%       |
| Python, 21 tests                         | 95.26% statements               | 82.81%   | Not measured |

The combined report unions the passed domain report with fresh browser/server/worker/CLI acceptance and current-source native-container observations from matching source content. Earlier browser failures are recorded as diagnostic evidence and are not the final application acceptance. Global/module gates pass; deliberately zeroed module and global copies fail the actual gate CLI. No exclusions or lowered floors were introduced. The denominator now includes seven additional marketing modules; build-time static rendering remains unmeasured, even where browser journeys verify the resulting HTML.

Python's coverage.py statement/branch score is 92.13%, above its separate 90% floor. The Linux ARM64 image passes execution, checkpoint restore and native continuation for Codex, Claude Code and OpenCode, plus OpenCode input and stdio MCP isolation/deduplication with external networking disabled. GitHub-hosted Linux AMD64 and deployed startup under load remain separate acceptance checks.

The ledger, delegated authorization, runtime capabilities, plan policy and adaptive queue timing retain 100% line/branch coverage. Run admission/cancellation has 93.69% branch coverage. Remaining critical targets include authentication (67.74%), cloud phases (77.77%), snapshot capture (86.11%), restore (86.84%), MCP OAuth (45.83%) and CLI credential/profile handling (57.50%). These stay visible in the [gap audit](testing/gaps.md). Fast and extended [mutation scores](testing/mutation.md) are 93.33% and 90.74%; the latter includes one timeout, distinct from assertion kills.

These are local measurements over disposable databases/files and deterministic providers. They do not establish vendor correctness, hosted capacity or production readiness. All 11 local load/dispatch cases pass with unchanged gates; measured results belong to [execution scheduling](../features/execution/scheduling.md#verification-and-measured-limits).

## Enforced gates

Domain TypeScript floors are **48% lines, 46% statements, 38% branches and 38% functions**. Application acceptance adds browser/server/worker/CLI observations and requires **63/61/48/49%** respectively. The final combined job includes native observations and requires **65/63/50/51%**. Missing native evidence fails that job. Runtime capabilities, the ledger, delegated authorization, plan policy and adaptive queue timing require **100%** coverage in all reports. Run admission/cancellation retains its 90% branch floor. Other existing module floors remain enforced for authentication, cloud execution, snapshot capture and restore. [The shared policy](../../scripts/coverage/policy.ts) is authoritative for Vitest and both supplemental gates.

Aim for 90%+ branch coverage of critical logic. Untested provider/UI branches remain visible; do not remove files or add assertion-free tests to hit a target. Independent domain gates must pass before broader acceptance, and combining reports cannot hide a domain regression. Combined CI additionally requires actual mapped observations from each configured surface. Python has its own coverage.py floor and never contributes to the TypeScript percentage.

Negative checks deliberately zeroed the runtime-capability branches and then all application counters in copies of a real report. The actual gate CLI exited unsuccessfully in both cases. Removing all supplemental observations also fails the higher combined floor. Mismatched source artifacts, including a cached runtime image containing an older source file, were rejected by the stale-source guard.

## GitHub Actions

| Job                                | Purpose                                                                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acceptance`                       | Strict TypeScript, production/coverage builds, domain and browser/CLI coverage, load/installation/package checks, Python and cost tests, documentation, generated contracts, dependency audit. |
| `Generated SDK contracts and transports` | Pinned generation drift, all five resource journeys, Python type checking, native HTTP/SSE fixtures, and actual API/simulator execution on a disposable database. |
| `Native runtime image`             | Current Docker image, three real harnesses, restore/continuation, OpenCode input and stdio MCP with external networking disabled; native coverage observations.                                |
| `Combined coverage gates`          | Merge observations from that workflow run, require mapped surfaces, enforce shared floors, retain reports and optionally upload distinct TypeScript/Python Codecov flags.                      |
| `Critical policy mutation tests`   | Fast runtime-credential and execution-plan mutation checks on PR/push/merge-queue/manual events; 90% minimum.                                                                                  |
| `Extended critical mutation tests` | Separate weekly/manual workflow for database authorization, financial and restore mutations; 85% minimum with a 90% target.                                                                    |

Workflows use pinned actions, read-only repository permissions, checkout without persisted credentials and synthetic local profiles. Fork jobs receive no production secrets, do not use `pull_request_target`, and make no paid provider calls. The scheduled job provisions only disposable fixture infrastructure. Evidence is retained for seven days. Failed tests remain failures even when other surfaces and reports are collected afterward.

These are implemented workflow definitions; a local pass does not establish a GitHub-hosted run. Runtime image builds can download public dependencies. CI does not publish packages/images, migrate production databases or enable paid execution.

## Codecov and branch protection

Repository rulesets require the acceptance, native runtime, combined coverage, and critical mutation checks. The optional Codecov upload uses `CODECOV_ENABLED=true` with approved tokenless public uploads and separate TypeScript/Python flags. Forks receive no production or upload secrets. Enabled upload failures fail the job.

Coverage comparisons supplement the mandatory local/global/module floors. Repository connection, first hosted verification, and badge activation are tracked in [release TODO](../maintainers/TODO.md).
