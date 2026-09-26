# Macrofold Rust SDK

Typed asynchronous resource methods and resumable run streams using Reqwest and Tokio.

Works with [Macrofold Cloud](../../docs/cloud/README.md) and [self-hosted deployments](../../docs/operations/README.md). Use the same resource methods with the origin and API key for your deployment. For help integrating an existing application, use the [coding-agent setup prompt](../../docs/getting-started/agents.md).

## Install from source

Add the local crate to your application's `Cargo.toml`:

```toml
[dependencies]
macrofold = { path = "/absolute/path/to/Macrofold/sdk/rust" }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
serde_json = "1"
```

Tested with Rust 1.94.1. Native TLS is the default; select `default-features = false, features = ["rustls"]` to use Rustls.

## Start a run

Set `MACROFOLD_API_KEY` to a scoped dashboard key and copy a workspace ID. Select a harness and model directly; no saved agent or session is required. This example uses Codex and OpenAI’s GPT-5.4 mini. The model catalog determines the provider. Managed execution uses your credits; use `fixture-model` with the local simulator for free development.

```rust
use macrofold::{Macrofold, ClientError, models::RunCreate};
use std::io::Write;

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    let client = Macrofold::new()?;
    let mut input = RunCreate::new("Create hello.txt containing Hello world.".into());
    input.workspace_id = Some("YOUR_WORKSPACE_ID".parse()?);
    input.harness = Some(macrofold::models::run_create::Harness::Codex);
    input.model = Some("gpt-5.4-mini".into());
    input.billing_mode = Some(macrofold::models::run_create::BillingMode::Managed);
    let run = client.runs().create(input).await?;
    let id = run.run_id.to_string();
    client.runs().stream_text(&id, "0", |text| {
        print!("{text}");
        std::io::stdout().flush().expect("stdout write failed");
        true
    }).await?;
    Ok(())
}
```

The default origin is `https://app.macrofold.ai`. The builder supports explicit keys and custom origins; missing or empty credentials return an error:

```rust
let client = Macrofold::builder()
    .base_url("http://localhost:3210")
    .api_key("YOUR_LOCAL_API_KEY")
    .build()?;
```

## Stream a model response

For a direct model call without a harness, use `inferences.stream` (Go: `Inferences.Stream`). The helper sets `stream: true`. Set `MACROFOLD_API_KEY` with `runs:write` and `runs:read`; this example requires a configured Anthropic provider and managed credit. Its $0.10 budget is a ceiling, not a price estimate. Workspace-restricted keys must also supply their authorized `workspace_id`.

```rust
use macrofold::{Macrofold, ClientError, models::InferenceCreate};
use std::io::Write;

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    let client = Macrofold::new()?;
    let request: InferenceCreate = serde_json::from_value(serde_json::json!({
        "model_binding": {
            "provider": "anthropic", "model": "claude-haiku-4-5-20251001", "billing_mode": "managed"
        },
        "input": {
            "messages": [{"role": "user", "content": "Explain worktrees in two sentences."}],
            "max_tokens": 256
        },
        "limits": {"timeout_seconds": 60, "max_output_tokens": 256, "max_cost_micro_usd": "100000"}
    }))?;
    client.inferences().stream(request, |event| {
        match event.r#type.as_str() {
            "run.accepted" => println!("Run: {}", event.run_id),
            "output.delta" => {
                print!("{}", event.data.text.as_deref().unwrap_or(""));
                std::io::stdout().flush().expect("stdout write failed");
            },
            "run.succeeded" | "run.failed" | "run.cancelled" | "run.timed_out" => {
                println!("{} {:?}", event.r#type, event.data.result);
            },
            _ => {},
        }
        true
    }).await?;
    Ok(())
}
```

