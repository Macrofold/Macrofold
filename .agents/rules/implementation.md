# Implementation and simplification

Apply this procedure to the requested change. A one-line fix does not need a separate design document; a change to authorization, money, durability, or a public contract needs explicit reasoning and evidence.

## Understand, then change

- State the observable outcome and the existing behavior to preserve. Inspect the affected entry point, owning service, callers, data shape, and relevant tests. For a bug, reproduce it when practical and identify the violated invariant before patching.
- Start at the existing implementation: can the behavior be achieved through a supported option, shared helper, platform feature, or installed library? Use the simplest suitable option. Existing conventions and accessible UI components matter more than mechanically preferring native primitives.
- Implement a complete, coherent path through the necessary layers. Fix a shared cause once when sibling callers need the same contract; do not scatter compensating guards. Do not move behavior into a shared helper when callers actually have different semantics.
- Preserve unrelated work. Avoid drive-by renames, repository-wide formatting, dependency upgrades, and layout changes in a focused fix. Delete code made obsolete by this change after checking references and tests.

## Keep the design small

DRY means one authoritative definition of a business rule, contract, or state transition. Similar-looking lines do not automatically represent the same concept. A little local repetition is preferable to a generic helper with many flags and incompatible callers.

Extract a function or module when it names a meaningful operation, isolates a real dependency, or improves comprehension. A single caller can justify that boundary. Do not add factories, generic repositories, plugin systems, configuration options, or service layers for hypothetical future consumers.

Prefer descriptive names, straightforward control flow, explicit dependencies, and cohesive modules. Avoid code golf, compressed one-liners, pass-through wrappers, broad utility buckets, and comments that narrate syntax. Explain only non-obvious invariants and tradeoffs.

Use maintained libraries for difficult protocols, cryptography, parsing, and accessible interactions. Check the installed dependency first; add a dependency only when its ongoing maintenance and bundle/runtime cost beat a small clear implementation. No popularity metric alone establishes fitness or security.

Dependency or runtime-image changes require license/notice, vulnerability, and adapter-compatibility review through the existing [dependency guidance](../../docs/engineering/dependencies.md). Keep upgrades focused and regenerate the lockfile with the package manager.

## Handle the failures that matter

Cover malformed/untrusted input, absent or revoked authority, documented provider failures, concurrent writes, disconnects, and interrupted persistence when the changed flow can encounter them. Do not invent fallback engines or rare-future deployment modes without a concrete requirement. A deliberate capacity limit belongs near its owner with a measurable reason to revisit it.

Finish with the relevant [tests](../../TESTING.md) and [review](code-review.md). Existing tests can protect a behavior-preserving refactor. Do not add tests that merely restate implementation or weaken checks to make a patch pass.
