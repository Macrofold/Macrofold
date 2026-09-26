# Documentation maintenance rules

These rules apply to every feature, fix, review, and documentation change. Read them before editing. User instructions take precedence.

## Current truth

Documentation describes the current implemented system and its meaningful limits. Update the existing explanation when behavior changes instead of appending a competing description. Distinguish implementation, local fixture evidence, unverified deployment behavior, and future proposals. Do not equate a simulation with a live integration or claim testing proves perfection.

Keep prose concise and generally high-level: purpose, user behavior, ownership, important invariants, dependencies, and tradeoffs. Explain implementation details only where needed to understand, operate, or modify the feature. Use code snippets only in implementation references or invocation/deployment guides. Link to authoritative source files and contracts instead of copying their contents.

## Audience and publication

Write public guides to the person using or hosting the product. Lead with the outcome, prerequisites, a short working path, and the expected result; introduce advanced concepts through links. Use descriptive headings and stable anchors. Keep the README brief and welcoming, with source installation commands that work today. Reserve frozen-lockfile installs for reproducible CI and release builds.

Write shared API, SDK, CLI, and feature guides for Cloud and self-hosted users equally. Keep managed account setup separate from operating a deployment, and keep contributor simulation separate from both. Explain actual origin, credentials, and capability differences without duplicating whole guides or implying unverified feature parity. Put AI-assisted setup beside the human quickstart: a copyable goal-oriented brief with current documentation links, secure credential instructions, and a verifiable first result. Keep one source for that prompt and never replace a customer's project instructions with contributor rules.

Verify package-script commands against `package.json` and the installed package manager. Use explicit `pnpm run <script>` when a name conflicts with a built-in command; this repository's setup command is `pnpm run setup`. Keep documentation and CI invocations consistent.

Do not publish owner-directed handoffs, local personal paths, account IDs, private worksheet dependencies, placeholder badges, or unsupported package/install claims. Keep unresolved release work in `docs/maintainers/TODO.md` and test evidence in linked maintainer/engineering records. Real user-impacting limits belong in the public guide even when they are inconvenient. Never hide a missing capability by presenting it as completed.

`docs/navigation.json` is the explicit public publication list. All listed files are rendered into the application docs, search, Markdown exports, and agent indexes; do not include maintainer evidence or private configuration. Use ordinary GitHub-compatible Markdown, one H1, meaningful H2/H3 sections, and relative local links. Avoid raw HTML, executable MDX, duplicate headings, and manually maintained copies of the same guide. Run `pnpm docs:generate` after changing published content and `pnpm docs:check` before handoff. Generated content is never edited directly.

Update a published page's metadata and parent navigation when its purpose changes. Preserve useful old URLs or update inbound anchors together. Keep canonical URLs, sitemap entries, and Markdown links aligned with the deployment origin. `llms.txt` improves discovery; it is not an SEO/AEO promise or a grant of application authority. Do not add speculative schema markup or fabricated update dates.

## Required hierarchy

[docs/README.md](../../docs/README.md) indexes the codebase, feature families, operations, engineering guidance, and verification status. The root README remains a short introduction with Cloud, self-hosting, AI setup, and free local entry points.

- `docs/features/README.md` indexes user and operator capabilities.
- Each major feature owns `docs/features/<feature>/README.md`, explaining behavior and linking relevant source and details.
- Feature details live beneath that feature. A detail with supporting documents gets a subdirectory: for example `dashboard/live-refresh.md` links to `dashboard/live-refresh/verification.md`.
- Cross-cutting architecture belongs in `docs/architecture/`; deployment/operation guides in `docs/operations/`; contributor/testing guidance in `docs/engineering/`; product scope and naming in `docs/product/`.
- `docs/status/README.md` is the current implementation and verification summary. Detailed test evidence belongs with the feature or in its linked verification reference.
- Machine-readable API/CLI contracts stay in `docs/api/`; requirement, cost, and license data files remain reference data.

Create a parent/index link for every new document. Prefer one authoritative home per topic and link from related features. Do not introduce another numbered flat document series. When moving a document, update inbound links, relative source paths, requirement mappings, scripts, and agent entry points together. Keep a redirect stub only for a concrete compatibility need.

