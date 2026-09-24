# Worker implementation

The branch's public contract is Workers; the controller and provider allocation are internal Hosts. This document maps code ownership and verified execution boundaries. It does not imply that an unmerged branch has been deployed to Macrofold Cloud.

## Owners

| Concern | Owner |
| --- | --- |
| Public schemas, endpoint names, SDK/MCP generation | `docs/api/openapi.json`, repository generators |
| Worker CRUD, permissions, revision fencing, public observations | `packages/core/src/workers.ts` |
| Settings and lifecycle policy | `worker-policy.ts`, `worker-types.ts` |
| Accepted deployment quotes and capability validation | `worker-catalog.ts`, `worker-pricing.ts` |
| Placement and bounded queued-demand scaling | `worker-placement.ts`, `worker-scaling.ts` |
| Transactional resource claims, materialization hints, financial cursors | `host-allocations.ts`, forward database migrations |
| Lifecycle reconciliation and provider receipts | `worker-reconciler.ts` |
| Provider lifecycle and exact machine I/O | `packages/providers/src/hosts.ts`, Docker/Vercel adapters |
| Automatic execution and explicit Worker execution adapters | `automatic-machines.ts`, `worker-machines.ts` |
| Multi-Run controller and cumulative meters | `packages/runtime/src/host-control.ts`, `host-meter.ts` |
| Native process ownership, capture and adapter continuation | runtime supervisor, process helpers, snapshot code and harness adapters |
| Existing execution and persistence orchestration | `engine.ts`, `cloud-engine.ts` |
| CLI and dashboard | CLI Worker handlers/flags, web Workers components |

## Implemented flow

Worker creation accepts a capability-compatible economic contract and finite limits. A Run independently selects its authorized execution context and optional Worker. The scheduler considers placement eligibility before choosing a fair candidate; Worktree writer exclusion continues through HostRun cleanup.

Reconciliation reads bounded queued requirements, projects consumption of existing/provisioning capacity, and authorizes additional Hosts within credit, instance, concurrency, and hourly ceilings. Physical provider identity is persisted before controller startup. Native operations carry boot and assignment fences. The controller keeps live harness handles separate from per-turn execution ownership and independently decides filesystem reuse versus process reuse.

Publication verifies durable Worktree and native continuation state. Only then may a local materialization become a clean cache hit. Cancellation, failed publication, and uncertain cleanup do not authorize replay of a potentially executed prompt. Dedicated compute is accounted once per Host; metered offers use monotonic cumulative receipts and a sealed final usage boundary.

Background Run admission uses nonblocking SQL advisory claims when another claimant owns the organization, Worktree, or global boundary. It defers durable work rather than occupying every connection while active Runs need to persist and heartbeat. Direct inference retains its in-transaction admission semantics. Runnable dispatch hints are limited by observed free global/account slots; cancellation and expiry cleanup remain discoverable at full capacity.

Financial reconciliation derives outstanding liability from active Runs and Host reservations. Storage maintenance treats unreleased HostRuns as active writers even after the public Run is terminal, so it cannot delete Session or Worktree state still needed by cleanup.

## Verification and remaining scope

Build/run evidence belongs in [verification](verification.md). Public docs describe real contracts and supported combinations; deployment-specific provider availability is read from offering discovery. Formal test additions are intentionally listed in [maintainer TODO](../../../maintainers/TODO.md), not reported as executed.

Cross-customer physical packing is an optional backend optimization, not permission to bypass tenant isolation. A resource-priced offering can use unshared physical capacity and charge its advertised usage meter while the platform absorbs overhead. Additional runtimes, regions, sizes, and pricing revisions must pass catalog validation and provider capability checks.

Pre-change resources and decisions are recorded only in the [architecture history](../../../architecture/changelog/workers.md); forward migrations retain deployment and accounting history by design.
