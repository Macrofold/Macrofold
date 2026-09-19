# Feature index

These guides apply to Macrofold Cloud and self-hosted deployments. Each feature explains its behavior first, with links to technical details. Start with the [quickstart](api/quickstart.md) or [AI setup prompt](../getting-started/agents.md); contributors can use the [codebase map](../architecture/codebase.md) to find implementation ownership.

| Feature                                                      | Behavior and detail                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Observability](observability/README.md) | Private execution traces, model and tool input/output, usage, cost attribution and replaceable exporters |
| [Execution](execution/README.md)                             | Hosted harnesses, lifecycle and durable run history; [runtime](execution/runtime.md) and [scheduling](execution/scheduling.md)                                                 |
| [Worktrees](workspaces/README.md)                           | Persisted files, checkpoints, independent branches and Git synchronization                                                                                                     |
| [Dashboard](dashboard/README.md)                             | User journeys and UI conventions; [shared live refresh](dashboard/live-refresh.md)                                                                                             |
| [API](api/README.md)                                         | Authentication, resources, idempotency, errors and public contracts                                                                                                            |
| [CLI](cli/README.md)                                         | Remote workspace linking, worktrees, streamed chat and explicit transfers                                                                                                        |
| [Identity and integrations](identity-integrations/README.md) | Authentication, tenant permissions, BYOK and connectors; [tool security](identity-integrations/tools-security.md) and [connector browser](identity-integrations/connectors.md) |
| [Billing](billing/README.md)                                 | Plans, reservations, credits, BYOK accounting and cost assumptions                                                                                                             |
| [Operations and analytics](operations/README.md)             | Growth, usage, capacity reporting and read-only administrator MCP                                                                                                              |

## Explicit-context decisions

[Decisions](decisions/README.md) add one typed inference, finite read-only investigations and sequential task recipes using the existing run identity, ledger and scheduler. [Context](decisions/context.md), [implementation](decisions/implementation.md), and [verification](decisions/verification.md) describe authorization, retention and rollout.

## Files and media

[Files and media](media/README.md) covers attachments, previews and downloadable outputs. Contributor references explain [processing and lifecycle decisions](media/implementation.md) and [verification](media/verification.md).

## Triggered work

[Triggers and scheduled tasks](triggers/README.md) connect Slack messages, incoming webhooks and recurring prompts to saved agents and persistent workspaces.

## Optional integration paths

[Customer agents](customer-agents/README.md) is a use-case-specific convenience API over workspaces, worktrees, presets, sessions, runs and connections. Start with its SDK quickstart and embedded connection guide, or compose the core API directly with the linked reference app. File memory and schedules remain independent options.

- [MCP for coding agents](mcp/README.md): configure and invoke team/cloud agents from local MCP clients.
