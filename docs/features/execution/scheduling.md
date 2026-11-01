# Execution plans, durable queues and fair scheduling

This document describes the current scheduling policy. The implementation retains the modular Next.js control plane, PostgreSQL outbox, provider-neutral Host execution, optional standalone poller, SSE, persistent worktrees and immutable credit ledger.

## Product policy

| Plan             | Subscription + metered usage | Included monthly credit | Maximum active jobs | Maximum execution lifecycle | Scheduling weight |
| ---------------- | ---------------------------: | ----------------------: | ------------------: | --------------------------: | ----------------: |
| Starter (`payg`) |                     $0/month |                      $0 |                  20 |                  30 minutes |                 1 |
| Pro (`pro`)      |                    $29/month |                     $10 |                 100 |                  60 minutes |                 2 |
| Scale (`scale`)  |                   $199/month |                     $50 |                 500 |                 120 minutes |                 4 |

The catalog is [plans.ts](../../../packages/core/src/plans.ts). Starter suits individual interactive work, Pro several independent repositories/a small team, and Scale a large power user running dozens of worktrees or batch agents. Plan access and usage pricing are separate: Worker compute uses its accepted offering; model/tool charges use their quoted rates. A subscription is not unlimited execution. See [cost model and pricing rationale](../billing/README.md). Fleet limits default to 200 native Runs and 2,000 lightweight Runs, independently configurable, with an optional total ceiling defaulting to their sum (2,200). A plan entitlement is not an immediate-start guarantee or a throughput measurement. Size each resource pool for measured provider/database capacity; [operator settings](../../operations/scaling.md#resource-capacity-settings) document ownership and units.

A customer means an **organization**, shared by all members, API keys, sessions and workspaces. Creating another credential does not evade its cap. Worktree caps remain one active writer; use independent Worktrees for actual parallel edits. Account policy is owner/admin-configurable downward, up to the paid plan's limits. Null means inherit the plan. Runtime and concurrency are independently configurable. A smaller concurrency cap drains existing jobs naturally; it never cancels them. A queued job above a newly lowered execution cap fails explicitly with `execution_limit_changed`; its requested execution window is not silently truncated. An operator can use the same authorized customer API for account assistance; the read-only operator MCP does not acquire mutation tools.

| Clock             | Default / maximum                                                | Begins                                     | Expiry behavior                                                                 |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Queue deadline    | 86,400 seconds; request may choose 1–86,400                      | Submission transaction                     | Failed run, `queue_expired`, terminal failure event, reservation released       |
| Execution timeout | 900 seconds, or lower account cap; plan/account maximum enforced | Claim into provisioning                    | Existing timeout/cancellation/persistence recovery path                         |
| Detailed history  | Starter 30 days; Pro/Scale 90 days                               | Existing completion-based retention policy | Detailed content pruned by retention maintenance, independent of queue deadline |

Queue expiry never deletes the request/status/history. Queued work occupies no execution slot; an explicitly retained Worker baseline can still incur compute cost while that Run waits, but its full maximum-cost budget remains reserved. Those funds are unavailable for other runs for up to the queue deadline, including during an outage. Cancelling a queued job settles it immediately with zero execution cost. Expiry/cancellation processing is transactional and idempotent; duplicate workers cannot release the same funds twice. A maintenance outage can delay settlement until the next successful sweep, so the API can briefly show `deadline_expired` before final failure.

Migration 024 introduced the SQL default for **new** rows only; forward migration 027 reasserts it after the history-policy checks. Migration 026 adds orchestration ownership. It does not rewrite historical deadlines or change running timeouts. The admission API writes the per-request deadline explicitly. Execution's `deadline` is created only when capacity is claimed; provisioning, input waits and persistence consume the same lifecycle window and active slot.

## Scheduling algorithm

[scheduling.ts](../../../packages/core/src/scheduling.ts) defines the shared eligibility query. [engine.ts](../../../packages/core/src/engine.ts) applies it at the actual transition to provisioning, under the existing `capacity:global` transaction advisory lock. Candidate lists are hints, never authorization to exceed a limit. All workers and targeted Workflow retries obey this decision.

1. Resolve the run's current actor, workspace/worktree availability, cancellation, queue deadline and current execution cap. Clean up invalid/expired work before capacity checks.
2. A queued Run is eligible only when its Worktree has no earlier queued work or active writer, no unreleased assignment is still cleaning that Worktree, its organization is below its cap, and it has not expired/cancelled. An explicitly selected Worker must also be enabled and have eligible resource/funding capacity. This placement filter precedes choosing the organization head, so a full or paused Worker cannot hide another eligible Worker. Worktree ordering is `(created_at, id)`; identifiers break timestamp ties. Worktree-free lightweight Runs remain independent.
3. Select the oldest eligible run in each organization and execution resource class (native or lightweight), giving interactive candidates first consideration **within that organization**. Within each resource class, interactive heads sort before background heads across organizations. Admission for one resource class does not wait for an eligible head in the other class; both still consume the same organization entitlement and weighted service clock. An interactive follow-up cannot jump its worktree's earlier writer.
4. Choose the eligible organization with the lowest effective virtual service, minus its bounded age bonus. Break ties by oldest submission then ID. Effective service is `max(organization.scheduler_finish, scheduler_clock.virtual_time)`. A successful start advances the organization by `1 / plan_weight` and the shared clock to the selected effective service. Both writes commit with the run's provisioning transition. Idle/new organizations join at the current clock, so they neither accumulate unlimited credits nor repay historical activity. Under steady equal-class eligibility, relative start opportunities approach 1:2:4, rather than reserving slots permanently by tier.
5. Each full minute of waiting earns 1/16 of a virtual turn, capped at 1/4 after four minutes. This nudges older work ahead within its class while retaining bounded access for newly arriving tenants. FIFO within a worktree remains authoritative. This is a small age adjustment, not a customer-selectable priority hierarchy.
6. Count active `provisioning`, `running`, `waiting_for_input` and `persisting` runs against account, resource-class and total fleet limits. Commit one claim while holding the global lock; release it before native execution. If no other tenant is eligible, the available customer keeps receiving turns up to its cap.

A Run whose automatic dispatch stopped is ineligible for a scheduling turn. Migration 050 exposes only its `dispatch_blocked` flag to the shared scheduler, keeping diagnostic text private. Other eligible Worktrees/tenants can progress; uncertain active Runs still consume capacity and retain Worktree ownership. Expiry/cancellation can settle an unstarted blocked Run through the existing claim boundary without replaying it.

**Interactive headroom is operational, not a hard reservation.** To satisfy work conservation, this release lets background jobs borrow all otherwise idle capacity. Interactive requests receive the next eligible free-slot opportunity, but cannot evict long-running jobs or bypass their own account/worktree cap. Do not promise immediate CLI response while filling the entire ceiling with background work. Maintain measured spare capacity by sizing the ceiling above expected sustained usage, verifying provider quotas, and raising it before long waits become normal. Continuous interactive demand can delay background work; aging never overrides interactive priority. Preemption and latency SLAs are not promised. Worker Host autoscaling is implemented separately within the caller's accepted offering, instance, concurrency, credit and hourly bounds; it does not expand account or global entitlements.

The fairness model follows the noisy-neighbor principle in [AWS fair queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fair-queues.html): tenant-aware opportunities and work conservation, rather than a single global FIFO. Our worktree ordering, hard tenant caps, plan weights and execution lifecycle are application policy, not claims of equivalence to SQS.

## Orchestration and failure behavior

The standalone poller uses commit wake hints, immediate bounded local pool
handoffs, independent pool discovery and reusable immutable preparation. The
[implementation and qualification record](../../projects/native-scheduling-latency.md)
separates the under-100-ms free-capacity target from measured results. Durable
claims, fair admission and recovery remain authoritative; cold Host/harness
startup and genuinely occupied capacity have independent costs.

Queue waiting resides in PostgreSQL. Failed claims retain expiry-bounded adaptive backoff; a fresh eligibility hint can wake pending work after capacity changes without waiting for an older capacity backoff. A distinct short dispatcher lease prevents duplicate pending advances. Its exact database timestamp fences release, so a stale response cannot clear another dispatcher's claim. Provider errors and running phase retries still honor their `available_at` deadline. Workflow starts only after capacity is claimed; a queued invocation returns to the outbox without a sleep loop.

Every Workflow invocation advances at most 128 phases before handing off the same persisted execution through the existing outbox. Orchestration generation fencing protects successor leases, while the existing phase lock and native supervisor preserve execution identity. The combined retry/sleep budget is at most 1,449 events per invocation. See [Workflow history and waiting](workflow-history.md) for the budget, scheduling/cancellation latency, crash boundaries and rollout procedure.

Standalone poller workers claim due rows with `FOR UPDATE SKIP LOCKED`; queued dispatch claims have a five-second lease and active cloud steps a two-minute dispatch backoff. [CloudDispatcher](../../../packages/core/src/portable-dispatch.ts) uses independent per-process pools: 256 inference advances, 16 native provisioning advances, eight restore/checkpoint transfers and 64 lifecycle/control advances. Migration 051 exposes only the derived `dispatch_class` in the restricted scheduler view. Locally active Run IDs remain excluded even if a dispatch claim expires; cross-process phase fencing remains authoritative. These settings replace `WORKER_CONCURRENCY` and its silent twenty-step clamp. They are separate from fleet active-Run ceilings and customer budgets. A full transfer pool cannot consume model slots.

Migrations 059–060 publish content-free wake hints after due-job and eligibility
changes commit. A standalone poller owns one direct PostgreSQL session listener;
lost hints or listener failures retain the 750 ms idle polling fallback. A
notification never selects a tenant, authorizes a Run or overrides capacity.
Non-native completion skips notification when no queued work exists, using the
indexed scheduling view; ordinary direct inference does not initiate empty
fleet scans. [Operator configuration](../../operations/scaling.md#standalone-wakeup-connection)
documents the direct session URL and connection budget.

[The core wakeup composition](../../../packages/core/src/dispatch-wakeup.ts)
selects that connection and safe diagnostics; the shared
[database listener](../../../packages/db/notifications.ts) owns connection,
reconnect and close behavior for both poller hints and local Run-event hints.
Neither adds tenant state or replaces durable SQL eligibility.

Account plan/concurrency/timeout changes also emit a committed hint; unchanged
limits and unrelated account metadata remain silent. Raising a cap does not
require another Run to finish or the periodic fallback before rediscovery.

Each pool discovers work independently, so a slow query cannot hold another
pool's later refill. Already-running transfer/control phases skip queued
eligibility discovery. Cloud and simulator dispatchers share a short
[admission queue](../../../packages/core/src/admission-queue.ts): FIFO within
each execution class, alternating native and inference heads when both wait.
A large inference burst therefore cannot put every native admission behind it.
The existing SQL claim still determines fair organization turns and capacity;
provider/model execution does not hold the local admission turn. After a losing
cloud admission claim, only its exact pending dispatcher lease is released,
without immediately loading the request and attempting the same admission again.

Ready native phases may exchange their local slot for a free next-class
slot within one bounded sixteen-advance/five-second quantum; full targets and
real waits yield to SQL. Phase state and its next due time publish atomically.
Retained local work keeps its crash backoff instead of being immediately stolen
by another poller. Every advance freshly claims current cancellation, deadline,
generation and phase ownership; only immutable accepted configuration is reused.
Local refill signals follow slot release or a handoff that frees the old pool;
merely consuming a slot does not wake another discovery sweep.

The simulator uses [LocalDispatcher](../../../packages/core/src/local-dispatch.ts) with separate inference and native/control pools. Only its short admission is sequential; executions remain asynchronous. Workflow starts take up to 100 candidate jobs and issue at most 16 start acknowledgements concurrently; admission remains SQL-coordinated. Workflow steps themselves are scheduled by the hosting platform, not the standalone process pools. All execution paths share fleet/account/Worker admission.

[MaintenanceDispatcher](../../../packages/core/src/maintenance-dispatch.ts) gives each component an independent non-overlapping cadence. Runs, tasks and triggers refresh two seconds after completion; other components refresh after fifteen seconds. Standalone Worker reconciliation independently refills eight slots, checking for due Workers on poller ticks (at most 750 ms idle). Slow Host creation no longer holds a whole batch or another maintenance component. Cron awaits bounded sweeps and starts run dispatch concurrently with maintenance. Graceful shutdown drains all owned work before closing pools. Required provisioning, funding or a writer can still make a particular Run wait.

Maintenance processes at most 100 expired/cancelled/unavailable queued runs per sweep, independently of dispatch leases and execution capacity. Local simulations whose worker heartbeat is older than 90 seconds are failed with `worker_lost`, lease-fenced, settled, and retain their prior verified worktree; their prompts are not replayed. Cloud workers instead resume inspection of the original machine through durable state. Deploy enough maintenance capacity to clear expiry backlogs promptly, and alert on overdue queued records. Typical expiry observation is the next two-second Run maintenance pass or configured Cron sweep; it is not an exact wall-clock guarantee during disruption.

The scheduler's sanitized reporting view exposes only IDs, lifecycle timestamps/status, scheduling and dispatch resource classes, and availability. It contains no prompts, file data, outputs or credentials. Tenant API observations are projected only for already-authorized run IDs. Cross-account reporting remains operator-only and audited.

Poller failures use structured `run_dispatch_unavailable`,
`poller_advance_failed`, `local_dispatch_failed`, `native_phase_failed`,
`dispatch_wakeup_unavailable` and `run_event_listener_unavailable` diagnostics. The shared
[error classifier](../../../packages/core/src/error-diagnostics.ts) preserves
controlled error type/code and PostgreSQL SQLSTATE when available. Successful
failure bookkeeping retains the original step cause; if authority/recovery SQL
also fails, that control failure takes precedence because recovery could not be
confirmed. Raw messages, SQL, connection URLs and request content are not copied
into these logs.

### Remaining scheduling limits

Answering a native question or cancelling an active quiet Run can still wait
for the normal two-second probe interval, even when control capacity is free.
Accelerating that path needs owner-safe due-job scheduling, not only a wake hint
or an unfenced overwrite of another controller's retained phase schedule.

Use matching execution-provider poller modes for one database. Heterogeneous
Docker and Vercel pollers sharing that database do not have provider-aware
candidate routing and are not a supported topology. This is distinct from
selecting supported Host offerings through the Worker abstraction.

Global wake hints reach every listening poller. Per-class scans coalesce while
in flight, but notification fanout and sustained discovery work at fleet scale
remain unqualified. The [maintainer follow-ups](../../maintainers/TODO.md#native-startup-failure-diagnostics)
track these limits; the original local latency record does not establish a
hosted or fleet-wide SLA.

## API and terminal UX

`POST /v1/runs` and `POST /v1/sessions/{id}/messages` accept:

```json
{
  "prompt": "Review the repository and save a report",
  "session_id": "019e1700-0000-7000-8000-000000000001",
  "queue_if_busy": true,
  "queue_timeout_seconds": 86400,
  "scheduling_class": "background",
  "limits": { "timeout_seconds": 900, "max_cost_micro_usd": "2000000" }
}
```

For the session-message route, omit `session_id` from the body. Background is the API default; the dashboard composer and attached CLI default to interactive, while detached CLI work defaults to background. The client-type header is telemetry, not the authority for priority. CLI examples:

```sh
macrofold run "Review this workspace" --timeout 1800 --queue-timeout 900 --scheduling interactive
macrofold run "Run the nightly analysis" --detach --queue-timeout 86400
macrofold run show RUN_ID --json
macrofold run attach RUN_ID
macrofold run cancel RUN_ID
```

Run/acceptance payloads expose `wait_seconds`, `waiting_reason`, `queue_expires_at`, `reserved_micro_usd`, and `scheduling_class`. Run status also exposes `execution_deadline`, null until claimed. Wait is submission-to-start; if never started it freezes at completion. Remaining held funds are zero after settlement. Reasons include `earlier_worktree_work`, `account_concurrency`, `global_capacity`, `scheduler_turn`, Worker lifecycle/capacity/funding reasons, and explicit cancellation/expiry/unavailable transitions; OpenAPI owns the complete enum. These are observations of mutable state, not a global queue position or ETA. The legacy advisory `queue_position` is no longer emitted.

Native acceptance initially reports `scheduler_turn`; the next Run status/list read calculates the detailed current reason. Admission does not scan the fleet to construct an advisory answer that may already change before delivery. A fresh Session's model/credential/limit configuration is validated once under its workspace/worktree admission guards and reused for its first Run; later Session messages revalidate their current configuration normally.

`GET /v1/organization/execution-policy` reports plan/effective caps. `PATCH` requires an unrestricted owner/admin with organization-write scope. Supply `concurrency_limit` and/or `max_timeout_seconds`; null resets a value to the plan. Responses include both effective and plan limits. API errors reject larger values rather than upgrading a subscription. The Billing API supplies all three plan cards and the effective policy. Public API documentation and both generated SDKs include these operations.

The dashboard's run list shows wait reasons/durations; run detail shows deadline, held funds and cancellation. Billing has three plan cards and execution controls. Attached human CLI streams poll waiting status every five seconds while durable SSE output continues. JSON/JSONL users inspect transient state through the ordinary run endpoint; the event log remains durable and ordered. `run.failed` with `data.code=queue_expired` distinguishes queue expiry from execution `run.timed_out`.

## Operator metrics and automation

Existing read-only capacity, health and operating reports include:

- Active executions and configured global ceiling.
- Total queued and eligible queued jobs; eligibility excludes account/worktree/expiry/availability and resource-class capacity blocks, but is independent of the optional aggregate fleet ceiling.
- Oldest eligible wait, measured from original submission rather than the last poll's `available_at`.
- Mean and p95 submission-to-start time over the requested report period, plus start count. Null means no observed starts.
- Per-account active/queued/eligible counts, oldest eligible wait, start count, mean and p95. Up to 100 accounts, ordered by oldest eligible wait; pass `organization_id` to inspect a particular account beyond the displayed window.

The existing operator MCP receives the same report without new write capabilities. The dashboard shows a capacity summary and account wait table. Billing budgets, prompts and files are not included in scheduling telemetry. Oldest dispatch-due age remains available separately for diagnosing delivery/polling problems. Begin investigating eligible waits above two minutes well before a day of tolerance becomes normal.

## Verification and measured limits

The [Worker verification record](workers/verification.md) owns current commit-scoped measurements. The 512-Run loopback HTTP/SDK/database workload completed with 32 simultaneous synthetic executions, three backing Host records, no observed resource violations and no deferred scheduling claims. External compute and model boundaries were simulated; native Docker performance is recorded separately. These are not production SLAs or multi-tenant fleet-capacity claims.

Profiling exposed two concrete costs: an inlined placement join repeatedly ran correlated Host checks, and inflated singleton-clock estimates triggered expensive JIT compilation. The shared query now materializes placement and Worktree heads once and explicitly bounds the clock to one row. Worktree heads preserve active-writer priority and queue ordering without scanning the same backlog for every candidate. No global JIT setting, new cache service, database-pool increase, or fairness relaxation was required.

The financial organization lock continues to use `FOR NO KEY UPDATE`, allowing foreign-key `KEY SHARE` readers while serializing balances. The global admission lock and restricted-role/RLS boundaries remain. The existing reusable suites can be invoked with `pnpm test:domain tests/integration/scheduling.test.ts tests/integration/billing.test.ts` and `pnpm test:load`, and the resource-capacity change reran the affected scheduling/load suites. Earlier native stress evidence remains separate. Add regression cases from [maintainer TODO](../../maintainers/TODO.md); runtime stress does not substitute for deferred suites.

Dispatchers preserve the fair candidate order after SQL claims and serialize only short admission transactions. Model and machine work remain concurrent. Racing a whole batch against the same admission locks can repeatedly defeat the eligible head even when capacity is free. [Capacity verification](../../engineering/capacity/README.md) records that reproduced failure, the fix, and the measured defaults; functional fleet-boundary tests do not certify live cloud throughput.

## Deployment capacity and rollout

Apply all forward migrations before the matching application, dispatcher and controller image. Drain active native execution before changing execution protocol versions; preserve published checkpoints and financial history. The [Worker operations guide](workers/operations.md) owns Host reconciliation, accepted prices, metering and shutdown. The [Workflow upgrade procedure](workflow-history.md#rollout-and-verification) owns orchestration handoff. Do not edit already-applied migration files to hide history.

For each enabled offering, verify real account/region identity, allocation ramp, control-request limits, concurrency quota, runtime image readiness, hard lifetime and final metering behavior. Model RPM/TPM/concurrency and storage/tool quotas are independent constraints. A public provider quota is not evidence that this deployment or harness mix reaches it.

Measure the deployment before increasing `GLOBAL_CONCURRENT_RUN_LIMIT`, Worker `max_concurrency`, or dispatcher process/step counts. Pools default to 80 domain, 20 authentication and 32 credential-refresh connections per process, each configurable; budget all replicas and administrative headroom accordingly. Inspect lock waits, pool waits, CPU/I/O, metadata plans, queue age, account waits, finalization lag and funding obligations. Do not enlarge pools to conceal repeated SQL work.

Run progressive local then explicitly budgeted hosted workloads: bursts, long jobs, new organizations, mixed Workers, expiration, graceful pause, forced cancellation, Host loss and recovery. Verify no duplicate launches, lost persistence, resource oversubscription, reservation drift or placement-based price changes. Maintain enough provider headroom for draining and uncertain allocations; application active-Run count alone does not represent all purchased capacity.

Worker autoscaling adjusts eligible Host capacity within accepted customer limits. It does not replace fleet provisioning, raise subscription entitlements, preempt active work, or predict traffic. Platform-wide ceiling changes require a consistent rollout across all dispatchers. Lower limits drain naturally; a protocol rollback requires paused admission, drained executions, and deliberate forward-compatible recovery rather than replaying prompts or deleting ledger/history rows.

Record environment, source/image versions, actual quotas, paid usage, latency distributions, fairness and recovery outcomes before advertising capacity promises. Stop increasing capacity when eligible work grows without progress, provider throttling rises, or finalization/funding safety degrades.

## Lightweight decision capacity

[Decision runs](../decisions/README.md) share organization/global occupancy. Direct `POST /v1/inferences` admits running work immediately or refuses before dispatch; it has no queue timeout or fair-turn dependency. Native, bounded and Task-child work retains queued ordering. Both paths use `execution-admission.ts` for active occupancy and caps, while `scheduling.ts` alone owns queued turns and weighting. An old queued head cannot block otherwise available immediate capacity.

`LIGHTWEIGHT_CONCURRENT_RUN_LIMIT` bounds lightweight occupancy (default 2,000); native occupancy defaults to 200. `LIGHTWEIGHT_RESERVED_SLOTS_PER_ORG` defaults to zero and can withhold native account slots for lightweight use; it does not reserve progress between immediate and queued lightweight work. No setting expands the plan cap or preempts active work. Under sustained saturation either mode can be delayed or refused; guaranteed per-mode progress is deferred. Direct saturation returns a typed 429/503; queued waiting reasons retain their existing meanings.

Immediate admission skips scheduler history/placement and records no virtual turn. Its existing outbox row is a running recovery job fenced through provider deadline plus 30 seconds, rather than ordinary queued dispatch. Recovery checks that stable deadline or explicit generation handoff, never the job's mutable dispatcher backoff. Successful direct requests and replays do not nudge a poller/Workflow; exceptional evidence recovery and unrelated queued mutations still do. The shared batched cancellation observer and local in-flight/admission bounds are described in [decision implementation](../decisions/implementation.md).

## Changelog

- Queue tolerance increased from one hour to 24 hours independently of execution timeouts. Three plans and PostgreSQL-coordinated organization turns replace a global FIFO backlog; the measured reasons for the dispatcher and financial-lock choices are retained in the [architecture decisions](../../architecture/decisions.md#changelog).