Project-specific proposals and implementation plans belong in [docs/projects/](../../docs/projects/README.md); requested specification/design pairs follow the [design workflow](../skills/macrofold-design/SKILL.md). Existing feature and architecture guides remain the current behavior owners. Do not move an existing accepted design just to fit the new project directory.

## Keep maintainer work synchronized

Before code or design changes, find related items through the [maintainer index](../../docs/maintainers/README.md) and [central TODO](../../docs/maintainers/TODO.md), even if none is named. Read their design owners, decisions, dependencies and exit criteria; cite tracker paths/IDs in the PR or handoff.

Update affected items with the work, not afterward: completed/partial scope, blockers, dependencies and remaining tasks. Check only satisfied exit criteria; preserve unverified acceptance checks and reopen regressions. Keep IDs stable; remove only obsolete work and link replacements. Add uncovered substantive work under its feature in the central TODO; do not create parallel TODO documents. Reconcile status against the final diff and evidence before handoff.

For accepted policies expected to change, maintain [Policies to revisit](../../docs/maintainers/revisitable-policies.md). Keep the current policy in its canonical owner; record why, when and by whom it should be reconsidered. Consult relevant entries when changing that policy or crossing its trigger. Update the owner, affected summaries and register together; a review trigger does not authorize relaxing the rule.

## Project approval and current truth

When the developer approves the discussed project plan for work **in chat**, follow the [chat-approval workflow](../skills/macrofold-design/SKILL.md#approval-to-implementation): create/update related maintainer work referencing both project files and integrate relevant accepted behavior/decisions into their persistent cross-project owners before coding, then implement. This is not a GitHub PR approval or a document-status change. Mark approved-but-unimplemented capabilities as targets, not current runtime behavior; update those owners and task states as each slice ships. Project docs retain project-specific scope, context and history, referencing canonical contracts rather than becoming competing current specifications. For a single implementation plan, link that plan instead of manufacturing a design pair.

Code/evidence establishes current behavior; accepted requirements establish targets. Explain changed assumptions and reconcile owners when improving a design. Never relax a specification to hide a bug or substitute an unaccepted proposal. Record unresolved material choices in the decision owner.

For conversation capture, extract agreed decisions, requirements, examples, limits, tasks and questions into their owners; compare the diff against that inventory. Keep proposals distinct. Silence means agreement only when explicitly granted for that conversation, never permission for destructive, paid or permission-changing actions.

Before consolidating/deleting, migrate unique current requirements, tasks, facts, criteria, questions and needed references. Preserve IDs, checkbox state, dependencies, blockers and valid exit criteria. Current specs/trackers state current truth, not dated diaries.

Review the full diff for lost meaning, duplicate owners, stale status and misplaced decisions. For moved paths/headings, search repository-wide, including code comments, and fix inbound links before removing the source. Update local why-comments when their reason changes. Verify relative targets and anchors. Edit only affected owners; record concrete follow-up work, not duplicate generic risks.

## Decisions and provenance

Explain accepted decisions and current tradeoffs in the main document. Historical provenance belongs **only at the bottom**, in an optional `Changelog` section. Include changes necessary to understand why the current system was built this way: an architectural reversal, a durability/security boundary change, or another consequential decision. Omit routine edits, daily progress logs, patch-by-patch test totals, and redundant dated introductions.

Central architecture decisions can describe several current tradeoffs; superseded alternatives and their history belong in the bottom changelog. Do not mix old test results with current totals. Keep useful earlier evidence in a linked verification reference with its scope/limitation; never present it as a current release pass.

## Before handing off

Update the affected feature, its detail/guide when needed, and the status summary for material behavior or validation changes. Update architecture or deployment guidance when responsibilities change. Add unverified prerequisites to the pre-deployment checklist. Record what was actually tested and its limits.

Run `pnpm docs:check` (generated-content drift and `python3 scripts/check-docs.py`). Check that the top-level index reaches the feature, local/source links resolve, and factual contract references match the implementation. Do not add a changelog entry for routine maintenance. Leave the hierarchy and current explanation coherent in the same change as the code.
