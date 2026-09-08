# Macrofold Python SDK

Manage persistent projects and run cloud agents with keyword arguments and typed responses. Requires Python 3.11 or later.

## Install from source

From the repository root, install into your application virtual environment:

```sh
python -m pip install ./sdk/python
```

## Start a run

Set `MACROFOLD_API_KEY` to a scoped dashboard key. Create a project and saved agent preset in the dashboard, then copy their IDs. The preset supplies the harness, model, billing mode, and authorized connection configuration; the project identifies persistent files. Managed execution uses platform credits. Use local simulation for free development.

```python
from macrofold import Macrofold

macrofold = Macrofold()
run = macrofold.runs.create(
    project_id="YOUR_PROJECT_ID",
    agent_id="YOUR_AGENT_ID",
    prompt="Create hello.txt containing Hello world.",
)
for text in macrofold.runs.stream_text(run.run_id):
    print(text, end="", flush=True)
macrofold.close()
```

The default origin is `https://app.macrofold.ai`. Override it for local development:

```python
macrofold = Macrofold(base_url="http://localhost:3210", api_key="YOUR_LOCAL_API_KEY")
```

An explicit key takes precedence over `MACROFOLD_API_KEY`. Empty or missing keys fail before a request. `Client` remains an alias for the same client. Close the client when finished; long-lived applications can share it across requests.

## Resource methods and types

```python
projects = macrofold.projects.list(limit=20, archived=False)
state = macrofold.runs.get(run.run_id)
macrofold.runs.cancel(run.run_id)
```

All public operations have [resource methods](../../docs/features/api/sdks/reference.md). Keyword arguments and nested types in `macrofold.params` provide completion. Returned Pydantic models expose attributes, typed UUIDs/datetimes, and `model_dump(mode="json")`. Money and sequence numbers stay strings. Use `from_` for date-range query parameters because `from` is a Python keyword.

Required keyword arguments are enforced by Python; editors/type checkers also validate fields, enums, and nested options. Exactly-one project/workspace/session selection and ownership-dependent model/BYOK rules are validated by the API. Omit optional fields to use server defaults; `None` sends JSON null only where the contract allows it.

Pages have `data` and `next_cursor`; pass the latter as `cursor` on the next request. File reads return `bytes`. File writes use `macrofold.workspaces.write_file(id, path="notes.md", if_match=revision, content=content)` with the observed revision.

## Text, structured events, or a complete result

`runs.stream_text(id, after="SEQUENCE")` yields only new assistant text as strings. It uses the existing SSE parser, reconnects after interruptions, and suppresses replay duplicates. Tool payloads, reasoning summaries, lifecycle events, and repeated full-response messages are excluded. Chunks are fragments, not necessarily complete words or lines.

For a complete response without streaming:

```python
result = macrofold.runs.wait(run.run_id, timeout=300)
print(result.output_text)
print(result.checkpoint_id)
```

`wait()` polls status until execution and persistence finish, then returns the typed result and metadata. It has no overall timeout unless one is supplied in seconds. A timeout raises `WaitTimeoutError` with `run_id` and stops waiting without cancelling the agent. HTTPX connection/read timeouts and retry delays are capped by the remaining wait; synchronous transport phases can slightly exceed the deadline before returning control. Waiting does not wait for optional Git synchronization.

Both helpers raise `RunFailedError` for failed, cancelled, timed-out, or unsuccessfully persisted runs. Inspect `run_id`, `status`, `failure_code`, and the typed `result`; API/authentication errors remain `ApiError`. Partial text may have been yielded before failure.

Use `macrofold.runs.events(id, after="SEQUENCE")` for typed structured events and durable sequence cursors. The existing `runs.stream()` remains available. Save a sequence when you need replay after a process restart; automatic reconnects handle it internally during one iterator's lifetime.

Call `close()` on a text/event generator to detach. Only `macrofold.runs.cancel(id)` cancels execution. The synchronous client uses HTTPX; async applications should run blocking work in a worker thread. `wait_operation(id)` remains available for workspace maintenance.

## Errors and recovery

Mutations keep one identity across bounded retries (two retries by default). To persist your own recovery identity:

```python
from macrofold import RequestOptions

project = macrofold.projects.create(
    name="Research",
    request_options=RequestOptions(idempotency_key="YOUR_SAVED_REQUEST_KEY"),
)
```

`TransportError.idempotency_key` preserves an uncertain mutation's key, including incomplete or invalid typed responses. Inspect remote state and retry the same body and key. `ApiError` exposes `status`, `code`, and `request_id`. Redirects are refused; HTTPS is required except on loopback hosts.

## Read persisted files

Before closing the client, read the exact file bytes using the run's workspace ID:

```python
macrofold.runs.wait(run.run_id)
content = macrofold.workspaces.read_file(run.workspace_id, path="hello.txt")
print(content.decode("utf-8"))
```

Keep binary content as `bytes`. Close the client in your application's cleanup, as in the example above.

Direct reads return the complete file up to 4 MiB. During execution they use the last published revision. See [reading files](../../docs/features/workspaces/read-files.md) for HTTP usage, larger downloads, permissions, and errors.

## Advanced access

`request(operation, path=..., query=..., body=...)` remains a low-level escape hatch returning dictionaries or bytes. Supply a callable `token` instead of `api_key` for renewed OAuth access tokens. `organization` selects a membership for a user token; API keys stay bound to their organization.

See [API conventions](../../docs/features/api/README.md) for budgets, permissions, pagination, and errors.
