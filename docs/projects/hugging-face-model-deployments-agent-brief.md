# Model deployment implementation and release brief

| Status      | Current progress                                                                                                          | Last updated |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | ------------ |
| In progress | Macrofold implementation is present; complete release verification and separately authorized live-provider qualification. | 2026-10-22   |

This reusable implementation brief follows the approved production design. The implementation instruction supersedes the historical design-only restriction. [Feature specification](hugging-face-model-deployments-feature-spec.md) · [Technical design](hugging-face-model-deployments-tech-design.md) · [Shared contract](hugging-face-model-deployments-contract.md) · [Research](hugging-face-model-deployments-research.md) · [Maintainer work](../maintainers/TODO.md#hugging-face-model-deployments) · [Setup and calls](../features/execution/model-deployments.md).

## Copyable brief

```text
Continue Macrofold/Macrofold on feat/production-model-deployments. This is an
IMPLEMENTATION and release-verification assignment under the approved design,
not the historical design-only task. Read complete root/scoped instructions,
mandatory baseline, project owners and current MD02–MD07 acceptance evidence.
Preserve other contributors' work and the running preview. Use the GitHub
connector for Git changes and progress commits at least every five minutes
while changes remain uncommitted. Do not merge or commit to main, force-push,
publish packages or change production defaults without applicable authority.

Macrofold implements model source inspection, immutable revisions, explicit
owner/connection delegation and application grants, RunPod service control,
direct inference, a protected vLLM runtime and API/CLI/dashboard controls.
Trace existing source and actual checks before changing or repeating work.
Complete independent server-owned acceptance even when a live account or the
subsequent OpenLegend consumer is unavailable. Keep every such gap precise.

The product is a persistent production model service, usable by OpenLegend
and other applications. The owner inspects a model, selects compatible
capacity and hourly limits, starts hosting, grants application access and
copies a deployment ID. Experiments are optional. Macrofold owns hosting,
credentials, health and infrastructure costs; OpenLegend owns character
context, schema/world validation and game effects.

Use model_binding = {deployment_id, deployment_revision_id?} through existing
POST /v1/inferences. Look up idempotency before resolving today's serving
revision. Preserve the accepted revision and Run across service changes.
Native text/JSON/tools/SSE follow advertised capabilities and existing
cancellation, accounting and recovery. DecisionBinding and bounded-agent
protocols remain separate. Never silently change models, downgrade strict
output, repair/refusal-retry or replay an ambiguously dispatched prompt.

RunPod Serverless Load Balancer REST v2 and pinned vLLM are the first managed
path. Provider scaling and engine batching own scheduling. Persistent
running/stopped intent, warm min/max capacity, request concurrency and an
hourly ceiling authorize normal recovery. Optional stop_at supports temporary
use. Inference cannot start stopped capacity or raise that authorization.
Compatible external OpenAI-chat servers remain usable on owner trust without
our wrapper; stopping Macrofold access cannot stop or cap external hosting.

Recheck current grants and the accepted owner's connection delegation at
execution/publication. Same-connection secret rotation and ordinary worker
replacement preserve valid answers; actual revoked authority does not.
Cleanup retains exact owned resource/attempt identities and narrowly scoped
credentials. A lost create acknowledgment never permits a blind new create.

Keep HF metadata, pricing, worker inventory and lifecycle reconciliation off
the ordinary inference path. Freeze only compact accepted target/configuration.
Deployment request fees start at zero; infrastructure costs remain distinct
per resource/period and unknown costs stay null. Do not create a second ledger,
custom GPU scheduler, finite experiment activation, boot certificate, manual
session renewal or invoice-attestation system.

Use existing explicit account/spending authorization for live tests and remove
billable fixtures. Credentials alone do not authorize execution. Registry
publication, actual GPU loading, RunPod bearer/custom-header routing,
streaming/cancellation/replacement and confirmed cleanup/costs need their own
live evidence. CPU fixtures and metadata inspection do not establish them.
OpenLegend's joint real-game acceptance awaits its subsequent consumer build;
keep independent Macrofold API/client/UI/CLI/runtime checks progressing.

Review the complete affected diff, fix concrete in-scope defects, regenerate
all five clients and documentation, and run applicable testing/image/security
gates. Keep actual commands/results and server/client/runtime identities in
the technical design, unfinished work in MD02–MD07, and usage in the feature
guide. Do not add parallel verification documents or revision diaries.
```

## Coordinated release boundary

The Macrofold API, migration and generated clients ship together. Managed hosting requires the built wrapper's own published immutable digest and qualified provider/GPU behavior; the upstream vLLM digest alone is insufficient. OpenLegend then configures the stable deployment through its normal provider path and verifies its actual serializer, decoder, privacy and current-world checks. Optional comparisons do not block the provider feature. Missing live access or spending authority blocks the affected check, not independent implementation or verification.
