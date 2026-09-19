# Reuse compute between runs

Keep a sandbox warm for follow-up messages, or create a long-running server for repeated agent work. Files and conversation checkpoints remain in Macrofold independently of the server. One sandbox belongs to one worktree and executes one run at a time; different sessions and harnesses can use it sequentially.

This is an optional execution setting. Workspaces, worktrees, sessions, permissions and run budgets continue to work as before. Direct explicit-context model requests do not need a sandbox.

## Keep a session warm

Use your deployment's API origin and a server-held key with `runs:write` and `runs:read`. The worktree/session must already exist, execution must be enabled, and the account must have available credit. See the [API quickstart](../api/quickstart.md) for setup.

Send a message to an existing session, keeping compute ready for five minutes afterward:

```sh
curl "$MACROFOLD_BASE_URL/v1/runs" \
  -H "Authorization: Bearer $MACROFOLD_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"session_id\":\"$SESSION_ID\",\"prompt\":\"Continue the investigation.\",\"keep_warm_seconds\":300,\"sandbox_max_cost_micro_usd\":\"5000000\"}"
```

Save the returned `sandbox_id`. Include it on subsequent run or session-message requests, alongside the existing session ID. Warm compute is reused. Once it has paused, a new request resumes it and authorizes a new compute allocation. A destroyed ID cannot be reused.

`keep_warm_seconds` is an integer from 0 to 86,400. On a run, **0 or null means release compute after that run**. Omission inherits the selected sandbox's policy. Without a sandbox or positive keep-warm duration, the existing disposable-per-run behavior remains unchanged. A positive duration without `sandbox_id` creates a new ordinary sandbox; supplying the saved ID is what enables reuse.

The accepted run response includes `run_id`, `session_id`, and `sandbox_id`; get a run to recover these identifiers later. [Follow progress](../api/events.md) using the existing run stream/result endpoints.

## Create a long-running server first

A long-running sandbox uses Docker in the local execution profile and Render in hosted deployments that have enabled it. Local development needs no Render account or credentials. It has a disposable filesystem and no attached persistent disk. This explicit choice retains the compute environment between agents; it does not provide fresh microVM isolation for each agent.

```sh
curl "$MACROFOLD_BASE_URL/v1/sandboxes" \
  -H "Authorization: Bearer $MACROFOLD_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"worktree_id\":\"$WORKTREE_ID\",\"name\":\"game-worker\",\"long_running\":true,\"max_cost_micro_usd\":\"5000000\"}"
```

The response is HTTP 202 with an `id` and `status: "creating"`. Poll `GET /v1/sandboxes/{id}` until `ready` to provision ahead of latency-sensitive work. You can also submit a run while it is creating; startup then counts against the run deadline. `worktree_id` is the API field for a worktree.

Set `long_running: false` or omit it for an ordinary sandbox: Vercel on cloud deployments, Docker in the local execution profile. An explicit sandbox initially has a five-minute minimum opportunity to receive its first run. Long-running sandboxes with omitted/null `keep_warm_seconds` have no idle timeout; set a positive duration to opt into idle suspension, or zero to release after each run.

Use the returned ID in `sandbox_id` on native run/message requests. A display name is optional and unique among your organization's non-destroyed sandboxes. Names are labels; operations use IDs. `GET /v1/sandboxes?worktree_id=...` lists authorized sandboxes with cursor pagination.

## Pause, resume and destroy

```sh
# Replace pause with resume or destroy as needed.
curl -X POST "$MACROFOLD_BASE_URL/v1/sandboxes/$SANDBOX_ID/pause" \
  -H "Authorization: Bearer $MACROFOLD_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)"
```

| Action | Ordinary sandbox | Local long-running worker | Hosted long-running server |
| --- | --- | --- | --- |
| Create | Starts fresh compute | Starts a Docker container without a lifetime cutoff | Creates a Render service without a persistent disk |
| Pause | Removes compute | Removes the container | Suspends the Render service |
| Resume | Creates a fresh compute generation | Creates a fresh container | Resumes the service on disposable compute |
| Destroy | Removes compute and retires the sandbox ID | Removes the container and retires the sandbox ID | Deletes the service and retires the sandbox ID |

