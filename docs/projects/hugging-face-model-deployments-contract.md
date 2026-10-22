# Custom model deployment contract

| Status | Current progress | Last updated |
| --- | --- | --- |
| In progress | The production serving contract is designed; API, hosting, clients and live acceptance remain unimplemented. | 2026-10-22 |

This is the canonical **proposed** API contract for [model deployments](hugging-face-model-deployments-feature-spec.md). The [technical design](hugging-face-model-deployments-tech-design.md) owns implementation and hosting; the [research](hugging-face-model-deployments-research.md) owns vendor evidence. [OpenLegend's consumer design](https://github.com/Macrofold/OpenLegend/blob/design/huggingface-model-deployments-2026-10-22/docs/projects/custom-models-tech-design.md) uses this production capability and may also use it for optional comparisons.

Reviewed implementation bases: Macrofold `07ba0ee1bb5c76aeb4d0d3553339dc274854335a`, OpenLegend `27c6fb8152ec58c34334e74ba91a9d5bec6a30ff`. Implement [OpenAPI](../api/openapi.json), server validation and generated clients together. These proposals have no deployed compatibility requirement.

## 1. Ownership and identity

A deployment is a persistent organization-owned model service. The owner selects its model and serving configuration, grants application access, and starts it under a standing hosting policy. It remains available until stopped, its optional stop time arrives, or an operational limit prevents service. Healthy replacement workers continue the same service automatically.

| Identity | Meaning | Changes when |
| --- | --- | --- |
| `deployment_id` | Stable configured service used by applications | A separate service is created |
| `deployment_revision_id` | Immutable model source and behavior-relevant serving recipe | Weights, tokenizer, template, quantization, runtime image/settings or external model target change |

Both are UUIDs. Revisions record the full Hugging Face commit and pinned runtime image independently. Credential rotation within the same authorized connection, worker/process restarts, equivalent allowed hardware replacement, capacity changes and operational spending policy do not create a model revision. Changing a provider account or connection still requires its owner's authorization; changing an external endpoint/model reference creates a revision.

Ordinary callers select `deployment_id`. They may supply `deployment_revision_id` when they intentionally require that exact version. Macrofold resolves and saves the actual revision once during Run admission. An accepted request retains that revision even if the service is subsequently updated. Boot IDs and hardware observations are diagnostics, never caller approval tokens or reasons to discard an otherwise valid answer.

Initial managed hosting is customer-funded RunPod Serverless Load Balancer with a pinned vLLM recipe. Imported OpenAI-compatible endpoints are also production targets under their owner's declared capabilities and hosting responsibility. Model servers remain separate from native-agent Workers, Worktrees and HostRuns. OpenLegend owns character context, fictional rules, output validation and application effects.

## 2. Authorization

Add `model-deployments:read`, `model-deployments:use` and `model-deployments:write` through existing scope handling. Use permits inference, not provider administration or starting capacity. Inference retains existing `runs:write` admission and `runs:read` retrieval controls. Management MCP remains read-only.

The first release uses one owner for the deployment and every selected private HF, compute and endpoint connection, checked against existing `owner_subject_id`. Public HF sources need no connection. An owner-authorized configuration operation creates the narrow connection-to-deployment delegation server-side; an organization admin cannot implicitly spend another member's credentials. Cross-owner composition is outside this delivery.

A game backend receives deployment read/use and its normal Run rights. It receives no upstream credentials. Source registration, credential entry/rotation and secret storage use existing encrypted connections. Neither runtime images nor responses, logs, URLs or prompts contain provider-account secrets.

### Application grants

Reuse existing resource-grant machinery where it represents these facts. `access` is `{grants: GrantInput[]}`, including an explicit empty array for no application access. Each input has:

- `subject`: `{kind:"subject",subject_id:UUID}` or `{kind:"api_key",api_key_id:UUID}`, referring to a current organization member/key.
- `workspace_scope`: `{kind:"selected",workspace_ids:UUID[]}` with 1–100 distinct authorized IDs, or explicitly selected `{kind:"all"}` with unrestricted owner authority.

Each grant permits read/use only. The initial maximum is 100 active grants per deployment, using existing pagination/bounds conventions. The server returns `grant_id`, normalized input, actor/time and revocation state. Create and revoke by grant ID; duplicate active subject/scope grants conflict. The owner has management access and must also grant any application identity used for inference.

Current grants apply to current service immediately. Grant addition does not restart hosting; revocation fences future dispatch/publication under existing authorization rules. Changing access does not require a new hosting session, model revision or financial quote.

Workspace-scoped GETs carry one `workspace_id` UUID query parameter; inference uses its existing top-level field. Validate organization, key/session workspace restrictions and current resource grant together. Omission is allowed only with unrestricted owner authority or an explicit all-workspaces grant. OpenLegend supplies trusted backend configuration, never a player's asserted workspace.

Use-recipient projections omit other recipients and connection-owner details. Run access remains independent. Revoking application access must not erase the narrow cleanup authority for already-owned paid resources. If the upstream credential itself is revoked, report unresolved cleanup honestly.

## 3. Control operations

Prefix paths with `/v1/model-deployments`. Mutations use existing `Idempotency-Key` persistence before external effects: identical input returns the same operation, changed input conflicts. Read-only inspection is the exception. GETs read persisted/projected state; they never create capacity or generate tokens.

| Method/path | Input and result | Effect |
| --- | --- | --- |
| `POST /inspect` | `{source,task:"text_generation",runtime_preferences?}`; 200 support findings and options | Bounded HF/catalog metadata; no GPU or generation |
| `POST /` | `{name,source,runtime,hosting,access}`; 201 deployment and first revision | Metadata only; initially stopped |
| `GET /` | Existing cursor pagination | Safe summaries |
| `GET /{id}` | Deployment/service projection below | Cached status and selected revision capabilities |
| `POST /{id}/revisions` | `{source,runtime,hosting}`; 201 immutable revision | Does not switch the running model |
| `GET /{id}/revisions/{revision_id}` | Immutable resolved configuration | Safe source/runtime details |
| `GET /{id}/grants` | Owner-only cursor-paginated grants | No secret access |
| `POST /{id}/grants` | One `GrantInput`; 201 grant | Current read/use access |
| `DELETE /{id}/grants/{grant_id}` | 200 revoked grant | Immediate narrowing |
| `PUT /{id}/service` | `{deployment_revision_id,desired_state,policy}`; 202 service projection | Owner-authorized start, update, recovery configuration or stop |
| `DELETE /{id}` | 202 retirement, 200 once retired | Stops owned capacity; retains required history/liabilities |

`desired_state` is `running|stopped`. Both selected revision and policy are explicit on service updates; stopping preserves the stored configuration for a later deliberate start. Serializing each deployment's control mutations through the existing domain owner prevents competing controllers. A later explicit operation may supersede earlier desired state; internal generations fence stale provider completions. The 202 response means reconciliation is accepted, not that a server is already ready or stopped. Inference 202 continues to mean an admitted Run is executing/recovering.

Control errors use the existing envelope: 400 `invalid_model_deployment`; 403 `permission_denied`; 404 `not_found` without tenant disclosure; 409 `deployment_conflict` for incompatible control work; 422 `unsupported_model_source` or `invalid_hosting_policy`; 503 `deployment_provider_unavailable` for transient dependency failure. Inspection returns 200 with definitive unsupported reasons; a timeout is not proof that a model is unsupported or absent.

### Source, runtime and hosting

Managed `source` has `kind:"hugging_face"`, `repository`, optional input `revision`, optional `source_connection_id`, and optional exact `weight_files`, separate `tokenizer` repository/revision and reviewed `chat_template` selection. Resolve a tag, branch or omitted revision to a full commit once; save only canonical repository/full commit. Use that pin for all model/tokenizer/template downloads.

Accept `owner/repository` or `https://huggingface.co/{owner}/{repository}`, optionally `/tree/{revision}`. Reject credentials, query strings, fragments and arbitrary hosts. An explicit revision and URL revision must agree. Revisions containing slashes use the explicit field. Reject dataset/Space pages, path traversal and ambiguous weight variants with actionable findings. Follow only the source adapter's approved HF metadata/download hosts.

Inspection reports task/architecture/format compatibility, required template/access, supported profiles and memory estimates including context/concurrency KV cache and loading overhead. Owner confirmation covers the pinned model's license/terms when required, using `license_acknowledged:true` and server-recorded actor/time/source evidence. A declaration neither invents a missing license nor accepts HF gate terms for another account; upstream gated access must work with that owner's credential. Model-card prose is data, never executable startup instructions.

Managed `runtime` is an immutable registered `profile_id` and typed, reviewed `parameters`: context/output capacities, dtype/quantization, tensor-parallel layout, batching/concurrency and supported parser/template options. The profile owns its OCI digest, supported architectures/formats and parameter schema. Initial profiles load compatible safetensors with remote code disabled. Arbitrary shell commands, images and repository Python execution are outside this first managed path; imported endpoints provide the extension for other engines.

`hosting` is one of:

- `{kind:"runpod_serverless",compute_connection_id,placement:{region_ids,gpu_pool_ids,gpu_count}}`. Provider DTOs stay private. Region IDs are preferences, not a residency guarantee. Hardware alternatives must fit the selected model/runtime and authorized rate; actual hardware is observable operational data.
- `{kind:"external_openai",endpoint_connection_id,model_alias,lifecycle:"external"}`. Origin/auth live in the protected connection. An immutable external source records `kind:"external"`, nullable declared repository/revision and declared capabilities. Its runtime records `kind:"external"` and nullable operator-declared engine/version. No Macrofold wrapper or artifact certificate is required for production use.

External sources have honest operator-declared provenance; unknown HF commit, runtime digest and hardware stay unknown. The initial route is for separately owned/paid hosting with no additional per-request provider tariff, declared by the endpoint owner. Commercial metered API pricing continues through an accounted provider adapter. Macrofold's zero separate request charge never claims that an external host is free.

### Standing service policy

For managed hosting, `policy` contains:

| Field | Meaning |
| --- | --- |
| `min_replicas` | Positive integer; default 1 warm worker for interactive use |
| `max_replicas` | Explicit positive maximum, at least the minimum; provider-supported bound |
| `max_concurrent_requests` | Explicit positive application admission cap within configured runtime/provider capacity |
| `max_hourly_cost_micro_usd` | Positive integer micro-USD decimal string authorizing a maximum planned infrastructure rate |
| `stop_at` | Optional UTC RFC3339 timestamp or null; null means ongoing operation |

Managed running capacity is warm in this initial path; stopping sets provider worker bounds to zero and reconciles teardown. There is no single-replica product ceiling. Provider-native scaling and vLLM batching operate within these bounds; Macrofold does not schedule individual GPUs.

For external hosting, policy contains `max_concurrent_requests` and optional `stop_at`; replica and rate-control fields are absent because Macrofold cannot enforce that host's lifecycle or bill. The owner confirms external hosting responsibility during configuration.

Service enablement and policy increases require the exact owner's deployment/connection authority. Before managed start/update, calculate maximum planned rate from all eligible GPU offers, GPU count, maximum replicas and required storage meters using fresh provider data. Reject an unpriceable configuration or one over the submitted ceiling. Persist the accepted rates/units with the service operation. A changed quote is not another public resource: the submitted policy is the authorization, and any higher required ceiling requires a deliberate owner update.

Standing authorization permits health recovery, credential refresh and replacement capacity within the same selected source, account and limits. It never permits silently upgrading to a larger unapproved GPU or raising replicas/rates. Backoff and a startup-failure circuit breaker prevent repeated paid failing starts; remaining healthy replicas can serve. Failed/ambiguous creates are reconciled before any new create. A stopped service cannot be awakened by an inference request.

The hourly ceiling is a rate/capacity guard, **not a lifetime or provider-guaranteed dollar cap**. Ongoing warm capacity continues billing while idle. Show estimated hourly/daily/monthly cost and provider-account spending controls before start; optional `stop_at` supports finite use without making all production sessions expire. Provider outages, delayed billing and shutdown tails remain explicit uncertainty. No monthly ledger, invoice-attestation workflow or experiment reservation is required to operate the service.

### Deployment projection

`GET /{id}` returns safe metadata plus:

| Field | Meaning |
| --- | --- |
| `deployment_id` | Stable UUID |
| `desired_state`, `desired_revision_id` | Owner's current target |
| `serving_revision_id` | Actually selected ready revision, or null while none can serve |
| `state` | `stopped|starting|ready|degraded|stopping|failed|cleanup_pending` |
| `admission_open` | Whether new calls can be accepted; authoritative admission still rechecks |
| `capabilities` | Capabilities of the serving revision, or null until one is ready |
| `policy` | Nonsecret standing limits |
| `ready_replicas`, `observed_at` | Observed availability and timestamp; nullable for external hosting |
| `cost_policy` | `{basis:"deployment",request_charge_micro_usd:"0",infrastructure_cost_included:false}` |
| `infrastructure_cost` | `{period_start,period_end,estimated_micro_usd,provider_reported_micro_usd,status,as_of,unresolved_liability}` |
| `failure_code` | Redacted operational reason or null |

Cost period boundaries and observations use UTC timestamps; unavailable values are null. Cost status is `estimated|provider_reported|external_unknown|uncertain`. Estimated and reported amounts can overlap and are never added together. Background observations are not an invoice-finality guarantee. Unknown costs and incomplete shutdown do not invalidate completed model answers.

A revision change first closes new admission and drains accepted calls under their original deadlines. The initial rollout may briefly interrupt service: stop/reconcile old capacity, then start the new revision, keeping its ready pointer separate from desired state. Do not update a live endpoint's image/weights in place and mix revisions. No automatic model substitution or new rollout framework is required. Rollback selects a prior immutable revision through the same service operation.

## 4. Capabilities and readiness

Capability metadata belongs to the deployed recipe, not a process-specific certificate. Managed profiles derive it from supported runtime/configuration; external owners declare it. Startup checks actual loading and authenticated endpoint health, with bounded background health refresh. Synthetic live acceptance verifies the implementation and advertised features before release; an experiment suite does not run before every start, restart or NPC call.

Expose `protocol:"openai_chat"`, supported `input_modalities`, booleans `chat_completions`, `json_object`, `json_schema`, `tools`, `streaming`, `stream_usage`, `schema_keywords`, `schema_dialect`, `accepted_parameters`, `context_window_tokens`, `max_output_tokens` and `max_concurrent_requests`. Context/output limits are positive integers; unsupported flags are false, unknown optional details null. Declarations do not prove model quality. API schema validation checks only supported input features; arbitrary provider-native fields are not silently discarded.

Known unsupported formats/parameters reject before dispatch. Actual provider context enforcement and normal response validation remain authoritative; do not duplicate tokenizer/grammar implementations or add a tokenization/manifest request to every call. Managed profiles disable silent truncation. Imported servers must honor declared bounds, expose context errors and avoid silently trimming the application's input, verified during integration acceptance under operator trust.

Plain-text-only models are valid production targets for consumers that can use them. OpenLegend can explicitly choose prompted JSON and retain its identical local schema/world validation; Macrofold does not inject that game policy or silently downgrade a caller's strict schema request. Generic chat does not implement Jev/raw scoring, embeddings or a tool-executing native harness. The separate native-agent catalog's 128k minimum does not apply.

## 5. Shared inference request

Extend `InferenceBinding` as an exclusive union with the existing catalog-provider binding. Do not widen `DecisionBinding` beyond its implemented decision protocols.

```json
{
  "workspace_id": "11111111-1111-4111-8111-111111111111",
  "model_binding": {
    "deployment_id": "22222222-2222-4222-8222-222222222222"
  },
  "input": {
    "messages": [
      {"role": "system", "content": "Return the requested structured result."},
      {"role": "user", "content": "Classify this synthetic example."}
    ],
    "temperature": 0.2,
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "example",
        "strict": true,
        "schema": {
          "type": "object",
          "properties": {"label": {"type": "string", "enum": ["a", "b"]}},
          "required": ["label"],
          "additionalProperties": false
        }
      }
    }
  },
  "limits": {
    "max_cost_micro_usd": "10000",
    "max_output_tokens": 128,
    "timeout_seconds": 30
  },
  "stream": false
}
```

This proposed `POST /v1/inferences` uses existing Bearer authentication and `Idempotency-Key`. IDs/prompts are synthetic. An optional UUID `model_binding.deployment_revision_id` requires that exact currently serving revision for a **new** admission. The binding forbids catalog `provider`, `model`, `billing_mode`, connection IDs and endpoint URLs. Omit `input.model`; Macrofold injects the admitted revision's alias. Reject conflicting supplied model fields rather than silently retargeting them.

Before resolving today's serving revision, look up an existing invocation by its original idempotency key/body through the normal authorization owner. Reuse returns that invocation and its original model revision, including after a rollout or stop. It cannot bind the same invocation to today's model, fail because an old explicit pin is no longer current, or replay the inference. The public request body stays the idempotency identity; server-resolved revision/endpoint is its stored execution snapshot.

For new work, resolve revision, current authority, readiness, concurrency and applicable limits through existing Run admission. Keep source lookup, provider billing polls, full capability probes and hosting reconciliation off this path. Cache immutable revision/prepared metadata, without caching away current authorization. There is one upstream generation request; no per-turn management, manifest or tokenizer HTTP call.

Preserve supported messages, sampling parameters, output formats and native response contents. Do not inject a persona, OpenRouter options, experiment settings or repair prompt. Existing multiple-completion/aggregate-output limits remain available when the runtime supports them; OpenLegend ordinarily requests one result. Returned tool calls are data and grant no tool authority.

Effective execution timeout is at most **240 seconds**, bounded further by current platform, provider and caller limits. Native max-token fields must be absent or agree with the explicit limit. If `stop_at` is set, new work must fit its remaining execution time; background maintenance stops capacity even without incoming traffic. Existing request/response byte bounds and cancellation semantics still apply.

Top-level `stream` uses Macrofold's existing streaming/recovery protocol when supported. Use the existing final-result path otherwise. OpenLegend's existing partial-text publication rules remain independent of provider selection. Streaming does not authorize game effects before final validation.

## 6. Terminal receipt and cost semantics

Preserve all required current inference receipt fields/statuses and the complete provider-native `result.inference.value`. Macrofold does not return already-decoded NPC JSON. OpenLegend parses its supported output and applies the same current-world validation used for other models.

Add these siblings inside `result.inference` for every admitted deployment-backed terminal receipt:

```json
{
  "deployment": {
    "deployment_id": "22222222-2222-4222-8222-222222222222",
    "deployment_revision_id": "33333333-3333-4333-8333-333333333333"
  },
  "cost_attribution": {
    "basis": "deployment",
    "deployment_id": "22222222-2222-4222-8222-222222222222",
    "infrastructure_cost_included": false
  }
}
```

These identify the admitted target, including when the provider fails. They are not a complete response. Existing model-source provenance fields may report a pinned HF commit for a managed pinned recipe; operator declarations must stay declared/unknown. Boot, hardware, usage availability and diagnostic metadata do not become additional acceptance conditions.

A valid completed answer is associated with the admitted revision, not whatever worker or revision is current when it arrives. Restart, credential rotation, replica replacement and deliberate subsequent rollout do not by themselves invalidate it. Current cancellation, authorization and application-state validity still apply. A crash before a usable result exists is an ordinary failed/uncertain request; recovery of hosting never justifies replaying that request blindly.

For the initial separately hosted BYOK request policy:

- `billing_mode:"byok"`, `charged_micro_usd:"0"`, `budget_cost_micro_usd:"0"` and `reported_micro_usd:"0"` describe the separate **request fee**.
- Preserve original `reserved_micro_usd` and release the unused request reservation through existing settlement.
- `provider_cost_micro_usd`, `provider_reported_cost_usd` and `upstream_inference_cost_usd` are null when no truthful per-call infrastructure price exists; their corresponding status fields remain unavailable.
- Token usage/completeness is factual and independent of billing; missing counts remain null.

An explicit zero request-cost ceiling is valid for this policy, but never starts free capacity or bypasses service authorization. OpenLegend's no-external-call mode still prevents inference to prepaid or external servers.

Hosting costs are observed per deployment and time window, once. Do not turn shared GPU cost into an authoritative per-NPC fee or charge it again in a request journal. Optional experiments may calculate labeled allocations or cost per usable answer from a measured window. Neither gameplay nor acceptance of useful output waits for invoice reconciliation.

## 7. Admission errors and operational recovery

These codes promise no new Run/provider dispatch only when that fact is established. Already-admitted/ambiguous work retains the existing terminal or HTTP 202 recovery contract.

| HTTP/code | Meaning | Caller behavior |
| --- | --- | --- |
| 400 `invalid_deployment_binding` | Invalid/mixed binding or conflicting model input | Correct configuration |
| 403 `permission_denied` | Current resource, workspace or connection authority insufficient | No credential fallback |
| 409 `deployment_binding_stale` | An explicit revision pin differs from the serving revision for new work | Deliberately select another revision if desired |
| 409 `deployment_not_ready` | Starting, stopped, draining or no healthy capacity | Surface availability; running services recover automatically |
| 422 `unsupported_model_capability` | Requested format, parameter or limit unsupported | Choose a supported request; no hidden downgrade |
| 429 `deployment_capacity` | Current bounded concurrency exhausted | Existing explicit pre-admission retry policy only |
| 402 `deployment_budget_exhausted` | Accepted hosting policy cannot support current planned rate/capacity | Owner adjusts hosting policy or provider configuration |
| 503 `deployment_unavailable` | Dependency unavailable before admission | Preserve uncertainty distinction; no blind replay |

No dispatch for one request does not mean warm infrastructure is free. Existing `inference_admission_unknown`, HTTP 202 reasons, cancellation and receipt retrieval remain authoritative. SDKs retain one inference submission by default. Explicit safe pre-admission retries use the same key/body and original total deadline; uncertain submission recovers the same Run. Do not add an inference retry loop, alternate model, refusal retry or schema-repair call as part of hosting recovery.

A same-revision replica/process failure removes unhealthy capacity from routing. Healthy replicas continue; ordinary provider recovery and bounded service reconciliation restore missing capacity under standing limits. Boot IDs do not fence otherwise valid same-revision requests. Repeated startup failures, unrecoverable source/config errors, revoked credentials or a violated hosting ceiling require visible degraded/failed status and bounded cleanup; never expand spending to force success.

An operator stop/retirement closes new admissions immediately, then drains accepted work within existing deadlines and the documented bounded drain timeout. Valid completed work can still publish under current permissions. After that allowance, cancel remaining calls and reconcile teardown. Revocation, unlike a routine stop, retains its current publication restrictions. A missing DELETE acknowledgement or empty observation does not prove billing stopped; persist `cleanup_pending` and actual owned resource identities until resolved.

## 8. Contract acceptance and coordinated release

Implement the production slice before optional benchmarking: metadata and grants; service lifecycle; direct inference/streaming and receipts; generated clients and operator controls; OpenLegend production configuration. Detailed work remains in [maintainer TODO](../maintainers/TODO.md#hugging-face-model-deployments).

Verify the same native request and full terminal receipt through Macrofold REST/SDK and OpenLegend's actual serializer/decoder. Acceptance covers stable deployment routing and optional pin, idempotent recovery across rollout, automatic same-revision restart, valid old-request completion, current revocation, local JSON validation, unsupported capabilities, concurrency/backpressure, zero request fee versus nonzero/unknown hosting costs, and confirmed managed cleanup. Fixtures establish contracts; separately authorized live checks establish provider behavior and realistic latency.

Ship actual Macrofold API/client support before enabling its consumer. OpenLegend operator configuration selects the target for production NPC generation; an absent feature fails visibly without hidden OpenRouter fallback. Record tested client/server revisions and runtime image in release evidence. Source/runtime upgrades are deliberate operations, while routine healthy replacement is ordinary service maintenance.

Experiments may pin a revision and record inputs, output strategy, outcomes, timing and cost observations through the same API. No experiment ID, study manifest, qualification certificate, boot pin, finite activation or owner invoice attestation is a prerequisite of production inference.
