# Streaming and webhooks

Follow detailed run events over Server-Sent Events, or receive completion events at a registered webhook endpoint. The final result is independently retrievable through the API.

The [SDKs](sdks/README.md) offer `runs.stream_text`/`streamText` for plain assistant text, `runs.wait` for the full response after execution and persistence, and `runs.events` for structured events. Text and wait helpers raise typed errors for failed/cancelled execution or persistence; detaching or timing out does not cancel the agent.

## Stream a run

`GET /v1/runs/{id}/stream` emits durable event IDs. Record the last delivered ID and send it as `Last-Event-ID` when reconnecting. `GET /v1/runs/{id}/events` offers paginated history with an `after` cursor.

Streams deliberately rotate after about 55 seconds. The SDK and CLI reconnect with backoff and current credentials. A network interruption or terminal close does not cancel execution. If a cursor refers to expired detailed history, recover through retained events and the result, acknowledging the gap.

Event payloads can include assistant text, tool activity, lifecycle changes, and artifact references. Render tool/model content as untrusted text. Only reasoning content exposed by the harness/provider is available.

## Register a webhook

Create an endpoint in **Webhooks** or with `/v1/webhook-endpoints`. Select events such as `run.completed`, `run.failed`, `run.cancelled`, `git_sync.updated`, and `connection.expired`. Run configuration references registered endpoint IDs rather than arbitrary callback URLs.

Save the signing secret when shown. Endpoints support secret rotation with an overlap window. See the [OpenAPI contract](../../api/openapi.json) for request and response fields.

## Verify delivery

Verify the raw request body before parsing it. Compute HMAC-SHA256 over the timestamp, a period, and the raw body using the endpoint secret. Compare the signature in constant time and reject timestamps outside a five-minute tolerance. The delivery includes `Webhook-Id`, `Webhook-Timestamp`, and `Webhook-Signature` headers.

Deduplicate the stable business event ID. An explicit replay has a new delivery ID but retains the same event identity. After securely recording the event, return a 2xx response promptly and process longer work asynchronously.

## Retries and recovery

Requests time out after ten seconds. Failed deliveries retry with jitter at approximately ten seconds, one minute, five minutes, thirty minutes, two hours, eight hours, and twenty-four hours, then become exhausted. Redirects are not followed. Inspect delivery status and explicitly replay after resolving the receiver failure.

Webhook failure does not change run success. Receivers should tolerate duplicate delivery and out-of-order business events, and retrieve current run state when it matters.

## Dashboard freshness is separate

The dashboard also receives lightweight resource-change signals. Those signals are best effort and have no organization-wide replay history. They only refresh API queries; they do not replace this durable run stream or webhook delivery system.

See [API conventions](README.md) and [delivery implementation](implementation.md#events-and-webhooks).
