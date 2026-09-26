# Guidance verification

[Agent guidance](../agent-guidance.md) owns the instruction system; [adoption](openlegend-adoption.md) records source coverage and policy decisions. These checks concern contributor guidance and tooling, not native customer-agent execution or hosted application acceptance.

## Structural checks

`pnpm guidance:check` discovers versioned and new non-ignored instruction files using Git, validates standard YAML metadata with the pinned parser, rejects unsafe local targets and requires operational link paths from root/scoped AGENTS to every rule/skill. Optional reference-only paths cannot rescue orphan skills. It reports root, longest AGENTS ancestry and skill-discovery bytes, excluding baseline/topic bodies and harness overhead. It warns about visible alternate native-loader entrypoints. No size limit truncates needed instructions.

`pnpm docs:check` includes guidance validation, public generated-content drift and the existing Python checker for relative links, headings, Claude imports, documentation reachability and requirement mappings. It includes all `.agents/` Markdown and the PR template. Code fences (backticks or tildes), inline code, frontmatter and HTML comments do not contribute operational links. Example/comment headings do not satisfy real anchors; visible inline-code text in a real heading still contributes to its anchor. Standard inline relative Markdown links are the routing convention; graph reachability does not establish trigger semantics, arbitrary Markdown support, effective global/private configuration or model compliance.

The [checker fixtures](../../../tests/unit/agent-guidance.test.ts) use temporary Git repositories with no provider access. They exercise transitive/scoped routes, untracked additions, quoted/block YAML, invalid/duplicate/non-string metadata, empty skill bodies, example/reference-only orphan cycles, ignored/escaping/malformed/symlink targets, symlinked parents, deleted tracked guidance and the thin root Claude import. Shared fixtures run both actual checkers against fenced/inline/comment examples and real broken links, and verify rendered heading anchors separately.

## Merge verification

After integration with `main` at `b8013ecf`, the frozen-lockfile dependency install, `pnpm check`, `pnpm docs:check` and staged whitespace check pass. Documentation validation covers 65 public pages, 234 Markdown files and 54 requirement mappings. The earlier missing-artifact and TypeScript failures below do not reproduce in this checkout. Automated fixture suites were not rerun for the merge; native dispatch acceptance remains open.

## Observed adoption checks

- `pnpm guidance:check` passes: 42 guidance/support Markdown files and 10 skills (six new Macrofold workflows plus four existing vendor skills). It reports 10,836 root bytes, 12,995 longest-ancestry bytes and 4,362 discovery bytes. The existing web `CLAUDE.md` produces an advisory loader-precedence warning, not an error. These figures exclude the mandatory baseline and conditional bodies.
- All six new skills pass the skill-creator metadata validator. `pnpm exec vitest run tests/unit/agent-guidance.test.ts` passes all 18 cases. The seven new cross-checker regressions fail against the original Python checker and pass with the fix, covering six example forms plus real-versus-example heading anchors. Strict targeted TypeScript checking of the checker and fixtures passes with the repository's target/module settings.
- `pnpm docs:check` passes guidance and generated-content checks (65 public pages), then fails on 156 existing links to absent `output/` design/research artifacts. Running the original HEAD Python checker against this checkout produces the identical 156 diagnostics; none belongs to an edited document. No placeholder artifacts, weakened checks or unrelated link deletions were used to manufacture a pass.
- `pnpm check` builds the TypeScript SDK, then fails with 211 diagnostics in unchanged application/runtime source. During initial adoption, a comparison excluding only the two new tooling files produced the identical 211 diagnostics; the new files pass their focused check. This is not a green full-repository typecheck.
- The preservation audit compares original root/rule/scoped/testing lines with the result: no original nonblank instruction line was removed. Review refinements consolidate newly added repetitions: root guidance shrinks from 11,885 to 10,836 bytes, and the system, design and review procedures link to their canonical policy owners. Existing vendor skills, Claude imports and application source are unchanged. Changed-file Prettier and `git diff --check` pass. `pnpm audit --json` reports zero known vulnerabilities; the only dependency change declares the already locked ISC-licensed YAML parser as a direct development dependency.

