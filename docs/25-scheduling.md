# Execution plans, durable queues and fair scheduling

Implemented September 6, 2026. This document is the current policy; it supersedes older one-hour queue and two-plan descriptions. The implementation retains the modular Next.js control plane, PostgreSQL outbox, Vercel execution adapter, optional standalone poller, SSE, persistent workspaces and immutable credit ledger.

## Product policy

| Plan             | Subscription + metered usage | Included monthly credit | Maximum active jobs | Maximum execution lifecycle | Scheduling weight |
| ---------------- | ---------------------------: | ----------------------: | ------------------: | --------------------------: | ----------------: |
| Starter (`payg`) |                     $0/month |                      $0 |                   2 |                  30 minutes |                 1 |
| Pro (`pro`)      |                    $29/month |                     $10 |                  10 |                  60 minutes |                 2 |
| Scale (`scale`)  |                   $199/month |                     $50 |                  50 |                 120 minutes |                 4 |

The catalog is [plans.ts](../packages/core/src/plans.ts). Starter suits individual interactive work, Pro several independent repositories/a small team, and Scale a large power user running dozens of worktrees or batch agents. All use the same compute/model/tool rates; a subscription is not unlimited execution. See [cost model and pricing rationale](06-billing-costs.md). The configured platform ceiling still defaults to 50; a Scale account's 50-job entitlement is not a guarantee that the whole deployment is immediately free. Test and enlarge shared infrastructure before enrolling enough power users to saturate it.

A customer means an **organization**, shared by all members, API keys, sessions and projects. Creating another credential does not evade its cap. Workspace caps remain one active writer; use independent workspaces/worktrees for actual parallel edits. Account policy is owner/admin-configurable downward, up to the paid plan's limits. Null means inherit the plan. Runtime and concurrency are independently configurable. A smaller concurrency cap drains existing jobs naturally; it never cancels them. A queued job above a newly lowered execution cap fails explicitly with `execution_limit_changed`; its requested execution window is not silently truncated. An operator can use the same authorized customer API for account assistance; the read-only operator MCP does not acquire mutation tools.

| Clock             | Default / maximum                                                | Begins                                     | Expiry behavior                                                                 |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Queue deadline    | 86,400 seconds; request may choose 1–86,400                      | Submission transaction                     | Failed run, `queue_expired`, terminal failure event, reservation released       |
| Execution timeout | 900 seconds, or lower account cap; plan/account maximum enforced | Claim into provisioning                    | Existing timeout/cancellation/persistence recovery path                         |
| Detailed history  | Starter 30 days; Pro/Scale 90 days                               | Existing completion-based retention policy | Detailed content pruned by retention maintenance, independent of queue deadline |

Queue expiry never deletes the request/status/history. Queued work occupies no execution slot and spends no compute, but its full maximum-cost budget remains reserved. Those funds are unavailable for other runs for up to the queue deadline, including during an outage. Cancelling a queued job settles it immediately with zero execution cost. Expiry/cancellation processing is transactional and idempotent; duplicate workers cannot release the same funds twice. A maintenance outage can delay settlement until the next successful sweep, so the API can briefly show `deadline_expired` before final failure.

Migration 024 changes the SQL default for **new** rows only. It does not rewrite historical deadlines or change running timeouts. The admission API writes the per-request deadline explicitly. Execution's `deadline` is created only when capacity is claimed; provisioning, input waits and persistence consume the same lifecycle window and active slot.

## Scheduling algorithm

[scheduling.ts](../packages/core/src/scheduling.ts) defines the shared eligibility query. [engine.ts](../packages/core/src/engine.ts) applies it at the actual transition to provisioning, under the existing `capacity:global` transaction advisory lock. Candidate lists are hints, never authorization to exceed a limit. All workers and targeted Workflow retries obey this decision.

1. Resolve the run's current actor, project/workspace availability, cancellation, queue deadline and current execution cap. Clean up invalid/expired work before capacity checks.
2. A queued run is eligible only when its workspace has no earlier queued work and no active writer, its organization is below its current cap, it has not expired/cancelled, and its project/workspace is available. Workspace ordering is `(created_at, id)`; identifiers break timestamp ties.
3. Select the oldest eligible run in each organization, giving interactive candidates first consideration **within that organization**. Across organizations, interactive heads sort before background heads. An interactive follow-up cannot jump its workspace's earlier writer.
4. Choose the eligible organization with the lowest effective virtual service, minus its bounded age bonus. Break ties by oldest submission then ID. Effective service is `max(organization.scheduler_finish, scheduler_clock.virtual_time)`. A successful start advances the organization by `1 / plan_weight` and the shared clock to the selected effective service. Both writes commit with the run's provisioning transition. Idle/new organizations join at the current clock, so they neither accumulate unlimited credits nor repay historical activity. Under steady equal-class eligibility, relative start opportunities approach 1:2:4, rather than reserving slots permanently by tier.
5. Each full minute of waiting earns 1/16 of a virtual turn, capped at 1/4 after four minutes. This nudges older work ahead within its class while retaining bounded access for newly arriving tenants. FIFO within a workspace remains authoritative. This is a small age adjustment, not a customer-selectable priority hierarchy.
6. Count active `provisioning`, `running`, `waiting_for_input` and `persisting` runs against both account and global limits. Commit one claim while holding the global lock; release it before native execution. If no other tenant is eligible, the available customer keeps receiving turns up to its cap.

