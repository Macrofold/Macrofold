---
name: macrofold-review
description: >-
  Thoroughly review and improve Macrofold changes for correctness, performance, architecture,
  extensibility and UX; explicit findings-only/read-only requests prohibit edits.
---

# Review the complete change

Use the [review rules](../../rules/code-review.md) for scope, priorities and read-only versus authorized-fix behavior. Inspect the complete requested change against its relevant base, the task, applicable instructions and canonical contracts. Trace changed producers and consumers; existing patterns are evidence, not proof of good design. Apply [startup reconciliation](../macrofold-rebase/SKILL.md) only when implementing authorized fixes, never as a side effect of reviewing.

Review from multiple angles: correctness, performance, architecture, modularity, extensibility, simplification, duplication/bloat and reuse of existing helpers. Check project-specific requirements, the overall branch/change intent and product goals, not just individual lines. Consider real dashboard, API, SDK, CLI, tenant/operator and customer-agent scenarios and calling patterns. For UI changes, inspect usability, accessibility, interaction consistency and project UI/UX conventions.

Judge risk by impact and plausible reachability, not frequency alone; a rare privacy, accounting or data-loss race is not automatically marginal. Prioritize invalid authority/disclosure, duplicate/lost effects, stale completion, cancellation/removal, broken restoration, unbounded work and user-visible contract violations. Trace request → principal/organization/resource authorization → admission/reservation → execution/provider dispatch → checkpoint/settlement → event replay/client presentation where relevant. Keep evidence, interpretation, proposed action and committed effects distinct.

Check ownership, dependency direction and extension seams against desired future functionality. Remove accidental constraints that would obstruct it without building speculative infrastructure. Simplify related duplication and remove bloat without unrelated redesign. For changed feature or cross-layer contracts, consult the [design skill](../macrofold-design/SKILL.md); reviewing a local fix does not require redesigning its subsystem or creating new project briefs.

Examine repeated scans, copies, allocations, nested fan-out, critical-path I/O and concurrency. Check how costs grow with organizations, active runs, worktree bytes, connections and accumulated history; look for glaring scaling holes even when small examples work. Consider indexing, filtering, pruning, reuse, batching or async separation where justified. Use [performance](../macrofold-performance/SKILL.md) for meaningful hot paths or scale investigations; distinguish measured results from estimates.

For authorized fixes, reconcile delivered scope and remaining actionable work under [documentation rules](../../rules/documentation.md#keep-maintainer-work-synchronized). For review-only tasks, report the proposed documentation destination without editing it. Use the [findings policy](../../rules/code-review.md#findings) to distinguish confirmed defects, uncertainty and optional improvements.

[Verification](../../../TESTING.md) determines permitted checks. Report actual evidence, missing checks and residual uncertainty using the root handoff requirements. No findings is not proof of correctness.
