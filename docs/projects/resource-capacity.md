# Resource-specific capacity and independent progress

Status: implemented, verified and locally activated. Hosted load acceptance remains separate. This extends [poller progress](poller-progress.md), rather than replacing the SQL scheduler or execution engine.

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

- Resource ownership replaces the shared step semaphore: model advances 64, provisioning 16, transfers 8 and control 64 per standalone process. Native/lightweight fleet defaults are 200/2,000. These are independently configurable starting points, not a measured production capacity claim; the [scaling guide](../operations/scaling.md#resource-capacity-settings) owns units, ranges and retained boundaries.
- Plan defaults become 20/100/500 concurrent Runs. Explicit lower account limits, Worker spending/resource policies and reservation checks remain authoritative. The former Worker 64-instance clamp is removed in favor of the accepted plan/policy.
- Shared bounded mapping refills I/O slots and drains already-started operations on failure. Maintenance components own separate schedules; hosted requests still await their work. Storage GC retains its reference-publication lock to avoid deleting live bytes.
- Session queues accept 100 queued Runs, excluding the active Run; unfinished push transfers default to 100 per organization. Read, write and cancellation/input HTTP buckets are independent. Database acquisition/pool settings are explicit per-process deployment controls.
- PostgreSQL fixtures verify a completed inference while the native transfer pool is full, independent fleet ceilings, 24 simultaneous phase slots without the former twenty-slot clamp, queue bounds, single launch/publication and failure/drain behavior. Existing scheduling/load, Worker scaling/API, storage, maintenance, webhook, Git, decision and trigger regression slices pass. Initial failures were stale plan expectations and test fixture/assertion setup; the corrected affected slices pass. Counts from overlapping slices are not a unique test total.
- `pnpm check`, isolated production Next.js build, `pnpm docs:check` and full five-language `pnpm test:sdks` pass. The latest standalone capacity slice passes 12 tests. Policy mutation verification passes at 93.33% (70/75 killed). The build retains an unrelated existing dynamic-filesystem tracing warning in `sqlite-snapshot.ts`; no compiler setting was relaxed. The SDK fixture mail sink was unavailable, so its pass does not establish email delivery.
- Tests use disposable databases/storage, scripted provider boundaries and no paid API calls. Neither thousands of simultaneous customers nor provider-specific rate/connection quotas have been load-certified. Hosted migration/rollout and measured throughput remain in [maintainer work](../maintainers/TODO.md#resource-capacity-and-progress).

## Local activation

Migration 051 is applied to the existing loopback database. After confirming no active or queued Runs, the owned API and Docker poller restarted gracefully on Node 24. The preview remains at `http://localhost:3210`; `/health` reports `local_docker` ready and `pnpm doctor:docker` passes. An authenticated billing read confirms the 20/100/500 plan limits; the restricted scheduling view exposes `dispatch_class`. Subsequent existing caller traffic reached result and billing endpoints successfully; no caller prompt was replayed or synthetic paid request submitted.

The existing local aggregate cap of ten was replaced with native ten, lightweight 2,000 and total 2,010. This preserves the developer's explicit native-compute allowance while separating inference; repository defaults remain native 200/lightweight 2,000. Spending opt-in and credentials were unchanged. No runtime image rebuild or cloud deployment was performed. Private command/process records and content-free verification are in `.data/resource-capacity/`; no secrets or caller content are included in the activation report.
