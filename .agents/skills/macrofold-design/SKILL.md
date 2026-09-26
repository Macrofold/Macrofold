---
name: macrofold-design
description: >-
  Create paired feature specs and technical designs, execute a project plan after chat approval,
  or design changed cross-layer contracts; not routine fixes.
---

# Design from observable behavior

Start with user/agent scenarios: trigger, authorized principal and resource, interaction, visible outcome and meaningful failure. Consult the relevant [feature guide](../../../docs/features/README.md), [codebase map](../../../docs/architecture/codebase.md) and [ranked improvements](../../../docs/product/improvements.md) for context, not automatic requirements. Separate the ambitious target from feasible, incremental end-to-end stages. Follow the [root planning requirement](../../../AGENTS.md#plan-before-implementation), scaling detail to the task.

## Feature-spec or technical-design requests

A request to create either deliverable produces both, as distinct cross-linked files with the same project prefix: `docs/projects/<project>-feature-spec.md` and `docs/projects/<project>-tech-design.md`. Update an existing pair rather than create duplicates.

The feature spec details behavior, user/agent journeys, target scenarios, scope/non-goals, edge/failure cases, acceptance criteria and staged capabilities. The technical design details architecture, semantic owners, contracts/data flow, persistence/migration, performance, security/privacy, extension seams, implementation stages, verification and tradeoffs/open decisions. Keep behavior distinct from mechanism and proposals from implemented behavior.

## Architecture and extension boundaries

Read the canonical feature specification and related [maintainer work](../../../docs/maintainers/TODO.md). Preserve the [architecture rules](../../rules/architecture.md), including the existing application composition and domain-owned provider ports.

Distinguish domain authorization/accounting/lifecycle policy, provider protocol adaptation, durable storage and client presentation. Compose existing operations first; add a narrow capability only for missing behavior. A model result, identifier, UI control or transport type never grants authority. Logical modularity does not require new packages or services.

Trace relevant ownership, units, permitted reads/writes, triggers, work bounds, interaction effects and lifecycle through cancellation, checkpoint/restore and historical replay. Include API/SDK/CLI/dashboard consumers, migrations and release-artifact coordination where affected, not only storage. Keep execution, persistence and Git publication outcomes distinct.

Challenge claimed composability with a genuinely different scenario. Localize necessary v1 specificity with its owner, limit, seam and extraction trigger instead of building an unused framework. Distinguish [implemented architecture](../../../docs/architecture/README.md) from accepted targets such as [Workers/shared hosts](../../../docs/architecture/worker-execution.md); a design approval alone does not ship the target.

## Approval to implementation

The trigger is the developer's **chat instruction approving the discussed project plan for work**. Interpret the conversation, not a magic phrase: “approved,” “looks good” or “yes” accepting the plan, or “go ahead” / “start work” / “implement” / “do it” referring to it are sufficient. No formal approval artifact, repeated spec filenames or second confirmation is required. Honor scope, requested revisions and “do not implement yet” qualifiers. Reading an old approval/status, quoting these examples or editing this workflow is not a new go-ahead.

Spec/design creation alone stops at the paired deliverables, feasible stages and open choices. After chat approval, apply the root development startup before edits; follow [Documentation](../../rules/documentation.md#project-approval-and-current-truth) to link maintainer work to both project files and integrate accepted decisions, then **commence implementation in the same working session**. Do not stop after planning/tracker updates or ask whether to begin. “Continue” resumes the next unfinished authorized work from current docs/trackers, not a new design/approval cycle.

Continue under the [root completion and handoff policy](../../../AGENTS.md#finish), including its scope/time limits and blocker handling. [Verification](../../../TESTING.md) owns evidence; [documentation rules](../../rules/documentation.md#keep-maintainer-work-synchronized) own work IDs, dependencies, exit criteria and unverified acceptance.
