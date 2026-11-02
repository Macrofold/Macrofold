# Native output allowance and completion correctness: technical design

Status: implemented locally and reconciled with main `0101368a0dad68a124b79a99d2644b6110cb70c3` in `codex/native-runtime-memory-packs`; [integrated qualification](native-output-budget-verification.md#integrated-branch-qualification) records the current V2 artifact and release limits. Pair: [feature specification](native-output-budget-feature-spec.md). Tracker: [NOB implementation and acceptance](../maintainers/TODO.md#native-output-allowance-and-incomplete-completions). Original inspected baseline: `50f59404920b4d6ecce9df89590c9c045d9c5032`; its substantial dirty implementation and checkout were preserved rather than rebuilt. The implementation follows NOB1–NOB6 below; NOB7 tracks the separate coordinated release. Existing spending, time and direct-inference defaults are preserved. Native output defaults change as specified in the approved allowance policy.

## Invariants and ownership

- Model capabilities belong to the existing catalog/policy owner. Native output policy belongs to admission. Adapters translate the accepted values; they do not choose competing limits.
- Output tokens include provider-reported reasoning and other output. An output allowance is per model call; the Run's existing spending cap bounds all its calls and compute.
- Transport completion, semantic completion, usage completeness and checkpoint verification are independent facts. A complete stream and known usage do not imply a complete answer.
- An explicit output-limit finish is terminal for a native Run. There is no automatic continuation, paid retry, model fallback, reasoning downgrade or replay of an ambiguous provider call.
- Keep actual token evidence, existing bounded financial settlement, tenant authorization and verified persistence. Do not turn a normal failure into an exception path that loses output or session identity.
- No catalog fetch, extra full Run read, per-token database write or awaited trace export is added to successful native model requests. Reuse existing compact projections, frozen terms, stream observation and transactions. A bounded answer-text buffer is required independently of optional tracing to retain partial answers when a native SDK replaces them with a later error; see [partial-answer preservation](#partial-answer-preservation).

### Existing flow and defects

| Owner | Current behavior | Required change |
| --- | --- | --- |
| [Catalog policy](../../packages/core/src/model-policy.ts), [catalog selection](../../packages/core/src/model-catalog.ts), [provider discovery](../../packages/providers/src/model-catalog.ts) | Discovery has optional `context_tokens` / `output_tokens`; selected `Model` drops them. | Carry verified capabilities into the selected/frozen model. |
| [Native admission](../../packages/core/src/runs.ts) | Freezes prices, parameters and limits, but no native output allowance. | Resolve and freeze one output allowance with existing configuration validation. |
| [Gateway](../../packages/core/src/model-gateway.ts) | `min(8192, requested-or-4096)` independently clamps output. | Use the admitted allowance; keep per-call reservation and current-authority checks. |
| [OpenCode](../../packages/runtime/src/opencode.ts) | Advertises context 128,000/output 8,192; final error check misses `finish: length`. | Use accepted model limits and classify final truncation. |
| Pinned OpenCode 1.18.29 | Its upstream output default is separately 32,000. | Derive its existing supported override from the admitted allowance. |
| Other native adapters | Pi misses `length`; Claude/Codex/Hermes need terminal-result checks; DeepSeek loses the specific reason. | Apply the adapter audit below and gateway backstop. |
| [Run publication](../../packages/core/src/cloud-engine.ts) | Success follows native success plus verified persistence; model-error fence publishes generic `model_request_failed`. | Preserve the first specific failure cause through polling, checkpointing and publication. |
| [OpenAPI](../api/openapi.json) | `RunResult` disallows extra fields but omits the `failure_code` already returned by the handler. | Declare that existing field; update all generated consumers together. |

The reproduction's exact identities, counts and caller behavior are retained in the [feature evidence](native-output-budget-feature-spec.md#problem-and-evidence). This task did not inspect the private reproduction DB itself. Do not infer that OpenLegend repeatedly rejected model responses, that 207 tokens were all visible prose, or why the reported total exceeded 8,192; those claims are not established by this evidence.

## Model capability data

### Canonical fields

Extend the existing selected `Model` and public OpenAPI `Model` with positive safe integers:

- `context_tokens`: published total context capacity.
- `output_tokens`: published maximum generated tokens, including reasoning where the provider defines them that way.
- `input_tokens`: optional separately published maximum input; absence means no separate published value, not unlimited context.

Reuse discovery's existing `context_tokens` and `output_tokens` names rather than introduce a second capability object or a parallel model registry. Add optional `input_tokens` to discovery where supported. Enabled native models must have reliable context/output bounds; optional input is never fabricated. Disabled catalog entries may omit unavailable caps. Type the enabled selection so admission need not scatter non-null assertions or fallback constants.

For OpenRouter, normalize the existing response's model/top-provider limits in the discovery adapter. Use the supported route's conservative bound when both model and provider publish different limits. Do not perform a separate endpoints lookup for every Run; the existing catalog refresh/cache is the owner. For direct OpenAI and Anthropic entries, retain reviewed limits alongside the existing reviewed model policy and merge reliable discovery metadata when present. Do not replace pricing or add credentials to catalog responses.

The selected model, including capabilities, stays in the Run's existing frozen `rate_card` snapshot. This field already holds the admitted model rather than prices alone. Keep the current rate-card hash price-specific; the catalog revision and frozen values explain capabilities. No new database table, per-request capability service or duplicated snapshot column is needed.

### Verified source bounds and limitations

Public metadata/documentation was checked on October 31, 2026. Recheck on a publisher/catalog capability change. These bounds are source facts; the separate [live Muse check](native-output-budget-verification.md#live-muse-xhigh-check) qualifies two actual requests, not every model or workload:

| Route | Published bounds | Design consequence |
| --- | --- | --- |
| OpenRouter `meta/muse-spark-1.3-contributor` | Endpoint metadata: context 1,048,576; maximum completion 943,718; Meta Contributor endpoint revision `20260902`. | 8,192 is a Macrofold ceiling, not this model's published maximum. Do not request 943,718 by default. |
| OpenAI `gpt-5.4-mini` | Context 400,000; maximum input 272,000; maximum output 128,000. | Preserve separate input/context limits; do not advertise all context as usable input. |
| First-party Claude Sonnet 4.6 | Overview advertises 1M context, 128K output. | Use provider metadata's exact integers or conservatively reviewed 1,000,000 / 128,000; do not infer binary units from `K`/`M`. |
| First-party Claude Haiku 4.5 | Overview advertises 200K context, 64K output. | Use exact metadata or conservatively reviewed 200,000 / 64,000. The native default is capped to this output maximum. |

OpenRouter's generic model listing and an endpoint listing can differ. Implementation must record the actual listing used by normal catalog selection and prove the selected enabled Muse snapshot exposes an output bound above 65,536. Do not hardcode the research endpoint's large limit into admission to conceal missing metadata. If a supported route has no reliable output maximum, keep it disabled until the catalog owner has a verified bound; return an actionable catalog/configuration refusal before paid dispatch.

Meta confirms that reasoning consumes output budget, Contributor accepts `xhigh`, and Contributor does not accept `max` or disabled reasoning. Preserve [existing parameter validation](../../packages/core/src/model-parameters.ts); do not equate `xhigh` with `high`, accept `max` for this slug or silently reroute the request. General provider parameter support remains separate from this allowance policy.

## Allowance policy

### Public contract

Add optional `max_output_tokens` to the existing native OpenAPI `Limits` schema: integer, minimum 1, maximum JavaScript safe integer (`9007199254740991`); admission applies the selected model's much smaller dynamic maximum. No misleading universal OpenAPI default is attached because the default depends on the model/effort. Description: **Maximum generated tokens per native model call, including reasoning and tool-call output. Does not increase the Run spending cap or deadline. Omission uses the Session allowance or the model-aware native default.**

Use this field consistently for native Session creation, agent presets and Run creation. It is not a new top-level parameter, `ModelParameters` field, environment variable or aggregate Run token budget. Do not silently accept/ignore it on non-native operations; those continue to use their existing inference/decision-specific contracts.

Resolve in one small pure function owned beside existing model-parameter/admission policy, for example `resolveNativeOutputTokens(model, modelParameters, requested)`. It needs no provider SDK types, I/O, cache, strategy registry or new package. Call it from `validateConfiguration`; do not reproduce its defaults in gateway or adapters.

### Defaults and validation

1. A present caller/inherited value must be a positive safe integer. Reject zero, null, fractions, numeric strings, infinity and values above `model.output_tokens` with HTTP 400 `invalid_request`, including safe details identifying the field and allowed maximum.
2. With no saved/requested value, choose 65,536 for explicitly requested `high`, `xhigh` or `max`; choose 32,768 for other explicit efforts.
3. Omitted effort on the exact Muse Contributor route also chooses 65,536, because its default reasoning remains enabled. Reuse the existing exact-model predicate/owner rather than duplicate model-name matching rules. Other omitted efforts use 32,768.
4. Limit an automatic default to the published output ceiling. Defaults are recommendations, not a second hard ceiling: a caller may explicitly request more, up to the model maximum and existing financial/time bounds.
5. Verify that accepted context and output values are internally coherent; reject malformed catalog capabilities rather than manufacture a 128,000/8,192 fallback. Leave the existing reviewed-model eligibility policy unchanged except where it must now require reliable caps; expanding admission to previously unsupported small models is not part of this fix.

These adopted defaults provide four/eight times the old allowance, with much more answer room after the reproduced 8,180 reasoning tokens. They are deliberately bounded policy choices, not publisher guarantees or a measured promise that all `xhigh` prompts fit. They avoid spending almost the full model context on every call. Record the values once, next to the resolver, with a why-comment linking this section.

### Inheritance and freezing

- Fresh Session: validate model/effort, resolve the allowance, save it in the existing Session limits. A fresh Run's implicit Session uses that same prepared configuration; do not select/resolve twice.
- Existing Session: merge saved limits and per-Run limits exactly as today, validate against the selected model, and freeze the resulting allowance in `runs.config.limits.max_output_tokens`. A per-Run override does not rewrite Session defaults.
- A changed model whose maximum is below an inherited allowance is an actionable admission refusal. The caller can explicitly choose a valid override. No provenance/version system is needed to guess whether a saved numeric limit once came from a default.
- Presets expose/store the same optional field through the existing resource/configuration owner. Use existing validation/inheritance, not a separate preset policy. Resolve missing defaults at Session/Run admission; do not freeze a model catalog forever when merely saving a preset.
- Recovering an admitted Run uses its frozen allowance and frozen capability snapshot; it does not reread today's catalog, reprice, reroute or re-resolve policy.

### Money and time

Dashboard continuation/preset forms inherit saved spending and execution-time limits unless the user edits them. A changed output field must not reset them to fresh-run defaults. Resolve the existing configuration query before submission; errors remain actionable and cannot fall through to a larger default. The CLI likewise retains the saved Session budget for output/timeout-only overrides.

Keep the gateway's existing conservative input reservation plus `effective output tokens × frozen output rate`, and the locked comparison against remaining Run budget, other in-flight model reservations and compute allowance. Use integer micro-USD arithmetic and existing cache-write rules. The Run's accepted monetary ceiling never increases automatically.

A larger allowance can reserve more money and cause a low-budget request to fail before dispatch even if its eventual answer might have been short. Preserve existing `run_budget_exhausted` behavior and explain reducing the allowance or explicitly increasing budget. Do not silently spend more, lower an explicit allowance, downgrade effort or bypass reservations for BYOK. Reserving a bound is not charging that amount; known usage settles normally and releases unused reservation.

Preserve current provider/gateway/Run deadlines and cancellation; this design does not raise the approximately 280-second gateway model deadline or 300-second local model-transport deadline. A 65,536 allowance is not a promise of enough wall-clock time for every model to emit it. A genuine deadline failure keeps its existing classification rather than being relabeled as output truncation.

## Runtime propagation and warm reuse

In [runtime types](../../packages/runtime/src/types.ts) and the [supervisor validator](../../packages/runtime/src/supervisor.ts), add required internal `modelLimits: { contextTokens: number; inputTokens?: number; maxOutputTokens: number }`. Here `maxOutputTokens` is the admitted per-call allowance, not another default; context/input come from the frozen model snapshot. Build it once from the accepted Run in [cloud-engine provisioning](../../packages/core/src/cloud-engine.ts).

Adapters consume this object; none rediscover models or compute allowance defaults. Pass published context/input and the resolved output allowance into harness model metadata where that interface supports them. Respect separate input capacity and the harness's context/output reservation behavior; raising output reduces available input room. Do not implement a generic byte-to-token context rejector or silently truncate prompt/history.

Include the exact runtime limit object in [runtime warm compatibility](../../packages/runtime/src/warm-session.ts), [core host allocation compatibility](../../packages/core/src/host-allocations.ts) and [host prepare identity](../../packages/runtime/src/host-control.ts) where identity is explicitly assembled. Re-read all three owners: changing only one hash leaves another stale reuse path. A changed allowance/capability must close the old resident and cold-resume the verified checkpoint. Same limits still reuse normally. Do not attempt live mutation of an already-created SDK provider/model object.

Configuration is private runtime data, not secrets or authority. Generation, organization, current principal, exact model/credential and deadline checks remain gateway-owned. A harness cannot enlarge its limit by changing model metadata or passing a bigger `max_tokens` value.

## Gateway request handling

Replace the 8,192 clamp and 4,096 fallback in [native gateway reservation](../../packages/core/src/model-gateway.ts) with the frozen `config.limits.max_output_tokens` already included in its compact configuration projection. No catalog query or full encrypted input read is required.

1. Normalize the relevant protocol output field: Responses `max_output_tokens`, Chat `max_completion_tokens` / supported `max_tokens` alias, Anthropic `max_tokens`.
2. If a value is absent, use the admitted allowance. Present malformed values are HTTP 400, not `Number(...)`, truthiness or a default. Reject conflicting aliases; equal valid aliases can normalize to the protocol's canonical field.
3. An intentional smaller harness request remains smaller. A larger harness request is bounded to the admitted allowance, as the gateway already constrains native requests. This is distinct from public admission, which refuses an excessive explicit caller limit instead of pretending it was honored.
4. Pass that effective value into existing `protocol.prepare` and reserve against the same value. Keep the existing `n = 1` and parameter/provider restrictions. `count_tokens` remains unmetered and does not invent a generated completion.
5. Retain the two-phase prepared/current-control validation and transactional reservation. Never cache authorization, available funds, Run cancellation, lease ownership or the first-model-failure fence as immutable configuration.

On success, the added work is scalar validation, bounded answer-text retention and carrying small immutable fields through the existing reads. No new SQL group or round trip is required. The budget resolver must not run per token or create a new request pipeline.

## Completion classification and failure control

### Narrow common helper

Add one dependency-free scalar helper in `packages/contracts/model-completion.ts`, shared by provider/runtime TypeScript owners: recognize explicit output-limit reasons `length`, `max_tokens`, `max_output_tokens`, and DeepSeek's `max-tokens`. Expose the single canonical native failure code `model_output_limit_exceeded`. Call it only on typed/validated finish-reason fields, never arbitrary error messages, prompt text or a generic object search.

Protocol extractors stay in [model stream/protocol owners](../../packages/providers/src/model-stream.ts). They normalize these locations:

| Wire protocol | Explicit output-limit evidence | Not equivalent |
| --- | --- | --- |
| Chat Completions / OpenRouter | `choices[0].finish_reason === length` | `stop`, `tool_calls`, content filtering, empty text, high usage alone |
| OpenAI Responses | Final response `status: incomplete` with `incomplete_details.reason: max_output_tokens`, in JSON or `response.incomplete` | Other incomplete reasons, transport EOF, a tool call or intermediate content-item completion |
| Anthropic Messages | Final `stop_reason: max_tokens`, or streaming message delta carrying it followed by message stop/usage | `end_turn`, `tool_use`, `pause_turn`, refusal or context-limit reasons |

Do not broaden the existing throwing `modelResponseFailed` check to treat a length frame as a transport exception before usage is consumed. Add a separate semantic output-limit observation, latched for the request. Keep existing SSE terminal framing, bounded capture and accounting gate. Transport finish and `usage.complete` retain their own meanings.

Other explicit terminal incomplete/error outcomes must also not become success; retain their existing provider/harness failure category instead of calling every incomplete response an output-limit error. Intermediate `tool_calls`, `pause_turn` or content-block endings are not final Run completion. If the harness actually terminates with unfinished work, use its existing failure outcome. Absence of text, a large token count or an unknown optional finish field alone is not evidence of truncation; do not introduce a text-length heuristic.

### Durable gateway backstop

The gateway must protect adapters whose SDK hides or mislabels native finish reasons. Reuse `recordModelFailure` and `runs.model_error_request_id`, rather than a new completion/retry controller:

1. JSON: parse bounded body, collect actual usage and explicit finish reason. SSE: latch the reason, keep draining within the existing deadline/byte bounds, and collect trailing usage. Do not start another model call.
2. For explicit output-limit evidence, invoke the existing failure-fence owner with typed cause `model_output_limit_exceeded` **regardless of `stop_on_model_error`**. For ordinary failures retain that flag's current behavior.
3. In its existing Run-locked transaction, first-writer-wins set `model_error_request_id`, merge `failure_code` into existing native `runs.result` JSON, and append existing `run.model_error` with the same safe code/request ID. Every fence writer, including ordinary-error and orphan reconciliation paths, records its typed cause (`model_request_failed` for an ordinary model error). Do not overwrite another already-established first cause, unrelated result fields or a terminal Run. No migration or second error table is needed.
4. Hold effect-enabling tool-call frames as well as terminal/usage frames in the existing protocol gate. Text/reasoning-only streams continue immediately. On success, settle and release original bytes unchanged. On explicit length failure, commit the fence, settle actual usage, then reject JSON or error the SSE stream without releasing the buffered tool/terminal frames. Preserve the original provider answer/usage in the existing result and trace owners; do not fabricate success or replace known usage with zero. Forwarding a length-limited tool call after fencing is unsafe: native file/shell tools do not consult the SQL connector fence. Actual pinned Codex and Claude Code fixtures reproduced a file write despite a failed Run, so the original forward-on-length proposal is superseded by this shared gate.
5. Extend current compact control reads with only `result->>'failure_code'` as needed. Subsequent native model admissions fail before dispatch using the first cause; polling cancels the resident, then performs ordinary checkpoint/accounting publication. Do not add a new wait for the scheduling loop to enforce spending denial.

The first persisted output-limit cause must survive a later stream/protocol/settlement error; finish draining when possible, preserve whatever usage is known, and use existing unknown-usage recovery when not. Never let a generic catch settle away the in-flight evidence or release a success tail after the output-limit fence failed to commit. Fence persistence can be retried as an idempotent database operation; the paid provider request cannot be retried. Recovery may stop/finalize the Run but may not regenerate an answer.

`stop_on_model_error: true` already serializes model admission while an earlier call is unsettled, protecting ambiguous failure-fence commits. Preserve that guarantee. With the flag false, already-dispatched concurrent calls cannot be undone; retain and settle them. Do not globally serialize all native models to pretend those calls never occurred. The [fault qualification](#verification-without-new-maintained-tests) must explicitly cover failure-fence outages and must not claim absolute zero additional provider work across an uncommitted fence and concurrent admissions. No new process-local authority cache or duplicate model-transport SSE parser is proposed.

### Partial-answer preservation

Actual Hermes qualification exposed a second loss mode: it consumed `I heard` and then replaced its final response with the next model request's HTTP 409 error. Adapter buffers alone cannot reliably establish the original provider answer. The gateway therefore uses one `ModelAnswerCapture` beside the existing optional tracing capture. It retains only answer-text deltas/snapshots, excludes reasoning and tool arguments, and caps retained text at the existing 4 MiB native-result bound with Unicode-safe prefix handling. It does not retain a second complete frame history or depend on tracing being enabled.

On an explicit output-limit failure, the existing first-writer failure transaction saves this bounded text in `runs.result.output_text`; `output_text_truncated: true` explicitly marks a diagnostic prefix shortened by this separate byte bound. JSON serialization is prepared before acquiring the Run lock. Normal successful requests do not write this buffer to the database. Final publication prefers this authoritative failure text, including an empty string, over a native SDK's later cleanup/retry message. Partial diagnostic text remains unsuitable for publication as a complete answer.

Tool authorization and final connector-effect admission also check the existing model-error fence. No new query is added. Already dispatched effects and local native tools cannot be rolled back; saved checkpoints remain independent. Strict model admission remains the existing opt-in serialization contract. Non-strict failure-fence outages retain the documented concurrency limitation; this change does not globally serialize native model calls.

### Native adapter changes

Pinned versions inspected: OpenCode SDK/binary 1.18.29, Claude Agent SDK 0.3.261, Codex 0.153.4, Pi 0.85.1, DeepSeek DSH 0.1.5-alpha.1; Hermes runtime image pins commit `b2aa855b626ff8688eb34b95c60ee8b6a4af3679`. Verify against the actual built image, not a different global CLI.

| Adapter and owner | Allowance mapping | Completion handling |
| --- | --- | --- |
| [OpenCode](../../packages/runtime/src/opencode.ts) | Replace `limit.context/output` constants; include supported `limit.input` when published. Before SDK server spawn, derive upstream `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` from the accepted allowance. | Inspect the final assistant message's `finish`, not just `info.error` or idle state. `length` returns failure with partial output and resume ID. Intermediate tool-call/unknown finishes do not prove a final answer. |
| [Pi](../../packages/runtime/src/pi.ts) | Replace provider `contextWindow/maxTokens` constants with accepted values. | `message_end` `stopReason: length` fails. Keep a terminal-failure latch so later events cannot clear it. `toolUse` is an intermediate tool step; `pending` / `deferred` alone do not prove final success. Preserve abort/error behavior. |
| [DeepSeek](../../packages/runtime/src/deepseek.ts), [bridge](../../packages/runtime/src/deepseek-bridge.ts) | Replace both provider model `maxTokens/contextWindow` and the independent bridge agent-options `maxTokens: 8192`. | Upstream maps Pi `length` to turn-end reason `max-tokens`; preserve that specific failure instead of generic `harness_error`. Existing non-completed turn failure stays failure. |
| [Hermes Python bridge](../../packages/runtime/src/hermes-bridge.py), [adapter](../../packages/runtime/src/hermes.ts) | Replace `AIAgent(max_tokens=8192)` with the accepted allowance supplied through its existing private configuration. | Do not rely solely on `completed` / `final_response`. Inspect a supported upstream finish field if present; the gateway fence is mandatory when it is not exposed. The gateway retains authoritative partial answer text even if the SDK final response is absent or replaced by an error. Do not add a second unbounded bridge buffer or monkeypatch upstream model generation. |
| [Claude](../../packages/runtime/src/claude.ts) | Derive supported `CLAUDE_CODE_MAX_OUTPUT_TOKENS` through this query's `env` option; verify the pinned SDK binary honors it. No invented `Options.maxOutputTokens`. | Inspect typed result `stop_reason` as well as `subtype`; success plus `max_tokens` is failure. The gateway covers earlier hidden truncation even if the SDK later returns success. Keep resume identity and partial content. |
| [Codex](../../packages/runtime/src/codex.ts) | Gateway omission uses admitted output, not 4,096. Use a native supported request/config option only if verified in this pinned version; do not invent `model_max_output_tokens`. | `turn/completed` requires completed status **and no turn error**. Inspect genuine typed incomplete reasons where exposed; the gateway's Responses observer covers hidden `max_output_tokens`. Preserve existing cancellation/error mapping. |

OpenCode's upstream [transform](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.29/packages/opencode/src/provider/transform.ts), [LLM request](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.29/packages/opencode/src/session/llm/request.ts) and [runtime flags](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.29/packages/opencode/src/effect/runtime-flags.ts) show the additional 32,000 default and supported override. The installed SDK's server launcher inherits `process.env` and exposes no per-server `env` option. Set the derived OpenCode variable only in the isolated native worker after its existing environment scrub and before spawn; do not add a new operator knob, leak the parent environment or set a global web/poller variable. Changed limits invalidate the resident first.

Claude's documented [output environment option](https://code.claude.com/docs/en/env-vars) can be capped by its own recognized-model table. Configuring the variable is not proof that the pinned binary honored a larger request; capture the actual request during qualification. Codex's public config reference did not establish a supported maximum-output config key. These are explicit binary-qualification gates, not permission to fake a successful configuration or silently substitute a harness.

Every normal truncation path returns existing `NativeResult { outcome: failure, failureCode, output, resumeId }`; it must not throw into [native-worker's](../../packages/runtime/src/native-worker.ts) generic catch that replaces output with an empty string. Retain the per-turn output buffer through adapter cleanup/catch: if the SDK throws after an explicitly observed limit, return that typed failure and partial text; do not swallow an unrelated exception when no such reason was observed. Do not introduce another outcome enum or public completion envelope. Close/interrupt outstanding reasoning blocks consistently, and close failed warm residents. A completed reasoning block is not proof of a complete answer.

The Python bridge may return its supported reason through its existing private JSONL result so the TypeScript bridge applies the common scalar classifier. Avoid a cross-language classification framework or importing provider SDK types into contracts. Keep only directly exposed finish reasons; no regex guesses from exception messages.

The complete adapter audit also rejects explicit unfinished final states without treating ordinary intermediate tool cycles as failures: OpenCode final tool/content-filter/error states, Pi final pending/deferred/toolUse and Claude final tool-use/pause/context-exhausted states use their existing generic failure category. Forty-two disposable adapter cases cover these distinctions; absence of an optional finish reason remains unchanged.

The supervisor retains a native Session ID already observed in `runtime.started` when cancellation beats the final SDK message. Host release separately tracks assignment cancellation and retains only a successful, non-cancelled resident. This closes the race where a gateway-failed turn's SDK freezes a success wrapper just before cancellation: verified files/identity survive, but that process is cold-resumed rather than reused.

### Final Run publication

In [cloud-engine](../../packages/core/src/cloud-engine.ts), carry the specific first gateway cause through poll control and final publication. When a model-error fence exists, use its saved typed `failure_code`; ordinary model failures save `model_request_failed` through the same owner. Otherwise respect the adapter's failure code. Do not add a legacy-result upgrade path. Do not let a later `NativeResult.outcome: success`, checkpoint success or retry of finalization overwrite a known semantic failure.

Keep current cancellation, question denial, deadline and accounting precedence; document any necessary correction locally. Do not add a `Date.now() > deadline` check at publication that turns timely model execution into a timeout merely because accounting/checkpointing was slower. `model_output_limit_exceeded` is the cause when observed before cleanup, not a cleanup timeout invented afterward.

Capture and publish checkpoints through the existing verified persistence path, including failure. Keep `native_session_id` / resume identity and state files when capture verifies. `execution_outcome: failure` can coexist with `persistence_status: verified`; missing/failed capture must remain explicit rather than reporting a fictitious checkpoint. Do not discard or edit the persisted OpenCode SQLite history to make the response appear complete.

## Contracts, callers and user experience

Update [OpenAPI](../api/openapi.json) as the source of truth before regenerating code:

- Native `Limits.max_output_tokens`, inherited references and descriptions, including the distinction from direct `InferenceLimits`.
- `Model.context_tokens`, `Model.output_tokens`, optional `Model.input_tokens`, with required-when-enabled selection validation described above. Avoid leaking internal-only helper fields through `listModels`, which currently spreads the selected model.
- Add optional string `RunResult.failure_code`, matching existing `Run.failure_code` and the handler's emitted result, rather than add another `error.code` copy or new outcome enum. Include `model_output_limit_exceeded` in documented failure semantics and native events. Add optional boolean `output_text_truncated` for a failure answer shortened by the diagnostic byte bound; omission does not establish semantic completeness.
- Explain the new unconditional native output-limit behavior in `Limits.stop_on_model_error`: false still permits existing ordinary harness retry behavior, but cannot make a truncated native completion successful.

Illustrative final result (a shape example, not a claimed replay of the historical Run):

```json
{
  "run_id": "01a19336-99ac-7317-96d0-43e42b13a798",
  "final": true,
  "execution_outcome": "failure",
  "persistence_status": "verified",
  "failure_code": "model_output_limit_exceeded",
  "output_text": "I heard"
}
```

`GET /v1/runs/{id}/result` still uses HTTP 200 for an available final failed result. Run creation still returns its existing asynchronous receipt; do not turn a later provider length into a retroactive admission HTTP error. Existing event streams carry `run.failed`. All partial text stays tentative until final success; consumers must not infer success from SSE EOF or non-empty output.

Regenerate contracts and TypeScript/Python/Go/Rust/Java SDKs together. Review typed model/limit/result serialization and the existing [TypeScript Run helpers](../../sdk/typescript/src/run-helpers.ts): `waitForRun` / collecting text must surface the normal failure exception with partial result and failure code. Other SDK helper equivalents follow the same behavior; do not build a new retry wrapper. Raw result methods remain available for inspection and deliberate recovery.

Update the [CLI configuration](../../packages/cli/src/context.ts) / [commands](../../packages/cli/src/commands.ts) using the existing limits path, with a native Run `--max-output-tokens` option and positive-integer validation. Ensure preset/session merges do not drop it. Existing JSON input remains valid. CLI waiting must exit unsuccessfully for this failed Run and present a bounded diagnostic without logging full private prompts.

Update [Run composer](../../apps/web/components/run-composer.tsx), [Run details](../../apps/web/components/runs.tsx) and the existing preset editor in [management](../../apps/web/components/management.tsx). Use progressive disclosure; no required output-token field on the basic path. Reuse a small shared limits form/parser if these surfaces otherwise duplicate validation. Show an incomplete-output failure, retain inspection/copy/checkpoint/usage actions, and do not render it as a successful answer.

Check [customer MCP catalog](../../packages/core/src/customer-mcp-catalog.ts) and [MCP dispatch](../../packages/core/src/customer-mcp.ts) for generated-schema propagation. Keep the existing read-only [management MCP](../../packages/core/src/admin-mcp.ts) boundary. No alternative native invocation endpoint is added.

## Accounting, tracing and safety

`usage.output` already includes reasoning for these protocols. The reproduction must remain 8,387 total output tokens, with 8,180 reasoning available as a detail; do not sum them again, replace them with 207 or clamp them to the accepted limit. A token ceiling is a request control, not authority to falsify provider measurements.

Use the current settlement idempotency, complete/missing usage distinction and provider reported-cost normalization. A length-ended but fully metered call is not an upstream rejection: do **not** set `upstreamRejected=true`, zero its usage or refund incurred model work. If reported monetary usage exceeds the reserved bound, retain the existing circuit-breaker/review behavior and cap customer charges at the authorized bound; retain the uncapped reported amount/token counts as evidence. No arbitrary safety multiplier is justified by the unexplained 195-token discrepancy.

For BYOK, native Langfuse charge fields remain Macrofold charges (zero model charge), while provider-reported/estimated cost and token details remain separate metadata. Traces mark semantic failure and include safe model, effort, admitted/effective output limit, finish reason, Run/request identity and known/provisional accounting status through the existing tracing owner. Do not await remote Langfuse export on the response path or store additional plaintext prompts/answers in general logs.

Never treat model/provider text as authority. Keep exact credential binding, current permissions, file/tool restrictions and organization fencing. A truncated tool call must not create a new tool execution. Already performed tools and saved files are not rolled back or repeated; expose their ordinary evidence/checkpoint state. Broader side-effect transactions remain outside this change.

## Implementation sequence

Each stage updates its owners, callers and existing fixture data together. These are one coordinated fix, not independently acceptable partial releases.

1. **Reconcile baseline and capabilities (NOB1).** Follow the full contributor baseline and scoped instructions; preserve unrelated work and preview. Recheck model metadata and pinned package/runtime versions. Extend existing catalog normalization/policy/type/public schema. Confirm enabled native selections carry caps without a new request-path lookup.
2. **Resolve admission and propagate configuration (NOB2).** Add native `Limits.max_output_tokens`, one resolver and Session/Run inheritance. Update implicit Session reuse, preset handling, simulator fixtures and internal runtime validator/types. Carry frozen values to runtime and all compatibility identities. Do not introduce old-Run migrations or silent fallback defaults; this prelaunch release drains old writers and creates fresh verification Runs.
3. **Map every adapter and the gateway (NOB3).** Remove each independent output constant, including OpenCode's upstream default via its derived flag and both DeepSeek constants. Normalize gateway output fields/reservations. Prove actual outgoing values before assuming a runtime setting works. Preserve direct-inference behavior and existing byte/deadline bounds.
4. **Implement completion failure end-to-end (NOB4).** Add narrow reason classification, protocol observation, unconditional native length fence, specific first-cause persistence, adapter NativeResult mappings and cloud publication. Drain usage and preserve checkpoints. Exercise normal/truncated completions before moving on; do not add automatic retry or an alternate inference path.
5. **Update clients and documentation (NOB5).** Regenerate all SDK contracts; update CLI, dashboard and customer MCP. Update the guide matrix below and current failure examples. Document budget reservations, defaults, tentative streams and explicit caller recovery. Run existing contract/client checks.
6. **Qualify and review (NOB6).** Execute the disposable success/failure/fault matrix, inspect the complete affected diff and final request captures, and fix in-scope issues. Record exact image/revision, configuration, outputs, usage, failures, checkpoint verification and verification limits. Keep the separate coordinated release gates open until they are verified.
7. **Coordinated release (NOB7).** Complete a clean final Dockerfile build, drain old native writers, ship matching app/runtime/client artifacts and qualify deployed-provider/hosted behavior. Local checks and the derived qualification image do not substitute for those release checks.

No database schema migration is planned: existing JSON config/result, catalog snapshot and failure-fence fields suffice. Do not add legacy adapters or mutate historical results to claim success was already fixed. If source inspection uncovers a required schema change, update this design explicitly before implementation rather than hiding it in a helper.

## Verification without new maintained tests

The design-only phase ran documentation checks. Implementation runs existing checks and adds **no new maintained tests**. Updating existing fixture objects for required runtime/capability fields is allowed; do not add permanent test cases or a parallel qualification framework. Put temporary drivers under ignored `.data/native-output-qualification/`, reuse existing protocol/native fixtures and record results in an internal verification section beside the execution guide or this project. Do not commit private request databases, credentials or full captured user content.

Historical design-only verification: the full five-document change was reviewed; `pnpm docs:check` and `git diff --check` pass. The checker verified 68 published pages, 272 Markdown files and 54 requirement mappings. Its existing `apps/web/CLAUDE.md` native-loader-precedence advisory remains unrelated. That earlier design-only check performed no runtime execution. Subsequent implementation and acceptance results are recorded separately in the [verification record](native-output-budget-verification.md).

### Existing check entry points

Commands below are verified against the current root package scripts. Follow [TESTING.md](../../TESTING.md) for disposable databases and applicable scoped guidance; use the intended branch's dependencies and a separate runtime image tag. Do not stop or retag the running preview's image.

```sh
pnpm docs:generate
pnpm sdk:generate:all
pnpm sdk:build
pnpm exec tsc --noEmit
pnpm test tests/unit/run-configuration.test.ts tests/unit/model-catalog.test.ts tests/unit/model-protocols.test.ts tests/unit/model-stream.test.ts tests/unit/native-bridge.test.ts tests/unit/sdk-run-helpers.test.ts
pnpm test tests/integration/model-catalog.test.ts tests/integration/run-boundaries.test.ts tests/integration/billing.test.ts tests/integration/inference-billing.test.ts
pnpm test:sdks
pnpm test:cli
pnpm docs:check
```

`sdk:generate:all` already includes `contracts`; use `pnpm contracts` only as an alternative early iteration entry point, not as another mandatory full-generation pass. Run affected browser journeys through the existing isolated dashboard runner under its documented setup. Full SDK verification is appropriate because this changes a shared contract; CI still owns full gates. Do not repeat unrelated full suites that already passed on the same tree.

For the real pinned native image, use the existing `test:native` runner and its documented fixtures/options (`--image-only`, `--warm`, `--failure`, `--cancel`). An example entry point is `DOCKER_RUNTIME_IMAGE=platform-runtime:native-output-qualification pnpm test:native opencode --image-only`; build and mount from this checkout under the existing runner instructions. Use a disposable wrapper/copy of `tests/fixtures/native-model.mjs` to produce the additional finish/usage scenarios, rather than editing maintained fixture behavior to add new cases. A disposable driver can reuse the runner's Docker command/mounts and overlay that copied file at `/tests/native-model.mjs` read-only; retain network-disabled execution, existing broker/checkpoint assertions and an isolated runtime tag. Inject scenarios at the provider boundary while running the real adapter/SDK, not by replacing the adapter result with a fabricated success/failure.

### Required disposable scenarios and assertions

| Area | Scenario and exact assertion |
| --- | --- |
| Admission | Omitted effort/default, explicit `xhigh`, explicit smaller/larger valid limit, published maximum, invalid/null/string/fraction/zero, malformed/missing catalog cap, preset/Session inheritance, per-Run override, changed model below inherited cap. Check exact resolved value and pre-dispatch refusal. |
| Outgoing allowance | Capture the real pinned OpenCode provider request: 65,536 is not reduced to 8,192 or 32,000. Check aliases, missing output field, a smaller intentional SDK request and a larger attempted request. Verify each other adapter's actual outgoing configuration/request. |
| Sufficient output | Controlled complete response with more than 8,192 total output tokens and a complete visible answer succeeds, with normal checkpoint/result. This tests transport/control, not model quality. Use realistic accounting and a sufficient explicit Run budget. |
| Truncation | JSON and split-chunk SSE with `length` / `max_tokens` / Responses incomplete; one-word, empty visible and tool-argument output. First finish reason is retained, final Run fails, partial text is inspectable, and no automatic follow-up provider request occurs. |
| Trailing usage | Reasoning 8,180 plus other output 207 gives output total 8,387 exactly. A finish frame before a later usage frame keeps the latter. Test a known complete usage response and then broken/missing usage separately; only the latter is provisional. |
| Adapter outcomes | Actual OpenCode final message finish; Pi length; DeepSeek max-tokens; Claude success subtype with max_tokens; Codex completed with turn error/incomplete response; Hermes success wrapper around a gateway-truncated call. None may publish success. Other explicit incomplete reasons remain failures with their correct existing category; normal tool-call cycles still complete normally. |
| Failure control | `stop_on_model_error` true/false/omitted: output limit always fences future admissions; ordinary failures retain current flag semantics. Attempt a later request from the same Run and verify no provider dispatch. Already admitted concurrent work is tracked/settled, not erased. |
| Faults/recovery | Fail/lose acknowledgment of fence commit; fail settlement; break stream after a length frame; repeat finalization and recover an orphan. No provider replay, no false success tail, first cause retained, usage settled at most once. Strict mode must keep its existing unsettled-request guard. Explicitly report any remaining non-strict concurrent fence-outage window. |
| Budgets | Managed/BYOK, insufficient remaining budget, actual usage above reservation, cancellation/deadline, provider refusal and missing usage. Do not lift caps, double-charge, turn paid truncation into a free rejection or hide reported cost. |
| Persistence | Failed execution plus verified checkpoint; failed capture plus last verified checkpoint; saved files/session identity survive failure. Continuation is a new deliberate Run, never an automatic repair. |
| Warm lifecycle | Same accepted caps reuse; changed output/context caps invalidate all resident compatibility identities and cold-resume verified state; failed/truncated resident closes. No stale environment/provider model object remains. |
| Caller contract | REST final failure with HTTP 200; generated result failure code; SDK wait/collect failure and raw partial retrieval; CLI nonzero exit; dashboard incomplete state; customer MCP schema. Successful native Runs and direct inference remain unchanged. |
| Bounds/performance | Existing 8 MiB model request, 32 MiB gateway response and 4 MiB native JSONL-line protections remain explicit. A supported allowance must not silently lose an oversized final/result line. Capture a large complete output; if the supervisor drops a required result, fix the existing reader to report a bounded failure or safely chunk through its existing protocol, not silently succeed or buffer without limit. Compare normal-request SQL count and bounded memory with baseline; no new success-path catalog/DB round trip. |

The historical paid Run must not be replayed automatically. The design itself authorized no new spending. The later implementation instruction supplied standing approval for tests below $0.25 each. Two synthetic real Muse `xhigh` checks each reserved a $0.05 ceiling, disabled fallback and allowed one bounded provider attempt; sufficient output succeeded and an explicit 16-token limit failed correctly; its actual output/usage/cost and scope are in the verification record. Do not claim all `xhigh` outputs are sufficient, model quality is proven or production acceptance follows from synthetic token counts.

## Documentation and artifact update matrix

During implementation, update these current-truth owners together; this proposal deliberately does not make them claim the fix is shipped:

| Owner | Required update |
| --- | --- |
| [Models](../features/execution/models.md), [harnesses](../features/execution/harnesses.md), [unified interface](../features/execution/unified-harness-interface.md) | Published capabilities, one admission allowance, actual adapter support and completion failure semantics. |
| [Runtime](../features/execution/runtime.md), [native testing](../engineering/testing/harnesses.md) | Frozen propagation, warm invalidation, verified failure checkpoints, pinned-binary qualification and bounded output diagnostics. |
| [API conventions](../features/api/conventions.md), [streaming](../features/api/streaming.md), [streaming internals](../features/api/streaming-implementation.md) | Native limits example, final failure/result code, tentative deltas, no paid repair retry; distinguish immediate inference. |
| [SDK guides](../features/api/sdks/README.md), [reference](../features/api/sdks/reference.md), [implementation](../features/api/sdks/implementation.md), SDK READMEs/examples | New limit/catalog fields, typed failure retrieval, existing wait-helper behavior and generated methods. |
| [CLI](../features/cli/README.md), [implementation](../features/cli/implementation.md) | Copyable output-limit option/JSON, inherited limits, failed exit and explicit recovery. |
| [Billing](../features/billing/implementation.md), [usage](../features/billing/usage.md) | Reasoning-inclusive usage, larger reservations versus actual charges, BYOK/provider cost separation, incomplete versus unknown usage. |
| [Status](../status/README.md), [maintainer TODO](../maintainers/TODO.md) | Mark implementation/verification independently; close only passed NOB gates. Preserve separate direct-inference 16,384-token work. |
| Published assets and runtime image | Run existing docs/SDK generators; build/publish one matching runtime revision under normal release authorization. Drain old native writers; do not run mixed required-runtime-config versions. |

## Decisions, tradeoffs and open items

**Adopted decisions:**

- **One native output allowance, not one arbitrary universal ceiling.** Catalog maximum and admitted allowance are different facts with one owner each. Keep 32,768 / 65,536 defaults in one resolver; allow explicit model-supported overrides.
- **Unconditional output-limit failure for native calls.** This includes auxiliary/compaction calls and can fail a Run that a harness might otherwise repair. It prevents incomplete answers/truncated tools and unrequested extra paid work. Ordinary model errors still honor `stop_on_model_error`.
- **Reuse existing failure fence and result JSON.** No new table, completion framework, independent controller or migration is warranted. The first specific cause must survive all publication paths.
- **Drain accounting, do not retry inference.** A length finish is a semantic failure, not proof that usage is unavailable or execution never occurred. Preserve original wire evidence and exact usage.
- **Raise allowance without raising money/time.** Increased reservations can expose low budgets earlier; make that explicit instead of silently weakening any accepted bound.
- **Invalidate warm configuration when limits change.** One cold resume is preferable to silently applying the wrong accepted model configuration. Same-configuration warm requests remain fast.
- **Use existing/disposable verification.** No new maintained tests are requested. This is a deliberate verification constraint, not a claim that regression coverage is unnecessary.

**Implementation qualifications and disposition:**

The [verification record](native-output-budget-verification.md) gives the actual checks, artifact identity and limits of each result. All four implementation qualifications were exercised locally. Deployed acceptance and clean release building remain separate gates:

1. **Catalog passed.** The real public listing traversed the production normalizer, ordinary cache refresh and enabled selection; Muse retained context 1,048,576 and output 943,718. Direct-provider reviewed capabilities and metadata merging passed existing/disposable checks. No per-Run metadata request was added.
2. **Pinned adapters passed.** All six actual native binaries sent the accepted 65,536 bound after gateway preparation. Codex omits its native output field and the gateway supplies the accepted value; no invented Codex option was added. Claude's supported environment mapping and OpenCode's derived override were verified on actual requests. Synthetic limit failures retain the specific cause, partial answer and verified native Session identity; one real Muse `xhigh` request additionally succeeded through OpenCode.
3. **Fault boundary qualified.** Lost fence acknowledgments, settlement failure and repeated reconciliation preserve one settlement and first cause. Strict mode blocks another unsettled request. A synthetic second request was admitted when the fence write was unavailable and strict mode was false. That preserved concurrency limitation is explicit; there is no claim that already dispatched work can be recalled or that a process-local cache could enforce cross-process authority.
4. **Byte bounds passed.** The existing supervisor now enforces the 4 MiB JSONL bound in a raw-byte Transform before readline buffering. Both newline-terminated oversized records and an unterminated 5 MiB record fail explicitly with `native_result_too_large`; a 2 MiB complete result succeeds. The answer observer retains a Unicode-safe bounded prefix and adds no successful-call database write. Token allowances remain distinct from byte/deadline bounds.

The follow-up review additionally qualified complete tool arguments followed by length: incomplete executable frames are withheld in the shared gate, with unchanged successful wire bytes and no new query. It also repaired byte-limit callback initialization before warm resume. Integration review normalizes equal output-token aliases to each protocol's sole field and extends the same withholding to legacy Chat `function_call` frames. All-six post-fence rejection and deliberate continuation passed again on the V2 selected-loader/profiling image, alongside one additional live Muse `xhigh` success; see the verification record for exact artifacts and first-observed-failure/concurrency scope. The no-new-maintained-output-tests restriction remains in force.

No additional product decision was required. The native defaults and conservative failure policy were adopted. The verification record distinguishes local implementation qualification from the live-provider and hosted rollout gates. Non-strict database-outage concurrency is an explicit existing limitation, not a zero-extra-work guarantee.

## Research references

- [OpenRouter Muse endpoint metadata](https://openrouter.ai/api/v1/models/meta/muse-spark-1.3-contributor/endpoints): actual public metadata response inspected, without inference or credentials.
- [Meta reasoning](https://dev.meta.ai/docs/reasoning), [Meta models](https://dev.meta.ai/docs/models), [OpenRouter reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens): effort support and reasoning-inclusive output.
- [OpenAI GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini): exact selected-model input/context/output limits; [Codex config reference](https://developers.openai.com/codex/config-reference): supported keys must be verified, not guessed.
- [Claude Sonnet 4.6](https://platform.claude.com/docs/en/models/sonnet-4-6/overview), [Claude Haiku 4.5](https://platform.claude.com/docs/en/models/haiku-4-5/overview), [Claude environment variables](https://code.claude.com/docs/en/env-vars): first-party capabilities and supported native override.
- [Native turn reliability](native-turn-reliability.md), [execution efficiency](execution-efficiency-tech-design.md), [native controls](native-run-controls.md): preserve current async OpenCode lifecycle, actual usage/cost separation, small immutable hot-path data and durable stop/accounting boundaries. This fix does not reopen unrelated queue/pool work.
