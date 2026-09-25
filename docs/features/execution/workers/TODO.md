# Worker follow-up

The public API, durable Worker/Host/HostRun ownership, scaling, pricing, runtime-control, CLI, and dashboard have implementation owners listed in [implementation](implementation.md).

Formal test cases and release acceptance are centralized in [maintainer TODO](../../../maintainers/TODO.md). Current measured execution evidence is in [verification](verification.md).

Optional extensions, not alternative public primitives:

- Add safe cross-customer physical packing only after the provider/controller supplies a verified tenant boundary. Preserve published resource prices independently from machine placement.
- Add runtime/region/shape offerings through the validated catalog, not a parallel scheduler. Benchmark a real mixed-harness workload before changing safe defaults.
- Consider an explicit native no-retained-conversation mode independently from filesystem retention. Current native admission creates or continues a Macrofold Session; omission is not a stateless promise.
- Revisit richer cache-affinity scoring and quota fairness only when measured queue, restore, or memory data justifies the extra coordination.
