# Working with coding agents

The repository uses one shared set of instructions for implementation and review. The goal is a small, complete change with clear ownership, reliable behavior, and evidence proportional to risk. Instructions support engineering judgment; they do not replace authorization, tests, CI, or human review.

## Start here

Read [AGENTS.md](../../AGENTS.md) and follow [the rules index](../../.agents/rules/README.md). The index routes each task to the relevant policy. Implementation, architecture, and review form the common code-change path; technology-specific rules add the constraints for the touched layer. [TESTING.md](../../TESTING.md) remains the authoritative testing policy, and [documentation rules](../../.agents/rules/documentation.md) own documentation maintenance.

Scoped `AGENTS.md` files in the web app, core, database, providers, runtime, CLI, SDKs, and infrastructure describe local invariants. The root explicitly requires reading scopes along touched paths, including when an agent starts at the repository root. The [codebase map](../architecture/codebase.md) identifies module owners.

## How instructions reach agents

| Entry point                  | Loading behavior and repository configuration                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex                        | Root `AGENTS.md` is the shared entry point. Codex discovers instructions along the startup directory chain. Root guidance explicitly directs the agent to read task-relevant rules and deeper scopes. Its `Code Review Rules` section points to the same review policy. |
| Claude Code                  | Root [CLAUDE.md](../../CLAUDE.md) imports `@AGENTS.md`. The existing web-app entry point imports its local instructions. Shared policy stays in AGENTS/rule files, rather than a second Claude-specific copy.                                                           |
| OpenCode                     | Uses `AGENTS.md`; the root explicitly instructs it to read applicable linked files. A Markdown link alone is not an automatic import.                                                                                                                                   |
| Other agents and review bots | Configure the tool to read root `AGENTS.md`, then follow the same routing. No claim is made that an arbitrary tool discovers these files automatically.                                                                                                                 |

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

Local verification passes for 24 public documentation pages, 102 Markdown files, and 54 requirement mappings. Six disposable checker scenarios pass: valid routing/imports, rejection of broken nested links, broken nested/root imports, exclusion of ignored dependency instructions, and rejection of a broken rule-index link. The five installed Next.js guide paths resolve, formatting checks pass, and the working diff has no whitespace errors. Application suites and paid agent evaluations were not rerun for this instruction/documentation change; the application behavior and preview were not modified.

For a harness upgrade or a newly configured agent, use a fresh session to confirm it identifies the root instructions, selects the applicable technology files, reads a deeper scope, and reports the existing test commands. A review session should use the same review policy. Check Claude's context view or the harness's instruction trace where available. This is an operator acceptance step, not a paid CI evaluation.
