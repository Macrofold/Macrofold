# Streaming implementation

Status: implemented in source. Local Anthropic HTTP delivery, bounded-agent completion, detach/replay and tracing acceptance are recorded below. Automated regression coverage, hosted lifetime acceptance and the full native image matrix remain open in [maintainer TODO](../../maintainers/TODO.md#delta-streaming-implementation). The operator explicitly requested implementation without writing or running automated tests. The [public guide](streaming.md) owns customer examples; this document owns design, boundaries and remaining acceptance.

## Contract and capability ownership

Top-level optional `stream: boolean` belongs to inference, run and message creation, including customer-agent continuation. Omission/false preserves previous behavior. Schema validation rejects null and other types. The resolved provider protocol or harness decides support before admission commits, funds are reserved or compute starts. Streaming requires `runs:read` as well as normal submission authority.

| Execution path                                                                | Delivery                                                                                           |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Direct Anthropic Messages / OpenRouter chat                                   | `POST /v1/inferences` returns HTTP 200 SSE: `run.accepted`, live output, finalized terminal result |
| Bounded generative agent                                                      | Existing HTTP 202 receipt; per-call deltas in its durable run stream                               |
| Codex, Claude Code, OpenCode, Hermes, Pi                                      | Existing HTTP 202 receipt and native assistant deltas; no replacement agent loop                   |
| Jev through TypeSafe or OpenRouter Decisions                                  | HTTP 400 `streaming_not_supported` when explicitly requested                                       |
| Pinned DeepSeek harness                                                       | Same rejection; ordinary committed-message/progress delivery remains available                     |
| Direct live output through MCP or a host without a retained request lifecycle | Same rejection; use ordinary inference or REST/SDK streaming                                       |

`packages/contracts/harnesses.ts` owns `incremental_output` separately from existing `streaming` (run-event delivery). Discovery lists enabled capabilities only. Run admission checks the effective session/preset configuration, rather than the unresolved caller input. Session and customer-agent requests forward the field. Claude's dedicated structured result is final-only; it is not an exposed independently streamable harness mode. Native OpenAI protocol calls continue through the existing gateway; this change adds no direct OpenAI endpoint.

Direct protocols remain the existing reviewed `decisionModel` routes. Adding another protocol requires implementing and declaring its streaming capability, not inferring support from its name. Top-level `stream` selects provider transport; matching nested `input.stream` is accepted and contradictions rejected. OpenRouter requests final usage. No partial structured-output parsing, token fabrication, model fallback or extra inference is performed.

## Layer boundaries

| Owner                             | Responsibility                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| OpenAPI / generated clients       | Optional request flag, SSE response media type, typed `InferenceStreamEvent` envelope                                |
| `core/decision.ts`                | Vendor-independent output fragment and sink, plus completed/incomplete `DecisionResponse`                            |
| `providers/inference-stream.ts`   | Incremental SSE framing, native response assembly, vendor terminal detection, usage and content identity             |
| `providers/decision-protocols.ts` | Protocol capability, preparation and existing response normalization                                                 |
| `core/inference-engine.ts`        | Authorization, durable invocation intent, response persistence, validation, financial settlement and trace ownership |
| `core/direct-inference-stream.ts` | Transient HTTP reader, producer lifetime, heartbeat, bounded backpressure and result replay                          |
| `core/inference-output.ts`        | Bounded-agent fragments coalesced into existing durable events                                                       |
| Maintained SDK transports         | Single-POST SSE iteration/callbacks, error identity and reader cleanup                                               |

Provider adapters use pinned MIT `eventsource-parser` 3.1.1 for framing, promoted from the existing dependency graph. Billing and permissions remain in core. SDKs reuse their existing SSE framing for direct and durable delivery, while retaining different recovery behavior. No broker, new service, database table or tracing SDK upgrade is needed.

## Direct execution and lifetime

1. Authenticate and resolve the exact route, context, credentials, permissions and budget. Before committing admission, atomically claim immediate capacity. Unavailable capacity returns HTTP 429 `streaming_capacity_unavailable` and rolls back. Reject `Prefer: respond-async` with streaming. Direct timeouts over 240 seconds return HTTP 400 `streaming_timeout_unsupported`; the host has a 300-second serving limit.
2. Preserve existing durable run identity, financial reservation, sealed request and invocation compare-and-set before provider dispatch. Only that owner invokes the model. Streaming does not defer spending authorization.
3. Pass an output sink through the existing direct phase runner and inference executor. Forward new output promptly; assemble one response concurrently. The model-call cancellation/deadline controller is independent of reader disconnection and polls authority/cancellation while active.
4. Seal and persist the assembled response before settlement/publication. The existing recovery phases validate typed output, settle usage idempotently and publish the terminal receipt. The final bounded-event batch commits atomically with response evidence. Event batches lock the run and check retained invocation content so terminalization/purge wins over late fragments. Tools execute only after complete validated arguments and normal authorization.
5. Keep the producer alive through the host's background callback (Next `after` in the web route). On detach, abandon only delivery. Finalization and trace flushing remain owned by the retained producer. A custom host without this contract rejects direct streaming.

Transient reader queues are bounded to 2 MiB. Queue overflow errors/detaches the reader rather than silently dropping frames or blocking generation. Idle streams send comments every 15 seconds. Headers request `text/event-stream`, `no-store, no-transform`, `X-Accel-Buffering: no` and include `X-Run-Id`. No direct SSE replay IDs are emitted.

The assembler retains the existing 512 KiB response bound, checks it in bounded wire increments, limits a buffered SSE frame to 512 KiB and total wire bytes to 8 MiB including framing. Slow readers do not create an unbounded response log. A hard host/process failure can lose unsaved partial text: the durable uncertain invocation remains authoritative and must not be blindly repeated.

## Output, completion and failure

Direct/bounded text fragments carry invocation, message, content and optional choice identities. Tool-argument fragments carry separate tool identity and opaque text. Do not concatenate separate choices, blocks or model turns. `output.started`, `output.finished` and `output.refusal.delta` retain those boundaries. Private reasoning is not published as assistant text. Native streams preserve their existing harness-specific event granularity.

Anthropic completion requires `message_stop` and a stop reason. OpenRouter requires `[DONE]` after choice finish reasons; accounting-only chunks before that marker are retained. EOF, malformed frames, upstream errors, timeout or cancellation produce incomplete evidence, not a successful full response. Available token counts survive, but incomplete usage remains provisional under the existing financial policy. A provider-native response retains its stop reason (including truncation); typed decision output still has to validate.

Terminal direct events include the same finalized result available through `GET /v1/runs/{id}/result`. `run.failed`, `run.cancelled` and `run.timed_out` are explicit unsuccessful outcomes; HTTP status cannot change after stream headers. A producer that cannot finalize promptly emits `transport.error` with recovery instructions. EOF alone is never success in an SDK helper.

Direct deltas bypass SQL event storage. The GET run stream still exposes durable lifecycle events and final-result observation, not missed direct tokens. Bounded agents retain replay by batching adjacent fragments with identical identities, flushing at approximately 4 KiB or when an incoming event observes 100 ms since the last flush, plus model completion. This intentionally uses no timer; a lone fragment during a provider stall may wait for the next event/completion. Native event replay, checkpoints and retention are unchanged.

## Idempotency and SDKs

The existing request fingerprint includes `stream`. An active replay returns HTTP 409 `stream_already_started` with the original authorized receipt. A terminal replay returns `run.accepted` with `delivery: result_replay` and the saved terminal result, never invented deltas or another call. Changed bodies conflict as usual. Recover with the original key/run ID; do not generate a new key to retrieve missed output.

All five resource clients expose `inferences.stream` (idiomatic language casing). TypeScript/Python provide iterators; Go/Rust/Java provide typed callbacks. Normal resource `create` rejects `stream: true` before sending, directing callers to the helper. Generated low-level REST operations remain escape hatches, not incremental readers. SDK direct helpers never retry/reconnect after receiving a stream; bounded pre-header retries in existing TypeScript/Python transports retain the same key. Closing an iterator or callback detaches without cancellation. Use the explicit run cancellation endpoint to stop work.

Direct terminal failures are events with receipts, not successful values or implicit exceptions. HTTP/API and transport errors retain submission identity. Native helpers retain durable cursor reconnects and their existing typed run failures. [SDK architecture](sdks/implementation.md) owns generation and transport details.

## Billing and tracing

Model prices, frozen rates, strict BYOK selection, reservations and settlement owners are unchanged. There is no streaming surcharge. Actual reported input/output/cache usage determines charges, never character counts. Each agent model call settles separately before another call; do not defer an entire multi-call agent's accounting to its final answer. Compute and connector accounting remain independent.

Each model invocation produces one generation observation containing assembled output (or explicitly incomplete evidence), usage, cost and existing tenant/workspace/worktree/customer/session metadata. First-output time is retained in invocation timings and forwarded to the trace. Langfuse 5.11.1 remains behind `TraceSink`; export runs outside delta delivery and finalizes through the retained host lifecycle. Typed streamed responses also retain the assembled provider response as sealed evidence so parsing, including invalid JSON, cannot discard the original text from the generation trace. This evidence is never tool authority. No per-token generations or general-log content are added. Existing redaction, retention and 1 MiB trace-capture bounds apply.

## Verification recorded for this change

- Public REST examples, all five SDK README examples and the generated method reference document direct streaming. The new snippets passed TypeScript, Go, Rust and Java compilation plus Python syntax compilation; documentation generation/link checks passed. No additional provider calls were made for this documentation pass.
- All five SDKs regenerated from OpenAPI. TypeScript/application type checking, Go build, Rust check, Java package compilation with tests skipped, and Python compilation passed. These are build checks, not behavioral suite results.
- Disposable local PostgreSQL plus the real HTTP handler and TypeScript SDK delivered Anthropic deltas before completion: one observed first delta at 1,171 ms and completion/replay by 3,770 ms. This is a single-call observation, not a latency benchmark.
- Completed idempotent replay delivered only identity and saved result. Direct output generated zero durable `output.delta` rows. Actual usage for that call was 16 input / 237 output tokens and $0.001201; Langfuse API readback returned one `decision.generate` observation, matching usage/cost and assembled input/output, with a first-output timestamp.
- A second manual journey detached after the first delta. Its concurrent identical submission returned 409; the original completed and saved full output/usage with exactly one provider call. Explicit Jev streaming and contradictory nested options returned HTTP 400 JSON.
- A live bounded-agent Sonnet call emitted invocation-tagged durable deltas, validated its final `hello` value and settled usage. Two Haiku attempts returned fenced JSON and correctly failed schema validation while retaining streaming delivery and billing; this is not evidence of guaranteed schema compliance from prompted JSON.
- OpenRouter live submission reached the provider but received HTTP 402 for insufficient credit. Its failed receipt/replay worked; successful OpenRouter incremental output has **not** been live-accepted in this change. No account funding or provider substitution was performed.
- No automated tests were written or run, by explicit operator instruction. Deferred parser, accounting, admission, bounded-agent, SDK and lifecycle regression cases are in the central TODO. Existing native image behavior was reused, not re-certified here. Hosted response flushing/disconnect survival remains a separate release gate.

## Deferred scope and reference documentation

No partial JSON snapshots, Jev deltas without upstream support, replacement DeepSeek agent loop, direct token replay, queued cross-instance live fanout, arbitrary new provider endpoints or native retention redesign. These are separate product/lifecycle decisions, not prerequisites for this delivery path.

Provider references: [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [structured output compatibility](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Claude Agent SDK streaming limitations](https://code.claude.com/docs/en/agent-sdk/streaming-output), [OpenRouter streaming](https://openrouter.ai/docs/api_reference/streaming), [OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs), and [Langfuse usage/cost fields](https://langfuse.com/docs/observability/features/token-and-cost-tracking). Recheck exact pinned SDK/protocol behavior before upgrades.
