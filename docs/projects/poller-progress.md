# Independent poller progress

Status: implemented and locally activated. Requested October 13, 2026. Hosted and complete caller-scenario acceptance remain open.

## Problem and evidence

The October 11 OpenLegend GPT-5 Run waited 59.9 seconds without `started_at` or a provider invocation before caller cancellation. Account capacity was available. No retained worker step log establishes the exact blocking operation. A synthetic request through the unchanged ordinary asynchronous API started in 0.587 seconds on October 13 after restoring the stopped local PostgreSQL container. This rules out a permanent provider/model failure, not intermittent queue stalls.

The standalone poller awaits all steps in a batch and an entire maintenance sweep before claiming more work. A slow provider/checkpoint step therefore blocks otherwise free dispatcher slots. Maintenance includes sequential network operations and must not gate run polling.

## Scope and implementation

1. Keep the existing SQL claims and advancement owner in `portable-dispatch.ts`; reuse them from a bounded dispatcher that tracks in-flight Runs and refills free slots independently. Exclude locally active Run IDs even after their SQL dispatch lease ages out. Preserve SQL phase fencing and recovery across processes.
2. Run one maintenance sweep concurrently with the dispatch loop. Never overlap sweeps; retain its existing interval after completion. Drain started steps and maintenance before closing tracing/database pools on shutdown.
3. Keep account/global/Worker capacity, priority, authorization, budgets, checkpoint publication, cancellation and API/SDK contracts unchanged. No additional queue service or paid retries.
4. Add barrier-based regression coverage for a slow native step alongside newly queued inference, bounded concurrency, failure handling, lease exclusion and shutdown. Run focused PostgreSQL suites and a bounded load cohort, type checks and docs checks.
5. Activate the updated local poller only after checking for active work. Verify a small synthetic GPT-5 request through `Prefer: respond-async` and ordinary polling; do not manually advance its Run. Each live request is capped at $0.02. Retain private IDs/timings, not credentials or game content.

## Acceptance and limits

Queued inference must reach execution while a different slow native step is still held at a test barrier and a dispatcher slot is free. Execution-step concurrency remains bounded; duplicate local claims and unhandled rejections are prevented. Shutdown drains current work. The public [scheduling guide](../features/execution/scheduling.md) owns the resulting behavior, and [maintainer TODO](../maintainers/TODO.md#worker-stall-diagnostics-follow-up) tracks unverified deployment/caller acceptance.

All occupied slots, account limits or unavailable compute can still require waiting. This change is not a start-time SLA. Historical evidence does not justify claiming the precise October 11 maintenance/provider operation, nor does a synthetic request complete the game's encounter acceptance.

## Verification

The implementation is based on `132d549b` plus this change. Restricted PostgreSQL fixtures verify queued inference completing while native checkpoint upload is held, bounded step concurrency, refill before a slow sibling completes, local exclusion after a dispatch lease expires, successful checkpoint publication and a single native launch. Process-loop fixtures verify polling during stalled maintenance, non-overlapping sweeps, the completion-based interval, failure isolation and graceful draining. Existing cloud, decision scheduling, dispatch failure and scheduling load suites pass. The concurrency fixture initially exhausted its artificial iteration count before an intentional five-second claim lease elapsed; it now waits for the actual state within a bounded deadline.

Focused suites: `poller-loop`, `portable-dispatch`, `cloud`, `decision-scheduling`, `dispatch-failures` and `load/scheduling`, through the disposable `pnpm test:domain` wrapper with paid execution disabled and simulated providers. `pnpm check` (including the application TypeScript SDK), `pnpm docs:check` and diff whitespace checks pass. Public API/SDK shapes and transports did not change; unrelated language SDK suites were not repeated.

The stopped development PostgreSQL container was restarted without replacing its disk or configuration. The idle old poller was gracefully stopped after confirming zero active/queued Runs; the replacement runs Node 24 with `WORKER_DIAGNOSTICS=1` and separate private logs. The application preview was preserved and health reports `local_docker` ready.

Two synthetic `openai/gpt-5` BYOK calls used `Prefer: respond-async`, the ordinary worker and status/result endpoints, with no manual Run advancement. Each had a $0.02 ceiling and returned `OK`. The unchanged baseline started after 0.587 seconds; the changed worker started its request after 3.605 seconds while the process itself was starting and finished the HTTP/poll journey in 5.643 seconds. Each response reported $0.00020875 in provider cost ($0.0004175 total), separate from Macrofold's zero BYOK model charge. These are small functional checks with different worker-start conditions, not a matched speedup benchmark. The blocked-step fixture establishes the concurrency improvement. Private attempt receipts, results and activation/log records are under `.data/queue-recovery/`.
