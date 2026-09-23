# Worker implementation status and evidence

**Scope:** Unmerged work-in-progress, not release acceptance. The revised design and target guide are committed documentation. The separate implementation bundle was tested in a partial local workspace; its code has not been imported into this branch or wired into the HTTP/scheduler/provider path.

The working branch is `feat/worker-economics-autoscaling`. Its code baseline for the earlier downloadable bundle was `4114840b98dfed4e612daf09fbc0b4920e6f30dd`; that is a historical base, not a moving branch-tip claim. `main` was checked at `19865a2f45885e228deb6b7ea443e33982257d21`. The subsequent documentation-only update imports the revised architecture, target user guide, scope record, cutover checklist, and architectural history; it does not import the source/test changes. Source and generated API artifacts still describe Sandbox execution.

## Completed local slice

| Source | Implemented behavior | Important limit |
| --- | --- | --- |
| `packages/core/src/worker-types.ts` | Internal economic, lifecycle, resource, cache and assignment-decision types | These are not generated HTTP types or database migrations |
| `worker-policy.ts` | Exact setting resolution, quotas, expiry, manual pause/resume/destroy intent, observed-state projection, hard offering constraints | Does not persist intent, enforce user grants, or invoke providers |
| `worker-pricing.ts` | Integer micro-USD inputs, dollar formatting, accepted allocation/resource price arithmetic, cumulative metering and monotonic deltas | No ledger, settlement deduplication storage, provider meters or retail price configuration yet |
| `worker-placement.ts` | Pure dedicated-capacity placement/provision/wait decisions with resource, cleanup, TTL, authorization-view, generation and aggregate cost constraints | A snapshot plan is not a transactional claim; pooled execution explicitly fails unavailable |
| `packages/runtime/src/manifest.ts` | Captures required hidden Git/native history instead of dropping all dot paths; existing auth filtering remains | Tests verify synthetic file capture/restore, not real native continuation or all secret formats |
| `packages/core/src/cloud-engine.ts` edit | Removes the second blanket hidden-path filter at snapshot indexing; retains native-auth filtering | SQL/cloud orchestration is not exercised in the focused runner |
| `tests/unit/manifest.test.ts` edit | Strengthens the existing round-trip test to assert restored `.git/HEAD` | Existing Vitest suite is retained; not weakened or claimed executed here |

No new service/framework, ORM, queue, provider dependency, runtime permissions, migrations, or commercial pricing is enabled by this slice. The policy modules deliberately depend only on the existing domain error helper and typed internal values, so they can be tested without pretending to run hosted infrastructure.

## Execution evidence

The test fixtures used actual imported policy code and actual filesystem capture/restore functions. Baseline dependencies were copied from the pinned repository and verified against their Git blob hashes. No replacement implementation of capture/restore was used.

The focused cases are registered in Vitest through:

- `tests/unit/worker-policy.test.ts`
- `tests/unit/worker-snapshot.test.ts`

The same case functions also run with:

```sh
node scripts/workers/acceptance.mjs all
```

The helper uses installed TypeScript and Node types to strictly compile the selected code and run Node's test runner. It normalizes extensionless imports only in temporary emitted JavaScript, because the repository normally bundles them. It does not modify production imports or generated SDKs. `policy` and `snapshot` can be passed instead of `all` for isolated verification.

### Historical bundle results recorded September 23, 2026

- **153/153 cases passed, none skipped:** 127 policy/meter/placement cases and 26 real filesystem cases.
- Strict TypeScript compilation passed with `strict`, `noUnusedLocals`, and `noUnusedParameters`.
- New policy modules reached **100% emitted-JavaScript line coverage**; branch coverage was 97.03% placement, 97.47% policy, and 95.65% pricing in this focused Node V8 run.
- The filesystem regression was tested before changing capture: the original code failed 12/26 focused cases. After the fix, all 26 passed, including known-auth exclusions, rejected auth restoration, hidden history/Git files, corrupted chunks, and non-traversed symlinks.
- This run used **Node 22.16.0 and TypeScript 5.8.3**, not the repository's pinned Node 24 / TypeScript dependency installation. Repeat in the pinned environment before integration.

