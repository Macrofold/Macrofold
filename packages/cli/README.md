# Macrofold CLI

Operate persistent hosted workspaces from your terminal. Requires Node.js 24 or later on macOS or Linux.

## Install from a checkout

From the repository root:

```sh
pnpm install
pnpm --filter @hosted-agents/cli build
cd packages/cli
npm link
```

This registers the built `macrofold` command locally. Use `pnpm cli` from the repository root if you prefer not to create a global link.

## Connect and run

Use [Macrofold Cloud](../../docs/cloud/README.md) or a [self-hosted deployment](../../docs/operations/README.md). Run `macrofold login --host https://YOUR_DOMAIN` with that deployment's origin (`https://app.macrofold.ai` for the default Cloud endpoint), then `macrofold project list` and `macrofold link PROJECT`.
Use `macrofold doctor` to list the deployed model catalog without starting a model call.

`macrofold chat --harness codex --model MODEL` opens an interactive hosted conversation. Prompts,
shell tools, and file edits execute remotely. `macrofold run "PROMPT" --harness codex --model MODEL`
streams a single run. `--detach` returns its ID; `macrofold run attach ID` reconnects.

`macrofold files push PATH --dry-run` and `macrofold files pull PATH --dry-run` preview explicit transfers.
Add `--yes` to apply a reviewed transfer noninteractively. Linking never uploads files.

## Authentication and automation

CI supplies `AGENT_HOST` and a scoped `AGENT_API_KEY` through its secret store. Alternatively,
pipe the API key into `macrofold login --host URL --api-key-stdin`. Credentials are never accepted
as command-line arguments. Profiles use private local files; they are not encrypted at rest.

Use `--json` for one versioned result envelope, or `--jsonl` for normalized run events. First
Ctrl-C requests remote cancellation and waits for persistence. Second Ctrl-C detaches. Ordinary
terminal closure and `/detach` leave remote runs running. `/help` lists interactive commands.

## Recovery

When a mutation response is lost, the CLI prints a recovery idempotency key (or
`error.idempotency_key` with `--json`). Inspect the remote state before starting another
action. To retry the exact request safely through the API or SDK, preserve that key and
the original request body. Running the CLI command again creates a new request identity.

## Command reference

`macrofold completion bash|zsh|fish|powershell` prints an installable shell completion definition.
`macrofold --help` lists all commands. See the [CLI guide](https://github.com/Macrofold/Macrofold/blob/main/docs/features/cli/README.md) for worktrees, transfers, budgets, and input handling.
