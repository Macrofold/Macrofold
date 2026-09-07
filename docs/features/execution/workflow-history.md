# Queue waiting and Workflow history

The PostgreSQL dispatch queue owns waiting. A queued job has no Vercel Workflow until it claims execution capacity. Running jobs use bounded Workflow invocations that resume the existing SQL phase state, sandbox identity and native supervisor marker. A continuation is orchestration only: it does not admit another product run, restart a prompt, increment the execution lease or reserve funds again.

## Waiting and latency

Failed claims persist `dispatch_jobs.available_at`. Retry ceilings rise from 5 to 10, 20, 40 and 60 seconds as submission age crosses 5, 15, 35 and 75 seconds. Stable per-run jitter uses 80–100% of that ceiling (48–60 seconds at steady state). The next timestamp never exceeds `queue_expires_at`. Deriving timing from the original submission prevents worker restarts from resetting backoff. Account/workspace-blocked jobs are filtered by SQL eligibility and need no individual timer or Workflow.

These are earliest eligible retry times, not promised wakeup times. Completion notifies dispatch and bypasses pending-job backoff, while retaining dispatch leases and rechecking authorization, workspace ordering, fair organization turns and account/global capacity. Other successful API mutations also notify dispatch. The one-minute Vercel Cron is the fallback; without a notification, a failed-claim backoff plus Cron alignment can take about two minutes, plus service delay. Jobs filtered solely by account/workspace eligibility can become candidates on the next sweep. Capacity is never promised while occupied.

Public cancellation of queued work settles immediately in its authorized transaction. Expiry and system cancellation are swept independently of capacity and dispatch leases, at most 100 records per pass. A healthy deployment usually observes these on the next Cron minute (15-second maintenance cadence for standalone workers); outages/backlogs can delay settlement. Expiry emits `run.failed` with `queue_expired`, preserves history, and releases reserved funds exactly once. Execution deadlines remain separate and start on claim.

Active execution still polls at two seconds plus phase/provider latency; restore checks use three seconds. Cancellation and input answers follow that cadence during execution. Provider failures back off up to 60 seconds. The 128th advance sleeps normally before handing off, so the continuation does not shorten a requested delay. Handoff normally triggers immediate dispatch; a lost notification waits for Cron. An abandoned active Workflow lease is recoverable after five minutes plus Cron/dispatch delay; a caught start error schedules a 30-second lease. These are recovery targets, not an SLA. The native supervisor also enforces its original deadline independently.

## Combined history budget

