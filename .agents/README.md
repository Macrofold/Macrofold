# Agent guidance system

[AGENTS.md](../AGENTS.md) is the shared entrypoint. Complete its mandatory baseline for implementation and review, then load the applicable task procedures and path instructions. Documentation-only work retains its narrower baseline. [Working with coding agents](../docs/engineering/agent-guidance.md) owns loading details, verification and the adoption record.

## Layout and authority

Root instructions hold universal constraints and top-level routing. `.agents/rules/` is a repository convention, not a native Codex permission-rule format. Package `AGENTS.md` files hold local boundaries; `rules/` owns development policy; `skills/*/SKILL.md` owns reusable procedures. Topic-specific details can route through their applicable parent instead of expanding the root. Existing specifications own behavior; comments retain local reasons. References are optional research, not routing prerequisites.

Markdown links resolve from the containing document; shell commands run from the repository root unless stated otherwise. A skill read by itself still needs root and applicable path guidance.

Follow the [root task-mode and authorization policy](../AGENTS.md#task-routes); adapters and nested instructions refine that shared policy instead of creating editor-specific copies.

## Maintaining the system

Use the [guidance-maintenance skill](skills/macrofold-guidance/SKILL.md). Keep one instruction owner, narrow triggers and exact meaning. Preserve Macrofold's full shared reading requirement while keeping optional research and specialized procedures conditional.

Use ordinary, non-symlink guidance files and versioned link targets; newly created non-ignored files are included before staging. Local-only/ignored targets cannot satisfy the guidance check. Keep native skills directly under `.agents/skills/<name>/SKILL.md`, with shallow links to details rather than a deep skill-folder hierarchy.

`pnpm guidance:check` checks skill metadata and operational reachability from root/scoped AGENTS and reports context sizes. `pnpm docs:check` includes that check plus local Markdown links, headings, Claude imports, publication drift and documentation reachability. Optional research links cannot rescue an orphan workflow. Structural reachability does not prove a useful trigger or actual agent compliance; use the [dispatch cases](../docs/engineering/agent-guidance/verification.md) when changing routing.

No generated wrapper copies, skill installers, permission changes or model settings are included. Review and pin vendor skills only when they add missing context; whole collections are not prerequisites to contributing. Existing Composio and Neon skills remain vendor references subject to Macrofold's boundaries, not permission to replace the stack or configure live resources.

Copied/adapted instruction text retains [upstream attribution and licensing](NOTICE.md).
