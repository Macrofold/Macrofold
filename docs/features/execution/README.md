# Runs and agents

Run Codex, Claude Code, OpenCode, Hermes, DeepSeek Harness, or Pi in a hosted worktree. Select an available harness/model combination from the deployment's catalog, set a budget, and follow the work as it happens.

## Start a run

Choose a workspace for isolated work, a worktree to use its files, or a session to continue its conversation. Select only one of these contexts. Agent presets save reusable configuration; explicit supported overrides apply to the submitted run.

Model availability depends on the deployment and funding mode. Query `/v1/harnesses` and `/v1/models` or use the dashboard selectors. A different harness starts a new conversation over the preserved files; native conversation state is not interchangeable across harness families.

## Follow progress

The run view and detailed SSE stream show lifecycle changes, assistant output, tool activity, artifacts, and provider-exposed reasoning summaries. Hidden model reasoning is not available. Retrieve the final result even if you were disconnected during execution.

Execution, persistence, and Git synchronization are separate outcomes. A failed task can still save recoverable files. A completed agent with a failed checkpoint requires recovery attention.

## Waiting and deadlines

New jobs can wait up to 24 hours by default. Set `queue_timeout_seconds` to request a shorter wait. The queue deadline bounds waiting before start; `limits.timeout_seconds` bounds execution afterward.

The API and dashboard expose elapsed waiting time, deadline, held credits, and the waiting reason: global capacity, account concurrency, or earlier worktree work. Accounts receive weighted opportunities as slots free up. Interactive work has priority within available capacity; running tasks are not interrupted to make space.

## Continue, answer, or cancel

Continue a session with another message. A busy session can accept a queued follow-up with `queue_if_busy=true`, up to ten queued messages per session. Answer explicit input requests using their request ID; a follow-up prompt is a separate task.

Cancel with the dashboard, CLI, or `POST /v1/runs/{id}/cancel`. Queued cancellation releases reserved credits. Running cancellation saves available work and settles consumed usage. It does not undo external tool actions or cancel other queued follow-ups. Leaving a browser or terminal does not stop a run.

## Learn more

- [Warm sandboxes and long-running servers](sandboxes.md): reuse compute independently of durable files and sessions.
- [Choose a harness](harnesses.md): native tools, models, streaming, and continuation.
- [Unified Harness Interface](unified-harness-interface.md): how native adapters connect and how to contribute a harness.
- [Model catalog](models.md): built-in choices, discovery, and accepted prices.
- [Streaming and webhooks](../api/events.md).
- [Plans and limits](../billing/README.md).
- [Scheduling policy](scheduling.md), [runtime implementation](runtime.md), [execution architecture](implementation.md), and [Workflow recovery](workflow-history.md).
