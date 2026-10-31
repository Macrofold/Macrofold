# Project plans and design pairs

Use this directory for substantial agreed implementation plans and requested feature-spec/technical-design pairs. Follow [planning](../../AGENTS.md#plan-before-implementation) and the [design workflow](../../.agents/skills/macrofold-design/SKILL.md).

A feature-spec or technical-design request produces distinct cross-linked `<project>-feature-spec.md` and `<project>-tech-design.md` files unless the user requests another shape. Update an existing pair rather than duplicating it. Ordinary implementation plans can use one `<project>.md`; straightforward low-risk work can use a conversation plan, including large mechanical changes. Follow the root risk/complexity criteria rather than a line-count threshold.

Specs describe observable outcomes, journeys, scope, failures, acceptance and feasible stages. Technical designs identify owners, contracts, tenant/credential boundaries, exact money/units, persistence/recovery, concurrency, performance, rollout, verification and open decisions where relevant. Plan the whole authorized scope; stages organize delivery rather than silently reducing it.

Project documents retain proposal-specific context. Current feature behavior stays in `docs/features/`, cross-cutting architecture in `docs/architecture/`, and unfinished implementation/acceptance work in [maintainer TODO](../maintainers/TODO.md). Link each new project here and from affected owners. The [design approval workflow](../../.agents/skills/macrofold-design/SKILL.md#approval-to-implementation) owns the transition from documents to implementation.

## Plans

- Execution efficiency: [feature specification](execution-efficiency-feature-spec.md), [technical design](execution-efficiency-tech-design.md) and [verification](execution-efficiency-verification.md), plus [optimization verification](execution-efficiency/optimization-verification.md). Compact two-commit immediate execution, bounded background administration, versioned caches and batched SQL are implemented locally across native/tool/queue/storage/event paths. Local capture/runtime refinement and activation are complete; six co-located Linux cohorts meet the server-overhead p95 target. The record preserves macOS misses, the open SQL/CI/hosted gates and the deliberate response-checkpoint tradeoff.

- Execution-efficiency follow-up: [implementation-ready optimization annex](execution-efficiency/remaining-optimizations.md), paired with the existing execution-efficiency feature specification above. Proposed SQL batching, payload reuse and explicit diagnostic tradeoffs; no application implementation is authorized by these documents.

- Opt-in performance profiling: [feature specification](performance-profiling-feature-spec.md) and [technical design](performance-profiling-tech-design.md). Implemented default-off operator flag, bounded content-free profiles and concurrent foreground/background attribution; observer-overhead qualification remains explicit.

- Native memory and startup efficiency: [feature specification](native-memory-startup-feature-spec.md) and [technical design](native-memory-startup-tech-design.md). Proposed allocation-memory failure summaries, optional bounded memory/stage profiles and selected-harness SDK loading. Design only; memory savings, observer cost and native/hosted acceptance remain unverified.

- Immediate inference: [feature specification](immediate-inference-feature-spec.md) and [technical design/TODO](immediate-inference-tech-design.md). Implementation and verification in progress: immediate request ownership, shared accounting, batched authorization observation, typed recovery and all five SDKs. Hosted lifetime and measured deployment capacity remain acceptance gates.

- Native scheduling latency: [implementation and qualification](native-scheduling-latency.md). Commit wakeups, bounded direct pool handoffs, independent discovery and immutable preparation reuse are active locally; matched scheduling/handoff p95 targets pass. Hosted/fleet qualification and strict maximum-latency tails remain explicit.

- Hugging Face model deployments: [feature specification](hugging-face-model-deployments-feature-spec.md), [technical design](hugging-face-model-deployments-tech-design.md), [shared contract](hugging-face-model-deployments-contract.md), [research](hugging-face-model-deployments-research.md) and [agent brief](hugging-face-model-deployments-agent-brief.md). Production BYOK and external-endpoint serving, direct inference, lifecycle, protected runtime and operator/client surfaces are implemented locally. The [feature guide](../features/execution/model-deployments.md) owns setup; [remaining acceptance](../maintainers/TODO.md#hugging-face-model-deployments) distinguishes local checks from actual RunPod/GPU qualification, registry publication and subsequent OpenLegend integration.

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