These actions return HTTP 202; poll `status` until `ready`, `paused` or `destroyed`. They return `sandbox_busy` while a run owns the server or a lifecycle operation is in flight. Wait for run cleanup before changing its server. Reusing the same idempotency key safely retrieves the original action response; poll the resource for current status.

**Pause/resume preserves saved work, not physical disk identity.** On the next run, Macrofold restores the verified worktree and that session's native conversation state. Destroy never deletes these checkpoints and never imports potentially corrupted server contents. Destroy and create is therefore a fresh-disk reset. Uncheckpointed files, installed packages and processes outside persisted paths are disposable.

## Costs and operational limits

Compute has its own prepaid allocation, separate from each run's model/tool budget. `max_cost_micro_usd` defaults to `"5000000"` ($5) per create/resume allocation; `sandbox_max_cost_micro_usd` sets this when a run creates a sandbox automatically. Amounts are decimal strings. Every resume, including automatic resume caused by a subsequent run, authorizes another allocation of the saved size.

The sandbox response reports the accepted per-minute rate, held credit, cumulative cost estimate and active run. Ready and idle time count toward compute cost. Exhausting the allocation pauses the sandbox; a run is admitted only if the remaining allocation covers its requested execution window. Long-running means no idle suspension by default, **not unlimited prepaid funding or an uptime guarantee**. Provider outages, restarts and deployment maintenance remain possible.

Compute is settled when the sandbox pauses or is destroyed, returning unused credit. The [billing usage endpoint](../billing/usage.md) reports it once with `sandbox_id`, workspace and worktree. Run model/tool charges stay separate. Shared server cost is not assigned wholesale to a single session/customer; those filters exclude sandbox charges. Rates are Macrofold's configured charges, not a measurement of the provider invoice. Idle shutdown is maintenance-driven and can occur after the requested interval.

Warm-session behavior retains both compute and the native harness process for a compatible follow-up. Pass the same `sandbox_id` and `session_id`: Codex, Claude Code, OpenCode, Hermes, DeepSeek Harness and Pi keep their loaded conversation in memory. The existing `keep_warm_seconds` policy controls this; no separate harness-cache flag is required.

Reuse requires the same session, model, harness, instructions, permissions, connector grants and latest checkpoint. Changing these, editing/restoring files, losing a process, pausing, or exhausting the idle period causes a fresh native startup from verified state. Different sessions can use the server sequentially, but switching sessions does not retain multiple live conversations. Concurrent agents in one server are not supported.

Each turn still receives its own deadline, budget, tracing and credentials. Idle harness processes are suspended; unrelated tool descendants are terminated before checkpoint capture. They cannot continue writing files or making model/tool calls between turns. A compatible next turn resumes the native processes with refreshed upstream authorization. `runtime.started` events include `reused` to distinguish live reuse from a fresh load.

This removes repeated provisioning, restoration and native initialization on a cache hit; model inference and network delivery still take time. Vercel environments rotate before their configured lifetime when the next run would outlast it. Confirmed loss before preparation can be replaced, but an ambiguously started agent is never silently replayed.

All actions use the same authenticated API, generated SDKs (`client.sandboxes.create`, `get`, `list`, `pause`, `resume`, `destroy` in TypeScript), and customer MCP operation catalog. The administrative MCP remains read-only. There is no separate dashboard server-management screen.

## Hosting and implementation

For local development, build the Docker runtime image and run the API and SQL worker using the [Docker profile](../../getting-started/local-development/docker.md). Both temporary and long-running compute use Docker; long-running containers have no fixed lifetime cutoff but still obey idle overrides, budgets and explicit lifecycle actions. Hosted long-running compute requires enabling and pricing Render, publishing the matching immutable runtime image, and running the lifecycle maintenance dispatcher. See [server configuration](sandboxes/operations.md) and the [runtime implementation](runtime.md#reusable-sandbox-lifecycle). Cloud users should check their deployment's availability; a checked-in provider is not evidence that every hosted deployment has enabled it.
