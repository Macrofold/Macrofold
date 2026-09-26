# Project plans and design pairs

Use this directory for substantial agreed implementation plans and requested feature-spec/technical-design pairs. Follow [planning](../../AGENTS.md#plan-before-implementation) and the [design workflow](../../.agents/skills/macrofold-design/SKILL.md).

A feature-spec or technical-design request produces distinct cross-linked `<project>-feature-spec.md` and `<project>-tech-design.md` files unless the user requests another shape. Update an existing pair rather than duplicating it. Ordinary implementation plans can use one `<project>.md`; straightforward low-risk work can use a conversation plan, including large mechanical changes. Follow the root risk/complexity criteria rather than a line-count threshold.

Specs describe observable outcomes, journeys, scope, failures, acceptance and feasible stages. Technical designs identify owners, contracts, tenant/credential boundaries, exact money/units, persistence/recovery, concurrency, performance, rollout, verification and open decisions where relevant. Plan the whole authorized scope; stages organize delivery rather than silently reducing it.

Project documents retain proposal-specific context. Current feature behavior stays in `docs/features/`, cross-cutting architecture in `docs/architecture/`, and unfinished implementation/acceptance work in [maintainer TODO](../maintainers/TODO.md). Link each new project here and from affected owners. The [design approval workflow](../../.agents/skills/macrofold-design/SKILL.md#approval-to-implementation) owns the transition from documents to implementation.

## Existing accepted targets

- [Workers and shared hosts](../architecture/worker-execution.md) remains in its existing authoritative location; do not move or duplicate it merely to use this directory. Its linked migration work remains separate from implemented sandbox behavior.
