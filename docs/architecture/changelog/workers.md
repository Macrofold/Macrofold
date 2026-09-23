# Worker architecture evolution

This is a decision-history note, not a release announcement. The [accepted Worker design](../worker-execution.md) owns the target contract; the [implementation record](../../features/execution/workers/implementation.md) owns delivery and verification status. At the documentation update, the executable API still uses worktree-bound Sandboxes.

## Changelog

### Previous implementation: one sandbox per worktree

Reusable Sandboxes combined a compute allocation with one Worktree, one active Run, fixed workspace/home directories, and at most one retained native harness. This made sequential reuse straightforward and established useful provider lifecycle, checkpoint, credential, accounting, and non-replay protections.

The limitation appeared with workloads such as OpenLegend: many independent character files and conversations need concurrent execution on economical shared capacity. Making the compute allocation belong to one Worktree prevented that reuse and put process cleanup, caching, and lifecycle decisions at too broad a scope.

### Intermediate proposal: separate state, retain one Host per Worker

The first Worker proposal separated durable Worktrees/Sessions from compute. It used public Workers with internal Hosts and HostRuns, but restricted each Worker to one serving Host and distinguished short-lived from long-lived Workers.

That removed worktree ownership but still required callers to route across additional Workers when load increased. It also mixed the lifetime of a logical execution target with a provider machine's timeout, and used longevity as an indirect choice of compute economics. This was a design stage, not an implemented or released Worker API.

### Accepted direction: cost-controlled autoscaling targets

A Worker is now a stable execution target with explicit compute economics, scaling limits, runtime, authority, and spending controls. It can use zero or more Hosts. The caller chooses the economic arrangement and limits; Macrofold places and reactively scales execution within them, without a forecasting service or an expensive fallback.

Dedicated capacity and sibling-Run isolation are independent. A customer can buy exclusive server capacity while allowing trusted agents to share it. Pooled resource prices are based on published rates, not the accidental occupancy of the server a Run landed on.

Manual pause accepts graceful intent and drains; automatic idle sleep can wake on demand. A provider Host timeout does not retire the Worker. HostRuns retain assignment history and fencing, while internal harness handles can outlive individual turns. Durable Worktree and harness-specific Session state remain independent of both. Only verified local materializations are disposable caches; active unpublished writes can be lost on failure.

### What the transition preserves

Keep PostgreSQL/outbox ownership, exact money and reservations, verified file recovery, per-turn authority, Worktree writer exclusion, and refusal to replay ambiguous native side effects. Preserve user file/session/accounting history. Do not keep hypothetical legacy API aliases solely for a prelaunch customer population that does not exist.

The planned transition introduces durable Worker/Host/HostRun ownership, scoped native containment, placement and billing integration, then cuts over endpoints, generated clients, UI, tests, and current guides together. Pooled execution and stronger isolation activate only after their concrete boundaries pass acceptance. Until then, describing the new design does not mean the switchover has happened.
