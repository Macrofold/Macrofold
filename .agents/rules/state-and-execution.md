# State, money, and durable execution

Use the existing [scheduling](../../docs/features/execution/scheduling.md), [Workflow](../../docs/features/execution/workflow-history.md), [billing](../../docs/features/billing/implementation.md), and [workspace](../../docs/features/workspaces/implementation.md) owners. Read only the feature details affected by the task.

## PostgreSQL and concurrency

Use parameterized queries, the restricted runtime role, and transaction-local tenant context. RLS complements service authorization. Use the same checked-out client for an entire transaction and release it in `finally`; do not mix `pool.query` into that transaction.

Enforce invariants with existing unique/check constraints, locks, and fenced state transitions. Keep transactions short and acquire locks consistently. Prefer slow provider calls outside lock-holding transactions when durable identity and reconciliation make that safe; do not move an existing serialized call outside its lock without preserving its concurrency/idempotency contract. Retain the database package's storage-maintenance lock and independent OAuth refresh rules. Do not replace correct serialization with a race-prone preflight read.

Migration-owner credentials never belong in serving processes. Use forward migrations; preserve accepted deadlines and terminal history. Rehearse compatibility and restoration with disposable databases. For Neon, retain pooled domain/direct auth separation and use `--no-env-pull` when linking/branching so cloud setup cannot overwrite local simulation settings.

## Durable work and accounting

A request is not a process lifetime. Use the existing PostgreSQL dispatch/phase state and Workflow step boundaries. Keep replayed orchestration deterministic; external side effects belong behind recoverable step/domain operations. Preserve execution identity, native launch deduplication, lease generations, workspace writer exclusion, and organization/global caps.

Treat queue expiry, execution timeout, persistence, and history retention separately. Budget Workflow steps/events across waits, execution, persistence, handoff, and retries using the pinned SDK and existing policy tests. Do not restart an agent to reset orchestration history.

Keep financial journals immutable, reservations atomic, and settlement idempotent. Enforce spending through the model gateway and authoritative ledger, not a client estimate. Cancellation/expiry releases unused funds; partial usage and ambiguous provider outcomes must remain accountable. Missing usage is not zero. Deduplicate billing events by durable identity and handle out-of-order delivery; provider timestamps alone are not ordering or deduplication keys.

Freeze accepted billable rates with the work that reserves them; an operator configuration change must not increase an existing run's liability. Validate an externally billable request before creating provider resources.

## Files and scaling

Verify checkpoint manifests/content before publication or restore. Preserve recoverable state on upload, restore, cancellation, or Git failure. Reject path traversal/symlink escapes; keep protected runtime state isolated. Never force-push or silently overwrite conflicting user work. Git sync failure is distinct from execution failure.

Publish refresh signals after commit. Keep streams from holding a database connection indefinitely. Bound pages, queues, buffers, and pool totals across instances; do not create one polling loop per resource when an existing shared path works.

Measure queue wait, saturation, query/lock time, and memory before redesigning. Use query plans and realistic isolated loads to justify indexes or larger changes. `EXPLAIN ANALYZE` executes the query: use a disposable database for mutations. Preserve the global capacity lock unless measured contention justifies replacement.
