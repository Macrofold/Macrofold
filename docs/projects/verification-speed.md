# Verification speed

Keep feedback fast without weakening the gates. The Worker reconciliation measured the cost of the previous workflow: failures latent on `main` surfaced one CI gate at a time, and every fix was re-verified with a 25–30 minute serial local acceptance run.

## Scope and owners

| Change                                                          | Owner                                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required checks on `main`                                       | Repository ruleset `Main requires verification`                                                                                                                                                                                              |
| Targeted local loop and base-first triage                       | [TESTING.md](../../TESTING.md#keep-the-verification-loop-fast), [AGENTS.md](../../AGENTS.md#work-discipline), [rebase skill](../../.agents/skills/macrofold-rebase/SKILL.md)                                                                 |
| All-surface CI reporting and path-scoped application acceptance | [`verify.yml`](../../.github/workflows/verify.yml), [`scripts/coverage/all.ts`](../../scripts/coverage/all.ts)                                                                                                                               |
| Parallel domain files                                           | [`scripts/fixture-database.ts`](../../scripts/fixture-database.ts), [`scripts/test-domain.ts`](../../scripts/test-domain.ts), [worker database setup](../../tests/fixtures/worker-database.ts), [`vitest.config.ts`](../../vitest.config.ts) |
| Parallel browser workers                                        | [`playwright.config.ts`](../../playwright.config.ts), [browser fixture](../../tests/fixtures/browser.ts), [`scripts/seed.ts`](../../scripts/seed.ts), [`scripts/test-dashboard.ts`](../../scripts/test-dashboard.ts)                         |

## Decisions

- Application acceptance is skipped on pull requests that change no application path. `main`, the merge queue, schedules and manual runs always run it, so a scoping miss is caught before or immediately after merge. `Combined coverage gates` is the required aggregate and fails when any verification job failed.
- Domain isolation stays per database: scheduling, capacity and advisory locks are database-wide. Each Vitest worker gets a template clone of one migrated database. Load tests stay serial because they measure capacity.
- Browser workers sign in as identically seeded per-worker accounts by rewriting the demo sign-in in the fixture, so existing journeys need no edits. Files that depend on the demo principal, database fixtures or deployment-wide state run afterwards in a serial project.

## Verification and completion

Complete when the domain suite passes repeatedly in parallel (including a shuffled order), the full local acceptance passes with four browser workers, and this pull request's CI passes every required check. Results are recorded in the pull request.
