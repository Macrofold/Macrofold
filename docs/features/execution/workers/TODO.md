# Worker follow-up

The public API, durable Worker/Host/HostRun ownership, scaling, pricing, runtime-control, CLI, and dashboard have implementation owners listed in [implementation](implementation.md).

Formal test cases and release acceptance are centralized in [maintainer TODO](../../../maintainers/TODO.md). Current measured execution evidence is in [verification](verification.md). The September 25 queued-capacity continuation adds and executes unit and PostgreSQL regressions; the earlier continuation's no-test note is historical, not a restriction on this work or evidence that these new tests are absent. The broader cutover obligations remain open beyond this verified subset.

Demand-sized baselines and safe single-Host idle replacement are implemented in [capacity reconciliation](implementation.md#demand-sized-baseline-and-idle-replacement). Replacement keeps old obligations until provider-confirmed release and preserves unpublished state even outside the bounded placement cache window.

Optional extensions, not alternative public primitives:

- Add coordinated multi-Host rebalancing only with an explicit plan for readiness, retained state, funding and confirmed release. Current demand replacement handles one individually sufficient idle Host; it waits when several releases would be required or its selected candidate has unpublished state outside the placement window. Any extension needs real concurrent database and provider-failure evidence rather than optimistic capacity subtraction.
- Add safe cross-customer physical packing only after the provider/controller supplies a verified tenant boundary. Preserve published resource prices independently from machine placement.
- Add runtime/region/shape offerings through the validated catalog, not a parallel scheduler. Benchmark a real mixed-harness workload before changing safe defaults.
- Consider an explicit native no-retained-conversation mode independently from filesystem retention. Current native admission creates or continues a Macrofold Session; omission is not a stateless promise.
- Revisit richer cache-affinity scoring and quota fairness only when measured queue, restore, or memory data justifies the extra coordination.
