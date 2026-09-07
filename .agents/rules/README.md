# Coding-agent rules

Start with [AGENTS.md](../../AGENTS.md) and complete its mandatory reading before implementation or code review. Read every rule file in this directory and its subdirectories, including newly added files, plus [TESTING.md](../../TESTING.md). The table identifies policy owners; it is not a menu for skipping rules. Apply each rule where its conditions hold, without expanding the requested change. Scoped instructions add local invariants and point here rather than copying policy.

## Required reading

| Policy                                        | Owns                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| [Implementation](implementation.md)           | Tracing behavior, small complete changes, simplification, and failure handling |
| [Architecture](architecture.md)               | Layer ownership, dependency direction, sources of truth, and design decisions  |
| [Code review](code-review.md)                 | Review procedure, priorities, scope, and evidence                              |
| [TypeScript and Node](typescript.md)          | Types, validation, async work, subprocesses, and resource cleanup              |
| [Web application](web.md)                     | Next.js/React boundaries, query caching, accessible UI, and freshness          |
| [State and execution](state-and-execution.md) | PostgreSQL, accounting, queues, Workflow, storage, Git, and scaling            |
| [Integration boundaries](integrations.md)     | Auth, model/tool providers, MCP, webhooks, SDKs, and CLI contracts             |
| [Documentation](documentation.md)             | Audience, current behavior, hierarchy, publication, and provenance             |
| [Testing](../../TESTING.md)                   | Test selection, isolation, assertions, coverage, and verification              |

Also read the [implemented architecture](../../docs/architecture/README.md), [accepted decisions](../../docs/architecture/decisions.md), and [codebase map](../../docs/architecture/codebase.md). Then load the affected feature details and scoped instructions. Use [testing and CI](../../docs/engineering/testing.md) for the checks relevant to the change. Documentation-only work follows the narrower reading requirement in root `AGENTS.md`.

## Maintaining instructions

Keep each rule actionable: state the condition, preferred behavior, and important exception. Add every new rule file to this index; keep background research outside the mandatory rules directory, in [engineering guidance](../../docs/engineering/agent-guidance.md). Prefer one owner for a rule; link to the owner instead of maintaining copies across tools.

Do not add fixed file-size quotas, mandatory patterns, review rituals, or new tools without a recurring demonstrated need. Amend rules when they cause unnecessary work or contradict a verified dependency contract. They guide judgment; tests, authorization, and CI enforce behavior.
