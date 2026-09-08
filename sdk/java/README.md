# Macrofold Java SDK

Typed resource methods and resumable run streams using the JDK HTTP client and Jackson. Supports Java 11 or later; contributor builds use JDK 21 and Maven.

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

Set `MACROFOLD_API_KEY` to a scoped dashboard key. Copy a project ID and saved agent preset ID. The preset supplies harness/model/billing configuration; the project identifies persistent files. Managed execution uses credits; local simulation is free.

```java
import dev.macrofold.Macrofold;
import java.util.UUID;
import dev.macrofold.model.RunCreate;

public class Example {
    public static void main(String[] args) throws Exception {
        Macrofold client = new Macrofold();
        var run = client.runs().create(new RunCreate()
            .projectId(UUID.fromString("YOUR_PROJECT_ID"))
            .agentId(UUID.fromString("YOUR_AGENT_ID"))
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

## Resource methods

`client.runs().get(id)` fetches a run; `client.runs().cancel(id)` cancels it. Query/header options use named parameter classes: `client.projects().list(new Resources.ListProjectsParams().limit(20))`. `client.projects().list()` uses defaults. Import `dev.macrofold.Resources` for parameter classes.

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
var file = client.workspaces().readFile(
    run.getWorkspaceId(), new Resources.ReadFileParams("hello.txt"));
try {
    System.out.println(java.nio.file.Files.readString(file.toPath()));
} finally {
    java.nio.file.Files.delete(file.toPath());
}
```

Import `dev.macrofold.Resources`. For binary content, use `Files.readAllBytes`. Delete the returned temporary file after use.

Direct reads return the complete file up to 4 MiB. During execution they use the last published revision. See [reading files](../../docs/features/workspaces/read-files.md) for HTTP usage, larger downloads, permissions, and errors.

## Advanced access

Generated classes such as `new ProjectsApi(client)` remain available, including `WithHttpInfo` variants for response headers and status. Low-level mutations still require explicit idempotency keys. Constructors require HTTPS except on loopback hosts and refuse redirects. For refreshed OAuth tokens, construct a new client with the renewed token.

See [API conventions](../../docs/features/api/README.md) for permissions, errors, and asynchronous work.
