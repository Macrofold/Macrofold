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

### Demand-sized baseline and idle replacement

`planWorkerCapacity` considers up to 32 queued requirements and adds at most four allocations per pass. It projects memory, CPU and occupied slots without mutating observed Hosts. Starting Hosts count as expected supply; successive queued Runs cannot claim the same projected resources. Paused, destroyed and expired Workers return no provisioning or funding plan.

Queued demand is placed before filling the remaining `min_instances` baseline. Demand-sized Hosts satisfy that baseline too. Otherwise, a single-instance Worker could spend its only instance or rate allowance on a cheap Host that cannot execute an already queued Run. With no queued demand, the baseline still uses the cheapest compatible accepted offering.

For existing capacity, the planner may nominate one ready, unused Host whose confirmed release would permit a fitting accepted replacement. It does not retire capacity needed by a later independently eligible Run in the bounded queue, a Host with held execution/cleanup resources, a starting Host, a non-clean materialization, or a leased warm handle. An unavailable, unaffordable, explicitly incompatible, or too-short-lived replacement is not a reason to discard a Host.

The reconciler records the drain under the existing Worker claim lock and also checks all materializations in that Host generation for unpublished state; the bounded placement cache window is not sufficient evidence for safe retirement. Provider I/O remains outside the transaction. The old allocation retains its instance, committed-rate and funding obligations until `advanceHost` confirms release and settles it. Only a subsequent pass can reserve replacement capacity. This can temporarily reduce the ready baseline; it does not promise uninterrupted availability or permit overspending to hide replacement latency.

This is a bounded one-Host replacement, not global repacking. When several allocations must be released together before a larger one fits, the planner waits rather than discarding capacity speculatively. A selected Host with unpublished state outside the placement window is also preserved rather than trying additional retirement candidates in the same pass. These extensions remain separate from the implemented single-replacement path.

### Demand-aware idle scale-down

Ordinary idle scale-down uses the same plan's per-Host funding selections, not a requirement that the entire queue be empty. A ready Host above `min_instances` may drain once its idle timeout expires, its observed execution/cleanup occupancy is zero, and no bounded queued requirement was projected onto it. This releases excess capacity when a lowered Worker concurrency limit blocks queued work, or when another Host already supplies the needed resources. A selected Host remains available for that work even after its idle timeout; a missing Host snapshot is not evidence of zero occupancy. Null idle retention and the minimum baseline retain their existing meaning.

Every elective retirement, including ordinary idle scale-down, checks the complete Host generation for non-clean materializations before requesting a drain. Older `recovery_required` state outside the 256-entry placement cache view therefore cannot be silently discarded. Once recovery/publication makes that state clean, the normal idle policy can release the Host. Expiration, explicit lifecycle intent, generation fencing, and funding exhaustion retain their existing mandatory drain paths; this safeguard is not a promise to retain an unfunded or expired allocation indefinitely.

An idle drain does not cancel or replay queued Runs, release active assignments, assume that a failed provider stop succeeded, or authorize replacement beyond the existing ceilings. Admission still rechecks the current plan under database ownership; the bounded queue projection is not a reservation or traffic forecast.

### Physical retirement, final receipts, and settlement

`worker-reconciler.ts` treats a sealed final receipt, provider-confirmed stop, and last-settled financial cursor as separate facts. Migration `047_host_final_usage.sql` adds `final_usage`; new resource receipts are validated and persisted with `usage_finalized_at` before settlement. Existing finalized-and-settled generations can still use their billing cursor. A normal idle retirement waits for execution/cleanup ownership, seals usage, stops physical compute, and then settles. `stopped_at` commits independently, so a later funding/ledger failure cannot erase the stop or keep extending the allocation clock.

Changed controller generations and passed funding/lifetime boundaries require physical teardown even if usage settlement cannot proceed. They retain SQL claims and unresolved liability. Unknown resource tails are not replaced with a recent health sample or zero. A provider stop that is not confirmed remains an obligation. `releaseHostFunding` independently requires both physical confirmation and no live HostRun claims; orchestration cannot bypass these ownership checks. Financial exceptions remain conservative and require operator reconciliation; this change does not authorize extra debits or automatic write-offs.

