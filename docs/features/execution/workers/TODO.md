# Worker follow-up

The public API, durable Worker/Host/HostRun ownership, scaling, pricing, runtime-control, CLI, and dashboard have implementation owners listed in [implementation](implementation.md).

Formal test cases and release acceptance are centralized in [maintainer TODO](../../../maintainers/TODO.md). Current measured execution evidence is in [verification](verification.md). The broader cutover obligations remain open beyond the verified subset; historical no-test notes describe their own continuations, not permanent changes to CI policy.

## Implementation review checkpoint

Review baseline: `dc890bde1860fbdd1f1f896e18401fcb91133007`, against merge base `19865a2f45885e228deb6b7ea443e33982257d21`. OpenLegend's portable engineering guidance was reviewed at `03105fed9209c126e4e69e9faeb4687f42d1e74a`: single semantic ownership, bounded work, explicit uncertainty, complete caller paths, and maintained documentation. Game-world policy and OpenLegend's package structure do not become Macrofold requirements.

The completed source review covered authored branch changes in configuration/admission, scaling and accounting, provider/runtime ownership and persistence, API/SDK/CLI/dashboard integration, and their user-facing contracts. Generated clients were checked through their schema/generator, not edited by hand. Reference applications, marketing journeys, and OpenLegend's actual Macrofold caller informed repeated character turns, interactive bursts, background jobs, shared Worktree ordering, cancellation, and replacement. That review did not rebase or merge; the subsequent [streaming reconciliation](reconciliation.md) records the consolidated commit series, rebase and combined acceptance separately.

No new unit tests were authored. Existing CI remains intact; actual database, controller, built CLI, browser and bounded native/runtime scenarios provide task-specific execution evidence. Changes and concrete deferred findings are reconciled into the [engineering review](review.md), implementation, public guide and verification record. Existing fixture corrections during reconciliation retain their safety assertions and are documented separately. No deployment or paid-provider enablement is inferred from a source review.

## Review follow-ups and release dependencies

The [engineering review](review.md) owns finding rationale; [implementation](implementation.md) owns corrected semantics and [verification](verification.md) owns executed results. These dependencies refine, rather than close, the broader central release inventory:

- [ ] Coordinate the OpenLegend native caller migration from `/v1/sandboxes`/`sandbox_id` to application-owned Workers. Prove lazy wake from submitted demand and that closing one actor conversation cannot destroy shared compute. Leave direct inference independent.
- [ ] Define and exercise the operator procedure for physically stopped but financially unresolved allocations: validate evidence, reconcile through the existing journal, preserve history and release holds only with an explicit resolution. Do not introduce automatic extra debits, write-offs or zero-usage assumptions.
- [ ] Exercise real provider creation/stop uncertainty and hosted process/isolation boundaries with approved accounts and budgets before enabling those offerings. Offline/native fixtures are not hosted-provider acceptance.
- [x] Reconcile main's streaming/SDK source with Worker ownership, regenerate the combined contracts and retain the separate delivery models. The [reconciliation record](reconciliation.md) distinguishes completed source integration from full-tip CI and merge status; hosted lifetime acceptance remains open.
- [ ] Profile Hermes cold-start latency and align OpenCode's declared fixture resources with its container limits before using the native workload to set production latency/density expectations. Preserve the observed results and separate functional acceptance from capacity benchmarking.
- [ ] Reconcile historical top-level status prose and retired Sandbox acceptance with the coordinated release. Current Worker facts are owned by this feature's implementation/evidence, not old no-test or cold-resume notes.

## Implemented capacity behavior

Demand-sized baselines and safe single-Host idle replacement are implemented in [capacity reconciliation](implementation.md#demand-sized-baseline-and-idle-replacement). Replacement keeps old obligations until provider-confirmed release and preserves unpublished state even outside the bounded placement cache window. [Demand-aware idle scale-down](implementation.md#demand-aware-idle-scale-down) retains Hosts selected for queued work rather than every idle Host whenever the queue is nonempty.

## Optional extensions

These are not alternative public primitives:

- Add coordinated multi-Host rebalancing only with an explicit plan for readiness, retained state, funding and confirmed release. Current demand replacement handles one individually sufficient idle Host; it waits when several releases would be required or its selected candidate has unpublished state outside the placement window. Any extension needs real concurrent database and provider-failure evidence rather than optimistic capacity subtraction.
- Add safe cross-customer physical packing only after the provider/controller supplies a verified tenant boundary. Preserve published resource prices independently from machine placement.
- Add runtime/region/shape offerings through the validated catalog, not a parallel scheduler. Benchmark a real mixed-harness workload before changing safe defaults.
- Consider an explicit native no-retained-conversation mode independently from Worker selection; do not reinterpret omission of `session_id` as statelessness.
