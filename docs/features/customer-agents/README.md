# Build an agent for each customer

Keep a customer's information in one persistent worktree while starting separate conversations, asking specialist agents to help, and scheduling follow-up work. Your application owns the customer and named-agent identity; Macrofold supplies execution, files, sessions, tool authorization, and schedules.

Start with the [personal-agent reference app](../../../examples/personal-agent/README.md). It follows Alice creating Milo, connecting a tool account, chatting, inspecting memory and tasks, scheduling work, and pausing or deleting Milo. Use the [optional file-memory starter](memory.md) for editable context, or the [database recipes](../../../examples/integrations/README.md) for external data.

## Before you begin

1. Choose [Cloud](../../cloud/README.md), [self-hosting](../../operations/README.md), or the [free local simulator](../../getting-started/local-development/simulation.md).
2. Set up your application's customer authentication. A display name, email submitted in a form, or client-supplied customer ID is not proof of ownership.
3. Install a [server-side SDK](../api/sdks/README.md). Keep platform and provider keys out of the browser.
4. Create a scoped key for the resources your server manages. Start from the dashboard's **Read & write** preset, expand **View permissions**, and narrow the selection and projects where possible.

## Map the identities once

| Resource | Owner and purpose | Reuse when |
| --- | --- | --- |
| External customer | Your app's verified authentication subject | The same customer signs in again |
| Named agent, such as Milo | An application record linking customer, project, preset, worktree and conversation IDs | The customer returns to their agent |
| Agent preset (`agent_id`) | Reusable harness, model, instructions, funding and tool-selection defaults | You want the same configuration; it is not a customer identity |
| Project (`project_id`) | Groups worktrees and access rules | Work belongs to the same customer context |
| Worktree (`workspace_id`) | Persistent files and checkpoints | Another conversation or agent needs those files |
| Session (`session_id`) | One compatible native conversation and configuration | The user continues that conversation |
| Run (`run_id`) | One accepted execution, budget and persistence outcome | You are observing or cancelling that exact execution |
| Task in your app | A record of work across runs, such as a trip plan | Work remains open after the conversation ends |
| Trigger (`trigger_id`) | A saved event or schedule that admits future runs | A customer explicitly enables recurring work |

The API retains `/workspaces` and `workspace_id`; the dashboard calls them **worktrees**. All operations use IDs, including unnamed worktrees. A task in `tasks.json` is ordinary data, not a platform scheduler or a guarantee that an agent will wake up.

## Create Milo

After authentication, create a private application record with the verified customer ID and an opaque agent ID. Provision its project, save a preset, and record the project's `default_workspace_id`. Install the optional memory files only in this new worktree. Persist IDs and stable idempotency keys after each confirmed step so restarting setup resumes the same resources.

Use one project per customer-agent in the reference app. This makes project-scoped grants and schedules straightforward. A shared preset can work across customers, but private instructions and tool defaults generally belong in a separate preset. A database-backed record can later replace the example's local store without creating another core platform resource.

## Start a fresh conversation

With the [TypeScript SDK](../../../sdk/typescript/README.md), select the existing worktree and preset and omit `session_id`:

```ts
const accepted = await client.runs.create({
  workspace_id: agent.workspaceId,
  agent_id: agent.presetId,
  prompt: 'Read my current profile and help plan next week.',
}, { idempotencyKey: savedActionKey });
// Store this relationship under the authenticated customer's application record.
saveConversation({ agentId: agent.id, sessionId: accepted.session_id, runId: accepted.run_id });
const finished = await client.runs.wait(accepted.run_id);
console.log(finished.output_text);
```

`agent`, `savedActionKey`, and `saveConversation` are your application's persisted records and storage methods, not SDK globals. The reference app supplies a complete implementation. New sessions share saved files, not other sessions' hidden native history. In simulation, output is scripted; it does not demonstrate model reasoning or memory retrieval.

## Continue or change agents

| Intent | Action |
| --- | --- |
| Keep chatting with Milo | Create a run using the stored `session_id` and the new prompt |
| New conversation, same Milo | Omit `session_id`; use Milo's existing worktree and preset |
| Another agent reviews Milo's files | Wait for persistence, then use the same worktree and a different authorized preset, without the old session ID |
| Two agents work at once | Create separate worktrees and explicitly review and merge their changes |

Wait for `runs.wait` to succeed before a different session writes the same worktree. A second writer receives `workspace_busy`; do not keep retrying without waiting for the first run. Failure to persist requires recovery before a handoff. Optional Git synchronization is separate. See [shared worktrees](../workspaces/shared-agents.md).

