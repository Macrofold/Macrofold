# Project plans and design pairs

Use this directory for substantial agreed implementation plans and requested feature-spec/technical-design pairs. Follow [planning](../../AGENTS.md#plan-before-implementation) and the [design workflow](../../.agents/skills/macrofold-design/SKILL.md).

A feature-spec or technical-design request produces distinct cross-linked `<project>-feature-spec.md` and `<project>-tech-design.md` files unless the user requests another shape. Update an existing pair rather than duplicating it. Ordinary implementation plans can use one `<project>.md`; straightforward low-risk work can use a conversation plan, including large mechanical changes. Follow the root risk/complexity criteria rather than a line-count threshold.

Specs describe observable outcomes, journeys, scope, failures, acceptance and feasible stages. Technical designs identify owners, contracts, tenant/credential boundaries, exact money/units, persistence/recovery, concurrency, performance, rollout, verification and open decisions where relevant. Plan the whole authorized scope; stages organize delivery rather than silently reducing it.

Project documents retain proposal-specific context. Current feature behavior stays in `docs/features/`, cross-cutting architecture in `docs/architecture/`, and unfinished implementation/acceptance work in [maintainer TODO](../maintainers/TODO.md). Link each new project here and from affected owners. The [design approval workflow](../../.agents/skills/macrofold-design/SKILL.md#approval-to-implementation) owns the transition from documents to implementation.

## Plans

- Execution efficiency: [feature specification](execution-efficiency-feature-spec.md) and [technical design](execution-efficiency-tech-design.md). Proposed compact two-commit immediate execution, bounded background administration, versioned caches and batched SQL; includes native/tool/queue/storage/event paths. Records the measured excessive round trips/payload transfers and the deliberate response-checkpoint tradeoff. Implementation has not started.

- Immediate inference: [feature specification](immediate-inference-feature-spec.md) and [technical design/TODO](immediate-inference-tech-design.md). Implementation and verification in progress: immediate request ownership, shared accounting, batched authorization observation, typed recovery and all five SDKs. Hosted lifetime and measured deployment capacity remain acceptance gates.

- [OpenRouter decision-model routing](decision-model-routing.md): reviewed Decision 1/Jev routing, native and typed requests, and shared billing controls.

- [Native Run controls](native-run-controls.md): layered question permission and durable stop-on-model-error admission/accounting.

- [Resource-specific capacity](resource-capacity.md): independent execution/admission/I/O pools, production defaults, and maintenance progress.

- [Independent poller progress](poller-progress.md): bounded execution steps and maintenance that do not block unrelated queued work.

- [Bounded operations and recovery](bounded-work.md): finite retry, polling, transfer and pagination budgets; protected uncertain state.

- [Verification speed](verification-speed.md): required checks, targeted verification, parallel domain and browser suites, path-scoped application acceptance.
- [Native run recovery](native-run-recovery.md): terminal checkpoint failure handling, safe Docker provisioning diagnostics and local recovery.

## Existing accepted targets

- [Workers and shared hosts](../architecture/worker-execution.md) remains in its existing authoritative location; do not move or duplicate it merely to use this directory. Its linked migration work remains separate from implemented sandbox behavior.

- [Local MCP development](local-mcp.md): explicit local-origin policy and verification.
- [Native home persistence](native-home-persistence.md): explicit durable state per harness, disposable runtime home, and verified cold continuation.

- [Native turn reliability](native-turn-reliability.md): asynchronous OpenCode turns, reported costs, copied SQLite normalization and permission-driven file tools.
