# Feature index

Each feature owns a high-level overview and links to implementation or operational details underneath it. The [codebase map](../README.md) explains module ownership.

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
