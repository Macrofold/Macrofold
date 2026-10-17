# OpenRouter decision-model routing

Status: implemented; 84 focused protocol/API tests and two real managed/BYOK requests pass locally. Current behavior belongs to the [decision guide](../features/decisions/README.md) and [implementation](../features/decisions/implementation.md); [verification](../features/decisions/verification.md#openrouter-decision-1-acceptance) records scope and release gaps.

## Scope and decisions

Support `microsoft/microsoft-decision-1` through the existing OpenRouter Decisions endpoint, managed credentials or exact OpenRouter BYOK. Native input retains all named `noul`, `choice` and `score` questions and complete response metadata. Optional typed definitions retain choice/score validation. Streaming, arbitrary generation and bounded agents remain unsupported by this scoring protocol and fail before dispatch.

Keep a small reviewed decision-only registry in `decision-models.ts`. Its exact provider/model identities and rates select eligibility, provider protocol, metadata refresh, input reservation and parameter validation. This replaces scattered Jev comparisons; it does not create a new provider framework or admit arbitrary discovered scoring models. Native harness eligibility stays separate.

Microsoft/OpenRouter currently publish $0.042 per million input tokens and zero output charge. Freeze those reviewed terms through the existing reservation/settlement path and apply OpenRouter price ceilings with fallback disabled. Preserve actual usage and reported provider cost; BYOK has zero Macrofold model charge. Provider-specific context windows remain enforced by the provider.

## Implementation and verification

1. Add the reviewed route and share its classification across admission/preparation, transport, input bounds and chat-only model parameters.
2. Extend existing protocol and API/SQL fixtures for model selection, native multi-question preservation, typed answers, managed/BYOK accounting, missing usage, rejected streaming and unsupported kinds. Preserve existing Jev and generative behavior.
3. Extend the opt-in decision acceptance fixture to select only the two reviewed OpenRouter routes. Bound its two synthetic managed/BYOK calls to $0.002 each, use disposable local data and preserve serving processes.
4. Update public usage, model policy explanations and maintainer verification. Run affected tests, TypeScript/SDK build and documentation checks, then review the full diff.

No public schema, database migration or runtime-image change is needed for the implemented routing. Existing SDKs accept the exact model string. A successful local live check establishes that route/account at that time, not hosted enablement or model accuracy/calibration for a customer's workload.

## Future capability discovery

Deferred caller-experience improvement, tracked in [provider-native follow-up](../maintainers/TODO.md#provider-native-inference-follow-up): expose the reviewed decision-only registry through the existing model catalogue so applications and coding agents can discover exact routes and capabilities without hardcoding documentation examples. This is separate from the [immediate-inference refactor](immediate-inference-feature-spec.md), not a prerequisite or a claim of current discovery support.

- Reuse the catalogue's existing provider/model identity and capability shape; do not create a parallel discovery endpoint or automatically admit arbitrary provider-discovered scoring models.
- Advertise the implemented modes explicitly: native scoring input with named `noul`/`choice`/`score`, optional typed choice/score, streaming false, bounded-agent false, native-harness false. Do not confuse native **provider input** with native **harness execution**.
- Keep supported capability separate from enabled/deployment availability and the caller's funding/credential entitlement. Discovery never grants spending authority, reveals connection details, or guarantees a key has upstream access. Admission remains authoritative.
- Share registry classification with validation and routing; one model entry must not acquire conflicting eligibility depending on API/SDK/UI. Existing general-model discovery consumers must filter for their requested execution mode before offering a scoring model as a chat/harness choice.
- When implemented, update OpenAPI/generated clients, catalogue filtering/examples and public decision guidance together; verify scoring routes are discoverable yet still rejected for unsupported modes, while ordinary model listings retain their intended scope. Choose any additive capability fields in that feature's design rather than prebuilding them here.

Sources: [Microsoft announcement](https://commandline.microsoft.com/microsoft-decision-1-model-foundry/), [OpenRouter model](https://openrouter.ai/microsoft/microsoft-decision-1), [OpenRouter Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request). Rates and endpoint metadata checked October 15, 2026.
