# Macrofold

**Run cloud agents. Keep their work.**

Macrofold is an open-source control plane for agent work. Give an agent a task, follow its progress, and review the files it produces—from an API, your terminal, or a shared dashboard.

Run Codex, Claude Code, OpenCode, Hermes, DeepSeek Harness, and Pi without building a separate integration for each. Workspace files outlive individual runs, so agents can build on earlier work without a dedicated, always-running computer. [Choose an agent harness](docs/features/execution/harnesses.md).

[Documentation](docs/README.md) · [Build with AI](docs/getting-started/agents.md) · [API quickstart](docs/features/api/quickstart.md) · [Cloud](docs/cloud/README.md) · [Self-hosting](docs/operations/README.md)

## Start with one task

Create a **workspace** for the files, choose an **agent**, and start a **run**. Review the result, then give it the next task. Add connected tools, schedules, or parallel work when you need them—not before your first result. [See the core concepts](docs/getting-started/concepts.md).

Use it for a research brief that stays up to date, recurring operational checks, or an agent inside your own product. The same saved files can support the next conversation or a handoff to another agent.

## What you can do

- **Keep the work, not a machine running.** Save files and Git revisions between tasks, restore checkpoints, and use [independent worktrees](docs/features/workspaces/shared-agents.md) for parallel agents. Native conversation continuation depends on harness compatibility.
- **Leave a task running and come back.** Submit a background agent run, follow its output and tool activity, and reconnect to its event history. Closing your client does not cancel that run. [Streaming and recovery](docs/features/api/streaming.md).
- **Set up an agent once.** Reuse its instructions, selected tools, and limits through the API, dashboard, [Slack, webhooks, or scheduled prompts](docs/features/triggers/README.md).
- **Connect the tools you use.** Add MCP servers, authorized applications, search providers, and your own model API keys. [Connections](docs/features/identity-integrations/README.md).
- **Keep control as you delegate.** Set permissions, run budgets, and concurrency limits; inspect usage and outputs. Connect GitHub to review and synchronize changes without force-pushing.

## Start building

Use [Macrofold Cloud](docs/cloud/README.md) with your account access, or [self-host](docs/operations/README.md) on infrastructure you control. Both use the same API, SDKs, CLI, and dashboard; configure your client's origin and credentials for the deployment you choose. Using a configured deployment does not require you to manage its execution infrastructure.

**Building with a coding agent?** Give it the [setup prompt](docs/getting-started/agents.md) and describe your feature. Prefer code? Follow the [API quickstart](docs/features/api/quickstart.md). To start without code, use the [dashboard quickstart](docs/getting-started/quickstart.md).

## Try it locally

Install [Node.js 24](https://nodejs.org/), [pnpm 10](https://pnpm.io/installation), and [Docker](https://docs.docker.com/get-started/get-docker/). Start Docker, then run:

```sh
git clone https://github.com/Macrofold/Macrofold.git
cd Macrofold
pnpm install
pnpm run setup
pnpm dev
```

In a second terminal, from the same directory:

```sh
pnpm worker
```

Open **http://localhost:3210**. Sign in with `demo@example.test` and `local-only-demo-2026`.

Local setup uses simulated agents, a local database, and captured email. No provider account or paid API call is required. Use [local Docker](docs/getting-started/local-development/docker.md) to run real harnesses through the API without Vercel, or [cloud staging](docs/getting-started/local-development/cloud.md) to exercise a hosted deployment. Docker's complete journey tests use scripted models and make no inference calls.

Continue with [your first run](docs/getting-started/quickstart.md), or compare [the three development modes](docs/getting-started/local-development.md). The [simulator guide](docs/getting-started/local-development/simulation.md) has local API, testing, and shutdown instructions.

## Find your next step

| I want to…                                          | Start here                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Understand workspaces, worktrees, sessions, and runs | [Core concepts](docs/getting-started/concepts.md)                                                                                 |
| Integrate an application                            | [API quickstart](docs/features/api/quickstart.md), [SDKs in five languages](docs/features/api/sdks/README.md) |
| Use a remote agent from my terminal                 | [CLI guide](docs/features/cli/README.md)                                                                                          |
| Connect tools or bring my own API key               | [Connections](docs/features/identity-integrations/README.md)                                                                      |
| Host the service                                    | [Deployment guide](docs/operations/launch-guide.md)                                                                               |
| Understand or contribute to the code                | [Architecture](docs/architecture/README.md), [codebase map](docs/architecture/codebase.md), [contributing](CONTRIBUTING.md)       |
| Read with a coding agent                            | [Setup prompt](docs/getting-started/agents.md), [documentation index](llms.txt), [OpenAPI](docs/api/openapi.json)                          |

## Contributing

Bug reports, documentation improvements, and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and review guidance, and [SECURITY.md](SECURITY.md) for vulnerability reporting.

Anyone can [contribute a harness](docs/features/execution/unified-harness-interface.md#contribute-a-harness) through the Unified Harness Interface and its integration and testing requirements.

## License

[Apache 2.0](LICENSE). Third-party components, agent harnesses, and hosted services retain their own licenses and terms; see [NOTICE](NOTICE).
