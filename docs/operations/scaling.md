# Scalability guide and operating plan

Research and source inspection: **September 6, 2026**.

This guide covers the implemented Vercel-first application, the smallest useful scaling improvements, provider constraints, capacity planning, and the evidence required before raising production limits. It supplements [implementation status](../status/README.md), [portability](../architecture/portability.md), [deployment steps](deployment.md), and [testing and CI](../engineering/testing.md).

[Execution scheduling](../features/execution/scheduling.md) defines the three plans, 24-hour new-job deadlines, PostgreSQL fairness, queue visibility and operator metrics. Its verification section records local multi-process load evidence. This guide describes current controls and the measurements required before increasing them; it does not certify production capacity or an SLA.

## 1. What we can establish now

Documentation answers what a provider offers, how its limits work, and how to configure it. It cannot establish our account's overrides, actual database pressure, or the throughput of this particular application.

The app's **50 concurrent executions** is a configurable guardrail, not a limitation of Next.js. Current Vercel Pro documentation lists a much larger sandbox concurrency allowance. However, sandbox creation speed, control API traffic, Workflow history, database work, and model throughput can become limiting much earlier.

Two implementation interactions deserve attention before the next capacity increase:

- **Workflow history is now bounded independently of queue duration and phase count.** SQL owns blocked waiting; running Workflows continue the same persisted execution after 128 advances. Verify deployed replay and event counts before launch.
- **Sandbox status checks generate provider API traffic.** At larger concurrency, the current polling approach can encounter a request quota well before the concurrent-sandbox quota.

Keep the current framework and provider boundaries. Start with a durable, fair queue, visible capacity, bounded polling, and staged testing. There is no evidence here that an Express migration, Kubernetes cluster, or another queue service is necessary.

## 2. Current topology and controls

```text
Dashboard / CLI / public API clients
                 |
        Next.js API on Vercel
                 |
        domain services + PostgreSQL
        auth, ledger, runs, events, dispatch records
                 |
       Vercel Workflow orchestration
                 |
      independent Vercel Sandboxes
       agent runtime + model/tool gateway
                 |
      private object storage / optional GitHub sync
```

API handlers submit durable work and return run identifiers; they do not keep an HTTP request open for the whole agent execution. Workflow advances bounded phases. Files and run history outlive an individual function or sandbox.

The standalone alternative runs the same domain and provider code with Node web/worker processes. PostgreSQL dispatch leases allow multiple workers. This is an alternative deployment topology, not another scheduler to activate alongside Workflow without a migration procedure.

| Control | Implemented value or behavior | What changing it means |
| --- | --- | --- |
| `GLOBAL_CONCURRENT_RUN_LIMIT` | Defaults to `50`; validated from `1` through `10000` | Global execution admission ceiling; requires deploying updated scheduler configuration |
| Organization concurrency | Starter: `2`; Pro: `10`; Scale: `50` | Additional plan ceiling; raising the global limit does not change these |
| Active slot states | `provisioning`, `running`, `waiting_for_input`, `persisting` | Input waits and persistence occupy capacity too |
| Workspace writer | One active execution per workspace | Independent worktree/workspace folders can run concurrently |
| Queue expiry | New rows: creation time + `24 hours` | Request `queue_timeout_seconds` may shorten to 1–86,400 seconds; migrations 024/027 preserve old deadlines |
| Execution timeout | Default `min(900, account cap)` seconds; Starter/Pro/Scale caps `1800`/`3600`/`7200` | Separate from time spent queued; begins when claimed |
| Sandbox shape | `2` vCPUs; persistent sandbox, immutable runtime image | Resource sizing is currently adapter code, not a customer autoscaling control |
| Sandbox timeout | Run timeout plus `1800` seconds | Allows lifecycle overhead; is not an extension of the user's execution deadline |
| `ORCHESTRATION_BACKEND` | `workflow` by default; `poller` alternative | Selects the deployment's orchestration mechanism |
| `WORKER_CONCURRENCY` | Poller default `4`; phase dispatcher clamps to `1..20` | Simultaneous orchestration steps per poller invocation, not the number of remote agents |
| Workflow queue checks | Queued work stays in PostgreSQL | Start Workflow only after claiming capacity; no day-long queue polling history |
| Runtime checks | Normal cloud phase delay approximately `2` seconds | Actual interval also includes step and provider latency |
| Detailed run SSE | Up to `55` seconds per connection, followed by reconnect/replay | Each reader polls independently, with at most one prefetched page |
| Dashboard refresh SSE | One shared subscription per tab; bounded invalidation and reconciliation | Process-shared SQL reads of current revision stamps; best-effort signals, no replay log |
| `RUN_ADMISSION_ENABLED=false` | Rejects new run submissions | Does not cancel accepted runs or prevent their queued dispatch |
| `PUBLIC_SIGNUP_ENABLED=false` | Pauses registration | Independent of execution admission |
| `ALLOW_PAID_EXECUTION=false` | Blocks further paid execution paths | Emergency control, not a graceful drain mechanism |

