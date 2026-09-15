# Documentation

Run Codex, Claude Code, OpenCode, Hermes, DeepSeek Harness, or Pi through an API, CLI, or dashboard. Give agents persistent files they can return to across tasks.

## Start building

- **[Build with AI](getting-started/agents.md):** copy a setup prompt into your coding agent and describe your feature.
- **[API quickstart](features/api/quickstart.md):** create a project, submit a task, and print its result.
- **[Dashboard quickstart](getting-started/quickstart.md):** run and review a task without writing code.

## Choose where Macrofold runs

| Option | You manage | Start here |
| --- | --- | --- |
| Macrofold Cloud | Your application, projects, permissions, and usage | [Connect to Cloud](cloud/README.md) |
| Self-hosted | Your Macrofold deployment and its infrastructure | [Self-hosting guide](operations/README.md) |

The same API, SDK, CLI, and feature guides apply to both. Use the origin and credentials for your deployment; enabled integrations, model availability, and limits depend on its configuration. For a free first experiment, use [local simulation](getting-started/local-development/simulation.md).

## Learn the essentials

A **project** groups work. A **workspace** holds its files. A **run** performs a task. [Core concepts](getting-started/concepts.md) explains what persists.

- [Runs and agents](features/execution/README.md): select a harness, stream output, continue, and cancel.
- [Workspaces and Git](features/workspaces/README.md): edit files, restore checkpoints, and synchronize a repository.
- [Share files between agents](features/workspaces/shared-agents.md): take turns in one workspace or use separate branches in parallel.
- [Connections](features/identity-integrations/README.md): model keys, named app accounts, and MCP tools.
- [Triggers and schedules](features/triggers/README.md): start work from Slack, webhooks, or recurring prompts.
- [Dashboard](features/dashboard/README.md) and [billing](features/billing/README.md): review work, manage access, and control usage.

## Build a customer-facing agent

Read the [customer identity guide](features/customer-agents/README.md), then run the [personal-agent application](../examples/personal-agent/README.md). It keeps customer ownership, named agents, files, conversations and schedules connected. Add the optional [file memory starter](features/customer-agents/memory.md) or use [customer-data recipes](../examples/integrations/README.md) for an existing database or MCP service. Each guide includes setup, examples, recovery, validation and an explicit AI reading map.

## Go deeper

[API overview](features/api/README.md) · [SDKs in five languages](features/api/sdks/README.md) · [CLI](features/cli/README.md) · [Streaming](features/api/events.md) · [Errors and retries](features/api/conventions.md) · [OpenAPI](api/openapi.json) · [Troubleshooting](getting-started/troubleshooting.md)

## Develop and operate

[Local simulation, Docker, and cloud staging](getting-started/local-development.md) are development modes. [Self-hosting](operations/README.md) covers operating a deployment. [Architecture](architecture/README.md), the [codebase map](architecture/codebase.md), and [contributing](../CONTRIBUTING.md) explain how to change Macrofold itself.

Anyone can [contribute a harness through the Unified Harness Interface](features/execution/unified-harness-interface.md), reusing the existing execution, streaming, and persistence system.
