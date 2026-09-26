# Stream model and agent output

Receive text as it is generated, then retrieve the saved final result. Streaming changes delivery, not model prices or token accounting. Use a backend API key with `runs:write` and `runs:read`, and a configured provider with enough credit. The [API quickstart](quickstart.md) covers credentials and SDK installation.

## Choose your path

| Call                                                | Response with top-level `stream: true`                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `POST /v1/inferences`                               | HTTP 200 SSE: run identity, incremental output, saved terminal result      |
| Native run, session message, customer-agent message | HTTP 202 run receipt; attach to the returned stream URL                    |
| `POST /v1/bounded-agent-runs`                       | HTTP 202 receipt; per-model-call deltas in the durable run stream          |
| Unsupported model protocol or harness               | HTTP 400 `streaming_not_supported`, before a run or reservation is created |

Omit `stream` or set it to false for the existing behavior. A nested provider `input.stream` must agree with the top-level option. Use `inferences.stream`, rather than `inferences.create`, for incremental SDK delivery.

Anthropic Messages and OpenRouter chat support direct deltas, including raw JSON text and tool argument fragments. Codex, Claude Code, OpenCode, Hermes and Pi emit native assistant text deltas. OpenAI calls inside native harnesses retain their existing gateway streaming; there is no additional direct OpenAI endpoint.

Jev through TypeSafe/OpenRouter Decisions and the pinned DeepSeek harness reject explicit incremental streaming. Ordinary DeepSeek runs still provide committed messages and progress. Claude's dedicated structured-result feature is final-only and is not a separate streaming mode exposed by this API. Macrofold never parses partial JSON or switches models to satisfy streaming.

## Direct inference in TypeScript

```ts
import { Macrofold } from 'macrofold';

const client = new Macrofold(); // MACROFOLD_API_KEY; optional baseURL for self-hosting
const request = {
  model_binding: {
    provider: 'anthropic' as const,
    model: 'claude-haiku-4-5-20251001',
    billing_mode: 'managed' as const,
  },
  input: {
    messages: [{ role: 'user', content: 'Explain what a worktree is in two sentences.' }],
    max_tokens: 256,
  },
  limits: { timeout_seconds: 60, max_output_tokens: 256, max_cost_micro_usd: '100000' },
};
// Persist this key if your application needs to recover after a process restart.
const key = crypto.randomUUID();
for await (const event of client.inferences.stream(request, { idempotencyKey: key })) {
  if (event.type === 'run.accepted') console.log('Run:', event.run_id);
  if (event.type === 'output.delta') process.stdout.write(event.data.text ?? '');
  if (event.type === 'run.succeeded') console.log(event.data.result);
  if (['run.failed', 'run.cancelled', 'run.timed_out'].includes(event.type)) {
    console.error('Execution did not succeed:', event.data.result);
  }
}
```

Inline stateless requests can use an unrestricted organization API key. Workspace-restricted keys must supply their authorized `workspace_id`. The same helper accepts typed decision definitions and explicit context; validation happens on the complete answer. For OpenRouter, select a currently enabled `/v1/models` route, use `provider: 'openrouter'`, and supply its native chat body in `input`.

### Other SDKs

All maintained helpers deliver `InferenceStreamEvent` objects. A terminal event contains `data.result`; inspect failed/cancelled/timed-out events rather than treating ordinary stream exhaustion as successful execution. HTTP/API and interrupted-transport failures raise the language's error type. Closing an iterator or stopping a callback detaches without cancelling.

| Language | Incremental helper                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| Python   | `client.inferences.stream(request_dict, request_options=options)`; returns a generator of Pydantic events       |
| Go       | `client.Inferences.Stream(ctx, &request, func(event macrofold.InferenceStreamEvent) error { ... }, options...)` |
| Rust     | `client.inferences().stream(request, \|event\| { ...; true }).await?`                                           |
| Java     | `client.inferences().stream(request, event -> { ...; return true; })`                                           |

Each [language guide](sdks/README.md) includes a complete direct-streaming example.

## Direct inference over REST

Set `MACROFOLD_API_KEY` first. Use your deployment's origin for local/self-hosted execution. Save the unique key before sending if you need recovery; retry an uncertain request with that same body and key.

