# Native Run controls

Status: implemented and locally verified. Owners: public contracts, permission adapters, model gateway and native Run finalization.

## Contract and decisions

- Add optional `permissions.questions: allow | deny` to the existing intersected workspace/worktree/Run policy. Omission inherits allowance; any denial wins. Remove supported native question tools from discovery and reject unexpected input requests at the runtime/control-plane boundary. Codex retains its schema but its native Default-mode execution flag and Macrofold RPC guard reject questions; verify attempted execution instead of claiming discovery removal. This grants no connector or filesystem access and does not manufacture a question capability for a harness without one.
- Add optional `limits.stop_on_model_error` (default false) to native Run/session/preset limits. On an upstream rejection, transport failure, protocol error or interrupted stream, persist the first failed request identity before returning the failure. All later model admissions for that Run reject, including after reconnect or process recovery. Already admitted requests may have incurred usage; retain their accounting. This is not a retry of the prompt or a rollback of effects.
- Cancel the failed native execution through the existing supervisor/persistence path and finalize as `failed` with `model_request_failed`. Preserve verified checkpoints and known/provisional usage. A provider error is not a customer cancellation. Independent new Runs have independent limits.
- Separate stream completion from usage completeness: preserve reported usage even when delivery fails; missing usage remains uncertain. No model billing or tracing changes per delta.

## Implementation and verification

1. Preserve unrelated capacity edits; extend OpenAPI and canonical permission validation, then regenerate all five clients.
2. Map question policy into actual native adapters, retain warm-handle permission fencing and enforce unexpected-question denial server-side.
3. Add a nullable first-failure identity to Runs. Fence model admission under the existing Run lock; record failure independently of settlement so settlement recovery cannot reopen spending. Use existing finalization and orphan settlement.
4. Verify actual workspace/Run HTTP acceptance, permission inheritance and native model-facing tool visibility. Inject rejected responses, protocol failures and premature stream EOF, then attempt further requests and reconnects; assert no further upstream dispatch, durable failure, preserved billing and terminal publication.
5. Run focused domain/native fixtures, TypeScript checks, all-client verification and docs checks. Update public permission/limit examples, internal ownership and maintainer tracking. Record local/hosted verification boundaries.

Migration is additive and has no data rewrite. Deploy compatible API/poller and runtime image together; old native images do not implement question denial. Preserve the active local preview and restart only idle owned processes.

## Verification and activation

- Focused domain checks cover HTTP workspace/Run admission, inherited denial, provider rejection, server/transport errors, error envelopes, interrupted streams with known/unknown usage, reconnect generations, already-admitted concurrent calls, orphan reconciliation, and terminal failure with verified checkpoints. A failure arriving during a question probe cannot publish stale input. Protocol checks cover OpenAI Responses, Anthropic Messages and OpenRouter chat completion markers.
- All six pinned native harnesses pass Docker checks with external networking disabled for denied questions with restricted and unrestricted files. Codex receives an attempted native question and rejects it; other question-capable harnesses omit denied schemas. OpenCode also passes structured question/answer delivery, saved-state restore and continuation with scripted model responses.
- All five regenerated SDKs pass shared verification. TypeScript build/check and documentation validation pass. Tests establish protocol/accounting behavior, not model quality or provider invoice amounts.
- Migration 052 and the complete verified image are active in the local Docker deployment. The idle API and poller were restarted. Actual localhost HTTP admission accepts `questions: allow`, `questions: deny`, and `stop_on_model_error: true`; synthetic Runs were cancelled before execution and fixture workspaces removed. Private activation evidence is under `.data/native-controls/`, without credentials.

No paid inference, full OpenLegend journey or hosted-provider deployment was performed. The next caller qualification should use a fresh session because existing sessions retain frozen permissions.
