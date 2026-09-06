# Python SDK

Requires Python 3.11+. Install the built wheel with `pip install dist/hosted_agents-*.whl`.
Package naming is provisional until public release. API keys come from your secret store.

```python
import os
from hosted_agents import Client

with Client(os.environ["AGENT_HOST"], os.environ["AGENT_API_KEY"]) as client:
    projects = client.request("listProjects", query={"limit": 20})
    print(projects)
    # A real deployment charges for execution. Select an approved model and budget.
    run = client.request("createRun", body={
        "workspace_id": os.environ["WORKSPACE_ID"],
        "prompt": "Update the report and save your work",
        "harness": "codex", "model": os.environ["AGENT_MODEL"],
        "billing_mode": "managed",
        "limits": {"timeout_seconds": 900, "max_cost_micro_usd": "2000000"},
    })
    for event in client.stream(run["run_id"]):
        print(event)
    result = client.request("getRunResult", path={"run_id": run["run_id"]})
```

`request()` accepts every operation ID in the published OpenAPI document. `path` contains
path placeholders, `query` query parameters, `body` the JSON object or bytes for a file PUT,
and `headers` includes preconditions such as `If-Match`. Responses are dictionaries, `bytes`
for `readFile`, and `None` for HTTP 204. OpenAPI remains the authoritative body/response schema.

Mutations retain one idempotency key across retries. `TransportError.idempotency_key` lets
you reconcile an unknown request outcome. `ApiError` includes `status`, `code`, and `request_id`.
The recovery key is retained even when success headers arrive with a truncated response body;
retry the identical body with `idempotency_key=error.idempotency_key` after inspecting remote state.
`wait_operation(ID)` polls durable maintenance operations. `stream(ID, after="SEQUENCE")`
reconnects after normal server rotation; retain the last yielded sequence for process restarts.
Closing the iterator detaches. Use `cancelRun` explicitly to stop a run.

This synchronous client uses maintained HTTPX transport. Async Python applications should
call it in a worker thread; a native async facade is a subsequent SDK convenience and does
not change the API. No SDK method sends credentials to an object download URL or follows redirects.
