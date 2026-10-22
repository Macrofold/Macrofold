# Model deployment design handoff

| Status | Current progress | Last updated |
| --- | --- | --- |
| In progress | The paired design and shared contract are prepared; implementation and live qualification remain unstarted. | 2026-10-22 |

This is the reusable **design-only** brief for a Macrofold agent. It points to the completed design work rather than asking another agent to reconstruct the conversation. [Feature specification](hugging-face-model-deployments-feature-spec.md) · [Technical design](hugging-face-model-deployments-tech-design.md) · [Shared contract](hugging-face-model-deployments-contract.md) · [Research](hugging-face-model-deployments-research.md) · [Maintainer work](../maintainers/TODO.md).

## Copyable brief

```text
Work in Macrofold/Macrofold on design/huggingface-model-deployments-2026-10-22.
This assignment is DESIGN ONLY. Do not implement code, deploy GPUs, run paid
model calls, change production/default models, or merge the branch.

Read this branch's complete root AGENTS.md and its applicable design, AI,
documentation and startup rules. Apply Macrofold instructions here. When
reading or editing Macrofold/OpenLegend, read and apply that repository's
AGENTS.md separately; do not transfer project-specific policy between them.
Inspect current branch/base and preserve any other contributor's changes.

Read the existing design family:
- docs/projects/hugging-face-model-deployments-feature-spec.md
- docs/projects/hugging-face-model-deployments-tech-design.md
- docs/projects/hugging-face-model-deployments-contract.md
- docs/projects/hugging-face-model-deployments-research.md
- the matching model-deployment section of docs/maintainers/TODO.md

Read OpenLegend's matching branch and:
- docs/projects/model-experiments-feature-spec.md
- docs/projects/model-experiments-tech-design.md
- docs/maintainers/model-experiments.md
- docs/limits/model-experiments.md

The goal is to inspect a Hugging Face model link, pin its actual artifacts,
explain supported runtime/hardware choices and cost, explicitly authorize a
finite hosting session, then let OpenLegend experiment through Macrofold's
existing POST /v1/inferences. Macrofold owns source/runtime/hosting identity,
credentials, capability qualification, GPU lifecycle and infrastructure cost.
OpenLegend owns NPC purpose selection, permitted context, schema decoding,
current-world authority and experiment/model-adoption decisions.

Preserve the exact shared binding:
model_binding = {deployment_id, deployment_revision_id, activation_id}.
Use the native request and receipt contracts already specified. Do not invent
a RunPod provider model in the OpenRouter catalog, widen Jev scoring to generic
chat, apply native-agent context floors to small inference models, add a
parallel inference/receipt system, or silently replace a selected model.

RunPod Serverless load balancing through REST v2 with the pinned vLLM wrapper
is the first designed managed route. Qualified imported OpenAI-chat endpoints
cover alternative/local runtimes, with honest identity and external-cost limits.
Every Hugging Face repository may be inspected; unsupported architectures,
weights, terms, templates or hardware must produce a specific reason.

Review concrete lifecycle failures: ambiguous provisioning, expired/revoked
grants, missing capacity, tokenizer/schema mismatch, failed/late output,
cancelled requests, provider outage, uncertain teardown and delayed billing.
Keep one qualified process per activation, reject a different boot before
generation, and require a fresh activation after identity drift.
A zero request fee is not free GPU time. A client timeout is
not proof that execution or charges stopped. Keep cleanup authority and
financial uncertainty until actual reconciliation.

Use current official provider/runtime documentation to resolve any concrete
remaining API uncertainty. Distinguish design decisions from facts established
by live qualification. Reuse and improve the existing documents in place;
do not create duplicate schemas, revision diaries or a second task backlog.
Do not broaden the initial scope into fine-tuning, a marketplace, general GPU
scheduling, production model adoption or a new NPC cognition architecture.

If you find an in-scope design defect, fix all affected contract/consumer
documents together and update the existing maintainer tasks. Close only
completed design criteria; leave implementation and model-quality evidence
unchecked. Verify links, examples, field/error/money agreement and required
documentation gates, commit to the design branch, and report consequential
decisions, verified limits and any genuinely unresolved decisions.
```

## Coordinated implementation boundary

A later explicit implementation request starts with the existing staged delivery and current repository instructions. Macrofold's tested API/runtime/client release precedes OpenLegend's pinned client integration. The two branch names do not establish compatibility by themselves: record the actual tested server, client and runtime revisions. The design-only brief above is not authorization to execute that later work.
