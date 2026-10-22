# Terminal CLI

Work in your local terminal while the agent and its files run remotely. Link a workspace, stream a task, continue a conversation, and transfer files when you choose.

Use the same commands with [Macrofold Cloud](../../cloud/README.md) or a [self-hosted deployment](../../operations/README.md). Login to the origin that owns your workspaces and credentials.

## Install and connect

The CLI requires Node 24 and supports macOS and Linux. Follow the [CLI installation guide](../../../packages/cli/README.md) to build and register the `macrofold` command, then run:

```sh
macrofold --help
macrofold login --host https://YOUR_MACROFOLD_ORIGIN
macrofold workspace list
macrofold link WORKSPACE_ID
macrofold doctor
```

For Cloud, use `https://app.macrofold.ai` (or the origin supplied with your access). For self-hosting, use your deployment's HTTPS origin. For local simulation, use `http://localhost:3210`. Login opens a device authorization flow; no local callback server is required. `doctor` reads the model catalog without executing a model.

Contributors can use `pnpm cli` from the repository root instead of installing the command. That script runs the same CLI from source.

## Run and continue

```sh
macrofold chat --harness codex --model YOUR_ENABLED_MODEL
macrofold run "Review the workspace and save a progress note" --harness codex --model YOUR_ENABLED_MODEL
macrofold run attach RUN_ID
```

Use `fixture-model` instead of `YOUR_ENABLED_MODEL` for free local simulation. Use an enabled model from the hosted catalog for real work. Hosted runs consume usage according to funding and limits. Use `--timeout`, `--max-cost`, and `--queue-timeout` to request lower bounds than the organization's maxima.

`--detach` submits a run and returns its ID. In chat, `/help` lists available commands; `/new` starts a new conversation, and `/detach` leaves remote work running.

When the harness exposes readable thinking, the CLI shows it with `Thinking` labels separately from assistant answers, including completion or interruption. In plain redirected output, thinking and progress go to stderr; stdout contains the final answer. `--jsonl` preserves the structured reasoning events for your own renderer.

## Select reusable compute

Most Runs need no Worker selection. For explicit compute limits or reuse, discover the offerings and target a [Worker](../execution/workers.md):

```sh
macrofold worker offerings
macrofold worker list
macrofold worker show WORKER_ID
macrofold run "Review this project" --worker WORKER_ID --harness codex --model YOUR_ENABLED_MODEL
```

Worker permissions require explicit additional consent. Add `--scope workers:read --scope workers:use` to `login` to inspect and use granted compute; add `--scope workers:write` only when administrative lifecycle control is needed. Normal login does not silently grant Worker administration. A scoped API key can supply the same permissions. Worker access does not grant file, model, or connector access.

Run/chat accept `--worker`, with `--memory-mib` and `--cpu-millis` for explicit per-Run resources. Use Worker command help for creation, revision-fenced updates, pause, resume, and destruction. UUIDs remain identity; exact live names are a convenience. A sleeping zero-baseline Worker wakes from submitted demand, not from polling, so submit before waiting for readiness. Ending one conversation should cancel its own Run rather than destroy compute shared by other conversations.

## Work in parallel

```sh
macrofold worktree list
macrofold worktree create review --from main --use
macrofold files list
macrofold git status
```

A remote worktree is an independent worktree and branch. It does not create a local checkout. Use `worktree checkout NAME --local PATH` explicitly when you want a verified local Git worktree for review.

## Host and operate a custom model

Use [model deployments](../execution/model-deployments.md) for a persistent inference service. Request `model-deployments:read` and `model-deployments:write` at login; connection setup additionally needs `connections:write`. Applications need an explicit deployment grant and `model-deployments:use` with their ordinary Run permissions.

```sh
macrofold connection add --config-file private-connection.json --json
macrofold model-deployment inspect Qwen/Qwen3-0.6B --compute-connection RUNPOD_CONNECTION_ID --json
macrofold model-deployment create --config-file deployment.json --json
macrofold model-deployment revisions DEPLOYMENT_ID --json
macrofold model-deployment start DEPLOYMENT_ID --revision REVISION_ID --policy-file policy.json --json
macrofold model-deployment show DEPLOYMENT_ID --json
macrofold model-deployment grant DEPLOYMENT_ID --config-file grant.json --json
macrofold model-deployment stop DEPLOYMENT_ID --json
```

Configuration files contain the corresponding public API request objects. Protect them with `chmod 600 FILE`; `--config-file -` or `--policy-file -` reads one object from stdin. Keep provider credentials in connection input only. Inspection performs no generation or provisioning. Creation saves a stopped deployment with the explicitly supplied access list. A service command returning accepted state does not establish readiness or completed shutdown.

Use `revise --config-file revision.json` to save immutable model/runtime settings, then `update --revision REVISION_ID` to drain and load them. `rollback --revision PRIOR_REVISION_ID` deliberately selects a saved revision. `update --policy-file policy.json` changes operating limits; omitted policy reuses the stored limits. `grants`, `grant`, and `revoke --grant GRANT_ID` manage current application access. `delete --yes` retires the deployment while retaining required history and cleanup obligations. Mutations accept `--idempotency-key KEY` to recover the same original request deliberately.

Warm managed capacity costs money between requests. The hourly ceiling limits planned infrastructure rate, not lifetime spend; reported and estimated costs are separate, and unknown costs stay unknown. Stopping an external endpoint closes Macrofold access only: its owner must stop the host and its billing separately.

## Transfer files deliberately

```sh
macrofold files push notes.md --dry-run
macrofold files pull notes.md --dry-run
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

## Connector permissions

The CLI uses the same [connector access rules](../identity-integrations/connection-access.md) as dashboard and SDK runs. Provider authorization alone grants no tool access. Inherited selection resolves the linked workspace and saved preset; an explicit connection selection only narrows approved access. Manage access rules in Connections or through the generated SDKs. Connection changes require connections:write consent.

Connector selection inherits by default. Use `--connection CONNECTION_ID:TOOL1,TOOL2` to narrow tools or `--no-connections` to select none; both work with `--agent` and `--session`. Selection never grants access.
