# Macrofold Go SDK

Typed API requests and incremental run streams using Go's standard HTTP client. Requires Go 1.23 or later.

## Install from source

In your application's `go.mod`, require `github.com/Macrofold/Macrofold/sdk/go v0.0.0` and add a local replacement:

```sh
go mod edit -require=github.com/Macrofold/Macrofold/sdk/go@v0.0.0
go mod edit -replace=github.com/Macrofold/Macrofold/sdk/go=/absolute/path/to/Macrofold/sdk/go
```

## Connect and stream

Set `AGENT_HOST`, `AGENT_API_KEY`, and an authorized `RUN_ID` in your environment.

```go
package main

import (
    "context"
    "fmt"
    "os"
    macrofold "github.com/Macrofold/Macrofold/sdk/go"
)

func main() {
    client, err := macrofold.NewClient(os.Getenv("AGENT_HOST"), os.Getenv("AGENT_API_KEY"))
    if err != nil { panic(err) }
    ctx := context.Background()
    projects, _, err := client.ProjectsAPI.ListProjects(ctx).Limit(20).Execute()
    if err != nil { panic(err) }
    fmt.Println(projects.Data)
    err = client.Stream(ctx, os.Getenv("RUN_ID"), "0", func(event macrofold.Event) error {
        fmt.Println(event.Type, event.Data)
        return nil
    })
    if err != nil { panic(err) }
}
```

## Create and recover requests

After adding the client import to your application, run `go mod tidy`, then `go run .`.

API groups expose typed builders such as `client.RunsAPI.CreateRun(ctx).IdempotencyKey(key).RunCreate(body).Execute()`. Generate and retain a unique key per intended mutation. REST requests are single-attempt; retry an uncertain request with the identical body and key. `Execute()` returns the typed result, HTTP response, and error, including structured API errors when available.

File PUT uses an open `*os.File`, a path, and `If-Match`. Close file handles when finished. Monetary fields remain strings. Use `XOrganizationId` when a user token must select a membership; API keys stay bound to their organization.

`Stream` resumes after server rotation. Cancel the context or return an error from the callback to detach; call `CancelRun` explicitly to stop the remote agent. Preserve the last event sequence to resume across application restarts.

See the [SDK guide](https://github.com/Macrofold/Macrofold/blob/main/docs/features/api/sdks/README.md) and [API quickstart](https://github.com/Macrofold/Macrofold/blob/main/docs/features/api/quickstart.md).
