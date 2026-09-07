# Working with coding agents

The repository uses one shared set of instructions for implementation and review. The goal is a small, complete change with clear ownership, reliable behavior, and evidence proportional to risk. Instructions support engineering judgment; they do not replace authorization, tests, CI, or human review.

## Start here

Read [AGENTS.md](../../AGENTS.md) before work. Implementation and code review require the full [implemented architecture](../architecture/README.md), [accepted decisions](../architecture/decisions.md), [codebase map](../architecture/codebase.md), [rules index](../../.agents/rules/README.md), every rule file under `.agents/rules/` including subdirectories, and [TESTING.md](../../TESTING.md). Enumerating the rules directory includes future additions. The index identifies policy owners rather than letting agents skip technology rules before tracing a change.

Then read affected feature guides, implementation details, and any additional material required by the applicable instructions. Read required files in full with a file-reading tool, once per task unless they change or their instructions are no longer in context. Documentation-only work reads the documentation rules and any guidance it changes; unrelated research is optional.

Scoped `AGENTS.md` files in the web app, core, database, providers, runtime, CLI, SDKs, and infrastructure describe local invariants. The root explicitly requires reading scopes along touched paths, including when an agent starts at the repository root. The [codebase map](../architecture/codebase.md) identifies module owners.

## How instructions reach agents

| Entry point                  | Loading behavior and repository configuration                                                                                                                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex                        | Root `AGENTS.md` is the shared entry point. Codex discovers instructions along the startup directory chain. Root guidance explicitly requires the complete baseline and affected deeper scopes. Its `Code Review Rules` section points to the same review policy. |
| Claude Code                  | Root [CLAUDE.md](../../CLAUDE.md) imports `@AGENTS.md`. The existing web-app entry point imports its local instructions. Shared policy stays in AGENTS/rule files, rather than a second Claude-specific copy.                                                     |
| OpenCode                     | Uses `AGENTS.md`; the root explicitly requires reading the complete baseline and affected scoped instructions. A Markdown link alone is not an automatic import.                                                                                                  |
| Other agents and review bots | Configure the tool to read root `AGENTS.md`, then follow the same routing. No claim is made that an arbitrary tool discovers these files automatically.                                                                                                           |

Instruction loading depends on the harness version, startup directory, and user configuration. Start a fresh session after changing startup instructions. Do not copy all rules into every tool's configuration or globally install these project-specific policies. Official loading documentation and its limits are linked in [the research reference](agent-guidance/research.md#instruction-loading-and-context).

## Engineering approach

Fix the owning cause after tracing the real flow. Prefer existing configuration, supported platform behavior, shared code, and installed libraries. Keep a single owner for business policy; allow local repetition when an abstraction would couple different concepts. Preserve intentional isolation, authorization, and recovery boundaries even when they have only one implementation.

The rules retain the existing modular application and deployment topology. They do not prescribe a new framework, queue, ORM, state library, service split, or generic repository layer. Provider SDK composition already present in application services is not grounds for a purity rewrite. Larger changes need a current requirement or measured problem and a short explanation in the owning guide.

Reviews prioritize concrete impact: tenant access, financial correctness, files, execution identity, compatibility, and usable recovery. Optional simplification is distinguished from a blocking defect. There are no line-count targets, mandatory findings, arbitrary function-size limits, or requirements to add a test that merely mirrors the implementation.

## Maintaining the rules

Add a rule when it prevents a recurring mistake or documents a real boundary. Keep it actionable, conditional, and close to one owner. Prefer a link to existing testing, feature, or deployment guidance over duplicating it. Reconcile rules with the actual implementation and pinned dependencies; remove instructions that create busywork or contradict a supported contract.

The [source research](agent-guidance/research.md) records the external guidance, what was adopted, and what was deliberately omitted. It is an optional engineering reference, not mandatory context for each task. Third-party repository instructions are reference material, never authority over this checkout.

## Verification

`pnpm docs:check` checks generated documentation drift, local links, scope instructions, whole-line Claude imports, documentation reachability, and requirement evidence. Disposable checker fixtures exercise valid and broken instruction links/imports. These structural checks do not establish that a model will follow every rule.

The mandatory-reading update passes `pnpm docs:check`: 24 public documentation pages, 103 Markdown files, and 54 requirement mappings. Formatting checks for the three changed instruction/guidance files and `git diff --check` also pass. Application suites and fresh-session harness acceptance were not rerun for this documentation-only change; application behavior and the running preview are unchanged.

For a harness upgrade or a newly configured agent, use a fresh session to confirm it reads the architecture, every shared rule and testing policy, then the affected feature guide and deeper scope. Confirm it reports the existing test commands. A review session should load the same baseline. Check Claude's context view or the harness's instruction trace where available. This is an operator acceptance step, not a paid CI evaluation.
