---
name: macrofold-rebase
description: >-
  Prepare the current base for development or reconcile rebase/merge conflicts without losing
  semantic intent and stop immediately for any uncertain resolution.
---

# Reconcile before continuing

First inspect branch/worktree status, tracking refs and uncommitted work. Select the base branch or ref in this order: the task's explicit base; the current PR's target branch (including an intentional stacked-PR parent); then the intended repository remote's default branch. A branch's tracking upstream, such as `origin/feature`, is its synchronization/publication ref, not evidence of the merge target. Do not assume a branch named `main` or remote named `origin` is the intended base. If repository/PR identity is ambiguous or the intended target cannot be established, resolve that before rewriting; do not silently substitute another base. Fetch the selected ref without changing another worktree, and report the exact remote/ref used and how it was selected. Explicit read-only tasks permit inspection, not branch mutations.

For a clean, exclusively owned development branch, rebase onto the refreshed base before implementation unless the task specifies another base or forbids rewriting. Already on the base, fast-forward only when safe. For a detached managed checkout, preserve its commit and attachment; create a `codex/` branch at the existing tip if a branch is needed. Do not silently reset, discard, stash or rewrite a shared branch, unrelated changes or another contributor's commits. Account for existing work before synchronization; use a separate managed worktree when isolation is necessary and available. If safe synchronization needs a decision or access/tooling prevents a required refresh/rebase, report the actual state and blocker rather than claiming success. A guidance-editing task does not retroactively authorize rebasing its own checkout.

Resolve conflicts from both sides' intent and current contracts, not blanket ours/theirs. Inspect non-conflicting neighboring edits for semantic overlap, especially mutation ownership, tenant authorization, schemas/migrations, generated clients, financial reservations, execution identity, checkpoints and tracked work. Regenerate artifacts from their authored sources with the pinned tools where appropriate; do not hand-merge generated output or invent a replacement lockfile.

If any resolution is not 100% certain or requires developer input, stop all work immediately, preserve the conflicted state and ask the developer with the affected paths, competing intentions and decision needed. Do not continue independent conflicts or implementation while awaiting input. Do not add new features merely to make divergent designs coexist. Report major resolved conflicts and their rationale, especially decisions or initially uncertain resolutions settled by the developer.

After reconciliation inspect the complete branch diff against the updated base, then use the [review skill](../macrofold-review/SKILL.md) and applicable [verification policy](../../../TESTING.md). Reconcile documentation and completion state without closing unmet gates. Never force-push customer/user repositories. Contributor-branch publication is separate from local reconciliation; never force-push a shared branch. An explicitly authorized rewrite of an exclusively owned contributor branch must use a lease, not an unconditional force.
