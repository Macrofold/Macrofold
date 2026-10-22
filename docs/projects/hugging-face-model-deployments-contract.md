# Custom model deployment contract

| Status | Current progress | Last updated |
| --- | --- | --- |
| In progress | The cross-repository design is specified; API, runtime, clients and live qualification are not implemented. | 2026-10-22 |

This is the canonical **proposed** wire contract for [model deployments](hugging-face-model-deployments-feature-spec.md). The [technical design](hugging-face-model-deployments-tech-design.md) owns persistence, reconciliation and hosting. The [research](hugging-face-model-deployments-research.md) records provider evidence. [OpenLegend's consumer design](https://github.com/Macrofold/OpenLegend/blob/design/huggingface-model-deployments-2026-10-22/docs/projects/model-experiments-tech-design.md) maps its NPC experiments to this contract; it does not maintain a second server schema.

Baseline: Macrofold `07ba0ee1bb5c76aeb4d0d3553339dc274854335a`, OpenLegend `27c6fb8152ec58c34334e74ba91a9d5bec6a30ff`. Neither deployed endpoint support nor a model's quality follows from this design. Implementation changes [OpenAPI](../api/openapi.json) and generated clients together; do not hand-edit generated artifacts or add a legacy API.

## 1. Ownership and identity

Three identities prevent silent changes:

| Identity | Meaning | Changes when |
| --- | --- | --- |
| `deployment_id` | Organization-owned configured model service | A separate service is created |
| `deployment_revision_id` | Immutable source, serving recipe, connection delegation and financial policy | Any behavior-relevant source, template, quantization, runtime, credential binding, endpoint or charging policy changes |
| `activation_id` | One explicitly funded, finite period of permitted use | A new period is authorized; restarting does not silently replace an old period |

All three are UUIDs. Identifiers are references, never authority. The owning organization comes from authenticated context, never a client-controlled organization field. Revision identity is distinct from the source's full HF commit, runtime image digest and manifest SHA-256. Their values are recorded independently.

Initial managed deployment supports customer-funded RunPod Serverless load balancing with a pinned vLLM recipe. Imported endpoints use `openai_chat` after qualification, with externally managed lifecycle. Macrofold does not make OpenLegend's fictional rules, refusal preferences, NPC purposes or audience policy platform-wide. Model servers are not native-agent Workers, Worktrees or HostRuns.

The initial deployment has at most one nonterminal activation. Each activation has one bounded qualification suite and one immutable certificate; verified endpoints also pin the authenticated serving-process boot. Observed boot/source/runtime drift or a connection credential-generation change closes admission and starts the same stop/cleanup path. Continued use requires a fresh quote and activation, even when the model revision is unchanged. This trades automatic recovery for reproducible, explicitly funded experiments. An unverified external endpoint cannot prove or fence unseen process changes. A stopped activation cannot be restarted or renewed. Preserve previous immutable revisions/receipts for their actual retention requirements, not a pre-launch compatibility layer.

## 2. Authorization

Add resource scopes `model-deployments:read`, `model-deployments:use` and `model-deployments:write` to existing principal/scope handling. Write includes configuring, quoting, explicitly funding, stopping and retiring a deployment; use does not imply write. Creation/activation requires a principal permitted to authorize the selected compute and source connections. Ordinary inference also retains current `runs:write` admission and `runs:read` retrieval controls.

Use grants are stored on the deployment, scoped to explicit organization principals/API keys and allowed workspace IDs. A game backend receives read/use plus its existing Run authority, never compute/HF secrets or deployment write permission. A wildcard workspace grant is an explicit owner choice; it is not the default. `workspace_id` must be supplied for a workspace-restricted grant.

For passive deployment/revision/activation reads and lists, transport that context as a single `workspace_id` UUID query parameter. For inference, use the existing top-level body field. The server verifies the workspace belongs to the authenticated organization, is within the key/session's existing restrictions, and matches a current deployment grant; the query/body value is a selector, not proof of membership. Omission is allowed only for the deployment owner with unrestricted workspace authority or an explicit all-workspaces grant. Read projections for a use recipient omit other recipients and connection-owner metadata. OpenLegend obtains the value from trusted server configuration, never player input. Deployment-use authority does not grant access to another caller's Runs.

### Initial owner and grant model

Keep the first release small: the authenticated deployment owner must also be the existing `owner_subject_id` of every selected private HF, compute and external-endpoint connection. Public HF sources need no connection. Creating a deployment/revision records a server-created delegation from that exact owner to that deployment and credential binding; it does not require a nonexistent preexisting delegation API. Cross-owner connection composition and transfer are unsupported initially. Organization administration alone cannot satisfy this check. Broadening access or creating/funding resources also requires existing connection-write, deployment-write and owner/admin membership; an owner retaining the relevant write authority may narrow access or stop outstanding capacity after demotion.

`access` is exactly `{grants: GrantInput[]}`. It defaults to no third-party access only when the UI explicitly submits `grants:[]`; the field itself is required. Each `GrantInput` contains `subject` and `workspace_scope`:

- `subject` is exactly `{kind:"subject",subject_id:UUID}` or `{kind:"api_key",api_key_id:UUID}`. Resolve existing current organization membership/key identity; never accept an email, display name or arbitrary external ID.
- `workspace_scope` is exactly `{kind:"selected",workspace_ids:UUID[]}` with 1–100 distinct authorized workspaces, or `{kind:"all"}`. The latter requires unrestricted owner authority and explicit UI selection. No wildcard string or implicit union across another grant's subject is accepted.
- Every grant permits read/use only, never write, credential administration or spending. Maximum 100 active grants per deployment; duplicate subject/scope combinations return 409. The owner has management/read authority; its inference use still needs an explicit grant.

The server returns immutable `grant_id`, normalized input, `created_at`, `created_by_subject_id` and nullable `revoked_at`. `GET /{id}/grants` returns the owner's cursor-paginated full list; recipients see only their effective access through ordinary safe projections. `POST /{id}/grants` creates one exact grant, and `DELETE /{id}/grants/{grant_id}` revokes that grant idempotently. Only the deployment/connection owner with deployment-write may mutate. Grant identity rather than a mutable collection replacement prevents lost updates; there is no grant PATCH. Changed recipient/workspace scope means revoke then create. Revocation is immediate for future dispatch/publication. Additions apply to the next activation: a quote freezes grant IDs/digests, and an activation's maximum use scope never expands beyond that snapshot. A stale quote after an access change must be replaced; it cannot fund recipients the owner has not reviewed.

Revoking a use grant blocks later dispatch/publication under existing authorization rules, but does not revoke the narrowly retained system cleanup capability needed to stop outstanding capacity. Revoked/invalid provider credentials make cleanup uncertain, not successful.

All operations use the existing API-key/session/customer-OAuth boundaries as applicable; management MCP remains read-only. Source/compute registration and credential entry use existing encrypted connection mechanisms. Request bodies, projections, traces and receipts contain connection IDs, never secret values.

## 3. Control operations

Prefix all paths below with `/v1/model-deployments`. Every state-changing operation requires `Idempotency-Key`, persisted before external effects. Identical key/body returns the same logical object; changed body conflicts. Provider uncertainty never authorizes a second create. GETs are passive reads of persisted/projected state and must not wake an endpoint. Exact resource identities, transactional lifecycle preconditions and idempotency own concurrency; no additional mutable `expected_revision` field is needed for this API.

| Method/path | Body and result | Authority and side effect |
| --- | --- | --- |
| `POST /inspect` | Source-only `{source,task:"text_generation",runtime_preferences?}`; 200 advisory support/profile/hardware options | Write; bounded HF metadata only, no GPU or model call, no resource mutation/idempotency requirement |
| `POST /` | Create body below; 201 returns deployment and first revision; unsupported selection returns 422 | Write; HF metadata resolution allowed, no GPU provisioning |
| `GET /` | Existing cursor pagination conventions; summaries only | Read; no provider probe |
| `GET /{id}` | Deployment, current revision ID and optional active activation ID | Read; no credentials, prompts or implicit warmup |
| `POST /{id}/revisions` | Same source/runtime/hosting specification as create; 201 immutable revision | Write; no active configuration replacement |
| `GET /{id}/revisions/{revision_id}` | Immutable resolved source/recipe and declared limits | Read |
| `GET /{id}/grants` | Cursor-paginated immutable grants and revocation state | Owner read; no secret access |
| `POST /{id}/grants` | One `GrantInput`; 201 grant | Owner write; additions apply to future activations |
| `DELETE /{id}/grants/{grant_id}` | 200 revoked grant | Owner write; current-use revocation is immediate |
| `POST /{id}/quotes` | Exact quote input below; 201 quote | Owner write; metadata/catalog only, never GPU startup |
| `POST /{id}/activations` | `{quote_id, quote_digest, authorization_expires_at, qualification_suite_id}`; 202 activation | Write plus exact funding authority; explicit paid provisioning/startup/probes |
| `GET /{id}/activations/{activation_id}` | Activation projection below | Read/use; no provider inference or cold start |
| `POST /{id}/activations/{activation_id}/stop` | `{reason:"operator_requested"}`; 202 same activation | Write; closes admission immediately, reconciles drain/teardown asynchronously |
| `POST /{id}/activations/{activation_id}/cost-reconciliations` | Owner-verified provider evidence and complete amount below; 201 immutable reconciliation | Owner write; accounting evidence only, no model or provider mutation |
| `GET /{id}/activations/{activation_id}/cost-reconciliations` | Owner-only cursor-paginated evidence/supersession history | Owner read; recipients use safe activation cost fields instead |
| `DELETE /{id}` | 202 retirement intent, 200 once retired | Write; stops active capacity first; never erases unresolved financial evidence |

Activation HTTP 202 is a control-plane accepted operation. Inference HTTP 202 retains its different, existing meaning: an already admitted Run executing/recovering. API docs and clients must distinguish these response types.

Control errors use the existing error envelope: 400 `invalid_model_deployment` for invalid strict input; 403 `permission_denied`; 404 `not_found` without leaking another tenant's resources; 409 `deployment_conflict` for a conflicting live lifecycle or duplicate grant; 409 `deployment_quote_stale` for expired/changed quote or grant snapshot; 422 `unsupported_model_source` for a definitive unsupported source/runtime; 422 `invalid_hosting_budget` for insufficient/unpriceable managed authorization; 503 `deployment_provider_unavailable` for transient metadata/provider unavailability. The existing idempotency-key/body conflict remains its current code. Inspection returns 200 with compatibility reasons for definitive unsupported candidates; a timeout is a transient error, never proof a repository is absent or unsupported.

### Create and revision inputs

Create requires `name` (existing resource-name validation), `source`, `runtime`, `hosting`, and `access` as defined above. Revision creation requires `source`, `runtime` and `hosting`; it keeps the deployment's current grants and name rather than redefining them. Server-authenticated owner actions establish delegation; request fields cannot assert someone else's approval. `name` is descriptive, not a unique reconciliation key.

`source` for managed hosting:

- `kind:"hugging_face"`.
- `repository`: canonical `owner/repository`, or a supported HTTPS HF model URL at the initial UI/API boundary; the saved revision contains only canonical ID.
- `revision`: optional full commit/tag/branch at inspection; omitted means resolve the current default branch **once**. Persist the resulting full commit; never run an unpinned default.
- `source_connection_id`: optional authorized HF connection for private/gated access.
- `weight_files`: optional exact repository-relative filenames to resolve quantization ambiguity. Reject traversal, symlink escape and ambiguous variants; never guess the largest/latest snapshot.
- `tokenizer`: optional separate repository/revision using the same rules; otherwise bind model repository/full commit.
- `chat_template`: repository-relative file at a pinned commit, or registered reviewed template ID; absent means use the pinned tokenizer template. A missing required template is an unsupported reason, not invented prompt syntax.
- `license_acknowledgment`: when inspection requires terms review, `{repository,revision,license_evidence_sha256,assertion:"owner_reviewed_and_accepted"}` matching the exact resolved source and inspection evidence. The authenticated owner submits this explicit declaration; the server stores its own acknowledgment ID, actor/time and evidence digest. It is not a reference to an assumed preexisting API or permission to accept terms for another account. A model card's label is evidence, not a grant.

Accept canonical `https://huggingface.co/{owner}/{repo}` and `/tree/{revision}` model pages, without credentials, query strings, fragments or arbitrary hosts. A literal source `revision` and URL revision must agree. Dataset, Space and API-only pages report unsupported source/task. Git revision strings with slashes use the explicit field rather than ambiguous URL parsing. Follow HF's trusted metadata/download hosts under the source adapter's network policy; do not turn model URLs into arbitrary HTTP fetching.

`runtime` is a registered immutable `profile_id` plus reviewed typed `parameters`: context/output capacities, dtype/quantization, GPU tensor-parallel count, batch/concurrency limit, selected tokenizer/template and optional supported reasoning/tool parser. No arbitrary container image, shell, Python module, executable command or `trust_remote_code:true` in the first managed path. Profile manifests name the OCI image digest, runtime version, allowed architectures/weight formats and parameter schema. Repository content never determines executable startup instructions.

`hosting` is a strict union:

- Managed: `{kind:"runpod_serverless",compute_connection_id,placement:{region_ids,gpu_pool_ids,gpu_count},max_replicas:1}`. Actual RunPod payloads are private adapter types, not public contract fields. Quote resolves catalog availability/pool rates and checks memory fit; it does not guarantee capacity. Region IDs are placement preferences, not a residency guarantee. Freeze eligible hardware types separately from the pool's hourly price and reject/clean up unaccepted observed hardware before application readiness; startup may already be billable.
- Imported: `{kind:"external_openai",endpoint_connection_id,model_alias,lifecycle:"external"}`. Source information is operator-declared evidence unless independently verified by the compatible wrapper. URL/auth live in the restricted endpoint connection. Activation may qualify/use it but cannot claim to start, stop or pay for its owner-managed server.

Imported `source` uses `kind:"external"`, `declared_repository`, `declared_revision` and optional manifest reference. Unknown fields remain null with an explicit evidence level. No fabricated source SHA, runtime digest or local-compute cost. Initial imported route requires a zero-per-request-fee declaration tied to its owner; a separately metered third-party API uses the existing provider path until its tariffs have a real adapter.

### Inspection and quote

Source-only inspection makes the paste-link journey possible before a runtime or GPU is chosen. It yields `support_status:"supported"|"unsupported"|"needs_operator_input"`, `reason_codes`, resolved source, estimated disk/VRAM requirements and possible registered profiles. The UI may preselect the least expensive adequate supported profile, but shows assumptions and the quote before paid activation. Create accepts the selected complete specification and revalidates its pinned resolution; an inspection is not spend authority or a deployable promise. Unsupported inspection is not a provisioned deployment. Reasons distinguish unsupported task/architecture/format, absent weights, missing template, gated access, unresolved license, remote-code dependency and inadequate memory. Memory sizing includes weights, runtime overhead, KV cache for declared context/concurrency, temporary loading requirements and GPU topology; parameter count alone is insufficient.

Inspection exposes `license_evidence_sha256` over canonical license metadata and the available pinned license-file digests/terms URLs. Missing or ambiguous terms stay `needs_operator_input`; an acknowledgment does not invent a license. For gated artifacts, the owner completes any required acceptance on Hugging Face itself. The adapter verifies actual download access with the exact owner connection; Macrofold neither auto-accepts upstream terms nor treats a checkbox as HF authorization. Separate tokenizer/template licenses follow the same rule and are included in the acknowledged evidence manifest.

Quote input is `{deployment_revision_id,duration_seconds,max_infrastructure_cost_micro_usd,qualification_suite_id,external_cost_acknowledgment?}`. Managed budget must be a positive micro-USD string; imported budget may be null. The optional field is allowed only for imported hosting and is required there: `{assertion:"owner_manages_host_and_confirms_zero_request_fee",cost_status:"known"|"estimated"|"unknown",declared_host_cost_micro_usd:string|null}`. Known/estimated amounts describe this requested authorization period, not a request tariff; unknown requires null. The authenticated endpoint owner explicitly acknowledges separate lifecycle, host cost and absence of a Macrofold cap. The server records its own acknowledgment ID/actor/time/evidence digest and includes it in the immutable quote. No extra acknowledgment-creation service is required.

A quote contains `quote_id`, `quote_digest`, `deployment_revision_id`, `created_at`, `expires_at`, `authorization_expires_at`, `duration_seconds`, `max_infrastructure_cost_micro_usd`, `rate_snapshot`, `startup_timeout_seconds`, `drain_timeout_seconds`, `cleanup_reserve_micro_usd`, `qualification_suite_id`, `qualification_max_requests`, `qualification_max_output_tokens`, `request_charge_micro_usd:"0"`, `funding_mode:"byok"`, and `external_cap_guaranteed:false`.

USD amounts use nonnegative integer micro-USD decimal strings, never floating point. Duration and managed-hosting budget are explicit positive operator inputs, not a default perpetual server. Set `authorization_expires_at = created_at + duration_seconds`; this finite wall-clock period includes startup, qualification, use and teardown. Set the quote acceptance deadline `expires_at` to the earlier of `created_at + 300 seconds` and `authorization_expires_at - startup_timeout_seconds - drain_timeout_seconds`; reject a nonpositive useful window. An activation echoes the exact `authorization_expires_at` and quote digest and must be accepted before `expires_at`; waiting never extends the funded period. Set `admit_until = authorization_expires_at - drain_timeout_seconds`, reducing it further if cost exposure requires earlier shutdown. An admitted request's execution deadline must precede `admit_until`.

Managed quotes fix all allowed placements and use the highest eligible rate/GPU count, maximum replicas, startup, idle, execution, storage and cleanup assumptions. Ambiguous managed pricing/storage or insufficient authorized budget rejects activation. No automatic larger GPU, region, replica count, alternate account or spend increase.

The cleanup reserve is **inside**, not in addition to, `max_infrastructure_cost_micro_usd`. For budget `B`, reserve `R` and cumulative conservative cost `C(t)` through time `t` excluding the same future reserved cleanup interval, derive the latest budget admission time satisfying `C(t) + R <= B`. `admit_until` is no later than that time or the finite wall-clock boundary above. Requests share this host commitment; concurrent calls do not each reserve another whole GPU interval. A maintenance deadline starts shutdown at the boundary even with zero incoming calls. Unknown new exposure closes admission and retains the liability; it does not erase the original commitment or claim a guaranteed external cap.

Imported endpoints use the same finite use authorization but purchase no capacity. Their `rate_snapshot` and `max_infrastructure_cost_micro_usd` may be null, `cleanup_reserve_micro_usd` is `"0"`, and the server-created `external_cost_acknowledgment_id` identifies the inline owner declaration above. This is not a zero-cost claim or a Macrofold spending cap. Stop revokes use and cancels Macrofold's requests, without terminating the external server.

The activation request must match the quote's bounded probe suite. Readiness probes that generate tokens consume that activation's authorization; discovery does not run them. Quote calculation and approval do not guarantee a hard external dollar ceiling: shutdown failures and delayed charges remain possible and must be shown before activation.

### Activation projection

Required fields:

| Field | Type/meaning |
| --- | --- |
| `deployment_id`, `deployment_revision_id`, `activation_id` | Exact UUID triple |
| `state` | `provisioning`, `warming`, `qualifying`, `ready`, `draining`, `stopped`, `failed` or `cleanup_pending` |
| `admission_open` | Boolean; only true for ready, current, authorized, unexpired capacity |
| `authorization_expires_at`, `admit_until` | UTC RFC3339 timestamps; admission stops early enough for authorized cleanup |
| `artifact_manifest_sha256` | Hex SHA-256 or null when unattested; never hash of alias alone |
| `runtime_image_digest` | Pinned OCI digest or null for unverified external runtime |
| `identity_evidence` | `verified_manifest` or `operator_declared` |
| `qualification_id` | This activation's immutable certificate UUID; null before qualification |
| `capabilities` | Certificate below, null until established |
| `serving_observation` | Immutable qualified `{observed_at,worker_boot_id,served_model_alias,hardware:{accelerator_kind,model,count,memory_bytes,data_center_id}}`; null before qualification |
| `cost_policy` | `{basis:"deployment_activation",funding_mode:"byok",request_charge_micro_usd:"0",infrastructure_cost_included:false}` |
| `accepted_terms` | Immutable nonsecret accepted commitment described below; never reconstructed from today's price or a current grant |
| `infrastructure_cost` | `{status,estimated_micro_usd,provider_reported_micro_usd,reconciled_micro_usd,reconciliation_id,reconciliation_basis,unresolved_liability,as_of}`; unknown numeric values and absent reconciliation fields null |
| `failure_code` | Stable code or null; human-readable redacted detail optional |

Infrastructure status is `estimated`, `provider_reported`, `reconciled`, `external_unknown` or `uncertain`. A stopped resource can still have uncertain accounting. `reconciled` requires accepted account/invoice evidence for the entire activation and residual resources; elapsed time or a quiet hourly billing bucket is not finality. Estimates and provider reports overlap; never add them together.

`reconciliation_id` is the current accepted immutable record UUID; `reconciliation_basis` is `owner_attested_provider_evidence` or null; `reconciled_micro_usd` is its exact accepted total, not an additional charge. On reopened uncertainty retain the last record as history, but clear these current-final fields until a superseding reconciliation is accepted. An authorized owner may inspect the append-only history; the safe use projection exposes only the current-final values, `status`, uncertainty and observation time. Consumers retaining prior snapshots can preserve their supersession trail without invoice or owner-only access.

`accepted_terms` contains the quote's exact `quote_id`, `quote_digest`, `duration_seconds`, `authorization_expires_at`, `max_infrastructure_cost_micro_usd`, `cleanup_reserve_micro_usd`, `startup_timeout_seconds`, `drain_timeout_seconds`, `rate_snapshot`, `qualification_suite_id`, `qualification_max_requests`, `qualification_max_output_tokens`, `request_charge_micro_usd`, `funding_mode`, `external_cap_guaranteed`, plus nullable `external_cost_acknowledgment_id` and `external_cost_acknowledgment` (the safe normalized declaration). It exposes neither provider secrets nor other recipients. OpenLegend reads this projection once with the immutable revision and reserves the accepted maximum commitment; it never infers an allocation budget from a request receipt or recomputes it from current catalog prices. `external_cap_guaranteed:false` means a strict cannot-exceed-total-liability study must reject this mode. A planning-bound study may reserve the quoted commitment while explicitly retaining residual shutdown liability and later overruns.

`rate_snapshot` is null for unpriced external hosting; managed snapshots contain `observed_at`, `source_url`, `currency:"USD"`, `gpu_pool_offers:[{pool_id,eligible_gpu_type_ids,rate_micro_usd_per_gpu_hour}]`, selected `gpu_count`, `max_replicas`, and `meters:[{kind,unit,rate_micro_usd,billing_quantum_seconds,rounding:"ceil_per_worker_epoch"|"ceil_per_resource_epoch"}]`. Include every required storage/compute meter, its exact unit and provider period conversion; do not encode a monthly storage price as an hourly rate without recording that conversion. Public amounts are decimal strings. The technical design owns conservative calculation and uncertainty for unobserved replacement workers.

### Operator cost reconciliation

RunPod billing observations have no automatic finality flag. The minimal completion workflow is the owner-authenticated `cost-reconciliations` operation above. Its strict body is `{total_infrastructure_cost_micro_usd,coverage_start,coverage_end,provider_resource_ids,evidence:{kind:"provider_invoice"|"provider_statement",provider_reference,evidence_sha256},assertion:"owner_verified_complete_activation_cost",supersedes_reconciliation_id?}`. Amounts are nonnegative micro-USD strings; timestamps and resource IDs must cover this activation's known paid epochs and residual owned resources. For managed hosting the server verifies ownership, confirmed compute shutdown, complete resource coverage and absence of unresolved provisioning/cleanup before accepting the attestation. For external hosting it verifies that Macrofold use and known requests have ended and that the evidence covers the declared attribution period; it does not require or claim shutdown of a shared external host. External resource IDs may be empty only when the evidence instead identifies the exact endpoint-connection revision and activation. An ambiguous shared-account invoice or overlapping unallocated host bill cannot be asserted as an exact activation total; preserve an estimate/unknown amount until attributable evidence exists.

The owner reviews the actual provider statement/invoice and records its opaque reference and SHA-256; these are audit evidence references, not URLs the API fetches or public invoice contents. Store actor/time and exact body digest server-side. Append an immutable `reconciliation_id`; return 201 and expose `reconciliation_basis:"owner_attested_provider_evidence"` with the safe cost projection. This records who accepted final cost, not an independent Macrofold audit of the provider. It does not charge the account again or fabricate a per-request invoice. Unknown external host cost remains `external_unknown` until equally attributable evidence exists; operator preference alone cannot turn unknown cost into zero.

Corrections append a new record with `supersedes_reconciliation_id`; they never rewrite old observations, receipts or journals. A newly received conflicting charge/resource observation reopens uncertainty and blocks a final-cost claim until corrected. OpenLegend can finish qualitative evaluation earlier, but any final-dollar qualification remains explicitly pending until this evidence workflow completes. Owner acknowledgment is an authorized accounting operation, not an implicit step in inference or shutdown.

Readiness can become false without changing a revision, for example after capacity loss or revocation. A ready projection is advisory for OpenLegend startup; Macrofold rechecks current authority, activation generation, deadline, cost exposure and capacity in its own dispatch admission. Do not poll management APIs on every NPC turn.

The immutable revision describes requested source/runtime/placement; `serving_observation` records actual qualified process/hardware evidence. `accelerator_kind` is `gpu`, `cpu` or `unknown`; other hardware values may be null when external evidence cannot establish them, and `memory_bytes` uses a nonnegative decimal string. Managed readiness requires observed GPU/count/location to satisfy the accepted offer. Neither a replacement worker nor a later status read can rewrite this activation's qualified observation or historical receipts. Unverified external boot identity remains null and explicitly operator-declared; it cannot satisfy a verified-serving requirement. Never report requested pool/region as measured hardware.

## 4. Capability certificate

One immutable certificate binds source/runtime/parameters, qualification suite and results for the activation's finite lifetime. Verified endpoints additionally bind the authenticated boot before the suite's first generation request; both qualification and application requests require the wrapper to reject another boot before invoking the engine. Drift closes admission rather than scheduling another paid suite. Operator-declared external endpoints without that evidence retain their offline limitation. The activation exposes:

- `protocol:"openai_chat"`; supported `input_modalities:["text"]` initially.
- `chat_completions:boolean`, `json_object:boolean`, `json_schema:boolean`, `tools:boolean`, `streaming:boolean`, `stream_usage:boolean`.
- `schema_keywords:string[]` and `schema_dialect:string|null`: actual qualified grammar support, not a claim that every JSON Schema is valid.
- `context_window_tokens`, `max_output_tokens`, `max_concurrent_requests`: positive integers reflecting deployed settings and qualification.
- `accepted_parameters:string[]`, `reasoning_mode:string|null`, `tool_parser:string|null`, `tokenizer_manifest_sha256:string|null`.
- `qualified_at`, `suite_id`, `suite_digest`, `certificate_digest`.

Generation quality, fictional refusal rate, lawfulness of actions, calibrated probability and game readiness are **not** platform capability flags. Generic chat does not implement Jev/raw scoring, embeddings or an autonomous tool-executing harness. The native-agent catalog's 128k minimum does not apply to this single-call path.

OpenLegend in-game use requires the exact structured-output dialect and schema features it actually sends. A model that supports only plain chat may enter an explicitly labeled offline screen, not silently receive a weaker in-game contract. Synthetic capabilities and runtime health do not qualify character quality.

## 5. Shared inference request

Extend inference binding, not the decision-binding registry. `InferenceBinding` is an exclusive union of the current catalog provider object and the following deployment object. `DecisionBinding` remains restricted to its actual decision protocols.

```json
{
  "workspace_id": "11111111-1111-4111-8111-111111111111",
  "model_binding": {
    "deployment_id": "22222222-2222-4222-8222-222222222222",
    "deployment_revision_id": "33333333-3333-4333-8333-333333333333",
    "activation_id": "44444444-4444-4444-8444-444444444444"
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

This is a proposed `POST /v1/inferences` body, with existing Bearer authentication and `Idempotency-Key` headers. UUIDs and prompts are illustrative fixtures, not real resources or game instructions.

The deployment binding requires all three IDs and forbids `provider`, `model`, `billing_mode`, `provider_connection_id` or endpoint URLs. The caller omits `input.model`; Macrofold injects the revision's served alias. Reject a supplied native model field rather than silently rewriting a possibly mistaken identity. A saved inference definition, when supported, resolves to this same binding and admission path; it cannot create another bypass.

The adapter preserves supported customer messages/parameters; it does not add an OpenLegend persona or OpenRouter routing/reasoning fields. Capability checks reject unsupported parameters, modalities, tools, streaming or schema keywords before dispatch. Do not silently drop a parameter, turn strict schema into JSON-object mode, add a repair call or change a reasoning mode.

Macrofold checks declared output/context policy and request bytes before Run admission. The authenticated managed wrapper then renders/counts the exact deployed tokenizer/chat template, including the actual model-visible system/schema/tool overhead, in the same upstream request before starting generation. It rejects overflow and never silently trims. This avoids a separate synchronous tokenization HTTP request on every NPC turn. A wrapper rejection after Run admission uses the normal terminal Run with `provider_outcome:"not_invoked"`, `outcome:"failed"` and `reason_code:"context_window_exceeded"`; it does not pretend no Run was admitted or no hosting time accrued.

An imported endpoint must qualify equivalent exact-tokenizer, overflow-rejection and no-truncation behavior for the in-game path. An operator-declared endpoint without that evidence remains an explicitly labeled offline diagnostic path with byte/output/deadline bounds and provider-context errors; approximate token counts are never presented as exact. The direct inference effective timeout remains **at most 240 seconds**, despite the broader shared schema's 300-second bound. Use the smaller of existing limits, qualified runtime capacity, provider ceilings and remaining activation admission time. `max_output_tokens` remains explicit; native max-token fields must be absent or exactly agree.

The initial serving profile produces one completion per request (`n=1`) and no runtime-initiated outbound tools. Returned tool calls remain data for the customer's normal authorization/execution path. Sampling seed is recorded when supported; GPU/runtime nondeterminism means the same seed is not a determinism guarantee.

Top-level `stream` continues to select Macrofold's existing native streaming transport. Stream framing, terminal Run receipts, cancellation, retrieval and replay remain the current protocol; do not invent a second SSE envelope. OpenLegend's first integration uses `stream:false` and final validated results. Later public text streaming depends on its separate speech-publication design.

## 6. Terminal receipt and cost semantics

Preserve all required current [inference receipt](../api/openapi.json) fields and statuses. `result.inference.value` contains the full provider-native ChatCompletion response, **not** already-decoded NPC JSON. OpenLegend reads its supported final text, parses the requested JSON and applies its existing current-world validation before acting. Truncation, reasoning-only output, a refusal, ambiguous/multiple usable choices or unsupported tool output is not a successful NPC action.

Add to every deployment-backed terminal `result.inference`:

```json
{
  "deployment": {
    "deployment_id": "22222222-2222-4222-8222-222222222222",
    "deployment_revision_id": "33333333-3333-4333-8333-333333333333",
    "activation_id": "44444444-4444-4444-8444-444444444444",
    "artifact_manifest_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "runtime_image_digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "qualification_id": "55555555-5555-4555-8555-555555555555",
    "identity_evidence": "verified_manifest"
  },
  "cost_attribution": {
    "basis": "deployment_activation",
    "activation_id": "44444444-4444-4444-8444-444444444444",
    "request_charge_micro_usd": "0",
    "infrastructure_cost_included": false
  }
}
```

These are additions inside the existing receipt, not a complete terminal response. Nullable unattested fields follow the activation projection. A receipt freezes its admitted revision/certificate and actual responding manifest evidence; returned headers/alias mismatch produces invalid output or uncertainty as appropriate, never another model call. `model_revision` identifies the known HF commit with `model_revision_status:"pinned"` only for verified pinned serving; an operator declaration alone must not be upgraded to provider attestation.

For the initial zero-per-request-fee BYOK policy:

- `billing.billing_mode:"byok"`, `charged_micro_usd:"0"` and `budget_cost_micro_usd:"0"` describe **this inference's separate request charge**.
- `reserved_micro_usd` retains the original caller ceiling; any unused request reservation releases through the existing settlement owner.
- `reported_micro_usd:"0"` is the frozen request-price result. It is not a provider GPU invoice.
- `provider_cost_micro_usd:null`, `provider_cost_status:"unavailable"`, `provider_reported_cost_usd:null`, `provider_reported_cost_status:"unavailable"`, `upstream_inference_cost_usd:null`: there is no truthful per-call infrastructure price here.
- Token `usage` and completeness remain factual counts; missing stays null. Request-fee settlement may be final even if GPU accounting remains uncertain; do not reuse one flag for both.

Explicit `max_cost_micro_usd:"0"` is acceptable only under this verified zero request-fee policy; it never creates free capacity or bypasses the activation authorization. OpenLegend may initially retain its existing positive reservation ceiling. Its no-external-call mode still blocks all calls, including prepaid/external servers.

Sum activation infrastructure cost once per unique activation, plus separately metered non-deployment calls, for an experiment's total. Do not apportion a shared GPU bill into fake authoritative per-character charges or sum estimated and reported versions. For comparable diagnostics, cost per valid result is whole measured experiment cost divided by valid results, explicitly a derived metric.

## 7. Admission errors, ambiguity and shutdown

Use the existing error envelope and Run recovery contracts. These codes are **pre-admission** results only when the server has established no Run/provider dispatch for this request:

| HTTP/code | Meaning | Caller behavior |
| --- | --- | --- |
| 400 `invalid_deployment_binding` | Mixed/missing identity or conflicting native model | Correct config; no call |
| 403 `permission_denied` | Current resource/grant/connection delegation insufficient | Stop; no fallback credentials |
| 409 `deployment_binding_stale` | Triple does not identify the selected revision/activation | Explicitly select a new profile; never substitute current |
| 409 `deployment_not_ready` | Provisioning, warming, qualification or lost readiness | Operator inspects activation; inference does not wake it |
| 409 `deployment_expired` | Admission window closed or activation terminal | Explicitly authorize a new activation if desired |
| 422 `unsupported_model_capability` | Format/context/parameter/schema not qualified | Change the declared experiment, not a hidden request downgrade |
| 429 `deployment_capacity` | Deployment concurrency exhausted | End this attempt or explicitly resubmit same identity within its original deadline |
| 402 `deployment_budget_exhausted` | Infrastructure admission ceiling reached | Stop; operator may separately fund a new activation |
| 503 `deployment_unavailable` | Before-admission service/dependency unavailable | Inspect; only confirmed no-dispatch failures may be retried under existing explicit policy |

No Run/provider dispatch for one request does not mean zero infrastructure charges: warm capacity can already be billable. Existing `inference_admission_unknown`, HTTP 202 reasons and ambiguous network responses remain authoritative. If a Run was admitted, report the normal terminal/recovery receipt with `provider_outcome` and uncertainty; never retroactively return a code promising no dispatch.

Existing SDKs default to one inference submission; keep that default. No automatic second model, provider retry, refusal retry, schema repair, larger allocation or reopened activation. Reusing a key recovers the same invocation; a changed body conflicts. Revocation, source drift, session stop and expiry fence future dispatch and publication; use existing cancellation/receipt recovery rather than duplicate application state machines.

Stopping sets `admission_open:false` transactionally, fences the activation, waits only its frozen drain allowance and aborts remaining requests. A request must fit within `admit_until`; no new work may consume the cleanup reserve. Provider teardown and final accounting are reconciled independently. A control-plane failure reports `cleanup_pending` with unresolved liability and operator action; neither a disconnected stream nor an accepted DELETE proves billing has stopped.

## 8. Contract acceptance and coordinated release

The implementer must verify the same golden native request and full terminal receipt through Macrofold REST/SDK and OpenLegend's actual serializer/decoder. Required checks cover exact triple, no model field/vendor leakage, final native response decoding, zero request fee with nonzero/unknown infrastructure cost, unknown dispatch recovery, expired/revoked grants, strict schema rejection, concurrency, identity drift and final shutdown evidence. Fixtures establish contracts; paid qualification establishes actual provider behavior separately.

Ship Macrofold schemas/domain/provider path and regenerate all current SDKs first. Publish a version whose API actually supports this contract. Then update OpenLegend's pinned client/serialization and start with explicit operator-only experiment configuration. An old server's missing endpoint/binding support fails visibly; never emulate support by falling back to OpenRouter.

The same branch name in two repositories is coordination, not an atomic release. Each implementation records tested client/server commits and runtime image digest. No default production model changes, public model marketplace, fine-tuning service, general GPU worker scheduler or automatic cheapest-provider router are required.
