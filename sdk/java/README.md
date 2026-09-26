# Macrofold Java SDK

Typed resource methods and resumable run streams using the JDK HTTP client and Jackson. Supports Java 11 or later; contributor builds use JDK 21 and Maven.

Works with [Macrofold Cloud](../../docs/cloud/README.md) and [self-hosted deployments](../../docs/operations/README.md). Use the same resource methods with the origin and API key for your deployment. For help integrating an existing application, use the [coding-agent setup prompt](../../docs/getting-started/agents.md).

## Install from source

Install into your local Maven repository:

```sh
mvn -B -f sdk/java/pom.xml install
```

Add this dependency to your application's `pom.xml`:

```xml
<dependency>
  <groupId>dev.macrofold</groupId>
  <artifactId>macrofold</artifactId>
  <version>0.1.0</version>
</dependency>
```

## Start a run

Set `MACROFOLD_API_KEY` to a scoped dashboard key and copy a workspace ID. Select a harness and model directly; no saved agent or session is required. This example uses Codex and OpenAI’s GPT-5.4 mini. The model catalog determines the provider. Managed execution uses your credits; use `fixture-model` with the local simulator for free development.

```java
import dev.macrofold.Macrofold;
import java.util.UUID;
import dev.macrofold.model.RunCreate;

public class Example {
    public static void main(String[] args) throws Exception {
        Macrofold client = new Macrofold();
        var run = client.runs().create(new RunCreate()
            .workspaceId(UUID.fromString("YOUR_WORKSPACE_ID"))
            .harness(RunCreate.HarnessEnum.CODEX)
            .model("gpt-5.4-mini")
            .billingMode(RunCreate.BillingModeEnum.MANAGED)
            .prompt("Create hello.txt containing Hello world."));
        client.runs().streamText(run.getRunId(), text -> {
            System.out.print(text);
            return true;
        });
    }
}
```

The default origin is `https://app.macrofold.ai`. Pass an explicit key with `new Macrofold(apiKey)`, or use the builder for custom origins. Empty or missing credentials fail before a request:

```java
var client = Macrofold.builder()
    .baseURL("http://localhost:3210")
    .apiKey("YOUR_LOCAL_API_KEY")
    .build();
```

## Stream a model response

For a direct model call without a harness, use `inferences.stream` (Go: `Inferences.Stream`). The helper sets `stream: true`. Set `MACROFOLD_API_KEY` with `runs:write` and `runs:read`; this example requires a configured Anthropic provider and managed credit. Its $0.10 budget is a ceiling, not a price estimate. Workspace-restricted keys must also supply their authorized `workspace_id`.

```java
import dev.macrofold.Macrofold;
import dev.macrofold.model.DecisionBinding;
import dev.macrofold.model.InferenceCreate;
import dev.macrofold.model.InferenceLimits;
import java.util.List;
import java.util.Map;

public class StreamExample {
    public static void main(String[] args) throws Exception {
        var client = new Macrofold();
        var request = new InferenceCreate()
            .modelBinding(new DecisionBinding()
                .provider(DecisionBinding.ProviderEnum.ANTHROPIC)
                .model("claude-haiku-4-5-20251001")
                .billingMode(DecisionBinding.BillingModeEnum.MANAGED))
            .input(Map.of("messages", List.of(Map.of(
                "role", "user", "content", "Explain worktrees in two sentences.")), "max_tokens", 256))
            .limits(new InferenceLimits().timeoutSeconds(60).maxOutputTokens(256).maxCostMicroUsd("100000"));
        client.inferences().stream(request, event -> {
            if (event.getType().equals("run.accepted")) System.out.println("Run: " + event.getRunId());
            if (event.getType().equals("output.delta")) System.out.print(event.getData().getText());
            if (event.getType().startsWith("run.") && !event.getType().equals("run.accepted")) {
                System.out.println(event.getType() + " " + event.getData().getResult());
            }
            return true;
        });
    }
}
```

