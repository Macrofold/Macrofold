# Trigger acceptance

[Feature architecture](../../features/triggers/implementation.md) owns implementation behavior. This record distinguishes local fixtures from live Slack and hosted execution.

## Local checks

Use the normal disposable database profile from [Run and test](../../getting-started/local-development.md):

```bash
pnpm test:domain tests/unit/trigger-policy.test.ts tests/integration/triggers.test.ts
pnpm test:dashboard:isolated tests/browser/triggers.spec.ts
pnpm check
pnpm test:sdks
```

The focused unit/integration suite covers exact-byte Slack signatures and replay windows, human-message filtering, cron/timezones, vendor response mapping, authenticated webhook idempotency, actual PostgreSQL tenant isolation, concurrent admission, workspace waiting, simulator execution, persisted checkpoints, history, cron outage coalescing, overlap, pause/resume, secret rotation, expiry, delegated revocation and uncertain replies. A subprocess fixture is killed after its reply lease commits to verify recovery without repeating execution or a Slack request. Financial cases verify one reservation under concurrent admission, no reservation after rejection, and exact release on queue expiry. Reply cases preserve the original destination after edits and fence a late acknowledgment from an earlier attempt.

Browser acceptance exercises webhook creation and one-time credentials, external HTTP intake through the actual Next route, worker admission, simulator output/tool history, refresh replay, scheduled prompt creation/editing/pause/run-now, and accessibility. Slack channel selection and discovery errors are browser protocol fixtures; the signed Slack-to-run-to-threaded-reply path uses the actual API/domain/SQL stack with a deterministic Slack provider fixture.

The focused suite passes **33 tests**: 15 policy/provider tests and 18 real-PostgreSQL integration tests. This includes the documented write-only administrator stop/delete scope and SDK channel pagination, scoped discovery rejection, provider errors, credential removal and disconnected intake. All five SDK acceptance suites pass, including Python's 150 cases with zero Pyright errors, Go's package tests, Rust's 12 cases, Java's 10 cases, and each language's API-to-simulator journey. Generation covers all 117 public management operations. Python tests explicitly load the current source package; package installation remains a separate check.

Ten isolated browser journeys passed across the new trigger views and existing dashboard, shared refresh and detailed stream recovery. A fresh frozen-source build then passed the three trigger journeys, including timezone display, plus real terminal and Python HTTP/SSE continuation. All four CLI subprocess cases pass on their isolated rerun without V8 collection; their preceding instrumented run timed out in three cases. Browser/CLI acceptance covers the final UI and execution/reply code; the subsequent internal scope correction is covered by strict checks and the final API/domain suite.

## Full-suite result and coverage gap

The final frozen-source run passes **571 unit, integration and Git tests in 77 files**. `pnpm check`, generated documentation checks and scoped formatting pass. Production dependency audit reports no vulnerabilities. Test databases, storage and servers are disposable; both existing previews remain healthy.

TypeScript domain coverage is **48.04% lines, 46.74% statements, 39.89% branches and 37.35% functions**. All assertions and other global/module floors pass, but **the function floor is 38%**, so `pnpm test:coverage` exits unsuccessfully. This is a remaining CI blocker, not an all-green coverage result. No threshold was lowered and no application file was excluded. The report keeps the full source inventory, including dashboard and concurrently developed marketing modules. Browser/server/worker/CLI observations were not merged into this domain percentage; Python and other SDK languages remain separate. Mutation scores and native-container acceptance were not rerun.

The [maintainer checklist](../../maintainers/TODO.md#trigger-release-acceptance) tracks the coverage shortfall. Add meaningful tests for uncovered behavior before release; do not substitute counter-only assertions or exclusions. The local browser results establish the trigger UI behavior without claiming domain coverage of its React callbacks.

No live Slack or paid model calls are part of these commands. Fixtures use disposable databases, files and loopback ports. An isolated source copy is used when concurrent edits prevent the browser build from establishing source provenance; the guard remains enabled. Diagnostic runs encountered host-load timeouts and correctly rejected builds whose sources changed. Those attempts are not acceptance passes.

## Remaining live acceptance

- Install a synthetic Slack app in a test workspace. Verify the exact public HTTPS request URL, signing secret, challenge, bot scopes, private-channel invitation and paginated channel listing.
- Send one human message, confirm one run and one threaded reply, and inspect persisted files. Test duplicate delivery and bot-loop exclusion. Confirm Slack acknowledges events within three seconds under expected cold-start/database conditions.
- Revoke the app or `chat:write` access and confirm visible failures. Exercise rate-limit rejection in a controlled fixture; do not intentionally flood Slack.
- In isolated cloud staging, verify the existing Vercel maintenance cron is authenticated and firing every minute. Observe a scheduled occurrence, workspace waiting, outage coalescing, pause and worker recovery.
- Use an explicitly approved budget for a real native-agent run and verify end-to-end model/compute billing. Local simulation does not prove native/cloud providers.
- Measure trigger throughput and receipt-table growth before raising the intake/job-batch limits. No capacity or latency SLA is established by local functional tests.
