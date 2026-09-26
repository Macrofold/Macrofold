# Core concepts

Start with three ideas: a **workspace** keeps files, an **agent** does work using the instructions and tools you choose, and a **run** is one task. You can select a supported harness directly for a run or save its configuration as an agent preset.

A workspace's **worktrees** are independent working copies used to edit and execute against its file tree. Use the main worktree first; add another when tasks need separate branches. [From one task to ongoing work](agent-work.md) shows how these concepts support a useful workflow.

## Resource model

| Resource     | Purpose                                             | Example                         |
| ------------ | --------------------------------------------------- | ------------------------------- |
| Organization | Shares membership, permissions, credits, and limits | Your team                       |
| Workspace      | Owns a distinct file tree                 | A research repository           |
| Worktree    | Checks out a workspace, optionally on a branch   | A feature branch                |
| Session      | Keeps a compatible native agent conversation        | An ongoing investigation        |
| Run          | Executes one prompt with a deadline and budget      | Update the report               |
| Checkpoint   | Records a verified recoverable file revision        | The files after a completed run |
| Connection   | Grants access to a provider or tool                 | An MCP server or model key      |
| Agent preset | Reuses harness, model, and run configuration        | A code-review setup             |

**Projects are not implemented yet.** They will group workspaces; they are not a current API resource.

## Optional integration paths

[Customer agents](../features/customer-agents/README.md) is a use-case-specific shortcut over this resource model. It binds your application's authenticated customer to a dedicated workspace, worktree and preset, and checks ownership when sending messages or managing connections. It is not a new core agent type or a requirement for running agents.

## What persists

A run ends; its saved work remains. Verified workspace files persist independently of the execution environment, so keeping a report or repository does not require a dedicated, always-running computer.

Compatible native session state supports conversation continuation, but it is not interchangeable across harness families. File persistence does not imply preserving live RAM, running processes, or every system-level installation. Optional warm compute has its own [lifecycle and cost](../features/execution/sandboxes.md).

Checkpoints provide verified recovery points. Detailed output and tool history have a separate plan retention policy. GitHub synchronization adds a remote version-control copy; it does not replace checkpoint persistence.

A lost sandbox can lose changes since the last published checkpoint. Saved checkpoints, current file revisions, and Git status are visible separately so you can identify what is recoverable.

## Parallel work

Different agents can share a worktree by taking turns: wait for persistence, then give its `worktree_id` to the next run. Their conversations remain separate. Only one active writer can modify a worktree; a new agent receives `worktree_busy` while work is pending. Create another worktree for parallel tasks. See [sharing a worktree](../features/workspaces/shared-agents.md). Organization concurrency limits apply across worktrees and workspaces; available global capacity also affects when a run starts.

## Three independent clocks

- **Queue deadline:** how long a run may wait before starting. New jobs default to 24 hours; requests can choose a shorter deadline.
- **Execution timeout:** how long the agent may run after starting, bounded by the organization's plan.
- **History retention:** how long detailed output remains available. Queue expiry does not delete the run's status or accounting record.

## An accepted request is not a completed task

The API returns a run ID when it accepts work. Follow the status, stream events, or retrieve the result until it is final. Cancellation requests stop future work and preserve recoverable files; they cannot reverse actions already taken by external tools.

Read [runs and agents](../features/execution/README.md), [worktrees](../features/workspaces/README.md), and [billing](../features/billing/README.md) for the full behavior.