Direct events are live-only and do not reconnect or replay tokens. Save the accepted run ID to retrieve its final result after a disconnect; detaching leaves execution running. Terminal failures arrive as events, so inspect them even when the helper returns normally. For recovery across process restarts, persist your own idempotency key using the request options described below. See [streaming](../../docs/features/api/streaming.md) for supported providers, events, limits, and REST examples.

## Resource methods

`client.runs().get(id)` fetches a run; `client.runs().cancel(id)` cancels it. Query/header options use named parameter classes: `client.workspaces().list(new Resources.ListWorkspacesParams().limit(20))`. `client.workspaces().list()` uses defaults. Import `dev.macrofold.Resources` for parameter classes.

[Every public operation](../../docs/features/api/sdks/reference.md) has a typed resource method. Models expose fluent setters and typed getters. The API validates required fields, selector combinations, ownership, and model/BYOK configuration. Money remains decimal strings. Pages expose `getData()` and `getNextCursor()`.

## Recovery and streaming

Mutations generate idempotency keys automatically. REST requests make one attempt. For a saved identity, use `resource.withOptions(new RequestOptions(key, organizationId))`, importing `dev.macrofold.RequestOptions`; pass `null` for the default organization. `RequestException` extends `ApiException`, preserving status, headers, body, cause, and `getIdempotencyKey()`. Inspect remote state and retry the same body and key after an uncertain outcome.

`runs().streamText(id, after, callback)` delivers assistant text fragments only, reconnecting and suppressing duplicate events. `events()` exposes structured events; `stream()` remains available. The overload without `after` starts at sequence zero. Return `false` to detach; interruption is observed during reads and retries, while idle reads are bounded by the connection timeout. Detachment leaves the agent running. Use `runs().cancel(id)` explicitly, and save event sequences to resume after a process restart.

The resource's organization option applies to stream connections, reconnects, and history checks without changing other resources.

File writes accept a `File` and `Resources.WriteFileParams(path, revision)`. Reads return a temporary file; delete it after use.

## Wait for the complete response

```java
var result = client.runs().wait(run.getRunId(), java.time.Duration.ofMinutes(5));
System.out.println(result.getOutputText());
System.out.println(result.getCheckpointId());
```

`wait(id)` has no overall timeout. It polls until execution and persistence finish and returns the typed result; optional Git synchronization is separate. A timeout raises `WaitTimeoutException` with `getRunId()`, closes the in-flight response, and stops local waiting. Interruption detaches without cancelling the agent.

Both text streaming and waiting raise `RunFailedException` for failed, cancelled, timed-out, or unsuccessfully persisted runs. Inspect `getRunId()`, `getStatus()`, `getFailureCode()`, and `getResult()`. Partial text may precede failure; transport/authentication exceptions retain their existing types. `Macrofold` is a branded entrypoint extending the existing `Client`.

## Read persisted files

```java
client.runs().wait(run.getRunId());
var file = client.worktrees().readFile(
    run.getWorktreeId(), new Resources.ReadFileParams("hello.txt"));
try {
    System.out.println(java.nio.file.Files.readString(file.toPath()));
} finally {
    java.nio.file.Files.delete(file.toPath());
}
```

Import `dev.macrofold.Resources`. For binary content, use `Files.readAllBytes`. Delete the returned temporary file after use.

Direct reads return the complete file up to 4 MiB. During execution they use the last published revision. See [reading files](../../docs/features/workspaces/read-files.md) for HTTP usage, larger downloads, permissions, and errors.

## Advanced access

Generated classes such as `new WorkspacesApi(client)` remain available, including `WithHttpInfo` variants for response headers and status. Low-level mutations still require explicit idempotency keys. Constructors require HTTPS except on loopback hosts and refuse redirects. For refreshed OAuth tokens, construct a new client with the renewed token.

See [API conventions](../../docs/features/api/conventions.md) for permissions, errors, and asynchronous work.

## Choose a harness

The same run methods support `codex`, `claude-code`, `opencode`, `hermes`, `deepseek`, and `pi`. Select a compatible model from the catalog. See [harness capabilities and examples](../../docs/features/execution/harnesses.md).