**Interactive headroom is operational, not a hard reservation.** To satisfy work conservation, this release lets background jobs borrow all otherwise idle capacity. Interactive requests receive the next eligible free-slot opportunity, but cannot evict long-running jobs or bypass their own account/workspace cap. Do not promise immediate CLI response while filling the entire ceiling with background work. Maintain measured spare capacity by sizing the ceiling above expected sustained usage, verifying provider quotas, and raising it before long waits become normal. Continuous interactive demand can delay background work; aging never overrides interactive priority. Product-reserved slots, preemption, SLAs and an autoscaler are deliberately out of scope.

The fairness model follows the noisy-neighbor principle in [AWS fair queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fair-queues.html): tenant-aware opportunities and work conservation, rather than a single global FIFO. Our workspace ordering, hard tenant caps, plan weights and execution lifecycle are application policy, not claims of equivalence to SQS.

## Orchestration and failure behavior

Queue waiting resides in PostgreSQL. The Workflow dispatcher claims capacity **before** creating a Workflow. A pre-upgrade Workflow that discovers its run is still queued releases the outbox lease and exits, rather than sleeping every five seconds for a day. The next dispatch sweep picks it up when eligible. This avoids exhausting the provider's step/event history during a 24-hour queue wait. Once started, the existing bounded cloud state machine manages the original sandbox/execution identity; a lost response never replays the prompt. A failed Workflow start remains durable and is retried through its dispatch record. On completion, a bounded Workflow step notifies the dispatcher to refill freed capacity immediately, including pending jobs still in a short failed-claim backoff. It preserves active dispatch leases and rechecks the same SQL eligibility/limits. The one-minute Cron sweep remains the recovery fallback; normal completion does not wait for that minute.

Standalone poller workers claim due rows with `FOR UPDATE SKIP LOCKED`; queued dispatch claims have a five-second lease and active cloud steps a two-minute lease. Running steps receive polling priority so cleanup can free capacity. Local simulator workers use [LocalDispatcher](../packages/core/src/local-dispatch.ts): a bounded set of up to 20 in-flight attempts per process, polling independently of execution duration. A slow batch no longer blocks fresh work in an otherwise free slot. The production poller retains its existing bounded step concurrency setting.

Maintenance processes at most 100 expired/cancelled/unavailable queued runs per sweep, independently of dispatch leases and execution capacity. Local simulations whose worker heartbeat is older than 90 seconds are failed with `worker_lost`, lease-fenced, settled, and retain their prior verified workspace; their prompts are not replayed. Cloud workers instead resume inspection of the original machine through durable state. Deploy enough maintenance capacity to clear expiry backlogs promptly, and alert on overdue queued records. Typical expiry observation is the next 15-second worker maintenance pass or configured Cron sweep; it is not an exact wall-clock guarantee during disruption.

