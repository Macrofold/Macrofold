# Documentation

Build with persistent cloud agents. Start a task, follow its progress, and return to the same files for the next one.

## Start here

| Guide                                                 | What you will learn                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| [Quickstart](getting-started/quickstart.md)           | Create a project and complete your first run                     |
| [Run and test](getting-started/local-development.md)   | Choose simulation, local Docker, or cloud staging; see what works today |
| [Core concepts](getting-started/concepts.md)          | Understand projects, workspaces, sessions, runs, and checkpoints |
| [Troubleshooting](getting-started/troubleshooting.md) | Recover from setup, queue, connection, and file errors           |

## Use the platform

- [Dashboard](features/dashboard/README.md): projects, files, run history, and team settings.
- [Runs and agents](features/execution/README.md): harness selection, streaming, cancellation, and continuation.
- [Workspaces and Git](features/workspaces/README.md): saved files, checkpoints, independent branches, and synchronization.
- [Connections and access](features/identity-integrations/README.md): provider keys, MCP, applications, search, and permissions.
- [Billing and limits](features/billing/README.md): plans, budgets, reserved credits, and retention.

## Build an integration

Start with the [API quickstart](features/api/quickstart.md) or [terminal CLI](features/cli/README.md).

- [API guide](features/api/README.md) and [OpenAPI reference](api/openapi.json).
- [Streaming and webhooks](features/api/events.md).
- [SDKs](features/api/sdks/README.md) for TypeScript, Python, Go, Rust, and Java.
- [Agent-readable documentation](getting-started/agents.md) and [CLI command schema](api/cli.json).

## Deploy and contribute

- [Development modes](getting-started/local-development.md): [local simulation](getting-started/local-development/simulation.md), [local Docker agents](getting-started/local-development/docker.md), and [cloud staging](getting-started/local-development/cloud.md).
- [Self-hosting](operations/README.md): deployment, configuration, backup, and scaling.
- [Operator reporting](features/operations/README.md): usage, customer activity, and the read-only management MCP.
- [Architecture](architecture/README.md) and [codebase map](architecture/codebase.md): system responsibilities and design decisions.
- [Contributing](../CONTRIBUTING.md) and [engineering](engineering/README.md): development, testing, and review.

## Start work automatically

[Triggers and scheduled tasks](features/triggers/README.md) connect Slack messages, incoming webhooks and recurring prompts to your agents. Follow the setup guide for your starting point.