Direct events are live-only and do not reconnect or replay tokens. Save the accepted run ID to retrieve its final result after a disconnect; detaching leaves execution running. Terminal failures arrive as events, so inspect them even when the helper returns normally. For recovery across process restarts, persist your own idempotency key using the request options described below. See [streaming](../../docs/features/api/streaming.md) for supported providers, events, limits, and REST examples. Native structured event helpers also carry `reasoning.started`, `reasoning.delta`, and `reasoning.completed`, grouped by `reasoning_id`; answer-only helpers exclude them. See the [thinking stream guide](../../docs/features/api/streaming.md#show-thinking-without-mixing-it-into-the-answer).

## Resource methods

`client.runs().get(id).await?` fetches status; `client.runs().cancel(id).await?` cancels a job. Query and header parameters use named structs in `macrofold::resources`; for default pagination use `client.workspaces().list(Default::default()).await?`.

[Every public operation](../../docs/features/api/sdks/reference.md) has a resource method. Request/response models live in `macrofold::models`. The API validates conditional selectors, ownership, and model/BYOK configuration. Money remains strings.

## Recovery and streaming

Mutations generate idempotency keys automatically. REST calls make one attempt. Use `resource.with_options(RequestOptions { idempotency_key: Some(key), ..Default::default() })` to persist your own identity, or set `organization` to select a user membership. `ClientError` can be downcast to `RequestError`, which retains the original generated error and `idempotency_key`. Inspect remote state and retry the same body and key after an uncertain outcome.

`stream_text()` emits only assistant text fragments. `events()` exposes structured events, and `stream()` remains available. Streams reconnect from the last delivered cursor and suppress duplicates. The callback returns `true` to continue or `false` to detach. Dropping the future also detaches; neither cancels the remote job. Save the event sequence for process restarts, and use `runs().cancel()` when you mean to stop the agent.

The resource's `organization` option applies to stream connections, reconnects, and history checks without changing other resources.

`worktrees().write_file()` uploads a `PathBuf` with `WriteFileParams` containing its remote path and observed revision. `read_file()` returns a Reqwest response; consume its bytes or stream and inspect headers for revision metadata.

## Wait for the complete response

```rust
let result = client.runs().wait_with_timeout(&id, std::time::Duration::from_secs(300)).await?;
println!("{:?} {:?}", result.output_text, result.checkpoint_id);
```

`wait(&id)` has no overall timeout. It polls until execution and persistence finish and returns the typed result; optional Git synchronization is separate. `wait_with_timeout` raises a `WaitTimeoutError` containing `run_id`, and drops in-flight local work. Dropping either future detaches without cancelling execution.

Both text streaming and waiting return a `ClientError` that can be downcast to `RunFailedError` for failed, cancelled, timed-out, or unsuccessfully persisted runs. It includes `run_id`, typed `status`, `failure_code`, and the full typed `result`. Partial text may precede failure; transport/authentication errors retain their existing types. `Macrofold` and `Client` refer to the same client type.

## Read persisted files

```rust
client.runs().wait(&run.run_id.to_string()).await?;
let response = client.worktrees().read_file(
    &run.worktree_id.to_string(),
    macrofold::resources::ReadFileParams {
        path: "hello.txt".into(),
        download: None,
    },
).await?;
let content = response.bytes().await?;
println!("{}", std::str::from_utf8(&content)?);
```

Keep the returned bytes for binary files; consume or drop the response to release its resources.

Direct reads return the complete file up to 4 MiB. During execution they use the last published revision. See [reading files](../../docs/features/workspaces/read-files.md) for HTTP usage, larger downloads, permissions, and errors.

## Advanced access

Generated free functions in `macrofold::apis` remain available using `client.configuration()`. Those low-level mutation calls require explicit idempotency keys. Constructors require HTTPS except on loopback hosts and refuse redirects. For refreshed OAuth credentials, construct a new client with the renewed token.

See [API conventions](../../docs/features/api/conventions.md) for pagination, permissions, and asynchronous work.

## Choose a harness

The same run methods support `codex`, `claude-code`, `opencode`, `hermes`, `deepseek`, and `pi`. Select a compatible model from the catalog. See [harness capabilities and examples](../../docs/features/execution/harnesses.md).