### Unacknowledged preparation and released-command fencing

`WorkerMachines.cleanupUnbound` reconstructs the durable assignment binding and requests the existing controller release outside SQL locks. Missing orchestration state is not evidence that prepare never reached the Host. A failed/unconfirmed release retains the Worktree and resource claims; an unbound launch intent requires explicit recovery rather than replay or abandonment. Unlaunched cleanup does not send a cancellation command to an assignment the controller may never have seen.

The Host controller serializes release of an unknown assignment with allocation and records a bounded tombstone before acknowledging it. A delayed prepare cannot recreate that writer. If preparation wins the race, cleanup retries against the now-known assignment. Commands queued behind a completed release recheck the released fence inside their assignment lock. These are extensions of existing ownership and queues, not another scheduler or persistence layer.

### Caller-facing and bounded-read changes

The frequent capacity query selects only Run identity, resource requirements and execution duration, not prompts, connection grants, attachments or full execution configuration. The existing 32-item eligibility/FIFO bound and transactional admission remain unchanged. No latency percentage is inferred from this narrower payload.

CLI selectors exclude destroyed records during exact-name resolution while preserving UUID history access. Explicit UUID/revision updates do not perform an unnecessary read. The existing generated SDK, command registry, flags, revision conflict behavior and permission owner are preserved. The dashboard prefers isolated creation, makes trusted sharing explicit, restricts indefinite retention to dedicated capacity, and distinguishes retained credit/cleanup from final charges and physical uptime.

The [public guide](../workers.md#match-compute-ownership-to-your-application) covers scheduled work, personal agents, parallel writers, direct inference and shared actor compute. The [review](review.md) records OpenLegend's required Sandbox-caller migration and remaining release boundaries; no caller repository was silently changed.

### Execution and publication

Publication verifies durable Worktree and native continuation state. Only then may a local materialization become a clean cache hit. Cancellation, failed publication, and uncertain cleanup do not authorize replay of a potentially executed prompt. Dedicated compute is accounted once per Host; metered offers use monotonic cumulative receipts and a sealed final usage boundary.

Background Run admission uses nonblocking SQL advisory claims when another claimant owns the organization, Worktree, or global boundary. It defers durable work rather than occupying every connection while active Runs need to persist and heartbeat. Direct inference retains its in-transaction admission semantics. Runnable dispatch hints are limited by observed free global/account slots; cancellation and expiry cleanup remain discoverable at full capacity.

The candidate query materializes Worktree heads and Worker placement once and bounds the singleton scheduler clock. Local dispatch awaits only the ordered short admission claim and runs its returned completion concurrently. Portable dispatch distinguishes fresh capacity eligibility from running provider-error backoff and uses an exact timestamp to release its own short pending lease.

Financial reconciliation derives outstanding liability from active Runs and Host reservations. Storage maintenance treats unreleased HostRuns as active writers even after the public Run is terminal, so it cannot delete Session or Worktree state still needed by cleanup.

## Verification and remaining scope

Build/run evidence and the executed queued-capacity unit/database regressions belong in [verification](verification.md). Public docs describe real contracts and supported combinations; deployment-specific provider availability is read from offering discovery. The broader regression and release inventory remains in [maintainer TODO](../../../maintainers/TODO.md); passing this focused slice does not close every cutover obligation.

Cross-customer physical packing is an optional backend optimization, not permission to bypass tenant isolation. A resource-priced offering can use unshared physical capacity and charge its advertised usage meter while the platform absorbs overhead. Additional runtimes, regions, sizes, and pricing revisions must pass catalog validation and provider capability checks.

Pre-change resources and decisions are recorded only in the [architecture history](../../../architecture/changelog/workers.md); forward migrations retain deployment and accounting history by design.
