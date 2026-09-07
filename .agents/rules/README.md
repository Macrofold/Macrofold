# Coding-agent rules

Start with [AGENTS.md](../../AGENTS.md). Read rules according to the task below; apply them to changed behavior and review scope, not as a mandate to refactor unrelated code. Read a file once per task unless it changes. Scoped instructions add local invariants and point here rather than copying policy.

## Required reading

| When                                                                     | Read                                                                                                |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Implementing, fixing, refactoring, or reviewing code                     | [Implementation](implementation.md), [architecture](architecture.md), [code review](code-review.md) |
| TypeScript or Node code, including tests and build scripts               | [TypeScript and Node](typescript.md)                                                                |
| Next.js routes, React dashboard, query cache, styling, or accessibility  | [Web application](web.md) and `apps/web/AGENTS.md`                                                  |
| PostgreSQL, billing, queues, Workflow, storage, Git, runtime, or scaling | [State and execution](state-and-execution.md) and applicable package instructions                   |
| Auth, model/tool providers, MCP, webhooks, SDKs, or CLI                  | [Integration boundaries](integrations.md) and applicable package instructions                       |
| Changed behavior or test review                                          | [Testing](../../TESTING.md); command detail in [testing and CI](../../docs/engineering/testing.md)  |
| Any edit and its documentation impact                                    | [Documentation](documentation.md)                                                                   |

## Maintaining instructions

Keep each rule actionable: state the condition, preferred behavior, and important exception. Keep detailed source research in [engineering guidance](../../docs/engineering/agent-guidance.md). Prefer one owner for a rule; link to the owner instead of maintaining copies across tools.

Do not add fixed file-size quotas, mandatory patterns, review rituals, or new tools without a recurring demonstrated need. Amend rules when they cause unnecessary work or contradict a verified dependency contract. They guide judgment; tests, authorization, and CI enforce behavior.
