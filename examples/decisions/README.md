# Explicit-context contract examples

These examples demonstrate two independent consumers of [Macrofold decisions](../../docs/features/decisions/README.md). They are original contract fixtures, not full applications and not a dependency on any private application repository.

[contracts.ts](contracts.ts) builds typed payloads with no runtime/domain imports:

- Customer-exception triage: the application selects an authorized customer case, submits relevant evidence, and decides whether to investigate. Application-side mutation requires a fresh case/query revision check.
- Actor decisions: an application submits only an actor's permitted observations and proposes wait/investigate. Perception, memory semantics, simulation time and atomic action commits stay in that application. This supports an Open Legend-style consumer without encoding game rules into Macrofold.

Both examples include explicit unknown evidence and entity/query dependency tokens. `required_records` permits an unknown record; `required_known` would prevent dispatch. A model's `unknown` answer abstains. Expired evidence produces `stale_input`; a structurally valid proposal may still be rejected by the application.

For an application, construct `decisionExample(workspaceId, 'triage')` or `decisionExample(workspaceId, 'actor')`, replace the synthetic evidence and observation time with authorized current data, then submit through `client.inferences.create` and `client.runs.wait`. Use the complete [quickstart](../../docs/features/decisions/README.md#first-decision) for credentials, limits and outcome handling. Keep keys on the backend.

The protocol shadow fixture compares deterministic rules, conventional-model output and Jev output over identical context, records disagreement and never auto-applies a result. Its synthetic outputs prove adapter/comparison wiring, not model accuracy or suitability. Evaluate representative authorized examples and rejection costs before enabling any application's automatic acceptance policy.

[Unit fixtures](../../tests/unit/decision-protocols.test.ts) check capability mapping, schema safety and unknown semantics. [API fixtures](../../tests/integration/inference.test.ts) execute both examples, including expiry, durable receipts and rejection separated from provider evidence. See [verification](../../docs/features/decisions/verification.md) for actual acceptance scope.