```sh
export MACROFOLD_BASE_URL="https://app.macrofold.ai"
REQUEST_KEY="$(uuidgen)"
curl -N --fail-with-body "$MACROFOLD_BASE_URL/v1/inferences" \
  -H "Authorization: Bearer $MACROFOLD_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Idempotency-Key: $REQUEST_KEY" \
  --data '{
    "stream": true,
    "model_binding": {
      "provider": "anthropic",
      "model": "claude-haiku-4-5-20251001",
      "billing_mode": "managed"
    },
    "input": {
      "messages": [{"role": "user", "content": "Explain worktrees in two sentences."}],
      "max_tokens": 256
    },
    "limits": {"timeout_seconds": 60, "max_output_tokens": 256, "max_cost_micro_usd": "100000"}
  }'
```

`curl -N` disables client buffering. HTTP 200 starts delivery; inspect the final event to determine success or failure. This example caps spending at $0.10 and requires managed credit; it does not estimate the price.

MCP does not embed a direct HTTP stream in a tool result: omit `stream` on direct inference tools, or use REST/SDK streaming. Native-agent MCP tools may request streaming support and return the usual receipt.

## Native and bounded agents

```ts
const run = await client.runs.create({
  worktree_id: process.env.MACROFOLD_WORKTREE_ID!,
  agent_id: process.env.MACROFOLD_AGENT_ID!,
  prompt: 'Summarize the README.',
  stream: true,
});
for await (const text of client.runs.streamText(run.run_id)) process.stdout.write(text);
```

Use `runs.events` for tools, lifecycle events and model-call boundaries. Session/customer-agent messages accept the same boolean and validate the resolved session or preset harness. Native/bounded execution can queue normally. `/v1/harnesses` includes `incremental_output` only on harnesses that emit incremental assistant text; `streaming` alone means run-event delivery, including completed messages.

### Native streaming on reusable Workers

Add a top-level `worker_id` to a native Run or Session follow-up to select reusable compute. The caller also needs `workers:use` for that Worker, independently of the existing data, harness and tool permissions. `stream: true` still validates incremental-output capability and `runs:read`; it does not bypass Worker capacity, cost limits or persistence. Unsupported harnesses are rejected rather than silently routed elsewhere.

The response remains HTTP 202 with a Run receipt, not a direct inference stream. Submit to a sleeping zero-baseline Worker before waiting for readiness, then attach to the Run's durable stream. Polling or keeping a stream open does not keep idle compute alive. Closing a reader detaches; cancelling an individual Run does not pause or destroy a Worker shared by other Runs. Keep Worker lifecycle control with the application's compute owner.

A displayed text delta is not a verified persisted result. Read the final Run result for execution, persistence and usage outcomes. Direct `/v1/inferences` and bounded investigations remain independent of native Worker compute and retain their separate delivery and admission rules. See the [Worker guide](../execution/workers.md) for lifecycle and billing.

## Show thinking without mixing it into the answer

Native runs expose readable reasoning supplied by the harness/provider through the same authenticated run stream. No extra endpoint, subscription or model call is needed. Use `runs.events`, rather than the answer-only `runs.streamText` helper:

```ts
const thinking = new Map<string, string>();
for await (const event of client.runs.events(run.run_id)) {
  const id = event.data.reasoning_id;
  if (event.type === 'reasoning.started' && typeof id === 'string') {
    thinking.set(id, ''); // Show a thinking indicator for this block.
  }
  if (event.type === 'reasoning.delta' && typeof id === 'string') {
    thinking.set(id, (thinking.get(id) ?? '') + String(event.data.text ?? ''));
    console.error('Thinking:', thinking.get(id));
  }
  if (event.type === 'reasoning.completed') {
    console.error('Thinking block:', id, event.data.status);
  }
  if (event.type === 'output.delta') process.stdout.write(String(event.data.text ?? ''));
}
```

REST consumers receive the same events from `GET /v1/runs/{id}/stream`; all five SDK event helpers preserve them. The generated `ReasoningEventData` model documents the payload. Group by `reasoning_id`, append `text` in event sequence order, and use the existing cursor to avoid duplication on reconnect. Keep thinking in a separate disclosure; the dashboard does this automatically. Do not append it to answer text or execute its contents.

| Event | Data | Meaning |
| --- | --- | --- |
| `reasoning.started` | `reasoning_id`, `format` | A native reasoning block started; readable text may never follow. |
| `reasoning.delta` | `reasoning_id`, `format`, `text` | Append this readable fragment. `format` is `summary` or `text`. |
| `reasoning.completed` | `reasoning_id`, `status` | Block ended (`completed`) or the turn stopped (`interrupted`). This is not run completion. |

