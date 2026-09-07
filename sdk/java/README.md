# Macrofold Java SDK

Typed API requests and incremental run streams using the JDK HTTP client and Jackson. Supports Java 11 or later; contributor builds use JDK 21 and Maven.

## Install from source

From the repository root, install into your local Maven repository:

```sh
mvn -B -f sdk/java/pom.xml install
```

Add the dependency to your application's `pom.xml`:

```xml
<dependency>
  <groupId>dev.macrofold</groupId>
  <artifactId>macrofold</artifactId>
  <version>0.1.0</version>
</dependency>
```

## Connect and stream

Set `AGENT_HOST`, `AGENT_API_KEY`, and an authorized `RUN_ID` in your environment.

```java
import dev.macrofold.Client;
import dev.macrofold.api.ProjectsApi;
import java.util.UUID;

public class Example {
    public static void main(String[] args) throws Exception {
        Client client = new Client(System.getenv("AGENT_HOST"), System.getenv("AGENT_API_KEY"));
        var projects = new ProjectsApi(client).listProjects(null, 20, null, null, null);
        System.out.println(projects.getData());
        client.stream(UUID.fromString(System.getenv("RUN_ID")), "0", event -> {
            System.out.println(event.getType() + " " + event.getData());
            return true;
        });
    }
}
```

## Requests and recovery

Construct API groups with the configured client, such as `new RunsApi(client)`. Mutations accept a typed model and explicit idempotency key. Generate a unique key with `UUID.randomUUID().toString()` for each intended action and retain it with the body for recovery. REST requests make one attempt. `ApiException` exposes status, response headers, and response body; do not repeat an uncertain mutation under a new key.

`WorkspacesApi.writeFile` uploads a `File` with the observed revision. `readFile` returns a temporary file; delete it after use. Use the `WithHttpInfo` variants for response headers and status. Monetary values remain strings.

`stream` runs synchronously and resumes after connection rotation. Return `false` from the callback to detach. Interruption is observed during reads and retries; an idle blocking read is bounded by the connection timeout. Detaching leaves the agent running. Use the cancellation API explicitly and retain event sequences for application restarts.

See the [SDK guide](https://github.com/Macrofold/Macrofold/blob/main/docs/features/api/sdks/README.md) and [API quickstart](https://github.com/Macrofold/Macrofold/blob/main/docs/features/api/quickstart.md).
