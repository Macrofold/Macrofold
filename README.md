# Macrofold

**A persistent workspace for cloud agents.**

Run Codex, Claude Code, OpenCode, Hermes, DeepSeek Harness, and Pi in the cloud from an API, your terminal, or a shared dashboard. Keep project files, conversation history, and Git revisions between tasks. [Choose a harness](docs/features/execution/harnesses.md).

The [Unified Harness Interface (UHI)](docs/features/execution/unified-harness-interface.md) connects each native harness to the same execution system.

[Documentation](docs/README.md) · [Build with AI](docs/getting-started/agents.md) · [API quickstart](docs/features/api/quickstart.md) · [Cloud](docs/cloud/README.md) · [Self-hosting](docs/operations/README.md)

## What you can do

- **Keep work between runs.** [Let agents share saved files](docs/features/workspaces/shared-agents.md), restore checkpoints, and create independent workspaces for parallel tasks.
- **Work from anywhere.** Start a run through the API, stream it in the terminal, and review its output and tool activity in the dashboard.
- **Start work automatically.** Connect Slack messages, incoming webhooks, or [scheduled prompts](docs/features/triggers/README.md) to a saved agent.
- **Connect your tools.** Add MCP servers, authorized applications, search providers, and your own model API keys.
- **Control access and spending.** Use organizations, scoped keys, run budgets, concurrency limits, and usage reporting.
- **Keep Git in the loop.** Connect a GitHub repository, review changes, and synchronize without force-pushing.

## Start building

Use [Macrofold Cloud](docs/cloud/README.md) with your account access, or [self-host](docs/operations/README.md) on infrastructure you control. Both use the same API, SDKs, CLI, and dashboard; configure your client's origin and credentials for the deployment you choose.

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
| Understand projects, workspaces, sessions, and runs | [Core concepts](docs/getting-started/concepts.md)                                                                                 |
| Integrate an application                            | [API quickstart](docs/features/api/quickstart.md), [SDKs in five languages](docs/features/api/sdks/README.md) |
| Use a remote agent from my terminal                 | [CLI guide](docs/features/cli/README.md)                                                                                          |
| Connect tools or bring my own API key               | [Connections](docs/features/identity-integrations/README.md)                                                                      |
| Host the service                                    | [Deployment guide](docs/operations/launch-guide.md)                                                                               |
| Understand or contribute to the code                | [Architecture](docs/architecture/README.md), [codebase map](docs/architecture/codebase.md), [contributing](CONTRIBUTING.md)       |
| Read with a coding agent                            | [Setup prompt](docs/getting-started/agents.md), [documentation index](llms.txt), [OpenAPI](docs/api/openapi.json)                          |

## Contributing

Bug reports, documentation improvements, and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and review guidance, and [SECURITY.md](SECURITY.md) for vulnerability reporting.

Anyone can [contribute a harness](docs/features/execution/unified-harness-interface.md#contribute-a-harness) that implements the Unified Harness Interface and meets its integration and testing requirements.

## License

[Apache 2.0](LICENSE). Third-party components, agent harnesses, and hosted services retain their own licenses and terms; see [NOTICE](NOTICE).
