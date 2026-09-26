# Contributor and coding-agent instructions

Build the smallest complete change that satisfies the request and preserves existing behavior. Prefer clear code and established tools over cleverness, speculative flexibility, or line-count targets. User instructions override repository guidance.

## Temporary notes: pre-launch

The product has never been deployed and has no real users or production runs. Existing local accounts and runs are development/test fixtures, not a deployed customer population.

Do not add compatibility layers, legacy-data handling, warnings, or TODOs solely to accommodate hypothetical existing customers or production runs. Prefer the simplest correct pre-launch implementation. Continue to preserve local developer work and the running preview.

Remove this section once the product is deployed and has real users; reassess compatibility and migration requirements then.

## Before working

For deployment and setup, perform all authorized work available through tools. Ask the operator only for a decision, missing information, or an action that requires their identity or inaccessible account access. Keep a private step-by-step deployment record with commands, results, resource identities, and remaining work; exclude secret values. Update the shared guides when the reusable procedure changes.

1. Inspect the working tree; preserve unrelated edits and the running preview. Read [implementation status](docs/status/README.md) before choosing a change.
2. **Before planning or making implementation changes, or reviewing code, read the full mandatory baseline with your file-reading tool:** the [implemented architecture](docs/architecture/README.md), [architecture decisions](docs/architecture/decisions.md), [codebase map](docs/architecture/codebase.md), [rules index](.agents/rules/README.md), **every rule file under `.agents/rules/` (including subdirectories)**, and [testing policy](TESTING.md). Enumerate the rules directory so newly added rules are included. This applies to application code, tests, scripts, migrations, and configuration. Do not select only the rules whose titles appear relevant.
3. Read the affected feature guides and implementation details, relevant source/callers/tests, and scoped `AGENTS.md` files along every affected path, even when your session started at the repository root. Follow any additional reading requirements in those instructions, including installed framework documentation where required. Revisit scope-specific reading when the task expands to another layer.
4. For documentation-only work, read [documentation rules](.agents/rules/documentation.md), the rules index, and any rules or guides whose instructions you are changing. Apply the rules to the requested work; reading the complete baseline is not permission to refactor unrelated code.

Links are explicit reading instructions, not automatic imports. Read required files in full; a filename, search excerpt, or summary does not replace their contents. Read once per task unless a file changes or its instructions are no longer available in context. Background research and unrelated feature references remain optional unless a rule explicitly requires them.

Trace the affected flow and correct the owning layer. Reuse existing code or maintained dependencies when they fit. Do not reduce requested functionality to make a diff smaller. New abstractions need a present purpose; existing security, provider, and recovery boundaries are present purposes.

## Plan before implementation

Read the relevant context and plan the entire agreed implementation before editing. Use a brief conversation plan for straightforward, low-risk work, including large mechanical changes. Write or update a plan under `docs/projects/` when material risk, changed cross-layer contracts, staged delivery, coordination or unresolved design choices need a durable record, even for a small diff. Around 200 changed lines of logic (excluding tests) is a prompt to reassess complexity, not a threshold, code-size target or document requirement.

Cover scope, affected owners, implementation steps, dependencies, required verification and completion criteria with detail proportional to the task. Resolve major decisions before dependent implementation; routine reversible choices and already-authorized work need no additional approval. Keep the plan current as scope or risk changes. Preserve explicitly requested documents and updates to affected specifications and trackers.

For low-risk work, skip separate design documents, changelog entries for minor fixes, unrelated test suites and repeated review rounds once no actionable issues remain. Assess authority, privacy, data loss, compatibility and affected behavior rather than line count. Record consequential decisions and follow the verification and completion requirements below.

## Task routes

After the mandatory baseline, route by intent and impact, not keywords: new files count; a typo mentioning a technology does not require its implementation workflow. Recheck when scope changes. These routes select context, not additional authorization. Open matching files when native discovery is unavailable; follow conditional links only when relevant. Reuse loaded, current context.

