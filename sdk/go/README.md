# Macrofold Go SDK

Typed resource methods and resumable run streams using Go's standard HTTP client. Requires Go 1.23 or later.

Works with [Macrofold Cloud](../../docs/cloud/README.md) and [self-hosted deployments](../../docs/operations/README.md). Use the same resource methods with the origin and API key for your deployment. For help integrating an existing application, use the [coding-agent setup prompt](../../docs/getting-started/agents.md).

## Install from source

In your application, add a local module replacement:

```sh
go mod edit -require=github.com/Macrofold/Macrofold/sdk/go@v0.0.0
go mod edit -replace=github.com/Macrofold/Macrofold/sdk/go=/absolute/path/to/Macrofold/sdk/go
```

After adding the import below, run `go mod tidy`.

## Start a run

Set `MACROFOLD_API_KEY` to a scoped dashboard key and copy a workspace ID. Select a harness and model directly; no saved agent or session is required. This example uses Codex and OpenAI’s GPT-5.4 mini. The model catalog determines the provider. Managed execution uses your credits; use `fixture-model` with the local simulator for free development.

```go
package main

import (
    "context"
    "fmt"
    macrofold "github.com/Macrofold/Macrofold/sdk/go"
)

func main() {
    client, err := macrofold.NewClient()
    if err != nil { panic(err) }
    ctx := context.Background()
    input := macrofold.NewRunCreate("Create hello.txt containing Hello world.")
    input.SetWorkspaceId("YOUR_WORKSPACE_ID")
    input.SetHarness("codex")
    input.SetModel("gpt-5.4-mini")
    input.SetBillingMode("managed")
    run, err := client.Runs.Create(ctx, input)
    if err != nil { panic(err) }
    err = client.Runs.StreamText(ctx, run.RunId, "0", func(text string) error {
        fmt.Print(text)
        return nil
    })
    if err != nil { panic(err) }
}
```

`NewClient()` defaults to `https://app.macrofold.ai` and `MACROFOLD_API_KEY`. Explicit options take precedence; missing or empty keys return an error:

```go
client, err := macrofold.NewClient(
    macrofold.WithBaseURL("http://localhost:3210"),
    macrofold.WithAPIKey("YOUR_LOCAL_API_KEY"),
)
```

## Stream a model response

For a direct model call without a harness, use `inferences.stream` (Go: `Inferences.Stream`). The helper sets `stream: true`. Set `MACROFOLD_API_KEY` with `runs:write` and `runs:read`; this example requires a configured Anthropic provider and managed credit. Its $0.10 budget is a ceiling, not a price estimate. Workspace-restricted keys must also supply their authorized `workspace_id`.

```go
package main

import (
    "context"
    "fmt"
    macrofold "github.com/Macrofold/Macrofold/sdk/go"
)

func main() {
    client, err := macrofold.NewClient()
    if err != nil { panic(err) }
    binding := macrofold.NewDecisionBinding("anthropic", "claude-haiku-4-5-20251001", "managed")
    request := macrofold.NewInferenceCreate(map[string]interface{}{
        "messages": []map[string]string{{"role": "user", "content": "Explain worktrees in two sentences."}},
        "max_tokens": 256,
    }, *binding)
    request.SetLimits(*macrofold.NewInferenceLimits("100000", 256, 60))
    err = client.Inferences.Stream(context.Background(), request, func(event macrofold.InferenceStreamEvent) error {
        switch event.Type {
        case "run.accepted":
            fmt.Println("Run:", event.RunId)
        case "output.delta":
            fmt.Print(event.Data.GetText())
        case "run.succeeded", "run.failed", "run.cancelled", "run.timed_out":
            fmt.Println(event.Type, event.Data.GetResult())
        }
        return nil
    })
    if err != nil { panic(err) }
}
```