Codex exposes readable summaries; Claude Code, OpenCode, Hermes and Pi map their SDK's exposed thinking text. `/v1/harnesses` advertises `reasoning_output` for these adapters. It describes event support, not a promise that a selected model/turn emits reasoning. DeepSeek's pinned adapter has no reasoning events. Direct inference and bounded-agent streams currently expose answer/tool deltas only; this reasoning contract applies to native harness runs.

**Reasoning visibility and reasoning effort are different.** Displaying an existing stream does not raise the model's effort or create extra inference. Existing harness/model defaults still apply. Codex requests automatic summaries. On compatible OpenRouter routes, the existing `model_parameters.reasoning.effort` controls generation (for example `low`); strict provider parameter support is enforced. Pi's local thinking setting remains off by default; an admitted OpenRouter reasoning setting is applied at the gateway. Pi only forwards its SDK's readable thinking events; an OpenRouter route that provides only opaque replay metadata can produce an empty block. Higher effort can increase tokens, cost and latency. Unsupported parameters fail rather than silently selecting another model.

Only readable provider-exposed text is published. Encrypted reasoning, signatures and redacted blocks remain native protocol state. No attempt is made to reconstruct hidden reasoning. Treat readable thinking as untrusted, potentially sensitive model output; it shares authorized run history and its retention rules. `output_text` and answer-only helpers never include it.

Thinking can precede answer text but cannot precede container/harness startup. Show the existing queued/provisioning/runtime/tool events during those stages. No reasoning events does not mean a stuck run. A block can start without any readable text; if the run terminates or detailed history is truncated before its completion event, stop the indicator and mark that block incomplete. Native delivery retains its polling cadence, so batches may arrive together.

## Events and final results

Direct SSE begins with `run.accepted` and the run ID/recovery URLs. `output.delta` carries `text`, `invocation_id`, `message_id`, `content_index`, and a `choice_index` when relevant. `tool.arguments.delta` carries opaque text and tool identity separately. Never execute a tool from partial arguments or concatenate independent choices into one answer. Content lifecycle/refusal events carry the same identities. Native events keep their existing harness granularity and envelope.

The terminal `run.succeeded`, `run.failed`, `run.cancelled`, or `run.timed_out` event includes the finalized result, after response persistence and financial settlement. EOF alone is not success. Missing usage stays provisional; interrupted upstream output stays incomplete. A `transport.error` means retrieve the result through the accepted run's URL.

One model call produces one saved response, one usage settlement and one generation trace with assembled output, subject to existing capture limits. Agent loops settle each call before the next. Reservations and permissions are checked before execution; streaming does not postpone spending controls. Direct deltas do not add per-token database or trace records. Native and bounded run events retain their existing replay storage.

## Disconnects, retries and limits

Direct deltas are live-only: there are no SSE replay IDs or token replay. After disconnecting, retrieve `/v1/runs/{id}/result`; the run stream still provides durable lifecycle history. Reusing the same request and idempotency key while active returns HTTP 409 `stream_already_started` with recovery details. After completion, it returns `run.accepted` with `delivery: result_replay` followed by the saved terminal result, with no fabricated deltas or second model call. Changing the body under the same key conflicts.

SDK helpers never reconnect a direct POST after output begins. Store its run ID and idempotency key. Closing a reader does not cancel admitted work; use `/v1/runs/{id}/cancel` explicitly. A slow reader that exceeds the bounded delivery buffer is detached, while result processing continues. A hard process crash can lose live partial text but does not authorize repeating an ambiguous provider call.

Direct streaming requires immediate capacity: HTTP 429 `streaming_capacity_unavailable` rolls back admission. Retry later, or omit streaming and use `Prefer: respond-async` for queued acceptance. Combining `stream: true` with that header returns HTTP 400 `invalid_request`. Direct timeouts above 240 seconds return HTTP 400 `streaming_timeout_unsupported`; finalization has additional room within the 300-second serving limit. Native agents retain their own longer execution limits.

Direct responses retain the existing 512 KiB assembly bound. Streams send heartbeat comments while idle and request no proxy buffering. Custom hosts must supply a background lifecycle that retains the producer after disconnect; unsupported transports reject streaming before admission. Self-hosted proxies must permit a 300-second request and flush SSE promptly.