[Vercel's current limits](https://vercel.com/docs/workflows/pricing) are 10,000 steps and 25,000 events per Workflow, with a replay slowdown advisory above 2,000 events. The installed `workflow` and `@workflow/core` versions are 4.8.5; `@workflow/world-local` is 4.4.0 and the Vercel adapter is 4.7.1. Provider documentation and pinned SDK source were checked for this implementation.

SDK source confirms three events for a successful step, an additional `step_retrying` and `step_started` per retry, and `wait_created` plus `wait_completed` for a sleep. Replay reuses recorded waits and completed steps; repeated `run_started` is idempotent. Both application step functions explicitly permit three retries, matching the [SDK retry contract](https://workflow-sdk.dev/docs/foundations/errors-and-retries). [Sleep](https://workflow-sdk.dev/docs/api-reference/workflow/sleep) is durable suspension, not a process timer. Vendor queue deliveries/function invocations also have costs; event count alone is not a complete invoice estimate.

| Work in one invocation | Bound |
| --- | ---: |
| Phase advances, including provider failures and phase-lock contention | 128 |
| Final handoff/completion-dispatch step | 1 |
| Durable sleeps | 128 |
| Ordinary steps including three retries each | 129 × 9 = 1,161 events |
| Sleep events | 256 |
| Lifecycle / exceptional-delivery allowance | 32 |
| Conservative total | **1,449 events** |
| Step count, conservatively counting sleeps too | **257** |

Every phase shares this budget: preparation, restore waits, execution, input waits, transcript draining, checkpoint indexing/upload, settlement, cleanup and retries. No phase-specific counter can escape the invocation ceiling. Hard service limits apply per invocation, not to the combined customer run. Aggregate orchestration work and cost still grow with runtime, files, provider latency and retries.

A 60-second queue loop alone is not a safe solution. The existing maximum persistence envelope (100,000 entries, 10 GiB, four-MiB chunks) can require more than 70,000 phase advances with the deliberately small transfer batches, before transport failures. The deterministic budget test includes this envelope, two-hour execution, conservative restore waiting and maximum transcript draining; it also adds two domain transport failures before every successful phase and three SDK retries per step. Bounded continuations keep each invocation within the same ceiling regardless of the total. This is a history bound, **not evidence that a 10-GiB transfer completes within sandbox lifetime or provider request quotas**.

## Ownership and recovery

Migration 026 adds an orchestration generation to the existing outbox row. Dispatch acquires its lease and advances that generation before starting a Workflow. Each advance renews only its matching organization/run/generation. A stale invocation exits without phase work or handoff. The existing cloud phase lock and original VM/supervisor marker still fence duplicate native side effects if a start acknowledgement is lost.

Handoff commits lease release and generation advancement before calling dispatch. Its conditional update cannot release a successor's lease on retry. Crash before release leaves a recoverable lease; crash after release leaves a due outbox row; losing the next Workflow's start acknowledgement leaves the same durable execution identity. No reservation is settled or recreated by handoff. Only existing cancellation, expiry and terminal settlement paths release it. Neither terminal product history nor detailed SSE replay depends on Vercel history retention.

This adds one integer column and short SQL ownership updates, with no service or runtime dependency. There is one additional Workflow creation per 128 advances, with one handoff step. It trades extra dispatch operations for bounded replay. Keep the existing database/global capacity lock and provider boundaries.

## Rollout and verification

Run the free [testing commands](../../engineering/testing.md), especially `pnpm test:domain tests/unit/workflow-history.test.ts`, the cloud/scheduling integration cases, and isolated `pnpm test:load`. The history workload is a deterministic model; SQL lifecycle tests use real PostgreSQL and a machine fixture with durable native launch markers, not Vercel or paid inference.

Focused local acceptance passes **29 tests**:

| Evidence | Scope |
| --- | --- |
| [History policy](../../../tests/unit/workflow-history.test.ts), 15 cases | Full simulated 24-hour retry schedule, jitter/restart/expiry boundaries, production 128-advance ceiling, every sleep, early exit, superseded owner and maximum-workload budget |
| [Pinned SDK local storage](../../../tests/unit/workflow-sdk-history.test.ts), 1 case | Actual local-world event storage for three retries and a sleep; repeated run-start delivery adds no duplicate event. This is not compiled cloud replay. |
| [SQL Workflow dispatch](../../../tests/load/workflow-dispatch.test.ts), 7 cases | Capacity admission, legacy waiting, immediate refill, forward migration preserving queued and terminal history, failed start acknowledgement, stale/foreign ownership, cancellation, expiry and exactly-once settlement |
| [Cloud phase regression](../../../tests/integration/cloud.test.ts) and selected [scheduling cases](../../../tests/integration/scheduling.test.ts), 6 cases | Lost native launch acknowledgement, competing standalone pollers, failed-agent persistence, lost VM preservation and expiry before provider access |

The current complete load rerun passes all 11 scheduling and Workflow dispatch cases in 109.64 seconds with unchanged timeout gates and a fresh database. It verifies eight- and 50-slot workloads, later arrivals, worker recovery and dispatch handoffs; [measured scheduling results](scheduling.md#verification-and-measured-limits) own the timing and workload details. Previous contended-host failures are not used as capacity evidence.

The SQL handoff scenarios use 12 advances per invocation to exercise multiple boundaries quickly; the independent unit suite tests the real 128 limit. They preserve 14 checkpoint files and one output event across execution and persistence handoffs, with one native start, unchanged execution generation and one balanced settlement. A 12-job eligible backlog exceeds the dispatch batch size and proves active continuations are serviced before blocked new claims. These two multi-phase cases use the existing load-test allowance of 120 seconds; ordinary test gates are unchanged. Host contention caused earlier 30-second fixture timeouts, so these results establish correctness rather than throughput.

The conservative maximum-workload model contains 81,751 successful advances, or 245,253 with two domain failures before each success, spread over 1,917 invocations. It accounts for maximum execution/restore waits and trace draining as well as both input and output persistence. The optimized standalone build `mr7rCpS_aornZ-lHi-Vf0` and strict TypeScript pass. The complete domain coverage suite passes its gates; the Workflow loop and adaptive retry helper have 100% line/branch coverage. Current suite totals and broader measurement scope are maintained in the testing reference. SQL ownership is exercised in the separate load suite. [Implementation status](../../status/README.md) records broader release evidence.

Migration 024 already introduced the 24-hour default. After local checks pass, apply additive migration 026 and forward migration 027 through the existing migration command before deploying this release. Migration 027 reasserts the default for new rows only; the API continues to write explicit shorter deadlines. Upgrade tests start from a one-hour default and accepted rows, verifying that migration does not rewrite their deadlines or reservations. Do not edit old migration files or shorten existing queued jobs.

Pause admission and drain old deployed Workflows before this orchestration upgrade: provider replay is pinned to the code that created a Workflow, so deploying new code does not retrofit its history budget. Preserve old deployment availability until drained. For forward recovery, retain the additive column and repair deployment/configuration; do not reset execution bindings or native markers. A rollback must also drain bounded Workflows and must not restore a history-unsafe dispatcher for 24-hour accepted work.

Remaining cloud acceptance is in [pre-deployment checks](../../operations/pre-deployment.md#capacity-and-release-controls). Verify actual event counts including retries/sleeps, compiled replay and default arguments, continuation after a lost acknowledgement, Cron repair, rolling deployment/drain, full-day expiry and financial reconciliation. Measure maximum workspace restore/persistence against sandbox lifetime, function duration and control API quotas. No paid calls are part of local acceptance.

## Changelog

- Queue waiting remains outside Workflow. Combined execution/persistence analysis required bounded orchestration continuations as well: slowing only the queue loop could not support the existing file-count envelope within one Workflow history.
