# Resource-specific capacity and independent progress

Status: the initial capacity split is implemented, verified and locally activated. The follow-up calibration below changes code/defaults but has not restarted the existing preview or worker. Hosted load acceptance remains separate. This extends [poller progress](poller-progress.md), rather than replacing the SQL scheduler or execution engine.

## Outcome and scope

An exhausted transfer/provisioning pool must not prevent unrelated model requests, polling, cancellation or cleanup. Production defaults must represent separate resource budgets, not a developer laptop's capacity. Explicit customer budgets, provider quotas, authorization, single Worktree writers and uncertain-execution fencing remain authoritative.

Audit inventory: standalone and Workflow dispatch; global/account/Worker admission; maintenance, Host reconciliation and autoscaling; restore/publish fan-out; database pools; HTTP rates and request/stream/file bounds; queue/runtime/recovery deadlines; provider/runtime limits. Record retained bounds with their reason in the scaling guide. No promise of production throughput without provider/account measurements.

## Implementation

1. Centralize validated deployment capacity settings. Replace the poller's shared four-step/twenty-step clamp with independent model, provisioning, transfer and control pools. Include phase metadata in the restricted scheduling view. Preserve per-Run SQL claims and fences.
2. Split fleet native and lightweight ceilings beneath an explicit total emergency ceiling. Make fair admission class-aware so an unavailable resource class cannot take another class's scheduling turn. Keep organization limits and their explicit overrides meaningful; raise plan defaults to 20/100/500 separately from infrastructure, preserving explicit lower overrides.
3. Run maintenance components on independent non-overlapping schedules. Replace batch barriers and sequential external job loops with bounded refill, retain lease/error ownership, and prevent slow delivery/Git work from delaying Worker reconciliation or expiry.
4. Improve Workflow start fan-out, transfer batching, Worker demand/provisioning bounds and database settings where the inventory demonstrates an artificial bottleneck. Keep memory/transport envelopes and financial reservations intact; do not solve delay by removing retry/deadline safety.
5. Verify mixed workloads with held transfer/provider/maintenance barriers, multi-process SQL capacity/fairness tests, failure/drain tests and representative larger synthetic cohorts. Run TypeScript, affected application/SDK checks when required, and documentation checks. Inspect the complete affected diff.

## Completion

- [x] Resource inventory and defaults documented with ownership/units and retained boundaries.
- [x] Independent dispatch/admission/maintenance progress implemented in both orchestration paths.
- [x] Targeted and load checks pass; no duplicate starts, cap violations or lost persistence.
- [x] Public scheduling/operator instructions and status/TODO reconciled.
- [x] Local activation verified without interrupting active customer/developer work; hosted acceptance reported separately.

The existing preview and uncommitted poller fixes are preserved. Base inspected and fetched: `origin/main`, already equal to the current checkout. No rebase or unrelated rewrite is needed.

## Decisions and verification