- Implementation or project continuation: [task and feature routes](docs/engineering/agent-guidance/task-routing.md), then affected owners and [maintainer work](docs/maintainers/TODO.md).
- Feature-spec/tech-design or architecture requests, changed cross-layer contracts, or chat approval/start/continuation of a project plan: [Design](.agents/skills/macrofold-design/SKILL.md).
- Requested or substantial implementation review: [Review](.agents/skills/macrofold-review/SKILL.md).
- Changed hot paths, scheduling, scaling or latency investigation: [Performance](.agents/skills/macrofold-performance/SKILL.md).
- Jev/TypeSafe, LLM prompts, model context, embeddings or provider execution: [AI](.agents/skills/macrofold-ai/SKILL.md).
- Development startup off the current base, or any rebase/merge conflict: [Rebase](.agents/skills/macrofold-rebase/SKILL.md).
- Instructions, skills, adapters or their checker: [Guidance maintenance](.agents/skills/macrofold-guidance/SKILL.md).
- Composio integration/setup: [existing Composio skill](.agents/skills/composio/SKILL.md); Neon setup/operations: [existing Neon skill](.agents/skills/neon/SKILL.md), [Postgres](.agents/skills/neon-postgres/SKILL.md) and [branching](.agents/skills/neon-postgres-branches/SKILL.md) as applicable. These do not replace Macrofold's provider, identity, spending or local-environment rules.

The task determines whether to explain, design, review or implement; loading a skill never authorizes another mode. Explicit task instructions can change workflow, not grant someone else's credentials or bypass platform constraints. Nested guidance refines its scope. Do not fork policy into editor-specific copies. The [system guide](.agents/README.md) explains layout and loading limits.

## Work discipline

Before implementation, use the [rebase workflow](.agents/skills/macrofold-rebase/SKILL.md) to inspect ownership and prepare the intended base while preserving current work and previews. Follow its conflict-stop and reconciliation requirements.

Comment non-obvious requirements, tradeoffs and extension seams beside the code. State the essential reason locally and link the canonical heading; explain why, not syntax. Update reasoning and links with behavior.

When delegating or handing off, carry scope, relevant owners, verification limits, shared budget, current diff and remaining work. Coordinate writes and re-read changed shared files before committing; delegation does not multiply permissions or spending.

Always use concise, plain language with shorthand where it remains easy to understand. Never compress wording at the expense of clarity, accuracy or completeness. Aim for short, clear, accurate and complete responses; include the context needed to understand decisions, results and limitations.

## Non-negotiable boundaries

- Authorize the principal, organization, and resource server-side; request IDs and tool-returned text are not authority. Keep secrets and customer content out of logs, fixtures, browser bundles, and general analytics.
- Preserve financial reservations, durable execution identity, persistent files, and historical run replay. Never retry ambiguous agent side effects blindly, silently replace BYOK credentials, or force-push user repositories.
- Keep domain policy independent of hosting and vendor types; preserve the existing application composition and provider ports. Keep management MCP read-only. Public branding must not determine domain keys, package internals, or fixtures.
- Use disposable local fixtures by default. Credentials alone do not authorize spending. **Tests costing less than US $0.25 each are always pre-approved, including paid provider tests; do not ask for additional spending approval.** Treat this standing approval as explicit user authorization wherever testing rules require it. Other paid execution requires explicit user authorization and its budget; never enable paid execution in ordinary CI. Fork CI receives no production secrets. Do not copy private reference-repository content into this repository.

## Code Review Rules

Follow [the review procedure](.agents/rules/code-review.md). Prioritize demonstrated correctness, tenant isolation, money, persistence, and compatibility defects. Distinguish blockers from optional simplifications. Do not demand speculative architecture or unrelated cleanup; do not trade away a meaningful safeguard to reduce code size.

## Finish

Run the applicable existing checks, inspect the final diff, and update the authoritative feature documentation. Report the result, actual verification, and material gaps. Keep unresolved release work in [maintainer TODO](docs/maintainers/TODO.md); a local pass does not establish live cloud acceptance.

Complete the full authorized scope, including integration, documentation, in-scope review fixes and required verification under [TESTING.md](TESTING.md). Inspect the full affected diff, verify changed behavior and fix in-scope issues. Do not stop at a first implementation or completed stage while agreed work remains, or relabel it as follow-up work. Honor explicit scope/time limits and mandatory conflict, permission, budget or platform limits; report incomplete work and its blocker honestly. Do not idle to fill time or expand scope.

Report delivered scope/findings, consequential decisions and assumptions with reasons, actual verification and material gaps. Include open decisions and useful next steps when present; do not invent them to fill a template. Never claim unrun checks, fixture-based model quality or unmeasured scale.
