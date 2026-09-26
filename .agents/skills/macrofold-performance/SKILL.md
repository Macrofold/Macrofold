---
name: macrofold-performance
description: >-
  Investigate or change Macrofold hot paths, database queries, scheduling, scaling or browser
  latency. Not prose-only mentions of performance or routine cosmetic edits.
---

# Bound work, preserve meaning, measure

Identify the workload and critical path: tenants/concurrency, active runs, worktree bytes/file count, retained history, cold versus warm state, host/device and responsiveness. Distinguish throughput, queue delay, first response and durable completion; one fast component is not an end-to-end speedup. Define a measurable target using the actual task and current contract.

Read the relevant [scaling owner](../../../docs/operations/scaling.md), [scheduling contract](../../../docs/features/execution/scheduling.md), [runtime timings](../../../docs/features/execution/runtime.md#startup-latency-and-measurement) or [dashboard refresh](../../../docs/features/dashboard/live-refresh.md). Use [testing and CI](../../../docs/engineering/testing.md) to select the existing isolated load/browser/native harness. Browser work uses browser measurements; a database or simulator benchmark does not establish native or hosted performance. Compare matched inputs/versions/machines, including setup, tail latency, memory and elapsed work.

Remove unnecessary work first: meaningful change triggers, conservative rejection before expensive work, bounded candidates, existing indexes, shared immutable definitions and dependency-correct caches. Include principal/organization/resource identity, revisions and lifecycle in invalidation. Budget exhaustion is not evidence of absence. Retention or pagination limits must not silently lose required files, replay events or financial facts.

Move non-authoritative diagnostics/I/O off critical paths when ordering, durability and failure semantics permit. Coalesce replaceable snapshots, not distinct committed events or effects; skipping work must preserve its required outcome. Add batching, queues, pooling, workers or hierarchy only for a justified bottleneck; bound concurrency/backlog and define cancellation/backpressure. Async syntax does not offload CPU. Preserve transaction boundaries, dispatch identity, lease fencing, fairness, checkpoint integrity, billing and current authorization unless an accepted behavior change explicitly allows otherwise.

Measure query plans, lock/pool wait, dispatch/phase latency, provider latency, transfer volume and browser delivery separately when those boundaries matter. Account for all connection pools across instances. Use disposable databases for `EXPLAIN ANALYZE` on writes. Do not weaken the global capacity lock, storage maintenance lock, reservations or current revocation checks to reach a timing target.

Exercise a relevant bounded stress workload and the changed runtime path under [Testing](../../../TESTING.md). Use disposable fixtures and new private output paths. Record matched before/after evidence, variance and remaining bottlenecks; unavailable baseline or runtime access is a limit, not invented improvement. A timeout is incomplete, not a capacity pass. Do not require stress for unrelated edits or weaken behavior just to hit a timing number. Live compute/model spending remains governed by root authorization, not by benchmark configuration.
