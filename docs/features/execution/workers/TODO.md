# Worker implementation and verification

The [architecture](../../../architecture/worker-execution.md) is the accepted target. [Implementation/evidence](implementation.md) distinguishes the additional locally tested bundle from code actually committed to the unmerged feature branch. This is not a shipped-feature claim. Provider activation and release acceptance remain in [maintainer TODO](../../../maintainers/TODO.md).

## Completed and preserved

- [x] Commit the latest revised design and draft Worker guide, distinguish uncommitted code from repository state, and link a concise architecture-history note. No Worker API activation implied.

- [x] The existing feature branch replaces fixed-one-Host/short-lived Worker concepts with stable autoscaling targets, explicit economics, independent tenancy and sibling isolation, graceful desired-state lifecycle, cost ceilings, and predictable pooled rates.
- [x] The existing branch repairs the erroneous `worktree:*` local dependency reference and adds branch-only verification; preserve those changes.
- [x] Additional local bundle: implement and strictly compile typed validation, exact money/rate arithmetic, monotonic metering deltas, and dedicated placement decisions. No SQL or HTTP activation implied.
- [x] Additional local bundle: reproduce hidden continuation/Git capture failure, patch capture and provide the matching cloud-index edit, and add cold filesystem regressions without dropping credential guards.
- [x] Additional local bundle: 153 focused behavior tests pass; original snapshot code fails 12/26 regression cases. Raw logs and exact scope are recorded.

## Required implementation, in order

| ID | Work item | Completion evidence |
| --- | --- | --- |
| W-01 | Reconcile the reviewed source/test bundle onto the current feature tip without overwriting the newer docs; continue the unmerged implementation branch | Exact-base/content checks, code review, committed changes and branch diff |
| W-02 | Replace internal request-shaped input with authoritative OpenAPI-derived boundary mapping; tenant-owned Worker services and independent use/read/write grants | Scope tests, restricted-key tests, correct errors, no cross-Run metadata leakage |
| W-03 | Forward migration for Workers, actual Hosts, historical HostRuns and rate/usage obligations; use indexed live-claim constraints and current RLS/ledger | Real PostgreSQL migration, simultaneous admission/cleanup/settlement and rollback fixtures |
| W-04 | Provider capability probes and scoped contained runtime paths/processes; controller handles multiple Runs | Two actual simultaneous native executions; cancel/capture A does not affect B; escaped grandchildren/daemons tested |
| W-05 | Integrate cache-first preparation, authorized clean-view materializations, per-Session continuation formats and stable warm-handle ownership | Cold real-harness continuation after Host destruction; restricted-after-unrestricted cache tests; per-turn credential revocation |
| W-06 | Placement-aware scheduler eligibility and atomic resource/rate claims; no full-Worker head-of-line block | Competing schedulers cannot overbook resources or exceed rate; fair independent work starts; Worktree/Session ordering preserved |
| W-07 | Bounded reactive dedicated autoscaling, baseline, idle drain, manual pause, customer expiry and Host replacement | Duplicate/unknown creates and stops; no self-wake after pause; baseline/cap conflict; load/budget/cleanup tests |
| W-08 | Ledger integration and resource meter epochs, missing telemetry semantics, accepted-rate updates, finite funding | Exact bounds, duplicate/regressing meters, rollover, unconfirmed release, refunds and no repeated whole-Host charge |
| W-09 | REST endpoints and UI/CLI/MCP/SDK cutover with good default and advanced UX | Generated OpenAPI/SDK transports, route contracts, key/scope selectors, async pause, clear cost/capacity reasons |
| W-10 | Pooled allocation and cross-customer containment, separately from dedicated service | Auditable tenant isolation, correctly attributed CPU/memory counters, no occupancy-based pricing or secret sharing |
| W-11 | Remove superseded Sandbox API/service/schema/tests after replacements pass; preserve actual stored checkpoints/ledger history | Full search for current Sandbox assumptions; no legacy aliases merely for hypothetical clients |
| W-12 | Full pinned-toolchain, docs/SDK generation, unit/domain/native/client/browser and scaling acceptance | Existing gates remain unchanged; unsupported hosted checks explicitly unverified |

## Documentation cutover map

The feature branch now contains the revised architecture target, architectural links, draft user guide, internal implementation record, this TODO, and the architecture-history note. The source/test changes from the local bundle are still not imported. It does **not** claim the currently published API has changed.

Before marking the overall migration complete, update these owners together with real handlers and generated artifacts:

- `docs/features/execution/{README,implementation,runtime,scheduling,sandboxes}.md` and relevant `sandboxes/` operational/verification pages; replace actual old routes and lifecycle examples, not mere global text replacement.
- `docs/features/workspaces/implementation.md`, harness/UHI docs, persistence/recovery guides, runtime permissions and credential boundaries.
- `docs/features/billing/{README,implementation,usage}.md`, pricing UI, accepted compute meters/rates, model/tool versus Host attribution, and effective tier limits.
- `docs/features/api/` quickstarts/conventions, authoritative `docs/api/openapi.json`, generated contracts and all SDKs; CLI and customer/administrative MCP catalogs.
- `docs/navigation.json`, current public docs/LLM bundles, site schemas and examples; regenerate using existing scripts, do not hand-edit generated output.
- `docs/architecture/{README,decisions,codebase}.md`, `docs/operations/{hosting,scaling,recovery}.md`, release status and maintainer acceptance when behavior actually ships.
- Existing `tests/unit/manifest.test.ts` gains an explicit restored `.git/HEAD` assertion; retain `snapshot-failures.test.ts`. Native/session/secret fixtures and the old blanket hidden-path helper need a full-checkout reference audit before cleanup.

The [architecture-history note](../../../architecture/changelog/workers.md) remains outside public navigation and links back to the accepted design. Preserve it after cutover; do not keep the old and new architectures as competing current guides.

## Deployment decisions requiring real inputs

- **Commercial configuration:** actual server/sandbox resource rates, supported shape/region/runtime catalog, finite default spending ceiling, and entitlement bounds. Fixture prices are not product prices.
- **Execution boundary:** choose and validate a hosted backend that supports the required containment. Do not advertise strong isolation or cross-tenant pooling from untested namespace/cgroup assumptions.
- **Retention billing:** default pooled opportunistic warmth is platform-paid and evictable; any promised/billable retention needs explicit rate/expiry. Dedicated customers already pay for allocated idle RAM.

Keep unsupported combinations unavailable. These items require measured or operator-supplied facts, not a new speculative architecture debate.

## Deferred unless evidence justifies them

Traffic prediction, globally optimal batch bin-packing, cross-region optimization, live RAM migration, retrospective cost-sharing rebates, Kubernetes/Redis as mandatory infrastructure, collaborative multiple Worktree writers, arbitrary privileged custom runtime images, and new public cache/Host/lease CRUD.

## Current blockers and verification

The revised documentation is committed to the feature branch; implementation remains in the earlier downloadable bundle. That bundle was checked against a historical exact base, so its application script must not be forced over newer docs. Reconcile the uncommitted source/test changes in a complete checkout. A partial local source workspace supported the earlier strict focused compilation/tests only. No full Node 24/pnpm installation, Vitest suite, DB/Docker/provider acceptance, generated artifacts, or remote CI success is claimed. See the implementation record for reproducible commands and the unambiguous remaining scope.