Sources: [configuration](../../packages/core/src/config.ts), [run admission](../../packages/core/src/runs.ts), [claim coordination](../../packages/core/src/engine.ts), [initial schema](../../packages/db/001_initial.sql), [cloud phases](../../packages/core/src/cloud-engine.ts), [sandbox adapter](../../packages/providers/src/vercel.ts), [poller](../../packages/core/src/portable-dispatch.ts), [worker](../../scripts/worker.ts), and [SSE implementation](../../packages/core/src/events.ts).

The single-writer boundary is the **workspace**, which represents an independently writable checkout/worktree. A project can contain several. Merely choosing different Git branch names inside the same writable folder does not make concurrent writes safe.

## 3. Provider limits to record

### Vercel Sandbox

Published limits checked on the research date:

| Dimension | Hobby | Pro |
| --- | ---: | ---: |
| Concurrent sandboxes | 10 | 10,000 |
| Maximum session duration | 45 minutes | 24 hours |
| Initial vCPU allocation/minute | 20 | 150 |
| Maximum vCPU allocation/minute | 40 | 5,000 |
| Control requests/minute | 1,000 | 10,000 |
| Deletions/second/team | 20 | 20 |
| Maximum vCPU / memory per sandbox | 4 / 8 GB | 8 / 16 GB |

