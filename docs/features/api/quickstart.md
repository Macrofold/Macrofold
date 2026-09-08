# API quickstart

Create a project, start a run, and read its result with cURL. Use a local simulator for a free first request or an authorized deployment for real agent execution.

## Prefer an SDK?

The [TypeScript](../../../sdk/typescript/README.md) and [Python](../../../sdk/python/README.md) guides start with `Macrofold()`, a scoped `MACROFOLD_API_KEY`, a project, and a saved agent preset. Use `runs.create` followed by plain-text streaming or `runs.wait` for the complete response. The [SDK index](sdks/README.md) includes Go, Rust, and Java. Clients default to the hosted origin and accept local or self-hosted overrides; streams reconnect automatically.

## Before you begin

You need cURL, [jq](https://jqlang.org/), `uuidgen`, and an API key created in the dashboard's **API keys** page. Grant project and run read/write scopes for this example. Store the key as `AGENT_API_KEY` using your shell or secret manager.

Set the service origin and check access. Use your deployment's HTTPS origin instead of localhost for hosted work.

```sh
export AGENT_HOST=http://localhost:3210
curl --fail-with-body "$AGENT_HOST/v1/me" \
  -H "Authorization: Bearer $AGENT_API_KEY"
```

## 1. Create a project

```sh
export PROJECT_REQUEST_KEY="$(uuidgen)"
PROJECT_ID=$(curl --fail-with-body "$AGENT_HOST/v1/projects" \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -H "Idempotency-Key: $PROJECT_REQUEST_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Research","persistence":"persistent"}' | jq -er '.id')
```

The returned ID identifies the project. Reuse this request key and body if the response is lost; keep the same terminal environment for the steps below.

## 2. Choose a model

```sh
curl --fail-with-body "$AGENT_HOST/v1/models" \
  -H "Authorization: Bearer $AGENT_API_KEY"
```

Select a model compatible with Codex. The local simulator uses `fixture-model`:

```sh
export AGENT_MODEL=fixture-model
```

For a hosted run, replace that value with an enabled model ID and add prepaid credits. Real execution can incur charges. This example sets a maximum budget of $1; it is not a prediction of the task's cost.

## 3. Start a run

```sh
export RUN_REQUEST_KEY="$(uuidgen)"
RUN_ID=$(jq -n --arg project "$PROJECT_ID" --arg model "$AGENT_MODEL" \
  '{project_id:$project,harness:"codex",model:$model,billing_mode:"managed",
    prompt:"Read the project and save a short progress note.",
    limits:{timeout_seconds:300,max_cost_micro_usd:"1000000"}}' | \
  curl --fail-with-body "$AGENT_HOST/v1/runs" \
    -H "Authorization: Bearer $AGENT_API_KEY" \
    -H "Idempotency-Key: $RUN_REQUEST_KEY" \
    -H 'Content-Type: application/json' --data-binary @- | jq -er '.run_id')
```

The server accepts the task and returns a run ID. This is an asynchronous acceptance, not the final result.

## 4. Follow progress and retrieve the result

```sh
curl -N --fail-with-body "$AGENT_HOST/v1/runs/$RUN_ID/stream" \
  -H "Authorization: Bearer $AGENT_API_KEY"

curl --fail-with-body "$AGENT_HOST/v1/runs/$RUN_ID/result" \
  -H "Authorization: Bearer $AGENT_API_KEY"
```

A cURL stream can end at the server's connection rotation before the run finishes. Reconnect with `Last-Event-ID` using the last event ID, or use an SDK to handle reconnection. Check the result's `final` flag before treating it as complete.

## Continue building

Use a workspace or session selector for work over existing files and conversations. Learn [authentication and retries](README.md), [event delivery](events.md), and [CLI workflows](../cli/README.md). The [OpenAPI contract](../../api/openapi.json) lists every operation and schema.
