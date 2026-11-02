# Macrofold Python SDK

Manage persistent workspaces and run cloud agents with keyword arguments and typed responses. Requires Python 3.11 or later.

Works with [Macrofold Cloud](../../docs/cloud/README.md) and [self-hosted deployments](../../docs/operations/README.md). Use the same resource methods with the origin and API key for your deployment. For help integrating an existing application, use the [coding-agent setup prompt](../../docs/getting-started/agents.md).

## Install from source

From the repository root, install into your application virtual environment:

```sh
python -m pip install ./sdk/python
```

## Start a run

Set `MACROFOLD_API_KEY` to a scoped dashboard key and copy a workspace ID. Select a harness and model directly; no saved agent or session is required. This example uses Codex and OpenAI’s GPT-5.4 mini. The model catalog determines the provider. Managed execution uses your credits; use `fixture-model` with the local simulator for free development.

```python
from macrofold import Macrofold

macrofold = Macrofold()
run = macrofold.runs.create(
    workspace_id="YOUR_WORKSPACE_ID",
    harness="codex",
    model="gpt-5.4-mini",
    billing_mode="managed",
    prompt="Create hello.txt containing Hello world.",
)
for text in macrofold.runs.stream_text(run.run_id):
    print(text, end="", flush=True)
macrofold.close()
```

The default origin is `https://app.macrofold.ai`. Override it for self-hosting, staging, or local development; for example:

```python
macrofold = Macrofold(base_url="http://localhost:3210", api_key="YOUR_LOCAL_API_KEY")
```

An explicit key takes precedence over `MACROFOLD_API_KEY`. Empty or missing keys fail before a request. `Client` remains an alias for the same client. Close the client when finished; long-lived applications can share it across requests.

## Stream a model response

For a direct model call without a harness, use `inferences.stream` (Go: `Inferences.Stream`). The helper sets `stream: true`. Set `MACROFOLD_API_KEY` with `runs:write` and `runs:read`; this example requires a configured Anthropic provider and managed credit. Its $0.10 budget is a ceiling, not a price estimate. Workspace-restricted keys must also supply their authorized `workspace_id`.

```python
from macrofold import Macrofold

client = Macrofold()
try:
    for event in client.inferences.stream({
        "model_binding": {
            "provider": "anthropic", "model": "claude-haiku-4-5-20251001", "billing_mode": "managed",
        },
        "input": {
            "messages": [{"role": "user", "content": "Explain worktrees in two sentences."}],
            "max_tokens": 256,
        },
        "limits": {"timeout_seconds": 60, "max_output_tokens": 256, "max_cost_micro_usd": "100000"},
    }):
        if event.type == "run.accepted":
            print("Run:", event.run_id)
        elif event.type == "output.delta":
            print(event.data.text or "", end="", flush=True)
        elif event.type.startswith("run."):
            print(event.type, event.data.result)
finally:
    client.close()
```