Direct events are live-only and do not reconnect or replay tokens. Save the accepted run ID to retrieve its final result after a disconnect; detaching leaves execution running. Terminal failures arrive as events, so inspect them even when the helper returns normally. For recovery across process restarts, persist your own idempotency key using the request options described below. See [streaming](../../docs/features/api/streaming.md) for supported providers, events, limits, and REST examples. Native structured event helpers also carry `reasoning.started`, `reasoning.delta`, and `reasoning.completed`, grouped by `reasoning_id`; answer-only helpers exclude them. See the [thinking stream guide](../../docs/features/api/streaming.md#show-thinking-without-mixing-it-into-the-answer).

## Resource methods

`client.Runs.Get(ctx, id)` returns a typed run; `client.Runs.Cancel(ctx, id)` cancels it. Methods take path identifiers, a typed body where applicable, and a typed parameter struct for query/header options. For example, `client.Workspaces.List(ctx, nil)` lists workspaces with default pagination. Pass `*ListWorkspacesParams` to set a cursor or limit.

[Every public operation](../../docs/features/api/sdks/reference.md) has a resource method. Model constructors set required fields; the API validates selector combinations, authorization, and model/BYOK configuration. Money remains decimal strings.

## Recovery and streaming

Mutations generate an idempotency key automatically. The last variadic arguments accept `WithIdempotencyKey(key)` and `WithRequestOrganization(id)`. REST calls make one attempt. `RequestError` retains the HTTP response, original error through `Unwrap`, and mutation identity through `IdempotencyKey`. After an uncertain outcome, inspect remote state and retry the same body and key.

`Runs.StreamText` emits assistant text fragments only, excluding tool payloads, reasoning, and lifecycle messages. `Runs.Events` exposes structured events; the existing `Runs.Stream` remains available. Both text and structured streaming reconnect with the last delivered sequence and suppresses duplicates. Cancel the context or return an error from the callback to detach. Detachment does not cancel the remote job; call `Runs.Cancel` explicitly. Save the last sequence to resume after a process restart.

`Runs.StreamText`, `Runs.Events`, and `Runs.Wait` also accept `WithRequestOrganization(id)` as variadic request options. This selection applies to reconnects and history checks; it does not change other requests.

File writes accept `*os.File` and `WriteFileParams{Path: path, IfMatch: revision}`; close the file afterward. Reads return a temporary `*os.File`; close and remove it when finished. Pagination uses `Data` and `NextCursor`.

## Wait for the complete response

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
defer cancel()
result, err := client.Runs.Wait(ctx, run.RunId)
if err != nil { panic(err) }
fmt.Println(result.GetOutputText(), result.GetCheckpointId())
```

Import `time` for this timeout example. `Wait` polls until execution and persistence finish, then returns the typed result. Optional Git synchronization is separate. Without a context deadline, waiting has no overall timeout. `WaitTimeoutError` includes `RunID` and unwraps to `context.DeadlineExceeded`; context cancellation detaches. Neither cancels execution.

`StreamText` and `Wait` return `*RunFailedError` for failed, cancelled, timed-out, or unsuccessfully persisted runs. It includes `RunID`, `Status`, `FailureCode`, and the typed `Result`. Use `errors.As` to inspect it. Partial text may precede failure; transport/authentication errors retain their existing types.

## Read persisted files

```go
if _, err := client.Runs.Wait(ctx, run.RunId); err != nil { panic(err) }
file, err := client.Worktrees.ReadFile(ctx, run.WorktreeId, &macrofold.ReadFileParams{Path: "hello.txt"})
if err != nil { panic(err) }
defer os.Remove(file.Name())
defer file.Close()
content, err := io.ReadAll(file)
if err != nil { panic(err) }
fmt.Print(string(content))
```

Import `io` and `os`. The returned temporary file is positioned at its beginning, including for an empty file. Close and remove it after use.

Direct reads return the complete file up to 4 MiB. During execution they use the last published revision. See [reading files](../../docs/features/workspaces/read-files.md) for HTTP usage, larger downloads, permissions, and errors.

## Advanced access

Generated builders remain available through `client.APIClient`, including `client.WorkspacesAPI.ListWorkspaces(ctx).Execute()`. These expose status/headers directly and require explicit idempotency for mutations. Constructors require HTTPS except on loopback hosts and refuse redirects. For refreshed OAuth tokens, construct a new client with the renewed token.

See [API conventions](../../docs/features/api/conventions.md) for permissions, asynchronous work, and errors.

## Choose a harness

The same run methods support `codex`, `claude-code`, `opencode`, `hermes`, `deepseek`, and `pi`. Select a compatible model from the catalog. See [harness capabilities and examples](../../docs/features/execution/harnesses.md).