In the earlier `macrofold-worker-implementation-partial.zip` download, `evidence/worker-acceptance.log` and `evidence/snapshot-before.log` contain the raw outputs. Those logs and their matching source are not imported by this documentation-only change. Coverage percentages apply to the focused compiled code, not the entire repository and not a replacement for its coverage gates. Unchanged runtime branches not exercised by these focused tests are reported as uncovered rather than hidden.

## What did not run

During the prior focused test run, no full repository installation, `pnpm check`, Vitest invocation, PostgreSQL migration/concurrency/ledger tests, Docker process/isolation test, native harness cold resume, cloud provider smoke test, API journey, SDK generation/transport tests, browser/CLI tests, docs generator, or sustained load test ran in this environment. No paid provider/model request was made.

The previous bundle was produced without a complete repository checkout or dependency installation. Its focused tests are historical bundle evidence, not a current branch test pass. GitHub writes were available for this later documentation update; the code nevertheless remains unimported. Do not reuse an earlier tool-availability limitation as a claim about current repository permissions. Full repository verification remains outstanding.

## Integration contract for the policy helpers

`chooseDedicatedWorkerPlacement` consumes already-authorized, bounded snapshots. It cannot authorize an API caller or protect a concurrent SQL writer. Its consumer must:

1. Resolve the principal, Worker-use grant, context/tool authority, current configuration and rate revision.
2. Build clean materialization metadata under the current Host generation; never accept a client-provided permission fingerprint as authority.
3. Obtain bounded candidate snapshots and run the pure policy outside long provider calls.
4. Recheck and reserve resources/rates/ownership in the existing transaction boundary before acting.
5. Persist the provider operation/assignment identity before I/O; keep uncertainty and cleanup reservations visible.

Starting and draining Host commitments count against the cap even before the provider charges or confirms release. A cache hit cannot override RAM/CPU/slot/lifetime/security constraints. A dirty/recovery-required materialization cannot produce a hit. Retained warm memory occupies RAM; reusing the matching handle avoids double counting that same reservation.

The pure planner intentionally returns `pooled_compute_unavailable` for the pooled path. Resource price arithmetic is reusable groundwork, **not a pooled executor**. Min-capacity reconciliation, reactive scale-down, capability validation, mixed-rate configuration updates, and bounded future batch placement remain in the service work, not hidden inside a pure single-Run planner.

At HTTP integration, map authoritative OpenAPI request types into these internal values rather than maintaining a second independently evolving public schema. The public amount stays `max_hourly_compute_cost_micro_usd`, matching existing project budgets; the dollar conversion helper is for UI/convenience formatting only.

## Documentation publication boundary

The accepted design, draft Worker guide, this record, TODO, and architecture-history note live in the feature branch. The guide is deliberately excluded from `docs/navigation.json` until actual Worker endpoints and generated clients work. Architecture index/decision/codebase links distinguish target ownership from implemented Sandbox ownership. No claim is made that current user documentation, code comments, OpenAPI, SDKs, CLI, MCP, dashboard, billing, or deployment guides have all switched over.

The original download application script expects its exact historical base and may now reject this branch because the docs have changed. Do not bypass that guard or overwrite the updated design: reconcile the remaining source/test changes onto the current feature tip.

## Finish line

[TODO](TODO.md) is the feature's remaining-work record. [Architecture](../../../architecture/worker-execution.md) owns target semantics; [Worker guide](../workers.md) is explicitly not live documentation yet. Cut over current public documentation only with the corresponding implementation, generated artifacts, and acceptance evidence. Do not delete existing useful Sandbox security, billing, or recovery tests merely to make the migration green.
