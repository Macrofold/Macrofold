# API guide

Use the REST API to create projects, start runs, follow progress, and retrieve saved work. The dashboard, CLI, and SDKs use the same resource model and authorization rules.

Start with the [API quickstart](quickstart.md). The application serves an interactive reference at `/reference` and its complete [OpenAPI contract](../../api/openapi.json) at `/openapi.json`.

## Authentication and organizations

Send a scoped API key or customer OAuth token in `Authorization: Bearer …`. Generate keys in **API keys** and save the secret when it is shown once. Keep credentials on your server or in a secret store, never in browser bundles or URLs.

A key belongs to one organization and can restrict scopes and projects. `X-Organization-Id` selects an authorized membership for credentials that support it; it cannot move an organization-bound key into another tenant. Resource IDs do not grant access.

## Resource conventions

All customer routes start with `/v1`. JSON fields use snake_case, timestamps use RFC 3339 UTC, and resource IDs are opaque. Money uses decimal-string micro-USD; `1000000` means $1. Large counts also use strings where required by the schema.

| Task                  | Routes                                                                              |
| --------------------- | ----------------------------------------------------------------------------------- |
| Identity and catalogs | `/me`, `/harnesses`, `/models`                                                      |
| Project files         | `/projects`, `/workspaces/{id}/files`, `/workspaces/{id}/file`                      |
| Execution             | `/runs`, `/sessions`, `/sessions/{id}/messages`                                     |
| Status and output     | `/runs/{id}`, `/runs/{id}/result`, `/runs/{id}/stream`                              |
| Recovery and Git      | `/workspaces/{id}/checkpoints`, `/workspaces/{id}/restore`, `/workspaces/{id}/sync` |
| Tools and access      | `/connections`, `/api-keys`                                                         |
| Usage and billing     | `/usage`, `/requests`, `/billing`                                                   |

The table shows route families; use OpenAPI for exact parameter names, required fields, and operation IDs.

## Idempotency

Supply a unique `Idempotency-Key` for each intended mutation. Reuse it with the identical request when recovering a lost response. The server retains fingerprints and results for 30 days. Reusing a key with a different body returns `409 idempotency_conflict`.

Run creation, session messages, checkout, file mutations, restore, sync, transfer planning/apply, and exports require idempotency. TypeScript and Python clients create and preserve keys across bounded retries; supply your own key to recover across process restarts. Go, Rust, and Java require explicit keys and make single-attempt REST requests.

## Asynchronous work

A run request returns 202 with `run_id`, related resource IDs, and URLs for status, events, result, and cancellation. File and workspace maintenance may return an operation ID instead. Poll `/v1/operations/{id}` and inspect its final status before using its result.

Result retrieval reports `final=true` after terminalization. Available partial output can be returned earlier. A canceled stream is not a canceled run; use the run cancellation endpoint explicitly.

## Pagination and rate limits

Lists use `limit` and a cursor, returning `next_cursor`. The default page size is 25 and maximum is 100. Follow the returned cursor rather than constructing one.

The default API rate is 300 requests per minute per credential within its organization. A 429 includes `Retry-After`. HTTP limits, run concurrency, and spending caps are independent.

## Errors and retries

Errors include `error.code`, `message`, `request_id`, `details`, and `retryable`. Preserve request IDs for diagnosis.

| Response                      | What to do                                                         |
| ----------------------------- | ------------------------------------------------------------------ |
| 401                           | Refresh authorization or sign in again                             |
| 403                           | Check membership, scopes, project restrictions, and current grants |
| 409 `workspace_busy`          | Wait for the writer or select an independent workspace             |
| 409 `idempotency_conflict`    | Restore the original body for that key                             |
| 412 `stale_revision`          | Read the current file revision and reconcile your change           |
| 429                           | Honor `Retry-After` and reduce request rate                        |
| Provider or transport failure | Check whether the outcome is known before repeating a mutation     |

Do not automatically repeat an external side effect whose outcome is uncertain. See [troubleshooting](../../getting-started/troubleshooting.md) for recovery paths.

## Streaming, clients, and protocols

Read [streaming and webhooks](events.md) and the [SDK guides](sdks/README.md) for TypeScript, Python, Go, Rust, and Java.

[Protocol details](implementation.md) cover transfer preconditions, OAuth discovery, event delivery, and endpoint inventory. Customer REST, authentication protocols, provider webhooks, and [operator MCP](../operations/README.md) are separate authorization surfaces.