The scheduler's sanitized reporting view exposes only IDs, lifecycle timestamps/status, scheduling class and availability. It contains no prompts, file data, outputs or credentials. Tenant API observations are projected only for already-authorized run IDs. Cross-account reporting remains operator-only and audited.

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
agent run "Review this project" --timeout 1800 --queue-timeout 900 --scheduling interactive
agent run "Run the nightly analysis" --detach --queue-timeout 86400
agent run show RUN_ID --json
agent run attach RUN_ID
agent run cancel RUN_ID
```

Run/acceptance payloads expose `wait_seconds`, `waiting_reason`, `queue_expires_at`, `reserved_micro_usd`, and `scheduling_class`. Run status also exposes `execution_deadline`, null until claimed. Wait is submission-to-start; if never started it freezes at completion. Remaining held funds are zero after settlement. Reasons are `earlier_workspace_work`, `account_concurrency`, `global_capacity`, or `scheduler_turn`, with explicit cancellation/expiry/unavailable transition reasons. These are observations of mutable state, not a global queue position or ETA. The legacy advisory `queue_position` is no longer emitted.

`GET /v1/organization/execution-policy` reports plan/effective caps. `PATCH` requires an unrestricted owner/admin with organization-write scope. Supply `concurrency_limit` and/or `max_timeout_seconds`; null resets a value to the plan. Responses include both effective and plan limits. API errors reject larger values rather than upgrading a subscription. The Billing API supplies all three plan cards and the effective policy. Public API documentation and both generated SDKs include these operations.

The dashboard's run list shows wait reasons/durations; run detail shows deadline, held funds and cancellation. Billing has three plan cards and execution controls. Attached human CLI streams poll waiting status every five seconds while durable SSE output continues. JSON/JSONL users inspect transient state through the ordinary run endpoint; the event log remains durable and ordered. `run.failed` with `data.code=queue_expired` distinguishes queue expiry from execution `run.timed_out`.

## Operator metrics and automation

Existing read-only capacity, health and operating reports include:

- Active executions and configured global ceiling.
- Total queued and eligible queued jobs; eligibility excludes account/workspace/expiry/availability blocks, but is independent of global fullness.
- Oldest eligible wait, measured from original submission rather than the last poll's `available_at`.
- Mean and p95 submission-to-start time over the requested report period, plus start count. Null means no observed starts.
- Per-account active/queued/eligible counts, oldest eligible wait, start count, mean and p95. Up to 100 accounts, ordered by oldest eligible wait; pass `organization_id` to inspect a particular account beyond the displayed window.

The existing operator MCP receives the same report without new write capabilities. The dashboard shows a capacity summary and account wait table. Billing budgets, prompts and files are not included in scheduling telemetry. Oldest dispatch-due age remains available separately for diagnosing delivery/polling problems. Begin investigating eligible waits above two minutes well before a day of tolerance becomes normal.

## Verification and measured limits

The repeatable tests use actual local PostgreSQL through the restricted application role, temporary databases/object directories and multiple Node processes. They call the real admission, scheduler, execution, persistence, cancellation and settlement code with explicitly simulated agents. They do not create cloud resources or call a model. Run:

```sh
pnpm test:domain tests/integration/scheduling.test.ts tests/integration/billing.test.ts
pnpm test:load
```

The load suite uses its own fresh database; it must not share a backlog intentionally left by unrelated lifecycle tests. Set `SCHEDULING_REPORT_PATH` to a local filename to retain the load report outside the temporary fixture directory. The isolated suite also verifies Workflow admission, legacy queue handoff, and completion-triggered dispatch without vendor calls. Tests cover the three tier ceilings, overrides/resets/authorization, shorter and invalid queue deadlines, expiry behind an active writer at full global capacity, duplicate cleanup and financial release, exact weighted opportunities, interactive workspace ordering, later arrivals, bursts/sustained traffic, real process termination, no prompt replay, and subsequent recovery. Stripe protocol fixtures cover Pro and Scale recurring-credit reconciliation; these are not authenticated Stripe account acceptance.

Final local acceptance on September 6, 2026 passed all four load cases:

| Experiment                                                                  | Measured result                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 93 jobs, three processes, eight shared slots, mixed sustained/burst traffic | Peak 8; zero observed account/global/writer violations in 1,172 samples; 65.21 seconds including setup, traffic injection and recovery                              |
| Four newly arriving customers alongside heavy accounts                      | Start waits 957, 1,548, 590 and 446 ms; each received a turn within the asserted 12 intervening start opportunities                                                 |
| Overall start wait in that deliberately congested mix                       | p95 39.28 seconds; the earlier independent run measured 14.15 seconds, illustrating local timing variability rather than a latency guarantee                        |
| 60 jobs on one Scale account, three processes, 50 shared slots              | Reached 50 active jobs; all 60 completed; zero observed ceiling violations; 5.20 seconds after worker startup (simulated agents held until the ceiling was reached) |
| Original batch loop versus continuous local dispatcher                      | Newly arriving interactive job waited 2,693 ms versus 91 ms with a 2.5-second job already running and three free slots                                              |
| Idle-queue query after the mixed load drained                               | Ten client observations 2.66–4.50 ms; PostgreSQL execution 0.952 ms; this does not measure lock contention or query cost at a large backlog                         |

The load fixture polls every 50 ms; the ordinary local worker polls every 750 ms. The before/after comparison isolates the dispatch-loop pattern at the same fixture cadence. It is not a claim of 91-ms production dispatch latency.

The mixed run included cancellation, explicit expiry, a killed worker, replacement, reservation settlement, persistent checkpoint code and no duplicate execution starts. Reports are written to the configured `SCHEDULING_REPORT_PATH` and a companion `-50.json` file. These are sampled local simulator observations, not a production throughput benchmark or SLA. Local results do not validate 50 live sandboxes, model quotas, cloud Workflow history, or production p95 latency.

Two fixes were justified by this experiment: the batch worker wasted available capacity behind a 2.5-second simulation; and concurrent checkpoint inserts/settlement caused a PostgreSQL lock-upgrade deadlock. Financial organization locks now use `FOR NO KEY UPDATE`, preserving balance serialization while allowing foreign-key `KEY SHARE` locks. The global capacity advisory lock remains. Query plans and client timing are recorded; no speculative index/cache/queue replacement was introduced.

## Manual scaling and rollout

1. **Apply migration 024 before new application code.** It adds nullable account caps, virtual scheduler state and a sanitized reporting view, a selected-plan binding on checkout orders, and changes only the default for newly inserted queue deadlines. Use the migration role with `pnpm db:migrate`; run API/workers with the restricted role. Configure both approved Stripe prices and Portal switches before offering Scale. Complete the [pre-deployment checklist](21-pre-deployment-checklist.md).
2. **Record actual upstream quotas.** In Vercel, verify team/project/region, sandbox concurrency, allocation ramp, control-request rates, immutable runtime image readiness, maximum lifetime (including adapter recovery allowance), and other projects' consumption. Confirm per-model RPM/TPM/concurrent-request quotas for every managed route and account-level BYOK restrictions. R2, GitHub, MCP/Composio and search quotas matter for representative tool-heavy work. Published limits are not evidence that your account or workload reaches them. Vercel Pro's documented 10,000 sandbox concurrency does not establish application capacity. [Sandbox quotas](https://vercel.com/docs/sandbox/pricing).
3. **Measure the deployment at its present ceiling.** Collect active/ceiling, eligible count/oldest wait, start-wait p95, per-account waits, request latency/errors, Workflow event/data growth, sandbox API errors, DB pool wait/CPU/IO/connections, object growth and reconciliation freshness. Preserve room for interactive requests and uncertain/cleanup machines still occupying provider quota. Never infer provider-free slots from application active count alone.
4. **Check database capacity before adding workers.** Each process can open five domain, three authentication and two credential-refresh connections: budget ten per instance plus migration/monitoring/admin headroom. Pooling client limits are not backend throughput. Inspect `pg_stat_activity`, slow-query/lock evidence and representative `EXPLAIN (ANALYZE, BUFFERS)` under a read-only metadata query. If saturated, increase Neon/database compute and connection budget first; repeat tests before changing query/index strategy. Keep transaction-scoped tenant settings/advisory locks and restricted roles. Never replace the global capacity lock without measured contention evidence.
5. **Run progressive local then controlled cloud tests.** Start with 4–8 slots, then 16, 25, 50, and higher only with recorded passing evidence. Use multiple organizations and workers; include long jobs, bursts, new arrivals, CLI interaction, expiry, cancellation, worker death and restore. Assert no account/global/writer cap violations, duplicate native launches, reservation drift or unfair new-tenant waits. A cloud smoke test costs money and must be explicitly budgeted by the operator; local simulation cannot establish real model/persistence throughput.
6. **Raise `GLOBAL_CONCURRENT_RUN_LIMIT` gradually** on every scheduler/Workflow deployment, keeping the same value throughout the deployment after rollout. More workers increase control-plane dispatch throughput, not tenant entitlements or provider quotas. The standalone poller initially uses `WORKER_CONCURRENCY=4` bounded steps per tick; adjust replica count/step concurrency only after DB/provider measurements show room. With Workflow, verify Cron/execution dispatch and the absence of long-lived waiting Workflows. Do not mix old/new scheduler backends without the documented drain procedure.
7. **Observe a full representative period at each increase.** Stop increasing if eligible wait grows continuously, DB/provider throttling rises, persistence/financial health deteriorates, or new accounts stop receiving opportunities. Inspect the cause; do not interrupt running agents to make room. Maintain admission/signup pause switches for disruption. Lowering an account cap naturally drains; lowering a global ceiling across deployments should use a planned admission pause and full queue/execution drain so old worker versions cannot keep using a higher ceiling. Resume only after the new configuration is uniform and recovery checks pass.
8. **Record evidence.** Save environment/versions, actual quotas, test size/durations, starts and wait distributions, per-account service, pool/lock pressure, provider usage costs and recovery outcome. Publish capacity promises only after the corresponding live workload passes. Twenty-four hours is tolerance for disruption, not a normal operating target.

Rollback: pause admission and drain the old/new schedulers before switching versions. Prefer forward recovery. Migration 024 is additive except the default; old rows and accounting remain readable. If reverting to an old two-plan release, first migrate any Scale subscriptions/entitlements through a deliberate supported billing policy—old code treats unknown plans incorrectly. An optional SQL rollback would restore the one-hour default and drop the reporting view, scheduler clock, checkout plan binding and new organization columns only after the new application is fully drained; it must not delete run/history/ledger rows. Existing explicit queue deadlines remain unchanged. Back up before schema removal, and re-run restricted-role admission, financial concurrency and restore checks after any rollback.
