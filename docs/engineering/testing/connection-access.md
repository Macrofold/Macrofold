# Connector access implementation and activation

The [public guide](../../features/identity-integrations/connection-access.md) owns user/API semantics. This record describes implementation boundaries and local acceptance; it does not establish live provider or cloud acceptance.

## Owners and boundaries

- `packages/core/src/connection-access-policy.ts`: vendor-independent rule shapes, matching semantics, source priority and selection precedence.
- `connection-access.ts`: tenant-aware SQL matching, bounded explanations and cursor queries, access ownership, compare-and-swap writes and audit records. Contextual browsing and execution candidate queries share its persistent eligibility predicate; owner/type and version preconditions are shared across access mutations. Read and write scope checks remain specific to each operation.
- `connection-access-resolution.ts`: persisted previews, full admission, frozen account/tool snapshots and current-policy revalidation. No provider discovery or credential refresh.
- `runs.ts`: verified session/preset provenance and admission. `tool-broker.ts`: run-then-connection lock order at final dispatch, durable call identity and fees. OAuth refresh retains its separate credential transaction and never executes under an access-row lock.
- `apps/web/lib/connection-access.ts`: shared revision cache and explicit retry after 412. Tools and Access reuse this hook; resource selectors share server search and cursor pagination. Run selection and one-run exceptions remain local to their context.
- `docs/api/openapi.json`: strict named request/response models and generated clients. The Python generator supports root discriminated request unions. The Go generator's nullable-array correction preserves omission, explicit null and empty lists; Java enables `JsonNullable`.

Access state lives in explicit connection columns plus `connection_access_rules`. Same-row shape checks, tenant composite foreign keys, uniqueness and forced RLS enforce storage invariants. Rule writes lock the connection and update its access version with the audit in one transaction. Provider discovery for newly approved tools happens before this lock and is followed by a revision recheck. Soft-deleted targets become inactive; hard purge cascades their rules. Accepted snapshots contain no secret or copied rule table.

## Coordinated activation

Migration **032_connection_access.sql** and the matching application activate together. Stop new admission (`RUN_ADMISSION_ENABLED=false`), stop trigger scheduling, and allow accepted development runs to finish. Confirm no queued, provisioning, running, waiting-for-input, or persisting runs remain. Do not rewrite an accepted snapshot to make it fit a new policy.

Apply `pnpm db:migrate` with the migration identity, restart the API and worker on the same code revision, then restore admission/scheduling. Check Connections → Tools/Access and a free simulated run. Keep migration credentials out of the serving environment.

The migration preserves connection IDs, names, encrypted credentials and connected-account identity. It carries forward approved tools and only an explicit old organization grant; owner-only grants do not become execution authority. Old `grants`, `shared` and subject authorization keys are removed from connection JSON. Runs and sessions are not rewritten. Reconnection and rename retain the same policy row. No runtime compatibility adapter is retained for the replaced grants endpoint.

## Acceptance

Use disposable databases through the repository test scripts. The migration regression reconstructs the previous columns inside a rollback-only transaction, asserts the fixture database name before DDL, migrates representative account/tool configurations, and compares retained credential identity and accepted run/session history.

Admission-only access fixtures cancel their own queued runs during teardown. Leaving those runs eligible can block unrelated lifecycle tests through the shared fair scheduler even when both files pass independently. The staging release check reproduced this with access-runtime followed by growth/deletion in one disposable database; the same sequence passes with scoped cancellation, without changing application scheduling or test assertions.

Focused tests cover rule truth/SQL parity, crossed pairs, scoped browsing, owner/admin separation, independent read/write scopes, demoted-owner reductions, RLS and tenant foreign keys, quoted revisions, stale/duplicate requests, idempotent ETags, bound cursors, unavailable targets, optional expansions, missing selections/exceptions, selection presence, saved preset provenance, trigger admission and dispatch/revocation ordering. Rejected mutations leave the policy, revision and audit unchanged. Preview never offers tool-access exceptions for model or subscription connections. SDK acceptance exercises generated request bodies and nullable selection semantics. Browser acceptance uses the isolated API for rule management, stale drafts across tabs, filters and mobile accessibility.

