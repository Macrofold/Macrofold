# Terminal CLI

Work in your local terminal while the agent and its files run remotely. Link a project, stream a task, continue a conversation, and transfer files when you choose.

## Run from source

The CLI requires Node 24 and supports macOS and Linux. After [installing the repository](../../getting-started/local-development.md), run:

```sh
pnpm cli --help
pnpm cli login --host http://localhost:3210
pnpm cli project list
pnpm cli link PROJECT_ID
pnpm cli doctor
```

Use your deployment's HTTPS origin for hosted work. Login opens a device authorization flow; no local callback server is required. `doctor` reads the model catalog without executing a model.

The examples use `pnpm cli` from a checkout. The built package provides the equivalent `agent` executable; see the [package guide](../../../packages/cli/README.md).

## Run and continue

```sh
pnpm cli chat --harness codex --model fixture-model
pnpm cli run "Review the project and save a progress note" --harness codex --model fixture-model
pnpm cli run attach RUN_ID
```

`fixture-model` is local simulation only. Use an enabled model from the hosted catalog for real work. Hosted runs consume usage according to funding and limits. Use `--timeout`, `--max-cost`, and `--queue-timeout` to request lower bounds than the organization's maxima.

`--detach` submits a run and returns its ID. In chat, `/help` lists available commands; `/new` starts a new conversation, and `/detach` leaves remote work running.

## Work in parallel

```sh
pnpm cli worktree list
pnpm cli worktree create review --from main --use
pnpm cli files list
pnpm cli git status
```

A remote worktree is an independent workspace and branch. It does not create a local checkout. Use `worktree checkout NAME --local PATH` explicitly when you want a verified local Git worktree for review.

## Transfer files deliberately

```sh
pnpm cli files push notes.md --dry-run
pnpm cli files pull notes.md --dry-run
```

Review the plan, then repeat without `--dry-run` to apply interactively. Add `--yes` for a reviewed noninteractive transfer. Linking does not upload files, and there is no background directory sync. Deletions and ignored-file inclusion require explicit options. Conflicting revisions require reconciliation.

## Cancellation and recovery

First Ctrl-C requests remote cancellation and waits while files are preserved. A second Ctrl-C detaches. Ordinary terminal closure, SSH loss, and `/detach` leave execution running.

Use `run show ID` for current state, `run attach ID` to resume its stream, and `run cancel ID` to cancel. Queued follow-ups have their own IDs and cancellation actions. The stream reconnects using durable event cursors.

If a mutation response is lost, preserve its reported idempotency key and original request. A fresh CLI invocation creates a new request identity. Inspect server state before retrying through the API or SDK with the recovery key.

## Scripts and credentials

Use `AGENT_HOST` and a scoped `AGENT_API_KEY` from a CI secret store, or pipe the key to `login --api-key-stdin`. Never pass keys as command-line arguments. Local credential files are protected by POSIX permissions; they are not encrypted at rest.

`--json` returns a versioned result envelope. `--jsonl` streams normalized events. Progress stays out of machine-readable stdout; `--plain` provides a simple terminal view.

For the full command table, selectors, exit codes, security boundaries, and input handling, read the [CLI reference](implementation.md) and [machine-readable command contract](../../api/cli.json).
