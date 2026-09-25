# Worker branch engineering review

Review in progress, September 25, 2026. Source baseline: `dc890bde1860fbdd1f1f896e18401fcb91133007`; merge base: `19865a2f45885e228deb6b7ea443e33982257d21`. Portable engineering guidance was read in `Macrofold/OpenLegend` at `03105fed9209c126e4e69e9faeb4687f42d1e74a`. Game-world policy is not a Macrofold requirement.

This assessment applies single semantic ownership, bounded work, explicit uncertainty, complete caller paths, and source/evidence separation. It does not replace the [architecture](../../../architecture/worker-execution.md), [implementation](implementation.md), [verification record](verification.md), or central [remaining-work inventory](../../../maintainers/TODO.md).

## Physical shutdown and financial reconciliation

The baseline can leave a draining allocation running forever when `settleHostSample` raises `host_funding_exhausted` before the provider stop. It can also receive a provider-confirmed stop and then lose that boundary when the following settlement transaction fails. Repeated polling would continue using an unbounded allocation clock.

A disposable PostgreSQL exercise at `8956c5fb7bf0ea620ed91b1c671f092cdb2a0ef9`, Actions run `36196706790`, reproduced the first path: after three reconciliation passes, one synthetic provider allocation remained, no stop had been called, the Host was `draining`, and `stopped_at` was null with `host_funding_exhausted`. The rate and external provider were explicit fixtures; this was not a paid-provider experiment or a unit-test suite.

The correction keeps three independent facts: a sealed final usage receipt (`final_usage`/`usage_finalized_at`), provider-confirmed physical stop (`stopped_at`), and last-settled financial cursor (`billing_cursor`). Normal idle retirement seals valid resource usage and stops compute before attempting settlement. A failed stop retains its receipt and funding. A failed settlement cannot undo stop confirmation or restart the allocation clock. Unreleased execution/cleanup claims still prevent ordinary retirement and final release of funding.

Funding exhaustion, a passed funded/lifetime boundary, or a changed controller generation requires a physical stop rather than an unlimited graceful drain. Such a forced stop may lose the resource meter's final tail; missing usage remains unknown and reserved for reconciliation. No extra customer debit, fabricated zero, prompt replay, or speculative release of instance/cost obligations is introduced. A confirmed stopped allocation may remain `draining` in the accounting projection until its claims and usage are resolved.

Migration `047_host_final_usage.sql` is forward-only. Existing finalized-and-settled receipts can still use their billing cursor; new final receipts are stored before settlement. Deployment requires the migration and matching application code together. Default fixtures must remain unpaid, and real provider stop/meter acceptance remains a separate release gate.

## Caller and integration context

OpenLegend's documented fast judgments and generation use direct `/v1/inferences`; native full deliberation/reflection uses the harness route. Workers must not add native allocation overhead to ordinary direct inference. Durable Run identity, bounded queues, explicit cancellation, and unknown billing outcomes matter more than convenient blind retries.

Macrofold main has an independent model-streaming/SDK documentation commit (`ea0c17cecae715f4def2c17d4cbe4e32d1ae8ae9`) beyond this branch's merge base. This review does not overwrite or merge that work. Its schema, SDK, engine and documentation interactions require reconciliation before branch integration.

The broader source, caller, performance, and UI review continues; this document is not release approval. Current-task verification uses executable scenarios and existing build/CI paths without authoring unit tests. Evidence for the corrected code will be recorded after execution.
