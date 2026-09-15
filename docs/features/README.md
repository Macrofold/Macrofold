# Feature index

These guides apply to Macrofold Cloud and self-hosted deployments. Each feature explains its behavior first, with links to technical details. Start with the [quickstart](api/quickstart.md) or [AI setup prompt](../getting-started/agents.md); contributors can use the [codebase map](../architecture/codebase.md) to find implementation ownership.

| Feature                                                      | Behavior and detail                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Execution](execution/README.md)                             | Hosted harnesses, lifecycle and durable run history; [runtime](execution/runtime.md) and [scheduling](execution/scheduling.md)                                                 |
| [Workspaces](workspaces/README.md)                           | Persisted files, checkpoints, independent branches and Git synchronization                                                                                                     |
| [Dashboard](dashboard/README.md)                             | User journeys and UI conventions; [shared live refresh](dashboard/live-refresh.md)                                                                                             |
| [API](api/README.md)                                         | Authentication, resources, idempotency, errors and public contracts                                                                                                            |
| [CLI](cli/README.md)                                         | Remote project linking, worktrees, streamed chat and explicit transfers                                                                                                        |
| [Identity and integrations](identity-integrations/README.md) | Authentication, tenant permissions, BYOK and connectors; [tool security](identity-integrations/tools-security.md) and [connector browser](identity-integrations/connectors.md) |
| [Billing](billing/README.md)                                 | Plans, reservations, credits, BYOK accounting and cost assumptions                                                                                                             |
| [Operations and analytics](operations/README.md)             | Growth, usage, capacity reporting and read-only administrator MCP                                                                                                              |

## Triggered work

[Triggers and scheduled tasks](triggers/README.md) connect Slack messages, incoming webhooks and recurring prompts to saved agents and persistent projects.

## Customer-agent applications

[Customer agents](customer-agents/README.md) connects external customer identity, named-agent records, worktrees, presets, sessions, memory and schedules. Start with the linked reference app and file-memory convention.
