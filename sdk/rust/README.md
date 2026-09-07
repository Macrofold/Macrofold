# Macrofold Rust SDK

Typed asynchronous API requests and incremental run streams using Reqwest and Tokio.

## Install from source

Add the local crate to your application's `Cargo.toml`, along with Tokio for the async entry point:

```toml
[dependencies]
macrofold = { path = "/absolute/path/to/Macrofold/sdk/rust" }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

The client is tested with Rust 1.94.1. Native TLS is the default; select `default-features = false, features = ["rustls"]` to use Rustls.

## Connect and stream

Set `AGENT_HOST`, `AGENT_API_KEY`, and an authorized `RUN_ID` in your environment.

```rust
use macrofold::{Client, ClientError, apis::projects_api};

#[tokio::main]
async fn main() -> Result<(), ClientError> {
    let client = Client::new(&std::env::var("AGENT_HOST")?, &std::env::var("AGENT_API_KEY")?)?;
    let projects = projects_api::list_projects(
        client.configuration(), None, Some(20), None, None, None,
    ).await?;
    println!("{:?}", projects.data);
    client.stream(&std::env::var("RUN_ID")?, "0", |event| {
        println!("{} {:?}", event.r#type, event.data);
        true
    }).await?;
    Ok(())
}
```

## Requests and recovery

Pass `client.configuration()` to the typed methods in `macrofold::apis`, with bodies from `macrofold::models`. For example, `runs_api::create_run` accepts an explicit idempotency key and `RunCreate` body. REST methods make one attempt. Retain your key and identical body to recover a lost mutation response; inspect typed `ResponseError` data before retrying.

`workspaces_api::write_file` streams a local `PathBuf` with the required revision and key. `read_file` returns a Reqwest response; consume its bytes or stream and inspect headers for revision metadata. Monetary values remain strings.

The stream callback returns `true` to continue or `false` to detach. Dropping the streaming future also detaches. Neither cancels the remote run. Save the last sequence to resume after restarting your application. Use the explicit cancellation API when stopping the agent.

See the [SDK guide](https://github.com/Macrofold/Macrofold/blob/main/docs/features/api/sdks/README.md) and [API quickstart](https://github.com/Macrofold/Macrofold/blob/main/docs/features/api/quickstart.md).
