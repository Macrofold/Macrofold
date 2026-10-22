# Model deployment design handoff

| Status | Current progress | Last updated |
| --- | --- | --- |
| In progress | Production serving and the shared contract are designed; implementation and live acceptance remain open. | 2026-10-22 |

This reusable **design-only** brief points to the current requirements. [Feature specification](hugging-face-model-deployments-feature-spec.md) · [Technical design](hugging-face-model-deployments-tech-design.md) · [Shared contract](hugging-face-model-deployments-contract.md) · [Research](hugging-face-model-deployments-research.md) · [Maintainer work](../maintainers/TODO.md).

## Copyable brief

```text
Work in Macrofold/Macrofold on design/huggingface-model-deployments-2026-10-22.
This assignment is DESIGN ONLY. Do not implement code, deploy GPUs, run paid
model calls, change production/default models, or merge the branch.

Read this branch's complete root AGENTS.md and applicable design, AI,
documentation and startup rules. Apply OpenLegend's own AGENTS.md when working
there. Inspect current branch/base and preserve other contributors' work.

Read the existing hugging-face-model-deployments feature spec, technical
design, shared contract, research and agent brief under docs/projects/, and
the corresponding section of docs/maintainers/TODO.md. Follow the linked
OpenLegend production model-provider design and tracker.

The primary goal is production model serving for OpenLegend and other apps.
A user should select a Hugging Face model, choose compatible infrastructure
and operating limits, start a reusable deployment, and use it as an ordinary
provider through POST /v1/inferences. Experiments are optional consumers.
Prioritize working functionality, request performance and extensibility.

Macrofold owns HF source resolution, runtime/hosting, credentials, service
health, capacity and provider costs. OpenLegend owns permitted character
context, task/schema validation and current-world authority. Do not put
hosting or experimental policy into the game domain or authored world rules.

Use model_binding = {deployment_id, deployment_revision_id?}. Production
normally selects deployment_id and follows its currently serving revision.
Optional pins serve deliberate rollout control or reproducible comparisons.
Every accepted Run records its resolved immutable revision; a later process
restart or service update does not invalidate an otherwise valid answer.

Use a persistent desired running/stopped service and explicit operating
policy, not finite experimental activations. Same-revision worker recovery
and supported provider autoscaling operate within that authorization. Default
to one warm replica, with explicit supported min/max and hourly cost limits;
optional stop_at supports temporary use. Do not build a custom GPU scheduler,
mandatory quote/certificate protocol or invoice-attestation subsystem.

RunPod Serverless Load Balancer REST v2 plus pinned vLLM is the first managed
adapter. Reuse native engine context/schema handling and batching. Add only
necessary authentication/route protection around it. Imported compatible
OpenAI-chat endpoints are also eligible for production on operator trust;
no custom provenance wrapper is a prerequisite. Preserve honest limitations.

Reuse current inference, authorization, Run/idempotency, cancellation,
streaming, accounting and recovery owners. Keep current grants effective;
keep secrets out of callers. Never retry an ambiguous dispatched prompt or
silently select another model. Preserve durable ambiguous-create recovery
and cleanup, since those prevent real duplicate hosting charges.

The normal request path must not fetch HF metadata, GPU prices, worker lists
or experimental evidence. Resolve the active revision atomically, reuse
immutable preparation and enforce necessary current permissions/capacity.
A zero request fee is not zero hosting expense; report provider costs once
per resource/period, with honest uncertainty and no invented token price.

Review real production use, outage/recovery, concurrent calls, schema failures,
streaming, credential rotation, model upgrades/rollback and resource teardown.
Keep optional experiments separate and lean. Use current official sources for
concrete provider uncertainties; distinguish documented behavior from live
verification. Reconcile existing docs/tasks without duplicate contracts or
revision diaries. Do not implement a new NPC cognition architecture.

Fix in-scope design defects across both repositories, preserve completed
versus unverified tracker status, verify links/examples/interfaces, commit to
the design branch, and report actual evidence and material remaining gaps.
```

## Coordinated implementation boundary

A later explicit implementation request follows the production delivery stages and current repository instructions. Macrofold's API/runtime/client release precedes OpenLegend's consumer integration. Record the actual tested server, client and runtime revisions; branch names do not establish compatibility. Optional benchmark work is independent of production feature completion. This brief does not authorize deployment or paid execution.
