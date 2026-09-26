# Streaming implementation

Status: implemented in source. Local Anthropic/OpenRouter direct HTTP delivery, OpenAI gateway streaming, Anthropic bounded-agent completion, detach/replay and tracing acceptance are recorded below. Automated regression coverage, hosted lifetime acceptance and the full native image matrix remain open in [maintainer TODO](../../maintainers/TODO.md#delta-streaming-implementation). The operator explicitly requested implementation without writing or running automated tests. The [public guide](streaming.md) owns customer examples; this document owns design, boundaries and remaining acceptance.

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

## Native reasoning delivery

The native event path exposes `reasoning.started`, `reasoning.delta` and `reasoning.completed` independently of answer text. `ReasoningEventData` in OpenAPI owns block identity, readable format and closure status; existing SDK `events` helpers carry the envelopes without another transport. The registry advertises adapter `reasoning_output`, independently of incremental answer support. No request flag is needed for observation, and generation effort remains a separate existing model setting. Direct/bounded reasoning mapping is not implemented by this native change.

Codex maps item start/completion and summary deltas, requesting automatic summaries. Claude maps indexed thinking blocks by provider message ID and excludes signature/redaction deltas. OpenCode tracks part types before routing generic text deltas, and removes repeated snapshot prefixes; reasoning cannot leak into the answer accumulator. Hermes uses its pinned native reasoning callback; Pi maps typed thinking start/delta/end events and excludes redacted blocks. Model defaults/explicit OpenRouter reasoning parameters still determine whether readable thinking exists. No heuristic extraction from answer text or additional summarization call is used.

`runtime/reasoning-events.ts` is the one batching/allowlisting owner: emit start and first readable text promptly, then coalesce up to 4,096 UTF-16 code units (at most 16 KiB UTF-8), flushing at the next incoming event after 100 ms or before another event/turn completion. There is no per-token trace export, timer or SQL transaction. A stalled lone fragment may wait until another event; native SQL ingestion still polls every two seconds. Block IDs preserve distinct model turns and interleaved parts. The worker closes active blocks as interrupted on turn failure/cancellation; hard process loss or the existing supervisor trace cap can omit completion, so clients also close indicators on run termination/truncation.

Cloud ingestion uses the existing producer-sequence deduplication, authorization and retention. Thinking remains run content, not application logs or tool authority. The dashboard groups fragments into one accessible disclosure per block; SDK text helpers and final `output_text` remain answer-only. Historical `reasoning.summary` rows remain displayable. No migration or new persistence service is required.

OpenCode waits for the subscription's connected event before submitting a prompt, then waits for both the prompt response and the matching session-idle event before closing its subscription, so queued reasoning from every model turn is drained. An early stream EOF/error fails the turn rather than silently returning a partial transcript; subscription reconnect is disabled because this native feed has no durable replay guarantee. Cleanup aborts outstanding transport and drains the consumer. Pi defers reasoning completion until the assistant message outcome: its SDK can emit `thinking_end` before reporting premature EOF, so that event alone is not proof of completion.

The CLI's shared renderer handles all three reasoning events. Human output labels thinking separately; plain command progress goes to stderr while final answer text stays on stdout. Interactive chat starts a distinct assistant line after reasoning/tool activity. JSON and JSONL retain their existing contracts.

### Native reasoning verification

Manual live execution used the actual TypeScript SDK, HTTP handler, SQL worker, native Docker processes and provider gateway with disposable data. All five supported adapters returned successful answer-only results, complete model usage and verified checkpoints. Client-observed times below include cold startup and polling; these are single observations, not benchmarks or promises of earlier text.

| Harness / route | First readable thinking | First answer text | Readable reasoning fragments |
| --- | --- | --- | --- |
| Codex / OpenAI `gpt-5.4-mini` | 25,633 ms | 25,633 ms | 10 |
| Claude Code / Anthropic Haiku 4.5 | 14,334 ms | 21,021 ms | 24 |
| OpenCode / OpenRouter Muse | 16,518 ms | 19,748 ms | 1 |
| Hermes / OpenRouter Muse | 22,319 ms | 22,319 ms | 1 |
| Pi / OpenRouter DeepSeek V3.2 | 11,061 ms | 24,990 ms | 78 |

OpenRouter routes explicitly requested low effort. Pi with Muse emitted start/end without readable text: the pinned SDK stores that route's `reasoning_details` in replay-signature metadata instead of emitting text deltas. The adapter deliberately does not decode that opaque field. A separate Pi/DeepSeek run verified actual readable deltas. DeepSeek **harness** streaming still rejects with HTTP 400 before provider dispatch; this is distinct from choosing a DeepSeek model through Pi.

Application TypeScript checking, runtime bundling, all five SDK compilation/build checks and public documentation checks passed. Rust reported existing generated unused-import warnings. The successful reasoning journeys recorded $0.057376 in model charges, excluding the earlier wrong-image verification attempt and compute.

The browser-rendered dashboard component was manually inspected with captured live events: expandable grouped text, active thinking, completion, interruption and truncated-history states. A direct manual worker-helper exercise verified Unicode reconstruction, bounded chunks, independent block closure and removal of non-allowlisted signature/encrypted fields. No automated tests were added or run. Ignored `.data/manual-reasoning/` retains the synthetic event records; fixture databases and owned containers were removed. The isolated image overlays the new native worker on installed dependencies; this does not establish a full release image, hosted delivery or warm multi-turn/cancellation acceptance.

Review fixes were manually exercised without paid calls using the installed Pi adapter/SDK against loopback SSE: success produces completed thinking, while premature EOF and cancellation produce interrupted thinking. OpenCode's actual adapter/SDK preserved the full reasoning suffix with both HTTP-first and idle-first ordering and rejected early EOF. Built CLI subprocess checks verified labeled thinking on stderr, answer-only stdout, and unchanged JSON/JSONL behavior. A manually operated pseudo-terminal verified interactive chat thinking, a separate assistant answer line and clean exit against a synthetic HTTP/SSE endpoint. These protocol fixtures do not replace native-image or hosted acceptance. Regression cases remain in maintainer TODO at the operator's request.

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
- After the operator added OpenRouter credit, a fresh three-provider manual pass succeeded with synthetic inputs and at most $0.10 reserved per call. OpenRouter and Anthropic used TypeScript SDK → loopback HTTP → direct inference; OpenAI used the real authenticated native model gateway, with fixture-prepared run lifecycle state and no actual Codex process. All three delivered deltas before completion and recorded complete usage. Langfuse API readback found exactly one generation per call with full input/output, matching tokens and recorded charges.

  | Provider / model | First client text | Completion | Input / output tokens | Recorded cost |
  | --- | --- | --- | --- | --- |
  | OpenRouter / `openai/gpt-5.4-mini` | 1,268 ms | 1,908 ms | 23 / 64 | $0.000306 |
  | Anthropic / `claude-haiku-4-5-20251001` | 902 ms | 1,865 ms | 25 / 91 | $0.000480 |
  | OpenAI gateway / `gpt-5.4-mini` | 1,697 ms | 2,307 ms | 23 / 55 | $0.000266 |

  These are single-call observations, not benchmarks or deployed/full-harness acceptance. OpenRouter reported $0.00030525 upstream cost; the ledger's $0.000306 reflects integer micro-USD rounding. The original credit rejection remains valid failure evidence. Sanitized outputs, timed deltas and trace API readbacks are retained under ignored `.data/manual-streaming/live-three-*` and `live-*-trace.json`; the disposable database was removed after verification.
- Real native harness streaming passed through TypeScript SDK → local HTTP → SQL worker → Docker → live provider gateway, with fresh disposable workspaces and synthetic prompts. Each run delivered public `output.delta` events before terminal run completion, recorded complete model usage, and persisted a verified checkpoint.

  | Harness / provider | First public text | Run completion | Delta events | Model calls | Recorded model cost |
  | --- | --- | --- | --- | --- | --- |
  | Codex / OpenAI | 15,972 ms | 22,363 ms | 306 | 1 | $0.005865 |
  | Claude Code / Anthropic | 22,199 ms | 23,190 ms | 43 | 1 | $0.067592 |
  | OpenCode / OpenRouter | 17,159 ms | 18,545 ms | 283 | 1 | $0.004520 |
  | Hermes / OpenAI | 23,794 ms | 27,729 ms | 301 | 2 | $0.006248 |
  | Pi / OpenAI | 6,719 ms | 11,298 ms | 295 | 1 | $0.002359 |

  OpenAI routes used `gpt-5.4-mini`, OpenRouter used `openai/gpt-5.4-mini`, and Claude used `claude-haiku-4-5-20251001`. These single-run timings include admission, container/harness startup and event polling; they do not establish token-by-token flush latency or warm-session performance. Polling can deliver accumulated deltas after provider generation finishes but before checkpoint completion. DeepSeek rejected `stream: true` with HTTP 400 `streaming_not_supported` and zero provider calls. The successful matrix recorded $0.086584 in model charges, excluding earlier interrupted diagnostic attempts and compute.

  Langfuse API readback verified one generation per actual model call (six total), captured input/output, and matching aggregate token counts and recorded model charges.

  The first Codex attempts exposed a rejected upstream-reader cancellation escaping cleanup and crashing the local host. The model gateway now handles that cleanup rejection while retaining settlement in the read loop; the full matrix passed afterward. The temporary HTTP adapter also now handles source errors/client closure. Type checking passed. Detailed synthetic outputs, timed events and trace readbacks are retained under ignored `.data/manual-streaming/harness-*`; the disposable database and owned containers were removed. This verifies the installed local diagnostic image, not a newly built release image or hosted deployment.
- No automated tests were written or run, by explicit operator instruction. Deferred parser, accounting, admission, bounded-agent, SDK and lifecycle regression cases are in the central TODO. Native multi-turn/cancellation streaming journeys and hosted response flushing/disconnect survival remain separate acceptance work.

## Deferred scope and reference documentation

No partial JSON snapshots, Jev deltas without upstream support, replacement DeepSeek agent loop, direct token replay, queued cross-instance live fanout, arbitrary new provider endpoints or native retention redesign. These are separate product/lifecycle decisions, not prerequisites for this delivery path.

Provider references: [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [structured output compatibility](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Claude Agent SDK streaming limitations](https://code.claude.com/docs/en/agent-sdk/streaming-output), [OpenRouter streaming](https://openrouter.ai/docs/api_reference/streaming), [OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs), and [Langfuse usage/cost fields](https://langfuse.com/docs/observability/features/token-and-cost-tracking). Recheck exact pinned SDK/protocol behavior before upgrades.
