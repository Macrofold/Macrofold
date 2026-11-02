# Native output allowance and incomplete completions

Status: implemented and locally requalified on the integrated branch; see [current V2 evidence](native-output-budget-verification.md#integrated-branch-qualification) and the retained original checks for actual qualification and release limits. Read the paired [technical design](native-output-budget-tech-design.md) for exact owners, contracts, implementation order and verification. Current behavior remains documented in [models](../features/execution/models.md), [native execution](../features/execution/runtime.md) and [streaming](../features/api/streaming.md). Implementation is tracked as [NOB work](../maintainers/TODO.md#native-output-allowance-and-incomplete-completions).

## Problem and evidence

The caller supplied this verified reproduction; this design session inspected the source rather than repeating the paid Run or independently downloading its private database:

| Fact | Recorded value |
| --- | --- |
| Run | `01a19336-99ac-7317-96d0-43e42b13a798` |
| Selected model | `meta/muse-spark-1.3-contributor` |
| Requested reasoning | `xhigh` |
| Public result | Run succeeded; `output_text` was only `I heard` |
| Final OpenCode message | `msg_19336f111001uTMJmFrP8BQyZf`, `finish: length` |
| Reasoning usage | 8,180 tokens |
| Other OpenCode output usage | 207 tokens |
| Gateway output usage | 8,387 tokens total |
| Caller behavior | OpenLegend rejected the incomplete response and published nothing |

At the inspected baseline, two Macrofold owners independently imposed 8,192 output tokens: OpenCode model configuration and native gateway admission. Reasoning shares the output allowance; a short visible answer does not mean the request needed few output tokens. The baseline also missed the final `length` finish. These are separate defects: increasing an allowance reduces truncation, while completion classification must remain correct at every allowance.

The usage total exceeds the nominal allowance by 195. Preserve that observation without inventing an explanation, reducing reported usage to 8,192, or adding the reasoning count a second time. Explicit `finish: length` establishes incompleteness independently of that discrepancy.

The pinned OpenCode release has an additional 32,000-token default. Pi also accepted a `length` stop as success. Fixing only the two reported constants is therefore insufficient. The [adapter audit](native-output-budget-tech-design.md#native-adapter-changes) covers all six native harnesses.

## Goals and boundaries

1. Give an admitted native Run one bounded, model-aware output allowance, including reasoning, text and tool-call output. Carry it through the catalog, Run, gateway and native adapters.
2. Treat an explicit output-limit completion as execution failure, never a successful final answer. Preserve streamed partial text, actual usage, accounting and verified persistence.
3. Keep the selected model, requested effort, credentials, spending cap and deadlines intact. Do not continue, retry, change models or lower reasoning automatically to repair truncation.
4. Make configuration and failure behavior consistent across REST, all five SDKs, CLI, dashboard, customer MCP and documentation.
5. Verify enough-output success and forced output-limit failure using existing checks and disposable scenarios. Add no new maintained tests.

This does not redesign immediate inference, decision scoring, provider routing, scheduling, context compaction, tracing storage or billing. Direct inference keeps its existing `InferenceLimits.max_output_tokens` contract and limits. No partial-JSON parser, fallback model, completion-repair service, compatibility adapter or new runtime package is introduced.

## Caller journeys

### Normal native request

An authorized caller selects a native harness/model and submits a prompt as today. With no output override, admission chooses the [documented default](native-output-budget-tech-design.md#allowance-policy), limited by the selected model. `xhigh` Muse receives a 65,536-token allowance, rather than 8,192. That is a maximum per model call, not a target to consume and not a promise that every difficult request will finish.

The admitted Run exposes its resolved `limits.max_output_tokens`. Streaming deltas remain tentative until the final Run result establishes execution success and acceptable persistence. A normal complete final response follows the existing successful Run/result/event contract.

### Advanced output control

An application may set `limits.max_output_tokens` on native Session creation, an agent preset or Run creation. This shares the existing limits object; it is not another environment variable or provider-specific reasoning budget. An explicit value must be a positive safe integer and must fit the model's published output ceiling. An invalid or excessive caller value is refused before native execution.

Session continuations inherit the Session's saved allowance unless the Run explicitly overrides it. A Run override affects that Run only. The dashboard and CLI preserve saved spending/time defaults when only output room is changed. Changing the selected model still requires revalidating the inherited allowance; a lower-capacity model produces an actionable admission error rather than silently changing an explicit/inherited limit. Reasoning parameters retain their existing Session immutability.

The dashboard puts this control under advanced Run/preset options, labels it **Maximum output tokens per model call**, and explains that reasoning counts toward it. Automatic defaults remain the easy path. The effective value is visible in Run details and the published model maximum in advanced configuration; users do not need to learn OpenCode environment variables.

### Output limit reached

Any native model response explicitly ended by its output limit stops the Run, including a truncated tool-call or internal summarization response. The conservative rule is intentional: Macrofold does not let a harness silently repair the response through another paid call or execute truncated tool arguments.

The Run fails with `model_output_limit_exceeded`. Its final result retains available partial `output_text`, the same failure code, actual usage and the independently determined persistence/checkpoint result. A verified checkpoint is valid saved state, not proof of a complete answer. Tool-call frames from that incomplete model response are not released to the harness. Earlier completed, authorized actions remain committed; this is not a Run-wide transaction or rollback of the integrating application's world state. A caller must not publish partial text as the final answer.

The dashboard shows **Output limit reached** and explains that the response is incomplete. Recovery guidance is to inspect the result and usage, then deliberately submit another Run with more output room or a simpler request; changing reasoning effort requires a new Session. Such a submission is a caller decision with a new request identity, not an SDK retry. An explicitly chosen `xhigh` request is never silently reduced.

### Insufficient spending or time

A larger token allowance does not raise `max_cost_micro_usd`, extend `timeout_seconds`, alter provider timeouts or reserve unlimited credits. If the next model call cannot reserve its accepted bound within the remaining Run budget, the existing budget refusal applies before dispatch. A deadline still stops execution normally. Docs explain that an allowance is a ceiling, while reservations and actual charges are separate quantities.

### Broken stream or missing usage

A complete transport with an explicit output-limit finish is semantically incomplete even when its token usage is fully known. A broken transport can have uncertain usage and is handled through existing provisional accounting. The implementation must not discard a trailing usage frame merely because an earlier frame already announced `length`.

An earlier output-limit observation cannot be undone by a later harness `completed` status, a successful checkpoint, an accounting retry or process recovery. Ordinary provider failure behavior remains controlled by `stop_on_model_error`; output-limit failure is unconditional for native Runs. Already dispatched concurrent calls cannot be recalled or made free, and their usage must still settle.

## Public behavior to specify together

| Surface | Required behavior |
| --- | --- |
| Model catalog | Publish reliable model context/output capabilities from the existing catalog owner; do not advertise guessed limits as publisher facts. |
| Native `Limits` | Optional `max_output_tokens`; model-validated on admission and returned resolved on the Run. |
| `Run` / `RunResult` | Native terminal failure remains an ordinary final result with `execution_outcome: failure` and `failure_code: model_output_limit_exceeded`. Declare the result's already-emitted failure-code field in OpenAPI. |
| Run event stream | Partial text may precede `run.failed`; no `run.succeeded` after explicit truncation. Existing final result is authoritative. |
| SDK helpers | Waiting/collecting throws the existing Run-failure exception; raw result retrieval preserves partial text and checkpoint details. No repair retry. |
| CLI | Structured limits input and an intuitive output-token option; failed Run exit status, useful bounded diagnostic and retained result. |
| Customer MCP | Same generated request/result schema and behavior; management MCP stays read-only. |
| Dashboard | Advanced control, effective limit, incomplete-response failure presentation and retained usage/checkpoint information. |

## Acceptance criteria

Passed locally with the scope and limitations in the [verification record](native-output-budget-verification.md). Controlled large-token finishes use synthetic provider usage; the separate actual Muse `xhigh` checks verify the real route, allowance and forced-limit behavior, not a representative game workload or a hosted deployment.

- [x] One admission resolver owns the native allowance. No remaining independent 8,192 output ceiling or hidden OpenCode 32,000 ceiling limits the selected allowance.
- [x] Muse Contributor `xhigh` remains exactly `xhigh`, uses the admitted allowance on the actual outgoing provider request, and can finish a controlled response requiring more than 8,192 total output tokens.
- [x] Every native harness either propagates a directly observed output-limit finish or is protected by the shared gateway failure fence; a harness success signal cannot erase the failure.
- [x] Forced output-limit completion, with partial text or no visible text, fails even with `stop_on_model_error` omitted/false. Ordinary failures retain that flag's existing semantics.
- [x] Known usage remains exact and is settled once. BYOK Macrofold charges remain zero; provider cost/usage stay separately visible. Unknown usage stays explicitly provisional.
- [x] Native checkpoints and resume identity survive normal failure finalization when capture succeeds. No warm resident is reused after failed execution.
- [x] Remaining budget, deadlines, current authority, credential binding, generation checks and concurrency fences are not bypassed.
- [x] REST, SDKs, CLI, customer MCP, dashboard and published/internal docs agree. Direct inference and chat-model hosting behavior are preserved.
- [x] The verification record distinguishes source inspection, offline fixture evidence and real-provider results. No new maintained tests are added.

## Delivery and decisions

The [technical implementation sequence](native-output-budget-tech-design.md#implementation-sequence) organizes the work; the allowance and correctness fix ship together. Implementation is authorized by the subsequent chat instruction; deployment and restarting the preview are not part of this work.

The adopted defaults and unconditional native output-limit failure have their tradeoffs recorded in the [decision register](native-output-budget-tech-design.md#decisions-tradeoffs-and-open-items). Pinned binaries, current model metadata and the local real-provider Muse path are qualified as recorded; clean final-image release building and deployed acceptance remain separate gates. The historical Run is evidence of a bug, not a Run to re-execute automatically.

The original dirty implementation is preserved and reconciled onto main `0101368a` in `codex/native-runtime-memory-packs`. The integrated V2 all-six API matrix and one additional bounded live Muse `xhigh` success pass. No new maintained output tests were added. Clean AMD64 build/audit and coordinated hosted acceptance remain open; the preview is unchanged.