Required commands: `pnpm sdk:generate:all`, `pnpm check`, `pnpm test:sdks`, `pnpm test:dashboard:isolated`, `pnpm test:coverage`, `pnpm test:cli`, `pnpm docs:generate`, and `pnpm docs:check`. Existing coverage floors remain unchanged. See [maintainer TODO](../../maintainers/TODO.md) for live release work.

## Local activation evidence

Migration 032 was applied to the existing unpaid local preview after verifying zero active runs, zero enabled triggers and no preview worker. API admission was briefly paused for the bounded migration and resumed in `finally`; the serving process was preserved. Database comparisons verified unchanged identity/content for all 40 connections and unchanged history for all 89 runs and 67 sessions. The existing signed-in browser successfully loaded Connections and its Access dialog afterward. No existing access policy was broadened manually and no external connector was invoked.

This local activation does not replace the coordinated staging API/worker rehearsal above. Execution acceptance uses disposable databases and separate simulator workers.

## Verified local results

Acceptance ran on macOS with Node 24.13.0, disposable PostgreSQL databases, loopback API origins and the free simulator. Provider boundaries use scripted transports; no paid model, sandbox or connector execution was enabled.

| Surface | Observed result | Evidence |
| --- | --- | --- |
| Domain and coverage | 858 tests in 104 files passed. All unchanged global/module gates passed; functions 38.28% against the 38% floor. | `/tmp/agentcloud-access-coverage-final.log` |
| Generated SDKs | TypeScript, Python, Go, Java and Rust suites passed; Python has 161 tests and a clean Pyright result. Includes actual local API/simulator journeys and nullable selection serialization. | `/tmp/agentcloud-access-sdks-final.log` |
| Full browser inventory | 150 passed, 10 initially failed, six unrelated video-export cases intentionally skipped because `SWARM_EXPORT_ACCEPTANCE` was not enabled. Failures were corrected and rerun below; this is not a claim that the original full invocation passed. | `/tmp/agentcloud-access-browser.log` |
| Focused application rerun | 26 browser cases passed; the access-editor case required a further regression fix. All six built CLI tests, real PTY interaction and the Python live-API continuation passed. | `/tmp/agentcloud-access-browser-final.log` |
| Access-editor regression | Passed stale two-tab edits and explicit retry, duplicate-rule errors, all rule scopes, paging, independent URL filters, mobile accessibility, pending-selection submission guard, context reset and a completed simulated exception run. The wrapper also passed all six CLI cases, real PTY and Python continuation. | `/tmp/agentcloud-access-browser-verified.log`; `coverage/connection-access-browser-verified/screenshots/connection-access-mobile.png` |
| Static checks | Strict TypeScript, optimized standalone application builds, generated contracts/clients, whitespace checks and documentation generation/link validation passed. | `/tmp/agentcloud-access-check-complete.log` and application logs above |

The corrected browser runs cover all ten failures from the full inventory. They found and fixed a restored one-run exception when switching away from and back to a preset, in addition to updating old worktree/tool-label assertions and waiting for completed dialog exits. The CLI regression verifies that omission inherits, explicit connection selection works with a preset and session continuation, and `--no-connections` sends an explicit empty list.

Each application run retains its source manifest and packed coverage under its ignored evidence directory. SHA-256 of `build-sources.json`:

- Full browser inventory, `coverage/connection-access-browser-2`: `78ab4b939eb97710a9fb1f5faa0cfdc545722bf8647f57c795c8358dc0a61a76`.
- Focused rerun, `coverage/connection-access-browser-final`: `96f37275fd78f8ad8a86cba6ca19d418f80685a57caee04a18a3302175792981`.
- Final access-editor regression, `coverage/connection-access-browser-verified`: `659701077725bb61d66c510c330f7762a011609f3ea9c9a8b3da28188601688e`.

Local checks establish the tested policy, persistence and application behavior. They do not establish deployed multi-instance ordering, vendor callback behavior, external account billing or cloud transport acceptance; those remain in the linked maintainer checklist.
