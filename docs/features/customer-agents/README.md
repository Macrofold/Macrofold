# Customer agents: an optional integration path

Give each authenticated customer a persistent assistant with separate conversations and connected accounts. **Integration paths are use-case-specific shortcuts over Macrofold’s core capabilities.** They are optional: workspaces, worktrees, presets, runs and connections work independently, and remain accessible when you use this path.

The Customer agents path stores your customer-to-resource mapping and checks it on every path operation. Your application authenticates customers; Macrofold does not introduce a new customer identity provider. The SDK group is `customerAgents` (language-specific casing); every endpoint lives under `/v1/integration-paths/customer-agents`, with the OpenAPI tag `customerAgents` and `x-platform-layer: integration-path`.

## Choose your starting point

- **Fastest integration:** follow the [customer-agent quickstart](quickstart.md), then add [customer account connections](connections.md). TypeScript includes optional React connection controls.
- **Custom resource layout:** compose the core API directly. The [personal-agent reference app](../../../examples/personal-agent/README.md) demonstrates this approach, with memory editing, schedules and lifecycle controls.
- **Additional context:** use the optional [file-memory convention](memory.md) or [customer data recipes](../../../examples/integrations/README.md). Neither is required by this path.

Both approaches use the same execution engine, budgets, durable events, checkpoints and connector authorization. There is no separate customer-agent runtime or billing system.

## What this path creates

| Resource                    | Purpose                                                       | Where it lives                  |
| --------------------------- | ------------------------------------------------------------- | ------------------------------- |
| Customer ID                 | Stable opaque subject from your app’s verified authentication | Your app; passed by its backend |
| Binding                     | Maps customer + your agent key to existing resources          | Integration path                |
| Workspace                     | Dedicated home for this customer’s assistant                  | Core platform                   |
| Worktree (`worktree_id`)   | Persistent files across conversations                         | Core platform                   |
| Agent preset (`agent_id`)   | Harness, model, instructions and per-run budget               | Core platform                   |
| Conversation (`session_id`) | One compatible native conversation                            | Core platform                   |
| Run (`run_id`)              | One accepted execution and persistence outcome                | Core platform                   |
| Connection                  | Named account and exact allowed tools                         | Core platform                   |

`ensure` creates a workspace, its default worktree, a preset, and a binding in one transaction. The same customer/key returns the existing binding, including during concurrent setup. Configuration and display name are creation-only; use the returned core IDs to edit presets or workspace settings. Multiple keys let a customer have several assistants. Deleting an underlying resource makes the binding unavailable; `ensure` does not silently recreate it.

The API retains `worktree_id`; the UI calls it a **worktree**. A customer-agent binding is an ownership convenience, not another core agent primitive: the core Agent API remains a saved configuration preset.

## Ownership and limits

Your backend derives the customer ID from a verified app session on **every** request. Never trust a customer ID submitted in a form, URL or model output. Bindings are scoped to the Macrofold organization, credential’s owning member, customer ID and agent key. Rotate API keys under the same owning member to retain access; a different owner cannot take over a binding by guessing its IDs.

The path checks conversations, runs, files and connections against the binding. A broad platform key can still call core APIs directly, so this path is not a substitute for your app’s authorization or a customer-scoped browser credential. All organization administrators retain their normal platform authority. Use separate organizations/credentials if your application needs that stronger administrative separation. Keep platform keys on the server.

## Conversations and files

`sendMessage` starts a new conversation unless `conversation_id` is supplied. Separate conversations reuse files, not each other’s hidden native history. Continue only a conversation returned for the same binding. Use `streamRun` to follow durable events and `getRunResult` for the final response; TypeScript also offers `streamText` and `waitRun`. Closing a stream detaches without cancelling execution.

The worktree has one writer. Wait for persistence before another conversation modifies it; `queue_if_busy` requests normal platform queueing. After successful persistence, `listFiles` and `readFile` return the saved files through the customer ownership check. Changing harness families starts a fresh native conversation. See [shared worktrees](../workspaces/shared-agents.md).

## Schedule ongoing work

Save the intended preset and workspace. In the dashboard, choose **Templates → Use and schedule**, or **Agent presets → Schedule this preset**. Review cadence, timezone, tool access and per-run budget before enabling. A weekly digest defaults to Monday at 09:00 in the selected timezone.

Schedules use the workspace's main worktree and start new conversations. They read the latest persisted files and resolve current permissions for each occurrence. If you need independent schedules over different contexts, give those contexts separate workspaces. An agent task list alone does not create schedules.

Budget is per run, not per month. Saved-trigger capacity, rolling delivery limits, queue capacity, and account spending caps are distinct. Pausing blocks future occurrences; it does not cancel a run already accepted. See [scheduled tasks](../triggers/scheduled-tasks.md).

## Recovery and lifecycle

| Situation                        | Required behavior                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup or mutation response lost  | Retry the stored idempotency key and identical body; never create a new key for an uncertain side effect                                                         |
| Stream disconnected              | Resume events from the last sequence or fetch the known run ID; do not submit the prompt again                                                                   |
| Run failed or persistence failed | Show the run and recovery status; preserve the last verified files and let the user choose a new attempt                                                         |
| Customer corrects memory         | Read the current file and revision, apply the correction with conditional write; reconcile a 412 conflict                                                        |
| Customer pauses the agent        | Block app-initiated runs and pause its schedules; show any already-running work separately                                                                       |
| Customer deletes the agent       | Stop new work, disable schedules, handle active runs explicitly, remove that agent's connection grants, then request workspace deletion through supported controls |

Deleting a named-agent application record alone does not delete platform resources. Workspace deletion has a seven-day undo window, requires appropriate authorization, and does not erase accounting or provider backups. File forgetting edits current context; checkpoint and transcript retention are separate. See [retention](../workspaces/README.md#retention-and-deletion).

## For coding agents

Read this guide, the [quickstart](quickstart.md), [connections guide](connections.md), [API conventions](../api/conventions.md) and [generated SDK method reference](../api/sdks/reference.md). Exact fields, scopes and responses come from [OpenAPI](../../api/openapi.json). Read the [implementation map](implementation.md) when changing the platform.

Copy this brief, replacing the experience sentence:

```text
Build a customer-agent feature using Macrofold’s optional Customer agents integration path.
Experience: each authenticated customer creates an assistant and returns to its conversations, files and connected accounts.
Read /docs/customer-agents, /docs/customer-agents/quickstart, /docs/customer-agents/connections, /docs/api/conventions and /docs/sdk/reference on our Macrofold deployment. Fetch their Markdown sources and /openapi.json.
Use the customerAgents SDK group and /v1/integration-paths/customer-agents routes. These compose core workspaces, worktrees, presets, sessions, runs and connections; do not invent a second runtime or customer auth system.
Derive customer IDs from verified server sessions, keep platform keys server-side, persist binding/run IDs and action idempotency keys, and test Alice/Bob separation.
For connections, review exact tool names into understandable capability choices, bind the return state to the authenticated customer and connection, and complete consent only from the authenticated backend. Start with No access, and handle reconnect, permission conflicts and disconnect explicitly.
Begin with local simulation. Paid runs and external side effects require explicit configuration and budgets. Show execution, persistence and per-run costs separately; wait/stream timeouts must not resubmit work.
```