- Resource ownership replaces the shared step semaphore: model advances 256, provisioning 16, transfers 8 and control 64 per standalone process. Native/lightweight fleet defaults are 200/2,000. These are independently configurable starting points, not a measured production capacity claim; the [scaling guide](../operations/scaling.md#resource-capacity-settings) owns units, ranges and retained boundaries.
- Plan defaults become 20/100/500 concurrent Runs. Explicit lower account limits, Worker spending/resource policies and reservation checks remain authoritative. The former Worker 64-instance clamp is removed in favor of the accepted plan/policy.
- Shared bounded mapping refills I/O slots and drains already-started operations on failure. Maintenance components own separate schedules; hosted requests still await their work. Storage GC retains its reference-publication lock to avoid deleting live bytes.
- Session queues accept 100 queued Runs, excluding the active Run; unfinished push transfers default to 100 per organization. Read, write and cancellation/input HTTP buckets are independent. Database acquisition/pool settings are explicit per-process deployment controls.
- PostgreSQL fixtures verify a completed inference while the native transfer pool is full, independent fleet ceilings, 24 simultaneous phase slots without the former twenty-slot clamp, queue bounds, single launch/publication and failure/drain behavior. Existing scheduling/load, Worker scaling/API, storage, maintenance, webhook, Git, decision and trigger regression slices pass. Initial failures were stale plan expectations and test fixture/assertion setup; the corrected affected slices pass. Counts from overlapping slices are not a unique test total.
- `pnpm check`, isolated production Next.js build, `pnpm docs:check` and full five-language `pnpm test:sdks` pass. The latest standalone capacity slice passes 12 tests. Policy mutation verification passes at 93.33% (70/75 killed). The build retains an unrelated existing dynamic-filesystem tracing warning in `sqlite-snapshot.ts`; no compiler setting was relaxed. The SDK fixture mail sink was unavailable, so its pass does not establish email delivery.
- Tests use disposable databases/storage, scripted provider boundaries and no paid API calls. Neither thousands of simultaneous customers nor provider-specific rate/connection quotas have been load-certified. Hosted migration/rollout and measured throughput remain in [maintainer work](../maintainers/TODO.md#resource-capacity-and-progress).

## Capacity calibration

The follow-up calibration compares matched disposable workloads before selecting further defaults. It covers dispatcher resource pools, fleet/account admission, Workflow/Worker batches, all three database pools and acquisition deadlines, HTTP buckets, session/upload queues, restore reads and maintenance fan-out. Product allowances and provider quotas are distinguished from process resource budgets; a locally accepted numeric setting is not a production capacity claim.

Use a separate PostgreSQL instance and synthetic loopback model/storage responses, preserve the preview and existing credentials, and record throughput, queue and pool wait, tail latency, memory, errors and accounting outcomes. Compare small/default/larger settings, include slow operations and burst arrivals, and stop escalation on resource pressure. Apply default changes only where the measured owning boundary supports them; retain hosted/native/provider acceptance as open. Record reproducible commands and the complete limit disposition in a linked engineering report.

[Calibration results](../engineering/capacity/README.md) include reproducible workloads and raw measurements. The initial measurements supported 256 inference advances and 40 application connections; the [saturation follow-up](../engineering/capacity/upper-bounds.md) revises database/rate/maintenance defaults using retained-history and hosted evidence. External-provider budgets remain separate. Ordered SQL admission fixes the burst starvation uncovered by testing without serializing execution. Both scheduling paths preserve the fair order lost by `UPDATE ... RETURNING`. Fixture setup now isolates resource ceilings from developer overrides.

## Saturation follow-up

The approved follow-up must distinguish boundary correctness from a measured operating ceiling. Budget: at most $25 for isolated resources; no paid model output is needed to measure control-plane throughput. Preserve the shared preview and production data/configuration.

1. Extend the existing benchmark with fixed arrival rates, single-credential read/write/control workloads, independent auth/credential work, matched inference cohorts and larger payloads. Record offered/completed rates, latency including generator delay, pool waits, CPU, memory and accounting. Escalate until errors, growing backlog, latency above the target or marginal throughput gains reveal a knee; do not label a successful total-request count as a concurrent capacity.
2. Repeat selected measurements on a separate hosted database if access permits. Use disposable synthetic databases, bounded compute, automatic expiry/suspension and private resource/cost records. Never load test the serving production branch.
3. Exercise uncertain transfer, stream, maintenance and scheduling page/fan-out bounds at increasing workloads. Classify every setting as measured process capacity, backlog/product policy, correctness/transport bound or external quota. An external service's quota cannot be inferred from a loopback fixture.
4. Set defaults below demonstrated knees with explicit headroom and reconcile scaling, feature, status and TODO owners. Preserve recovery/accounting invariants. Run affected regressions, TypeScript/SDK build and documentation checks; record any real blocker rather than claiming every upper bound is established.

Completed: a limit-by-limit disposition, sustained confirmation and reverse-order payload recheck, private cost record, cloud/local cleanup and final diff review are recorded in the saturation report. Verification passes 165 tests across 13 files, another 17 isolated load tests, `pnpm check` including the TypeScript SDK build, `pnpm docs:check`, hosted pooled/direct deadlines and migration 053 over 640,000 pre-existing ledger rows. Hosted quota/multi-replica acceptance remains separate; no serving process was restarted.

Retained-history calibration also exposed a fleet-wide ledger scan while holding one organization's billing lock. Add an explicit tenant predicate and covering tenant/journal index (migration 053), preserving RLS and financial facts. Compare query plans and the same 32-organization, 10,000-journal-per-organization workload before/after; rerun finance/isolation regressions. Apply the migration only to disposable calibration databases in this task.

Maintenance defaults must also account for sweep cadence: a 100-webhook page with a fifteen-second idle cadence can fall behind successful model completion even when individual deliveries are fast. Raise its configurable candidate page to 1,000 and delivery concurrency to eight, retaining the twenty-second admission window, per-destination timeout, locks and retry identity. Storage maintenance increases from two to four organizations after the measured throughput knee; larger fan-out mostly lengthened waits. Verify full-page continuation and no duplicate delivery.

The saturation ramp exposed repeated Ajv compiler initialization inside inference transactions and an exclusive workspace-deletion lock shared by unrelated admissions. Reuse bounded immutable schema validators and take shared admission locks while deletion remains exclusive. Verify schema mutation/isolation, simultaneous admissions, deletion fencing and exact financial settlement; compare the same 512-Run workload before/after before selecting limits. Saturation also exposed overlapping cancellation/heartbeat intervals accumulating more than 1,700 waiting SQL requests. Both execution paths now permit one in-flight check per Run and drain it on stop; repeat matched load and cancellation/failure regressions before final calibration.

The real Neon pooled probe rejected startup `statement_timeout` options before any request. Move server statement/idle-transaction defaults to the restricted runtime role in the migrated database, shared with client deadline constants. Keep direct identity `search_path`, transaction-local tenant context and shorter per-operation deadlines. Verify effective defaults through fresh direct and pooled connections, including timeout/rollback and unchanged authorization; do not disable deadlines or change the serving database. Migration tooling must install these role defaults before deployment.

## Local activation record

Migration 051 is applied to the existing loopback database. After confirming no active or queued Runs, the owned API and Docker poller restarted gracefully on Node 24. The preview remains at `http://localhost:3210`; `/health` reports `local_docker` ready and `pnpm doctor:docker` passes. An authenticated billing read confirms the 20/100/500 plan limits; the restricted scheduling view exposes `dispatch_class`. Subsequent existing caller traffic reached result and billing endpoints successfully; no caller prompt was replayed or synthetic paid request submitted.

The existing local aggregate cap of ten was replaced with native ten, lightweight 2,000 and total 2,010. This preserves the developer's explicit native-compute allowance while separating inference; repository defaults remain native 200/lightweight 2,000. Spending opt-in and credentials were unchanged. No runtime image rebuild or cloud deployment was performed. Private command/process records and content-free verification are in `.data/resource-capacity/`; no secrets or caller content are included in the activation report.
