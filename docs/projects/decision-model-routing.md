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

No public schema, database migration or runtime-image change is needed. Existing SDKs accept the exact model string. A successful local live check establishes that route/account at that time, not hosted enablement or model accuracy/calibration for a customer's workload.

Sources: [Microsoft announcement](https://commandline.microsoft.com/microsoft-decision-1-model-foundry/), [OpenRouter model](https://openrouter.ai/microsoft/microsoft-decision-1), [OpenRouter Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request). Rates and endpoint metadata checked October 15, 2026.
