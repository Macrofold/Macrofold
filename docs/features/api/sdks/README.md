# SDKs

Use Macrofold from your application to manage projects, start cloud agents, and stream their progress. Every SDK uses the same [API contract](../../../api/openapi.json), permissions, and resource model.

## Choose your language

| Language   | Import                                              | Guide                                              |
| ---------- | --------------------------------------------------- | -------------------------------------------------- |
| TypeScript | `import { Client } from 'macrofold'`                | [TypeScript](../../../../sdk/typescript/README.md) |
| Python     | `from macrofold import Client`                      | [Python](../../../../sdk/python/README.md)         |
| Go         | `macrofold "github.com/Macrofold/Macrofold/sdk/go"` | [Go](../../../../sdk/go/README.md)                 |
| Rust       | `use macrofold::Client`                             | [Rust](../../../../sdk/rust/README.md)             |
| Java       | `import dev.macrofold.Client`                       | [Java](../../../../sdk/java/README.md)             |

Each guide starts with installation from source. Set your service origin and a scoped API key in the application environment. The [local simulator](../../../getting-started/local-development.md) lets you develop without paid model calls.

## Requests and streaming

TypeScript and Python expose operation IDs through `request`. Go, Rust, and Java expose generated, typed API groups. Use your editor's completion alongside the interactive `/reference` API documentation.

Use the maintained `stream` helper for incremental run events. It resumes from the last delivered sequence after a disconnected stream and suppresses duplicates. Save that sequence if your application must resume after restarting. Detaching the stream leaves the remote run running; cancel through the run API explicitly.

## Reliable mutations

TypeScript and Python create idempotency keys and preserve them across bounded retries. Go, Rust, and Java require an explicit key for operations that need one and make one REST attempt. Generate a unique key per intended action, store it with the request, and reuse that exact key and body if the response is lost. Do not retry an uncertain mutation with a new key.

All clients preserve monetary values as decimal strings. Constructors require HTTPS except on loopback development hosts and refuse redirects. Keep API keys in server-side code. For expiring OAuth credentials, TypeScript and Python accept token suppliers; recreate the Go, Rust, or Java client with a renewed token before new requests.

See [API conventions](../README.md) for errors, pagination, asynchronous operations, and organization selection. Contributors can read [SDK architecture and verification](implementation.md).
