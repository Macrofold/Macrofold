# Documentation

Give an agent a task, follow its progress, and keep the work it produces. Macrofold runs Codex, Claude Code, OpenCode, Hermes, DeepSeek Harness, and Pi through the same API, terminal, and dashboard—without a separate integration for each harness.

Workspace files outlive individual runs. Start with one useful task, then reuse its files, agent setup, and connected tools for the next. [From one task to ongoing work](getting-started/agent-work.md) explains how the pieces fit together.

## Start building

- **[Build with AI](getting-started/agents.md):** copy a setup prompt into your coding agent and describe your feature.
- **[API quickstart](features/api/quickstart.md):** create a workspace, submit a task, and print its result.
- **[Dashboard quickstart](getting-started/quickstart.md):** run and review a task without writing code.

## Choose where Macrofold runs

| Option | You manage | Start here |
| --- | --- | --- |
| Macrofold Cloud | Your application, workspaces, permissions, and usage | [Connect to Cloud](cloud/README.md) |
| Self-hosted | Your Macrofold deployment and its infrastructure | [Self-hosting guide](operations/README.md) |

The same API, SDK, CLI, and feature guides apply to both. Use the origin and credentials for your deployment; enabled integrations, model availability, and limits depend on its configuration. For a free first experiment, use [local simulation](getting-started/local-development/simulation.md).

## Learn the essentials

Start with a **workspace** for files, an **agent** for the job, and a **run** to do one task. You can use the workspace's main worktree before learning about parallel branches or saved conversations. [Core concepts](getting-started/concepts.md) explains the resources and what persists.

- [Explicit-context decisions](features/decisions/README.md): submit evidence for typed decisions, bounded investigations and reviewable task proposals.
- [Runs and agents](features/execution/README.md): select a harness, stream output, continue, and cancel.
- [Worktrees and Git](features/workspaces/README.md): edit files, restore checkpoints, and synchronize a repository.
- [Share files between agents](features/workspaces/shared-agents.md): take turns in one worktree or use separate branches in parallel.
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