Allocation capacity increases with sustained creation and resets after ten idle minutes. Enterprise lists 100,000 control requests/minute; custom agreements can differ. [Official Sandbox quotas and pricing](https://vercel.com/docs/sandbox/pricing).

For our two-vCPU shape, the initial Pro allocation budget corresponds to approximately **75 new sandboxes/minute**. This is an arithmetic planning estimate, not an assurance that every request starts immediately. A burst of 1,000 accepted jobs must tolerate provisioning over time.

Record the actual team, plan, region, any custom quota, and consumption by other projects. Reconcile provider-visible machines with app run states: provisioning uncertainty, delayed cleanup, and recovery can leave provider capacity occupied after the app's active-run count has fallen. Preserve headroom for this difference.

### Vercel Workflow

| Dimension | Published limit |
| --- | ---: |
| Steps per workflow run | 10,000 |
| Events per workflow run | 25,000 |
| Workflow creations/second | 1,000 |
| Pro Workflow requests/minute | 1,000,000 |
| Replay slowdown advisory | Above 2,000 events or 1 GB entity storage |
| Pro retention after completion | 7 days |

A normal step produces three events; retries and other operations add history. Workflow duration can be unbounded while its history remains bounded. Product run history must remain in our own database/object storage. [Workflow limits and pricing](https://vercel.com/docs/workflows/pricing).

The underlying [Vercel Queues service](https://vercel.com/docs/queues/pricing) has its own message retention and delivery semantics: default message TTL is 24 hours, maximum seven days. That is **not** the app's `runs.queue_expires_at`, nor the maximum lifetime of a Workflow. Do not change product expiry based on a similarly named provider setting.

### Vercel Functions and HTTP

Pro Functions currently document 30,000 concurrency, 300-second default duration, and 800-second generally available maximum duration. Payloads are limited to 4.5 MB; the file-descriptor limit is 1,024, including runtime use. Fluid Compute can handle multiple requests within an instance. [Function limits](https://vercel.com/docs/functions/limitations).

Scaling has a burst ramp, initially up to 1,000 concurrent executions per ten seconds per region; throttled requests can receive `503`. A published concurrency maximum is not a guaranteed request rate. [Concurrency scaling](https://vercel.com/docs/functions/concurrency-scaling).

Our API route sets `maxDuration=300`. Verify that each individual restore, upload, or orchestration phase fits this boundary. Test the deployed staged transfer path: a file limit accepted locally can still exceed the HTTP platform limit, particularly after JSON/base64 overhead. Large workspace restoration must remain chunked and bounded. Do not enlarge a request handler to encompass an entire agent run.

### Neon PostgreSQL

Neon's pooler uses transaction-mode PgBouncer, with up to **10,000 client connections**. Backend query capacity remains finite. The documented backend pool allocation is 90% of `max_connections` per user/database pool, with all pools still sharing the database limit. Session-dependent behavior, including session `search_path` and `LISTEN`, needs special handling. [Connection pooling](https://neon.com/docs/connect/connection-pooling).

Current documentation gives this connection-cap formula:

```text
effective_CU = min(max_CU, 8 × min_CU)
max_connections = max(100, min(4000, floor(effective_CU × 419.66)))
```

For example, both `0.25..2 CU` and `0.25..4 CU` yield 839 under that formula; raising the upper bound alone need not increase the connection ceiling. A fixed `4 CU` yields 1,678. Seven connections are reserved. Record the actual `SHOW max_connections` result; old indexed tables and different endpoint settings are not authoritative for our deployment. [PostgreSQL compatibility and connection settings](https://neon.com/docs/reference/compatibility).

One CU corresponds to approximately 4 GB RAM plus CPU resources. Current documented autoscaling reaches 16 CU, with a maximum eight-CU difference between minimum and maximum. Fixed sizing can reach 56 CU on eligible plans. Automatic scaling within an existing range differs from editing endpoint settings: changing fixed size or min/max can restart the endpoint and disconnect clients. [Compute configuration](https://neon.com/docs/manage/computes), [autoscaling](https://neon.com/docs/introduction/autoscaling), and [plan availability](https://neon.com/pricing).

### Storage and integrations

| Dependency | Documented constraint / scaling action |
| --- | --- |
| Cloudflare R2 | Writes to the same object key are limited to one/second. Test duplicate chunk writes and checkpoint contention; retain private S3 access. The management API quota is separate from object operations. [Limits](https://developers.cloudflare.com/r2/platform/limits/) |
| GitHub | Installation REST limits start at 5,000/hour, with plan/installation adjustments and secondary limits, including concurrency. Inspect returned rate headers. Avoid syncing every small file edit through separate REST calls. Git transport and LFS have their own behavior. [Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) |
| Stripe | Default global limits: 100 requests/second live, 25 in sandbox; endpoint limits also apply. Preserve idempotency and webhook reconciliation during throttling. [Rate limits](https://docs.stripe.com/rate-limits) |
| Resend | Current default is 10 requests/second/team across API keys; daily/monthly email quotas are additional. A signup burst needs retryable delivery and visible failures. [Usage limits](https://resend.com/docs/api-reference/rate-limit) |
| Model providers | Record actual account/project/model request and token allowances, concurrent streams, spend limits, and returned throttling headers. No universal quota follows from user count. |
| Search, connectors, remote MCPs | Record plan quotas, per-user/provider limits, latency, timeouts, and retry behavior. BYOK changes whose quota is used; it does not remove the limit. |
| Customer webhooks | Slow or failing destinations must not hold execution capacity indefinitely. Track delivery backlog and retry age separately from run completion. |

For model, search, and connector accounts, this guide does not claim an authenticated quota check. The existing [pre-deployment checklist](pre-deployment.md), [launch guide](launch-guide.md), and [deployment steps](deployment.md) remain required. Do not silently substitute platform credentials when customer credentials are exhausted.

## 4. Turn user growth into a capacity model

Plan using arrival rates, durations, and resource demand:

```text
average occupied execution slots ≈ runs arriving per minute × mean slot minutes/run
ideal completion throughput ≈ available slots / mean slot minutes/run
```

For 1,000 daily active users, assuming evenly distributed demand:

| Usage per user/day | Average occupied slots |
| --- | ---: |
| One ten-minute run | 6.9 |
| One hour total | 41.7 |
| Four hours total | 166.7 |
| Continuous execution | 1,000 |

These are illustrative workload calculations, not tested user capacities. Real traffic has bursts, long tails, failures, input waits, startup time, and persistence time. One customer can create many runs; many registered users can create none.

At 50 slots and ten-minute average occupancy, ideal service is five runs/minute. If arrivals remain six/minute, backlog grows by roughly 60 runs/hour. A longer expiry avoids premature failure but cannot stabilize that queue. Sustained arrivals must remain below effective service capacity, with room for bursts and repairs.

A safety ceiling bounds simultaneous resource demand and spending exposure. It also stops an admission surge from pushing every downstream dependency into retry loops. Keep it even when infrastructure scales automatically. The right ceiling is the lowest safe value established by workload tests, provider quotas, and the operating budget, allowing recovery headroom.

Use 20–30% spare capacity as an initial planning assumption, then revise from measured burst and recovery behavior. This is a proposed operating margin, not a provider guarantee.

## 5. Concrete bottlenecks in this implementation

### A. Queue waiting and Workflow history

Queue waiting now resides in the PostgreSQL outbox, with expiry-bounded adaptive failed-claim delays toward 48–60 seconds. Eligibility checks and completion notifications can wake jobs earlier. A full-day queue wait adds no Workflow history. Migration 027 reasserts the 24-hour default for new jobs without modifying accepted deadlines.

Execution and persistence are also bounded: each Workflow advances at most 128 phases, then hands off the same SQL execution state through the outbox. This supports large manifests without restarting the native agent or its reservation. The conservative bound is **1,449 events and 257 steps including sleeps** per invocation, counting all three SDK retries on every ordinary step. The existing maximum workload cannot safely fit one monolithic Workflow even if queue checks slow to a minute.

The [history-budget reference](../features/execution/workflow-history.md) owns the verified SDK behavior, full workload model, ownership/recovery protocol, latency and rollout. Staging must still validate compiled replay/event counts, Vercel Cron recovery and maximum transfer completion within provider quotas/lifetime. Local history arithmetic is not a measured 10-GiB cloud transfer.

### B. Sandbox control requests

[The adapter's `probe`](../../packages/providers/src/vercel.ts) resolves the sandbox, runs a probe command, and reads its output. SDK internals can add requests. Other phases also perform provider operations.

```text
estimated control requests/minute
  = active sandboxes × checks/minute × requests/check + other operations

illustration: 200 × (60 / 2) × 2 = 12,000 requests/minute
```

This example assumes just two counted requests/check and no other traffic. It demonstrates why a cap of 200 needs measurement of the pinned SDK's actual request behavior. Latency may reduce the observed check frequency; additional requests increase it.

Instrument calls by operation and status without recording credentials or customer content. Reduce redundant lookups, coalesce reads, and adapt idle checks where correctness permits. Reserve request budget for starts, cancellation, persistence, and cleanup. Handle throttling with bounded backoff; do not retry ambiguous creation or command side effects blindly.

### C. PostgreSQL and output streaming

Each detailed run SSE iteration reads events and run status in separate transactions. Pull-based delivery limits prefetch to one page; a stalled reader does not keep loading its history. An idle stream waits 750 ms; an active stream waits 150 ms after delivering a batch.

```text
1,000 idle streams × 2 reads / 0.75 seconds ≈ 2,667 SELECTs/second
```

That estimate excludes transaction setup and other API/database work, and assumes negligible query latency. The stream releases database connections between polls, but still creates query load. Several viewers of one run repeat the same reads. The separate [dashboard refresh channel](../features/dashboard/live-refresh.md) coalesces revision reads within each application process and never streams detailed agent output.

First measure this path. The simplest improvements are combining appropriate reads, adaptive idle polling, and coalescing reads for subscribers in the same process. Preserve ordered event IDs, authorization, heartbeat behavior, and `Last-Event-ID` replay. Add shared notification infrastructure only when measurements justify it; notifications should wake readers while durable events remain the source of truth. A dedicated `LISTEN` consumer would require a session-compatible connection, not transaction pooling.

### D. Coordinating execution starts

`claimRun` locks the organization and workspace, then takes the shared PostgreSQL advisory transaction lock named `capacity:global`, counts active runs, and transitions an eligible run to `provisioning` in the same transaction.

The global lock serializes **execution-start claims** so two schedulers cannot both consume the last slot. It does not serialize whole agent executions or every public API request. It remains held until the claim transaction commits, including its event/state writes.

Measure lock wait and claim latency under burst admission. Keep the protected transaction small. Inspect query plans and suitable indexes before replacing the lock/count with capacity-reservation rows. A replacement must preserve crash recovery and avoid leaked reservations; it is not a necessary first scaling project.

### E. Data growth and worktree contention

Execution capacity does not remove a workspace's writer boundary. A backlog entirely targeting one worktree stays serial even with free global slots. Display this reason and let customers create independent worktrees through the existing product interfaces.

Track growth of `api_requests`, run events, usage/ledger records, manifests, object versions, and indexes. General request analytics already adds database writes; polling, model calls, and tools amplify work beyond externally submitted job count. As history grows, inspect slow reporting queries and vacuum/index health. Add summaries or partitioning only for demonstrated growth patterns. Financial records and customer files need explicit retention policies, not emergency deletion to make a benchmark pass.

## 6. Neon setup and resizing procedure

1. In the Neon project, select the production branch/compute. Record its region, plan, fixed size or autoscaling minimum/maximum, suspension policy, and direct connection allowance. Keep database and application compute geographically close; the current web deployment selects `iad1`.
2. Obtain the **pooled** connection string from the Connect dialog for the restricted application role. Configure `DATABASE_URL` through deployment secrets. Never paste connection strings into a capacity report.
3. Treat authentication separately. [The auth pool](../../packages/db/index.ts) sets `options: '-c search_path=auth,public'`. Validate that exact startup behavior before moving it through transaction pooling. Initially use a restricted direct `AUTH_DATABASE_URL` where needed; do not use the migration/owner role. A future auth pooling adjustment must preserve schema resolution and pass login, OAuth, refresh, and tenant isolation checks.
4. Use the direct endpoint for migrations and other session-dependent maintenance. Domain tenant context is set transaction-locally and uses transaction-scoped locks; verify those invariants against the real pooler with the deployed roles.
5. Collect endpoint CPU, memory/cache behavior, query latency, backend utilization, and waiting client counts under the target workload. Compare quiet, burst, and sustained periods.
6. If CPU remains high and queries are already reasonable, increase compute. If cache/memory pressure drives latency, increase the minimum so the working set stays warm. If connections wait while CPU is low, inspect pool sizes, long transactions, locks, and direct-auth connections before buying more CPU.
7. If increasing a maximum does not increase connection allowance, inspect the minimum/maximum relationship and `SHOW max_connections`. Allow headroom for migrations, maintenance, and recovery.
8. Schedule manual endpoint resizing as a reconnect event. Confirm transaction error handling, retry only safe operations, and verify recovery before raising execution capacity.

Automatic scaling responds within the configured range; it does not fix inefficient SQL or an excessively low minimum. Regular worker/cron/database polling may also keep the endpoint awake, so do not assume scale-to-zero savings. [Neon autoscaling guidance](https://neon.com/docs/guides/autoscaling-guide).

### Connection budget

Current pools are instantiated per Node process/runtime instance:

| Pool | Maximum clients |
| --- | ---: |
| Domain | 5 |
| Authentication | 3 |
| Credential refresh | 2 |
| Total potential per process | 10 |

For example, 100 processes can potentially open 1,000 clients; this does **not** mean 100 agents need 1,000 database connections. Fluid instance reuse, lazy opening, and pooler multiplexing affect actual usage. A direct auth endpoint still consumes backend connections. Increasing process count and pool sizes together can amplify pressure.

Add measurements of `pg.Pool.totalCount`, `idleCount`, and `waitingCount` if absent. Database session counts alone do not reveal clients waiting inside application pools. Keep the credential pool separate: the code uses it to avoid nested credential refresh exhausting the caller's pool.

Read-only diagnostics for an authorized operator to run against the actual endpoint:

```sql
SHOW max_connections;

SELECT state, wait_event_type, count(*) AS connections
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state, wait_event_type
ORDER BY connections DESC;

SELECT count(*) AS transactions_older_than_30_seconds
FROM pg_stat_activity
WHERE datname = current_database()
  AND xact_start < now() - interval '30 seconds';

SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
```

Use monitoring permissions appropriate to the operator. These queries deliberately omit SQL text, prompts, keys, and customer files. They were not run against production for this guide. Read replicas can later serve suitably stale reports; they do not increase primary write capacity or belong in authoritative authorization, billing, and admission decisions.

## 7. Implemented controls and next measurements

1. **Queue waiting and history:** PostgreSQL owns blocked waiting, with 24-hour defaults for new jobs. Bounded Workflow continuations preserve execution identity and reservations. Cancellation and expiry retain history and release funds; existing deadlines are unchanged.
2. **Organization fairness:** weighted virtual service coordinates eligible starts through PostgreSQL. Interactive work has first priority; workspace ordering and plan/global limits still apply. Workflow and standalone workers share the same admission decision.
3. **Queue visibility:** API, dashboard and CLI expose elapsed wait, waiting reason, expiry and cancellation without a global position or start-time estimate.
4. **Capacity reporting:** operator reports expose active slots versus the configured ceiling, eligible backlog, oldest eligible wait, start latency and per-account waiting. Management REST/MCP remains read-only.
5. **Next measurements:** quantify Sandbox control requests and database/stream load before increasing capacity. Extend provider/pool telemetry or optimize queries only where measurements show a bottleneck. Deployed replay, recovery and transfer acceptance remain release checks.

Fairness means a new organization's eligible work gets a turn as slots become available. If 50 runs already occupy all 50 slots, scheduling cannot start the 51st immediately without additional capacity or preemption. Weighted organization turns prevent one organization's queued backlog from monopolizing future opportunities; it cannot promise a wall-clock start bound for indefinitely occupied slots. Our current execution timeout still applies.

Unused capacity should always go to eligible work within plan limits. This needs no separate borrowing feature. Guaranteed immediate starts, priority tiers, preemption, or reserved onboarding capacity would be separate product commitments.

Defer a custom autoscaler, new message broker, shared realtime vendor, API framework rewrite, database sharding, and active-active regions until a specific measurement or customer requirement warrants them.

## 8. How to increase execution capacity

Use **50 → 100 → 200** as candidate stages, not certified capacities. Higher stages require the same evidence. Do not jump to the configuration parser's maximum just because it is accepted.

### Before each increase

1. Fill in the capacity worksheet below. Confirm current provider terms/account allowances and budget. Check shared team consumption and recovery headroom.
2. Establish arrival rates, duration distribution, queue age, eligible backlog, Sandbox API volume, Workflow history, and database baselines. A workspace or organization limit may explain the queue without a global shortage.
3. Pass the relevant free correctness/load checks. Resolve phase-history or request-budget failures before enabling more real executions.
4. If database measurements require resizing, perform it first and confirm recovery. Check model/token capacity and storage/persistence throughput independently.
5. Record the previous deployment, runtime image digest, database migration version, and all effective scheduler configurations.

### Apply and observe

6. Update production `GLOBAL_CONCURRENT_RUN_LIMIT`, for example from `50` to `100`, and deploy the configuration to all execution-claiming runtimes. Vercel environment changes need a new deployment; do not assume editing a dashboard field changes already running workflows.
7. Account for workflows associated with older deployments and any standalone schedulers. Record the cap they actually evaluate. A shared database lock cannot enforce a lower ceiling if a still-active scheduler uses a higher value.
8. Watch queue age and completions together with provisioning latency, provider `429/503`, SQL pool waits, persistence duration, and cost. Hold at the stage until the target workload is stable and a representative long run has completed/restored.
9. Raise again only after measured headroom supports it. If only control-plane or database work is saturated, increasing the execution cap makes the problem worse.

### Rollback and drain

Lowering the cap prevents additional claims above that value; it does not cancel existing executions. Propagate the lower value to every relevant scheduler, including the deployment versions handling existing work. During a mixed-version interval, do not claim that the lower bound is already universally enforced.

To change orchestration backends, pause new admission, resolve/drain **accepted queued jobs as well as active jobs**, verify persisted checkpoints, and follow the [backend deployment procedure](deployment.md). `RUN_ADMISSION_ENABLED=false` alone still permits accepted jobs to start. Do not enable two orchestration topologies casually or replay interrupted prompts.

If spending or data integrity is at risk, use the existing emergency controls and reconcile run/provider state. Disabling paid execution can interrupt work; it is not the ordinary way to lower load. Preserve snapshots/files, settle financial reservations correctly, and inspect ambiguous side effects before retrying anything.

### Horizontal scaling in practice

On the preferred topology, Vercel scales request/step compute and each execution uses a separate sandbox. We increase usable capacity by removing measured bottlenecks and adjusting limits; we do not provision one dedicated API server per agent.

On the standalone topology, add worker replicas using the existing Docker worker service and shared SQL leases. Increase replica count or `WORKER_CONCURRENCY` only if phase backlog/latency warrants it, while budgeting each replica's connections and provider calls. The default of four means four concurrent phase advances, which can service more than four remote agents.

Both topologies retain a finite PostgreSQL primary and external account limits. Horizontally scalable components do not make the whole system infinitely scalable.

## 9. Testing strategy and release gates

### Existing evidence

The repository includes multi-tenant burst, financial reservation, and global-capacity integration tests in [scale.test.ts](../../tests/integration/scale.test.ts), plus cloud lifecycle tests in [cloud.test.ts](../../tests/integration/cloud.test.ts). The capacity test proves competing claims respect a small shared limit; it is not a sustained production throughput benchmark.

[Testing and CI](../engineering/testing.md) records the current acceptance/coverage work. Use the latest actual reports, not a hard-coded test count in a capacity promise. The local simulator does not reproduce every cloud phase, SDK call, durable Workflow event, or vendor throttle.

### Free local checks to run for scaling changes

Use isolated disposable data, synthetic tenants, local storage, and provider doubles. Disable external execution and network access for runtime fixtures. Reuse existing database isolation wrappers rather than loading the developer's preview database.

| Test | Required assertions |
| --- | --- |
| Multiple schedulers | Three or more independent worker processes contend for shared jobs; no duplicate execution starts, exceeded global/organization limits, or leaked leases |
| Capacity ramp | Candidate limits 50, 100, 200; enough tenants and independent workspaces to reach each limit; record the local machine's ceiling rather than blaming the application for load-generator exhaustion |
| Fairness | Heavy tenant backlog plus newly arriving small tenants; eligible organizations receive turns across replicas; blocked workspaces do not block unrelated tenants |
| Long queue | Advance a deterministic clock through 24 hours; verify cancellation, expiry, reservation release, and restart survival; count the full Workflow event/step budget, including retries and persistence |
| Long execution | Exercise timeout, input wait, shutdown, and final persistence under concurrent load; keep execution and queue deadlines independent |
| Streaming | Many viewers of one run and many distinct runs; slow consumers, disconnects, reconnect storms, and replay; no gaps or cross-tenant events; measure query and memory growth |
| Persistent files | Representative large projects and worst supported entry counts; interrupted restore/checkpoint, checksum mismatch, same-key object contention, concurrent independent worktrees |
| Provider pressure | Inject quota `429`, creation throttles, slow reads, timeouts, and ambiguous acknowledgments; bounded retries and recovery without re-executing user side effects |
| Worker/database loss | Kill a worker after claiming and after native launch; reconnect after database restart; retain files and reconcile reservations/leases |
| API pressure | Separate read, submit, token/tool gateway, auth, webhook, and reporting traffic; test rate-limit isolation and clear rejection behavior |
| Storage/history growth | Seed realistic run/event/request history sizes and inspect query plans, table/index growth, vacuum behavior, and report latency |

A dedicated reusable load harness is still work to build; existing acceptance commands are not a substitute. Run the cloud phase engine with deterministic provider doubles to cover the production state machine. A virtual 24-hour test proves time-boundary behavior quickly, but cannot establish 24 hours of real provider reliability. Where the managed Workflow backend cannot be reproduced faithfully locally, record the remaining cloud acceptance explicitly.

Use the existing checks as applicable:

```sh
pnpm check
pnpm test:domain
pnpm test:e2e
pnpm test:cli
pnpm test:native
```

For a capacity experiment, record a warmup, a burst, and at least a representative sustained period; 30–60 minutes is a reasonable initial local soak target. Include sufficient simulated long-running work to expose slot occupancy and lifecycle cleanup. Stop if the load generator itself saturates and rerun with valid measurement conditions.

### Proposed acceptance targets

These are starting engineering targets to agree before a test, not current SLAs:

- Zero cross-tenant access, duplicate native execution caused by dispatch, financial invariant violations, or lost committed files.
- No admission above the effective configured cap; no starvation of an eligible organization across completed scheduling rounds.
- Under the defined target load, ordinary metadata API p95 below 500 ms and unexpected 5xx below 0.1%, excluding deliberate fault-injection windows and documented throttles.
- In an under-capacity scenario with eligible jobs and a healthy provider, p95 queue-to-provisioning below 60 seconds. Measure end-to-end ready-to-run separately; this does not apply to blocked workspaces or an already full fleet.
- No sustained growth in eligible backlog, application-pool waits, or cleanup backlog when arrivals are below measured service capacity.
- Worst supported queue/runtime/filesystem scenario remains below Workflow history limits with an explicit margin for retries.
- No sustained provider throttling at target load; sufficient control-request and compute headroom for cancellation/recovery.

### Live acceptance that still requires operator setup/budget

Reading public docs, quota pages, and account settings does not execute a sandbox or verify real scheduling behavior. A meaningful Sandbox/Workflow load test can incur compute, storage, event, function, network, and database charges **even with zero model tokens**.

Before real-user launch, authorize a capped staging budget and run a small native execution, persistence/restore, streaming/reconnect, cancellation, provider-throttle recovery, and deployed large-file transfer journey. Then increase concurrency gradually to the intended launch cap. Record actual invoices/usage and SDK request counts. Model throughput needs a separately budgeted test or account evidence; do not infer it from zero-token simulation.

Stop live tests for unexpected spend, growing provider failures, data/ledger inconsistency, or failed recovery. Never run an unbounded benchmark against production or assume that a free-tier allowance makes every call free.

### Capacity report template

For each validated stage record:

```text
Date / release / runtime digest / SDK versions:
Topology / region / worker or function instance observations:
Global cap / organization caps / queue wait policy:
Provider account quotas and shared consumption:
Neon plan / min-max CU / observed max_connections / pool configuration:
Workload: arrivals, durations, tenants, worktrees, file sizes, event rates:
Load-generator hardware and utilization:
Peak and sustained occupied slots / actual provider machines:
Queue age and provisioning latency p50/p95/p99:
API latency, errors, provider requests and throttles:
Workflow steps/events per run, including worst-case persistence:
Database CPU/cache, query latency, connections, pool waits, lock waits:
Streaming fanout, reconnects, query rate:
Persistence/restore and cleanup results:
Costs, duration, failures injected, stop conditions:
Conclusion: validated workload envelope and remaining limits:
```

## 10. Metrics, alerts, and operator actions

[Existing reports](../../packages/core/src/reports.ts), extended by [the implemented scheduler](../features/execution/scheduling.md), now expose true eligible wait age, active/ceiling and per-account start waits. They also include lifecycle counts, dispatch backlog, overdue dispatch work, exhausted jobs, database connections, provider circuit state, and financial/storage attention. Provider capacity is currently reported as unavailable. The field `dispatch_oldest_due_seconds` uses scheduling `available_at`, which is moved during retries; it is **not true customer queue age**. Some usage aggregates include queued jobs as active; do not reuse those for occupied execution slots.

| Signal | Suggested initial response |
| --- | --- |
| True oldest/p95 queue age rises | Split by eligibility reason and organization; distinguish workload pressure from a blocked workspace, plan limit, or stalled dispatcher |
| Slots remain full and eligible backlog grows | Check provider/database/model headroom, then consider the next tested cap |
| Free slots but eligible jobs do not start | Inspect fairness/dispatch leases, deployment versions, throttling, and expired credentials |
| Sandbox control quota or creation throttles | Slow/coalesce control operations or starts; do not simply add workers |
| Workflow history approaches budget | Inspect waiting/polling and file phase counts; prevent new runs entering an unsupported path |
| Pool waits, long transactions, or SQL latency grow | Inspect locks and hot queries; resize only for demonstrated resource pressure |
| Provider machine count exceeds app occupancy | Investigate uncertain creation, cleanup, or recovery before admitting more work |
| Persistence/restore duration rises | Inspect object request rate, bytes, entry counts, Git transfer, and phase size |
| Spend per successful run rises | Separate model tokens, sandbox memory/CPU, orchestration, retries, storage, and network |
| Signup/auth/email failures rise | Inspect email/OAuth quotas and callbacks; signup count alone does not prove activation |

Report users, DAU/WAU, activated organizations, runs requested/completed, tokens, storage, and costs alongside infrastructure metrics. Define an active user from an authenticated product action, not background scheduler polling. Use aggregate identifiers and timings; never put prompts, keys, tool payloads, or customer files in general telemetry. Management MCP should surface these reports and recommendations without infrastructure mutation privileges.

## 11. Cost model

Prices below are public list rates checked on the research date, before credits, discounts, taxes, and regional differences. Average usage determines the bill; a concurrency ceiling alone does not.

### Sandbox runtime

For `iad1`: CPU $0.128/vCPU-hour; memory $0.0212/GB-hour. Our two-vCPU shape has 4 GB memory. Creation: $0.60/million; network: $0.15/GB; snapshots: $0.08/GB-month. [Vercel price list](https://vercel.com/pricing). CPU waiting on I/O is excluded; provisioned memory remains metered. [Sandbox metering](https://vercel.com/docs/sandbox/pricing).

Let `u` be average utilization of the two allocated CPUs, between zero and one:

```text
runtime cost/sandbox-hour = 4 × 0.0212 + 2 × 0.128 × u
                          = $0.0848 + $0.256 × u

At 10% CPU utilization: $0.1104/sandbox-hour
50 continuously occupied sandboxes × 730 hours ≈ $4,029.60/month
200 continuously occupied sandboxes × 730 hours ≈ $16,118.40/month
```

These are calculations for a hypothetical workload, excluding inference and the rest of the platform. Intermittent jobs cost less because aggregate occupied hours are lower. Input waits and slow persistence can increase cost even when useful agent work has stopped. Measure provider runtime separately from app slot duration.

### Orchestration, database, storage, and other costs

| Component | Rate / model |
| --- | --- |
| Workflow | $0.02/1,000 events; data written $0.50/GB; retained $0.50/GB-month. Function compute and underlying queue operations add charges. [Pricing](https://vercel.com/docs/workflows/pricing) |
| Neon | Launch compute $0.106/CU-hour; Scale $0.222/CU-hour; database storage $0.35/GB-month. Actual average CU matters. [Pricing](https://neon.com/pricing) |
| R2 Standard | $0.015/GB-month; Class A $4.50/million operations; Class B $0.36/million; R2 egress free. Other services in a transfer path can still charge. [Pricing](https://developers.cloudflare.com/r2/pricing/) |
| Models / search / connectors | Actual provider usage and subscription rates, split between managed and customer-supplied credentials |
| Remaining services | Functions, queue delivery, registry, observability, email, payment fees, backups/history, domains, and support |

For example, an average two CU for 730 hours on Neon Launch is approximately **$154.76/month for compute**. A four-CU maximum does not mean four CU are used continuously. Conversely, frequent polling can prevent suspension savings.

Use measured events/run in the orchestration estimate. At $0.02/1,000 events, 10,000 events contribute $0.20 before function/queue/storage charges. A five-second empty queue check can have material cost when multiplied by many waiting jobs.

Keep product pricing distinct from vendor cost. The current `COMPUTE_MICRO_USD_PER_MINUTE` default of `8000` is used in the application's compute reservation calculation; it is not Vercel's tariff and does not establish profit margin. Reconcile ledger settlement, provider invoices, failed/retried runs, and BYOK economics before changing pricing or allowing long unattended sessions.

## 12. Operator capacity worksheet

Complete this before production launch and every material increase. An unknown is a task to resolve, not evidence of unlimited capacity.

| Item | Value / evidence to fill in |
| --- | --- |
| Production team/project, plan, region | Not inspected for this guide |
| Global cap in every live scheduler deployment | Code default 50; deployed value unknown |
| Sandbox concurrency, creation and control quotas | Compare actual account with section 3 |
| Actual requests per runtime check and per run | Requires SDK instrumentation and cloud acceptance |
| Queue policy and worst-case Workflow history | 24-hour new-job default; SQL waiting and bounded Workflow continuations implemented; staging acceptance pending |
| Tenant fairness | PostgreSQL-coordinated weighted turns and local multi-worker tests; validate deployed contention and quotas |
| Peak arrivals and slot duration distribution | Requires representative workload measurements |
| Neon pooled application URL and direct auth/migration setup | Requires secret-safe account/configuration check |
| Neon CU range, max connections, CPU/cache/pool baseline | Requires endpoint measurements |
| Model/search/connector quotas and spend budgets | Requires account-specific evidence |
| Maximum tested workspace size and restore time | Record files, bytes, history steps, and deployed transport behavior |
| Last successful restore and worker-loss test | Link actual report |
| Validated concurrency and streaming fanout | No production benchmark established by this guide |
| Alerts, incident owner, cap rollback procedure | Configure and rehearse before growth campaigns |
| Monthly budget and cost per successful run | Fill from measured component usage |

Review official limits again before deployment or a major increase. The next decision should be based on this worksheet and the latest test report, with a specific bottleneck and an observed result for each change.
