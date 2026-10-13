# Streaming and webhooks

Follow detailed run events over Server-Sent Events, or receive completion events at a registered webhook endpoint. The final result is independently retrievable through the API.

The [SDKs](sdks/README.md) offer `runs.stream_text`/`streamText` for plain assistant text, `runs.wait` for the full response after execution and persistence, and `runs.events` for structured events. Text and wait helpers raise typed errors for failed/cancelled execution or persistence; detaching or timing out does not cancel the agent.

## Stream a run

See [model and agent streaming](streaming.md) for direct inference and harness capabilities. Direct `stream: true` submissions deliver transient output on their POST response; their GET run stream retains lifecycle events, not historical token deltas.

`GET /v1/runs/{id}/stream` emits durable event IDs. Record the last delivered ID and send it as `Last-Event-ID` when reconnecting. `GET /v1/runs/{id}/events` offers paginated history with an `after` cursor.

Streams deliberately rotate after about 55 seconds. The SDK and CLI reconnect with backoff and current credentials. A network interruption or terminal close does not cancel execution. If a cursor refers to expired detailed history, recover through retained events and the result, acknowledging the gap.

Event payloads can include assistant text, tool activity, lifecycle changes, and artifact references. Render tool/model content as untrusted text. Native `reasoning.started`, `reasoning.delta`, and `reasoning.completed` events expose readable thinking separately from answer text, grouped by `data.reasoning_id`. See [thinking event payloads and examples](streaming.md#show-thinking-without-mixing-it-into-the-answer). Only reasoning content exposed by the harness/provider is available.

## When automatic recovery stops

With native Run `limits.stop_on_model_error: true`, `run.model_error` records `{ "request_id": "<failed-model-request-id>", "failure_code": "model_request_failed" }` once. Further model admissions are blocked immediately, including reconnects. This event precedes shutdown/checkpoint/settlement; continue following the Run to its terminal failure and final accounting. It is a durable Run event, not a separate webhook subscription type. See [model failure behavior](../execution/README.md#stop-after-a-model-failure).

`run.recovery_required` means repeated failures stopped automatic run processing. This may happen while dispatching work, saving a checkpoint, settling charges, recording the result, or cleaning up the worker. It does not mean the agent is restoring a conversation or restarting its task.

Its `data` identifies the failed operation and last safe error code:

```json
{
  "code": "run_recovery_required",
  "step": "billing",
  "cause": "accounting_bound_failed",
  "attempts": 8,
  "original_failure_code": "model_request_timeout"
}
```

| Field | Meaning |
| --- | --- |
| `step` | `dispatch`, `checkpoint`, `billing`, `finalization`, or `cleanup`. This identifies the operation that failed last, independently of the broad Run status. |
| `cause` | Safe error code from that operation. Arbitrary exception messages and provider stderr are withheld. An unfamiliar code is not evidence of a specific cause. |
| `attempts` | Consecutive failures in the exhausted automatic retry budget, not total model calls or lifetime attempts. |
| `original_failure_code` | Optional earlier run failure, during execution or publication. It is separate from the operation now preventing completion. |

`GET /v1/runs/{id}` also exposes `failure_code: "run_recovery_required"`, so applications attaching after the event can detect it. Read the retained event through `/events` or `/stream` for details. SDK event streams stop attachment at this boundary; text and wait helpers raise their typed run error with the current receipt. Missing event details must remain unknown rather than inferred from `status: "persisting"`.

Keep the Run ID and inspect its status, result and retained checkpoint. The event does **not** assert successful provider shutdown, finished persistence or final billing. A receipt can still have `final: false` and `persistence_status: "pending"`. Conversely, cleanup can fail after a verified checkpoint and finalized billing; those completed outcomes remain valid. An operator must inspect the named failed operation and resolve its cause before resuming processing; automatically starting another Run could repeat side effects. Uncertain files, execution identity and financial holds remain protected.

Local client waits also have finite deadlines; timeout detaches without cancelling the remote agent. Durable attachments cap automatic reconnects; save the latest sequence before explicitly reattaching. [SDK usage and limits](sdks/README.md).

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

See [API conventions](conventions.md) and [delivery implementation](implementation.md#events-and-webhooks).
