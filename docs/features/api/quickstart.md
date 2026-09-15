# API quickstart

Create a project, run an agent, and print the result. This example works with Macrofold Cloud or your own deployment.

**Building with a coding agent?** Copy the [setup prompt](../../getting-started/agents.md) and describe the feature you want.

## Before you begin

1. Get access to [Macrofold Cloud](../../cloud/README.md), use a [self-hosted deployment](../../operations/README.md), or start the [free local simulator](../../getting-started/local-development/simulation.md).
2. In **API keys**, create a key with project and run read/write access. Store it as `MACROFOLD_API_KEY` in your server environment.
3. Install the [Python SDK](../../../sdk/python/README.md#install-from-source). Prefer another language? Use [TypeScript](../../../sdk/typescript/README.md), [Go](../../../sdk/go/README.md), [Rust](../../../sdk/rust/README.md), [Java](../../../sdk/java/README.md), or [HTTP](http-quickstart.md).

## 1. Create a project

Save this as `example.py`. Set `MACROFOLD_BASE_URL` to your deployment's origin for local or self-hosted use; leaving it unset selects Cloud. This example reads that variable explicitly.

```python
import os
from macrofold import Macrofold

macrofold = Macrofold(
    base_url=os.environ.get("MACROFOLD_BASE_URL", "https://app.macrofold.ai"),
)
project = macrofold.projects.create(name="Research")
```

A project keeps its files between tasks. Save `project.id` and reuse it in your application.

## 2. Start a run

Append the following. Set `MACROFOLD_MODEL` to a model enabled for Codex in your dashboard. For free local simulation, use `fixture-model`. Real execution requires credits or a configured BYOK connection and can incur charges.

```python
run = macrofold.runs.create(
    project_id=project.id,
    harness="codex",
    model=os.environ["MACROFOLD_MODEL"],
    billing_mode="managed",
    prompt="Create hello.txt containing Hello world.",
    limits={"timeout_seconds": 300, "max_cost_micro_usd": "1000000"},
)
```

This caps the run budget at $1; it is not a price estimate. To choose another agent, see [harnesses and models](../execution/harnesses.md). A saved [agent preset](../execution/README.md) can supply the harness, model, and billing settings instead.

## 3. Get the result

```python
result = macrofold.runs.wait(run.run_id)
print(result.output_text)
macrofold.close()
```

Run `python example.py`. You'll see the agent's response after execution and file persistence finish. A failed run raises an exception with its run ID. Simulation produces scripted output rather than interpreting the prompt.

## Next steps

- [Approve connector access](../identity-integrations/connection-access.md) and choose inherited, specific, or no tools.

- [Stream text](../../../sdk/python/README.md#text-structured-events-or-a-complete-result) as the agent works.
- [Read the saved file](../workspaces/read-files.md) using `run.workspace_id`.
- [Let another agent use those files](../workspaces/shared-agents.md).
- [Handle retries and errors](conventions.md) before connecting the flow to real customer actions.