Direct events are live-only and do not reconnect or replay tokens. Save the accepted run ID to retrieve its final result after a disconnect; detaching leaves execution running. Terminal failures arrive as events, so inspect them even when the helper returns normally. For recovery across process restarts, persist your own idempotency key using the request options described below. See [streaming](../../docs/features/api/streaming.md) for supported providers, events, limits, and REST examples. Native structured event helpers also carry `reasoning.started`, `reasoning.delta`, and `reasoning.completed`, grouped by `reasoning_id`; answer-only helpers exclude them. See the [thinking stream guide](../../docs/features/api/streaming.md#show-thinking-without-mixing-it-into-the-answer).

## Immediate inference and recovery

Use the inference resource's `create` method for one model invocation. It returns a terminal result or an explicit recovery receipt without polling. Terminal failures are ordinary returned results: inspect `status` and `result.inference.outcome` before applying a value. A `running` receipt includes `recovery_reason` (`in_progress`, `finalization_pending`, or `outcome_unknown`); retrieve its existing Run using `urls.result`. Never submit a replacement automatically after an uncertain outcome.

Both inference `create` and `stream` make **one submission attempt by default**, regardless of general client retry settings. They default to one total 300-second request deadline, including any explicit retries and response reading. A shorter caller deadline detaches delivery; it does not cancel accepted execution. The server supports execution windows up to 240 seconds. Queued inference (`Prefer: respond-async` or `queue_timeout_seconds`) is unsupported.

Pass `request_options=RequestOptions(idempotency_key="saved-call", inference_retries=1, timeout=300)` to `inferences.create(...)` or `inferences.stream(request, ...)`. Timeout is in seconds.

Explicit inference retries accept counts from zero to two and apply only to confirmed pre-admission refusals. They preserve the exact key/body and honor the full `Retry-After`; a hint that cannot fit returns the refusal immediately. Network loss, invalid responses, unknown admission, and interrupted SSE never trigger automatic resubmission. Save your own key before submission to recover across process restarts.

New terminal receipts include invocation-specific `usage` and `billing`; token counts and micro-USD amounts are decimal strings, and unknown counts/costs are null. `billing.charged_micro_usd` is Macrofold's customer model charge (zero for BYOK); provider-reported and estimated provider costs are separate overlapping diagnostics, not additional charges. Failed and uncertain results retain accounting too.

## Resource methods and types

```python
workspaces = macrofold.workspaces.list(limit=20, archived=False)
state = macrofold.runs.get(run.run_id)
macrofold.runs.cancel(run.run_id)
```

All public operations have [resource methods](../../docs/features/api/sdks/reference.md). Keyword arguments and nested types in `macrofold.params` provide completion. Returned Pydantic models expose attributes, typed UUIDs/datetimes, and `model_dump(mode="json")`. Money and sequence numbers stay strings. Use `from_` for date-range query parameters because `from` is a Python keyword.

Required keyword arguments are enforced by Python; editors/type checkers also validate fields, enums, and nested options. Exactly-one workspace/worktree/session selection and ownership-dependent model/BYOK rules are validated by the API. Omit optional fields to use server defaults; `None` sends JSON null only where the contract allows it.

Pages have `data` and `next_cursor`; pass the latter as `cursor` on the next request. File reads return `bytes`. File writes use `macrofold.worktrees.write_file(id, path="notes.md", if_match=revision, content=content)` with the observed revision.

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

Call `close()` on a text/event generator to detach. Only `macrofold.runs.cancel(id)` cancels execution. The synchronous client uses HTTPX; async applications should run blocking work in a worker thread. `wait_operation(id)` remains available for worktree maintenance.

## Errors and recovery

Other mutations keep one identity across bounded retries (two retries by default). To persist your own recovery identity:

```python
from macrofold import RequestOptions

workspace = macrofold.workspaces.create(
    name="Research",
    request_options=RequestOptions(idempotency_key="YOUR_SAVED_REQUEST_KEY"),
)
```

`TransportError.idempotency_key` preserves an uncertain mutation's key, including incomplete or invalid typed responses. Inspect remote state and retry the same body and key. `ApiError` exposes `status`, `code`, and `request_id`. Redirects are refused; HTTPS is required except on loopback hosts.

## Read persisted files

Before closing the client, read the exact file bytes using the run's worktree ID:

```python
macrofold.runs.wait(run.run_id)
content = macrofold.worktrees.read_file(run.worktree_id, path="hello.txt")
print(content.decode("utf-8"))
```

Keep binary content as `bytes`. Close the client in your application's cleanup, as in the example above.

Direct reads return the complete file up to 4 MiB. During execution they use the last published revision. See [reading files](../../docs/features/workspaces/read-files.md) for HTTP usage, larger downloads, permissions, and errors.

## Advanced access

`request(operation, path=..., query=..., body=...)` remains a low-level escape hatch returning dictionaries or bytes. Supply a callable `token` instead of `api_key` for renewed OAuth access tokens. `organization` selects a membership for a user token; API keys stay bound to their organization.

See [API conventions](../../docs/features/api/conventions.md) for budgets, permissions, pagination, and errors.

## Choose a harness

The same run methods support `codex`, `claude-code`, `opencode`, `hermes`, `deepseek`, and `pi`. Select a compatible model from the catalog. See [harness capabilities and examples](../../docs/features/execution/harnesses.md).

## Waiting and recovery limits

Run waits default to 30 hours; use the language's finite timeout/context options for a shorter application deadline. Timing out or detaching never cancels the remote agent. `run_recovery_required` raises the typed Run failure with the current receipt, even when persistence or settlement is still pending. Keep the Run ID and inspect recovery rather than automatically replaying side effects.

Durable streams allow eight consecutive connection failures and at most 2,048 connections per attachment. Save the latest sequence and explicitly reattach if the attachment budget is exhausted. See [SDK usage](../../docs/features/api/sdks/README.md) and [recovery event semantics](../../docs/features/api/events.md#when-automatic-recovery-stops).

## Native output allowance

Session, preset and native Run limits accept `max_output_tokens`, including reasoning and tool-call output. Omission uses inherited/model-aware defaults. An explicit length-limited completion fails the Run; wait helpers report failure, while raw result retrieval retains partial text, `failure_code` and verified checkpoint metadata. A shortened diagnostic prefix is marked `output_text_truncated`. No paid repair retry occurs. See the shared [native output guide](../../docs/features/api/sdks/README.md#native-output-limits) for allowance, budget and recovery details.
