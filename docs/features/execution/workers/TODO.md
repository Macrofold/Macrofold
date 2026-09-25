# Worker follow-up

The public API, durable Worker/Host/HostRun ownership, scaling, pricing, runtime-control, CLI, and dashboard have implementation owners listed in [implementation](implementation.md).

Formal test cases and release acceptance are centralized in [maintainer TODO](../../../maintainers/TODO.md). Current measured execution evidence is in [verification](verification.md). The broader cutover obligations remain open beyond the verified subset; historical no-test notes describe their own continuations, not permanent changes to CI policy.

## Active implementation review

Review baseline: `dc890bde1860fbdd1f1f896e18401fcb91133007`, against merge base `19865a2f45885e228deb6b7ea443e33982257d21`. OpenLegend's portable engineering guidance is reviewed at `03105fed9209c126e4e69e9faeb4687f42d1e74a`: single semantic ownership, bounded work, explicit uncertainty, complete caller paths, and maintained documentation. Game-world policy and OpenLegend's package structure do not become Macrofold requirements.

The review covers authored branch changes in configuration/admission, scaling and accounting, provider/runtime ownership and persistence, API/SDK/CLI/dashboard integration, and their user-facing contracts. Generated clients are checked through their schema/generator, not edited by hand. Examine the reference applications, marketing journeys, and OpenLegend's actual Macrofold caller, including repeated character turns, interactive bursts, background jobs, shared Worktree ordering, cancellation, and replacement. Preserve independent work on main; a rebase or merge is not part of this review.

Current task verification: do not author unit tests or a replacement test suite. Exercise representative runtime and failure scenarios, static/build/documentation checks, and meaningful bounded workloads; preserve existing CI and all unmet release gates. Changes, concrete deferred findings, and actual evidence must be reconciled into the existing implementation, public guide, verification record, and central maintainer TODO before handoff. No deployment or paid-provider enablement is inferred from a source review.

## Implemented capacity behavior

Demand-sized baselines and safe single-Host idle replacement are implemented in [capacity reconciliation](implementation.md#demand-sized-baseline-and-idle-replacement). Replacement keeps old obligations until provider-confirmed release and preserves unpublished state even outside the bounded placement cache window. [Demand-aware idle scale-down](implementation.md#demand-aware-idle-scale-down) retains Hosts selected for queued work rather than every idle Host whenever the queue is nonempty.

## Optional extensions

These are not alternative public primitives:

- Add coordinated multi-Host rebalancing only with an explicit plan for readiness, retained state, funding and confirmed release. Current demand replacement handles one individually sufficient idle Host; it waits when several releases would be required or its selected candidate has unpublished state outside the placement window. Any extension needs real concurrent database and provider-failure evidence rather than optimistic capacity subtraction.
- Add safe cross-customer physical packing only after the provider/controller supplies a verified tenant boundary. Preserve published resource prices independently from machine placement.
- Add runtime/region/shape offerings through the validated catalog, not a parallel scheduler. Benchmark a real mixed-harness workload before changing safe defaults.
- Consider an explicit native no-retained-conversation mode independently from filesystem retention. Current native admission creates or continues a Macrofold Session; omission is not a stateless promise.
- Revisit richer cache-affinity scoring and quota fairness only when measured queue, restore, or memory data justifies the extra coordination.
