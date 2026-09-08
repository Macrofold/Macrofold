# SDKs

Use Macrofold from your application to manage projects, start cloud agents, and stream their progress. Every SDK uses the same [API contract](../../../api/openapi.json), permissions, and resource model.

## Choose your language

| Language   | Import                                              | Guide                                              |
| ---------- | --------------------------------------------------- | -------------------------------------------------- |
| TypeScript | `import { Macrofold } from 'macrofold'`             | [TypeScript](../../../../sdk/typescript/README.md) |
| Python     | `from macrofold import Macrofold`                   | [Python](../../../../sdk/python/README.md)         |
| Go         | `macrofold "github.com/Macrofold/Macrofold/sdk/go"` | [Go](../../../../sdk/go/README.md)                 |
| Rust       | `use macrofold::Macrofold`                          | [Rust](../../../../sdk/rust/README.md)             |
| Java       | `import dev.macrofold.Macrofold`                    | [Java](../../../../sdk/java/README.md)             |

Each guide starts with installation from source. Set `MACROFOLD_API_KEY` to a scoped dashboard key; all clients default to `https://app.macrofold.ai`. Explicit keys and custom origins support local development, staging, and self-hosting. Missing credentials fail before a request. The [local simulator](../../../getting-started/local-development.md) lets you develop without paid model calls.

## Requests and streaming

Use resource methods such as `client.projects.create` and `client.runs.get`. TypeScript accepts typed options, Python accepts keyword arguments and returns Pydantic models, and Go/Rust/Java use typed models and idiomatic resource groups. The [method reference](reference.md) maps every public operation across languages. Low-level transports remain optional escape hatches.

Create a run with a project ID, a saved agent preset ID, and a prompt. The preset supplies the harness, model, billing mode, and connection configuration; the project identifies the persistent files. Explicit supported overrides remain available.

Use `runs.stream_text` (with language-appropriate casing/accessors) for assistant text strings, or `runs.wait` for a complete typed result without streaming. Both report failed execution or persistence through a typed exception/error carrying the run ID. Waiting includes checkpoint persistence, but not optional Git synchronization. A wait timeout stops local waiting without cancelling the agent.

Advanced integrations use `runs.events` for structured events and durable sequence cursors; `runs.stream` remains available. Streaming resumes after interruptions and suppresses duplicate sequences. Save a sequence to resume after a process restart. Detaching leaves the remote run running; use `runs.cancel` explicitly.

## Read the files an agent saved

Use the run's workspace ID and a relative path with `workspaces.read_file` (or the language-equivalent method). The [file-read guide](../../workspaces/read-files.md) explains complete byte responses, waiting for persistence, and downloads.

## Reliable mutations

All resource methods create idempotency keys for mutations. TypeScript and Python preserve them across bounded retries; Go, Rust, and Java make one REST attempt and retain the key in an error when a mutation cannot be confirmed. For recovery across process restarts, provide and store your own key per intended action, then reuse that exact key and body if the response is lost. Low-level Go/Rust/Java operations still require an explicit identity. Do not retry an uncertain mutation with a new key.

All clients preserve monetary values as decimal strings. Constructors require HTTPS except on loopback development hosts and refuse redirects. Keep API keys in server-side code. For expiring OAuth credentials, TypeScript and Python accept token suppliers; recreate the Go, Rust, or Java client with a renewed token before new requests.

See [API conventions](../README.md) for errors, pagination, asynchronous operations, and organization selection. Contributors can read [SDK architecture and verification](implementation.md).
