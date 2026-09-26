# From one task to ongoing work

An agent can do more than return a reply: it can read files, use approved tools, and leave work that the next task builds on. Macrofold gives supported agents a place to do that, with an API, terminal, and dashboard for starting and reviewing the same work.

Use familiar harnesses such as Codex, Claude Code, and OpenCode without writing a new agent loop. You decide the task, context, access, and budget. Macrofold handles run scheduling, progress delivery, and verified file persistence.

## Get one useful result first

Start with the [API quickstart](../features/api/quickstart.md), [dashboard quickstart](quickstart.md), or [coding-agent setup prompt](agents.md). You need access to a configured deployment and an enabled model. [Local simulation](local-development/simulation.md) demonstrates the flow without paid model calls; it produces scripted results, not real research or code.

For a real first task, supply a short document and ask the agent to write a summary to a file. Review the output and confirm persistence. Then ask a follow-up using that saved work. You do not need to configure schedules, multiple agents, or reusable compute before this works.

Three ideas are enough to begin: a **workspace** keeps files, an **agent** supplies the instructions and tools for the job, and a **run** does one task. Start with the workspace's main worktree; explore [the full resource model](concepts.md) when you need independent branches or conversation continuation.

## Keep the work, not a computer running

Workspace files outlive an individual run. After verified persistence, the next run can read the saved report, code, notes, or other files even when the earlier execution environment is gone. Your application does not need to reserve an always-running computer just to retain those files.

Files, conversations, and live processes are different. A compatible session can continue a native conversation; changing harnesses starts a new conversation over the saved files. Stopping compute does not promise preservation of arbitrary process memory or every system-level installation. Optional [warm compute](../features/execution/sandboxes.md) has its own lifecycle and charges. Storage, model, and tool charges remain subject to your [billing configuration](../features/billing/README.md).

## Set up an agent once

Save an [agent preset](../features/execution/README.md#reuse-an-agent) with its instructions, supported harness/model, and run configuration. Select the connections and tools it may use. Reuse that setup with a different task rather than rebuilding it on every request.

A research agent might read selected sources and update a brief. A team agent might inspect a repository and write a diagnostic report. Once a manual run works, a [schedule, Slack message, or webhook](../features/triggers/README.md) can start subsequent work. These are applications you configure, not prebuilt autonomous services.

## Leave, return, and review

A submitted background agent run is independent of the client watching it. Close the browser or disconnect your application, then use the run ID to retrieve status, recorded events, and the final result. Set explicit deadlines and budgets; leaving the page is not cancellation. [Direct model streams have different disconnect behavior](../features/api/streaming.md).

Execution, file persistence, and optional Git synchronization have separate outcomes. A successful response is not proof that every file was saved or a GitHub push succeeded. A lost execution environment may lose edits after the latest published checkpoint. Check those outcomes before handing work to the next task.

## Grow only when the workflow needs it

| You need | Add |
| --- | --- |
| Another agent reviews a saved report | A sequential handoff using the same worktree; wait for persistence first |
| Two agents work at the same time | Independent worktrees, within concurrency limits; review and merge explicitly |
| An agent inside your product | Your application's user authorization and saved resource IDs, or the optional customer-agent integration path |
| The same task runs regularly | A saved agent and a trigger with appropriate access and budget |

[Shared-agent workflows](../features/workspaces/shared-agents.md) and [customer agents](../features/customer-agents/README.md) provide working examples. Shared files do not share private conversations or grant access to another customer's data.

## Keep the decisions that belong to you

Choose the allowed files and tools, spending limits, and when to cancel. Review outputs before using them for consequential actions. Cancellation cannot undo a tool action that already happened, and recovery must not blindly repeat an uncertain external action.

Use [Macrofold Cloud](../cloud/README.md) to consume the service, or [self-host](../operations/README.md) to operate it yourself. Both use the same client interfaces; models, integrations, and limits depend on the deployment. The hosting choice changes who operates the infrastructure, not the need to authorize your users and decide what your agents should do.