Native session state is harness-specific. Changing from one harness family to another starts a fresh conversation; summarize relevant information into authorized files instead of pretending native transcripts migrate automatically.

## Connect the right customer account

1. Authenticate the customer in your app and resolve their agent record server-side.
2. Authorize a named connection using its supported authentication method. For browser-based app consent, use the platform's authenticated connection flow; do not forge a returning user's identity.
3. Approve only needed tools, then add an exact **project + preset** access rule for this agent. Avoid organization-wide access for customer-private accounts.
4. Save the connection ID in the customer's application record. A browser request cannot attach an arbitrary connection ID from another customer.
5. Inspect the access preview and perform a deliberate first run with a budget.

Connected-account identity, your external customer identity, and the platform user are separate. Sharing one server credential does not automatically isolate external customers: the application must enforce its mapping on every request. For stronger separation, provision separate platform organizations/credentials and resolve them from trusted server configuration. Model keys remain owner-bound and never silently fall back to platform keys.

[Connection access rules](../identity-integrations/connection-access.md) explain tool ceilings, inheritance and one-run exceptions. [Connector setup](../identity-integrations/composio.md) is an operator step; enabling a toolkit neither connects customer accounts nor grants tools.

## Schedule ongoing work

Save the intended preset and project. In the dashboard, choose **Templates → Use and schedule**, or **Agent presets → Schedule this preset**. Review cadence, timezone, tool access and per-run budget before enabling. A weekly digest defaults to Monday at 09:00 in the selected timezone.

Schedules use the project's main worktree and start new conversations. They read the latest persisted files and resolve current permissions for each occurrence. If you need independent schedules over different contexts, give those contexts separate projects. An agent task list alone does not create schedules.

Budget is per run, not per month. Saved-trigger capacity, rolling delivery limits, queue capacity, and account spending caps are distinct. Pausing blocks future occurrences; it does not cancel a run already accepted. See [scheduled tasks](../triggers/scheduled-tasks.md).

## Recovery and lifecycle

| Situation | Required behavior |
| --- | --- |
| Setup or mutation response lost | Retry the stored idempotency key and identical body; never create a new key for an uncertain side effect |
| Stream disconnected | Resume events from the last sequence or fetch the known run ID; do not submit the prompt again |
| Run failed or persistence failed | Show the run and recovery status; preserve the last verified files and let the user choose a new attempt |
| Customer corrects memory | Read the current file and revision, apply the correction with conditional write; reconcile a 412 conflict |
| Customer pauses the agent | Block app-initiated runs and pause its schedules; show any already-running work separately |
| Customer deletes the agent | Stop new work, disable schedules, handle active runs explicitly, remove that agent's connection grants, then request project deletion through supported controls |

Deleting a named-agent application record alone does not delete platform resources. Project deletion has a seven-day undo window, requires appropriate authorization, and does not erase accounting or provider backups. File forgetting edits current context; checkpoint and transcript retention are separate. See [retention](../workspaces/README.md#retention-and-deletion).

## Implementation map for coding agents

Read in order: this guide → [reference app](../../../examples/personal-agent/README.md) → [memory convention](memory.md) → [connection access](../identity-integrations/connection-access.md) → [API conventions](../api/conventions.md) → [generated SDK methods](../api/sdks/reference.md). The [OpenAPI contract](../../api/openapi.json) owns exact fields, scopes and responses. The reference app owns its customer record; the core `Agent` API remains a preset. Do not invent `/customers` or an aggregate `/personal-agents` platform endpoint.

Copy this brief into a coding agent, replacing the customer experience sentence:

```text
Build a customer-agent feature using Macrofold's customer-agent guide and maintained personal-agent example.
Customer experience: each authenticated customer creates a named assistant and revisits its files in new conversations.
Read /docs/customer-agents, /docs/customer-agents/example, /docs/customer-agents/memory, /docs/customer-agents/integrations, /docs/connections/access, /docs/api/conventions and /docs/sdk on the chosen deployment; fetch their linked source examples and exact API contract.
Keep the verified customer-to-project/worktree/preset/session mapping server-side. Use opaque IDs and stable persisted idempotency keys. Never accept another customer's resource ID as authority.
Begin with the local simulator and synthetic Alice/Bob fixtures. Do not enable paid execution or external tool calls without explicit configuration and budget.
Offer memory review/correction, new and continued conversations, a schedule review, and explicit pause/delete controls. Explain recovery, retention and unsupported native-history migration. Verify customer separation and uncertain-response recovery before enabling real accounts.
```