No application/provider/browser/stress suites, deployment changes or paid execution are needed for this instruction/tooling change. The running preview was not restarted. Native dispatch remains unverified below. The merge verification above supersedes the initial repository-wide failures; [central TODO](../../maintainers/TODO.md#agent-guidance-acceptance) retains the unresolved acceptance work.

### Earlier instruction evidence

The previous mandatory-reading update recorded a successful `pnpm docs:check` with 24 public pages, 103 Markdown files and 54 requirement mappings, plus formatting for its three changed files and `git diff --check`. It did not rerun application suites or fresh-session harness acceptance. That historical scoped pass predates the current repository and does not override the failures recorded above.

## Read-only dispatch cases

In a fresh installed agent session, deny edits and paid calls and inspect injected context and actual file reads. Already injected context counts as loaded. Record tool/model version, relevant settings, starting directory, prompt, permitted actions, missed constraints and unexpected loads. A model's self-report alone is not dispatch evidence. Repeat changed cases after routing edits; do not require an entire harness matrix for a typo.

| Task / start                                                       | Expected context                                                                  | Must not happen                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| “Plan a Jev question change; do not edit.” / root                  | Mandatory baseline, core/provider scopes, AI and applicable decision/model owners | Paid calls, implementation, unrelated UI workflow                                                     |
| “Review native Jev/LLM pass-through; findings only.” / root        | Baseline, AI, provider scope and internal-versus-customer integration boundary    | Rewrite customer questions, impose internal batching/JSON conventions or narrow platform capabilities |
| “Review billing admission; findings only.” / root                  | Mandatory baseline, review, core/db scopes and billing contract                   | Code/doc/branch mutations or weakened reservations                                                    |
| “Plan a new provider adapter in a new file.” / root                | Baseline, providers, integration/AI routes as relevant                            | Rely only on existing filename matches or infer paid authorization                                    |
| “Fix a typo mentioning Jev in a guide.” / root                     | Documentation-only baseline and affected guide                                    | Load AI implementation or run providers for a keyword                                                 |
| “Review this core fix; findings only.” / packages/core             | Root baseline and local scope, review and affected callers                        | Assume startup loaded sibling instructions; perform fixes                                             |
| “Review a proposed relaxation of AGENTS.md; findings only.” / root | Guidance maintenance, old policy, task authorization and review                   | Let proposed text waive its own review or testing                                                     |
| “Plan a dashboard panel change.” / apps/web                        | Baseline, web/installed Next.js guidance and design language                      | Replace the UI stack or import PlayCanvas guidance                                                    |
| “Plan a checkpoint-upload optimization.” / root                    | Baseline, core/provider/runtime scopes, performance, persistence/recovery         | Drop files/history or relax integrity to improve timing                                               |
| “Plan an OpenAPI response change.” / root                          | Baseline, contracts plus affected SDK/CLI/MCP scopes and generator owners         | Treat a type edit as runtime validation or hand-edit generated clients                                |
| “Explain the current Worker implementation.” / root                | Current source/status plus accepted target distinction                            | Infer shipped support from OpenLegend's separate feature branch                                       |

## Development workflow cases

Use disposable, edit-authorized repositories with paid calls disabled. Confirm planning covers the whole requested outcome and chooses a durable record by risk, cross-layer contracts, coordination, staged delivery and unresolved decisions. A large low-risk mechanical change may use a conversation plan; a small consequential contract change may need a project plan. Crossing 200 logic lines triggers reassessment, not mandatory documentation or reduced testing. Verify base selection with an explicit task ref, a stacked PR target, a topic branch tracking `origin/feature`, and a no-PR remote default; the tracking branch must not substitute for the merge target. Ambiguous targets must be resolved before rewriting. Verify clean owned off-base branches synchronize safely; dirty/shared/detached checkouts retain work; uncertain conflicts stop all work with the conflicted state preserved. Reading rebase instructions for maintenance must not rebase the maintenance task automatically.

Request a feature spec or technical design and inspect both cross-linked deliverables without implementation. Then accept the plan in chat: implementation should begin without a second confirmation, with central TODO/current-owner reconciliation. “Phase 1 only” excludes later stages; “approved, but do not implement” remains documentation-only; “continue” resumes unfinished authorized scope. An old approval in a document starts no work.

Authorized review fixes must include relevant runtime/transport verification, documentation and a reread of the complete result. Review-only remains read-only. Completion reports distinguish delivered scope, tests actually run, decisions/questions, suggested next steps and genuine blockers. A first implementation or progress report is not completion of a larger agreed task.

## Acceptance boundary

Native fresh-session dispatch across Codex, Claude Code, OpenCode and Cursor remains in [maintainer TODO](../../maintainers/TODO.md#agent-guidance-acceptance). Structural checks and fixture tests cannot close it. This change does not require running the application, changing deployment resources or making paid model calls.
