# Share a worktree between agents

Two agents can use the same persisted files by taking turns in one worktree. They can use different harnesses, models, and named connections. Each new session keeps its own conversation.

This works the same way on Macrofold Cloud and self-hosted deployments.

## Hand work from one agent to another

Use the same `worktree_id` and wait for the first run to finish execution **and persistence** before submitting the second. Reusing a `workspace_id` selects that workspace's main worktree; an explicit worktree ID makes the handoff unambiguous.

After [setting up the Python SDK](../../../sdk/python/README.md), use two saved agent presets authorized for the workspace:

```python
from macrofold import Macrofold

macrofold = Macrofold()
worktree_id = "YOUR_WORKTREE_ID"

research = macrofold.runs.create(
    worktree_id=worktree_id,
    agent_id="YOUR_RESEARCH_AGENT_ID",
    prompt="Write findings.md with your research findings.",
)
macrofold.runs.wait(research.run_id)

review = macrofold.runs.create(
    worktree_id=worktree_id,
    agent_id="YOUR_REVIEW_AGENT_ID",
    prompt="Read findings.md and write review.md with your assessment.",
)
result = macrofold.runs.wait(review.run_id)
print(result.output_text)
macrofold.close()
```

For self-hosting or local use, set the client's base URL as described in the SDK guide. Each preset supplies its own harness, model, billing configuration, and authorized connections. Each run consumes its own budget. The second agent receives persisted files, not the first agent's private conversation or credentials.

If persistence fails, `wait` raises an error. Recover the worktree before handing it off. Optional Git synchronization is independent of `wait`; another agent on the same worktree can read the saved checkpoint without waiting for a GitHub push.

## If the worktree is busy

A new run from another session or agent returns **409 `worktree_busy`** while the worktree has pending work. Wait for that work to finish, or select another worktree. The API does not automatically queue a new agent behind another agent in the same folder.

Queued follow-up messages within an existing session are a separate feature; they continue that session's fixed configuration. They are not a way to switch its agent preset.

## Work in parallel

Create independent worktrees from a shared checkpoint or authorized Git ref. Each agent gets its own writable files and can run concurrently within the organization's limits. Review and merge their Git branches explicitly. Shared ancestry does not automatically synchronize later edits or resolve conflicts.

| Need | Use |
| --- | --- |
| Agent B reads files saved by agent A | Same worktree, sequential runs |
| Continue an agent's conversation | Same session with compatible configuration |
| Agents edit at the same time | Separate worktrees, then review and merge |
| Read progress before the run saves | Run events; file reads show the last published revision |

See [worktree and Git behavior](README.md), [read files through the API](read-files.md), and [run lifecycle](../execution/README.md).
