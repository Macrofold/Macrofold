# Core concepts

A project is a lasting home for work. A run is one task performed inside it.

## Resource model

| Resource     | Purpose                                             | Example                         |
| ------------ | --------------------------------------------------- | ------------------------------- |
| Organization | Shares membership, permissions, credits, and limits | Your team                       |
| Project      | Groups related files and workspaces                 | A research repository           |
| Workspace    | Owns an independent working folder and Git branch   | A feature branch                |
| Session      | Keeps a compatible native agent conversation        | An ongoing investigation        |
| Run          | Executes one prompt with a deadline and budget      | Update the report               |
| Checkpoint   | Records a verified recoverable file revision        | The files after a completed run |
| Connection   | Grants access to a provider or tool                 | An MCP server or model key      |
| Agent preset | Reuses harness, model, and run configuration        | A code-review setup             |

## What persists

Persistent project files and compatible native session state survive ordinary run completion. Checkpoints provide verified recovery points. Detailed output and tool history have a separate plan retention policy. GitHub synchronization adds a remote version-control copy; it does not replace checkpoint persistence.

A lost sandbox can lose changes since the last published checkpoint. Saved checkpoints, current file revisions, and Git status are visible separately so you can identify what is recoverable.

## Parallel work

Only one active writer can modify a workspace. Create another workspace for parallel tasks. Organization concurrency limits apply across workspaces and projects; available global capacity also affects when a run starts.

## Three independent clocks

- **Queue deadline:** how long a run may wait before starting. New jobs default to 24 hours; requests can choose a shorter deadline.
- **Execution timeout:** how long the agent may run after starting, bounded by the organization's plan.
- **History retention:** how long detailed output remains available. Queue expiry does not delete the run's status or accounting record.

## An accepted request is not a completed task

The API returns a run ID when it accepts work. Follow the status, stream events, or retrieve the result until it is final. Cancellation requests stop future work and preserve recoverable files; they cannot reverse actions already taken by external tools.

Read [runs and agents](../features/execution/README.md), [workspaces](../features/workspaces/README.md), and [billing](../features/billing/README.md) for the full behavior.
