# Hugging Face model deployments — technical design

| Status | Current progress | Last updated |
| --- | --- | --- |
| In progress | The technical design defines the serving and application boundaries; implementation and live provider qualification have not started. | 2026-10-22 |

## Scope and authoritative references

Implement the [feature specification](hugging-face-model-deployments-feature-spec.md) through existing Macrofold inference, authorization, operations, database and client-generation owners. The [shared contract](hugging-face-model-deployments-contract.md) alone owns public DTOs, endpoint examples, receipt fields and cross-repository conformance. The [research appendix](hugging-face-model-deployments-research.md) owns current vendor evidence and price comparisons. Implementation tasks and unsatisfied acceptance remain in [maintainer TODO](../maintainers/TODO.md#hugging-face-model-deployments).

The reviewed base is `Macrofold/Macrofold` at `07ba0ee1bb5c76aeb4d0d3553339dc274854335a`; its [codebase map](../architecture/codebase.md), [inference implementation](../features/decisions/implementation.md) and [Worker architecture](../architecture/worker-execution.md) distinguish existing behavior from the target below. This task changes documentation only: zero runtime logic lines, migrations, generated API files, dependencies or deployed resources. Future implementation is a coordinated, high-risk contract/lifecycle/accounting change and must follow the staged acceptance gates here.

## 1. Invariants and component ownership

The feature adds a model-serving resource, not a second application execution engine. Existing immediate inference remains the owner of Run identity, current application authority, request limits, provider dispatch, cancellation, output publication and response recovery.

| Owner | Responsibility |
| --- | --- |
| `apps/web` transport/composition | Validate public requests, authenticate, invoke domain operations, render statuses and existing inference streams; inject provider ports. |
| `packages/core` deployment domain | Organization ownership, immutable revisions, explicit credential delegation, quotes, finite activations, admission, capacity and lifecycle reconciliation. |
| Existing inference domain | One accepted model call, saved deployment snapshot, current-use rechecks, terminal receipt, result retention and no replay after uncertain dispatch. |
| `packages/providers` | Hugging Face metadata/download adaptation, RunPod v2 adaptation, qualified endpoint transport; no policy or permission grants. |
| Small model-serving image wrapper | Exact snapshot loading, provenance manifest, authenticated restricted HTTP surface, bounded request forwarding and health; vLLM performs inference. |
| Existing database/ledger/operations | Tenant isolation, immutable accepted terms, lifecycle identity/fences, request charges and separate infrastructure-cost observations. |
| OpenLegend | Character context/privacy, prompt/schema construction, permitted game effects, evaluation corpus, model-role selection and experiment conclusions. |

Required invariants:

- One inference binds one deployment revision and one activation. No implicit fallback, renewal, replacement activation or provider-funded retry.
- Creating or inspecting metadata has no GPU side effect. Paid provider mutations require a committed, current, finite activation authorization.
- Runtime code comes from an operator-reviewed immutable image; Hugging Face repository content is model data. No repository shell instructions, arbitrary image, `trust_remote_code`, generated code or implicit adapter merge is executed.
- Source/runtime identity, readiness, transport capability, application quality and authority are distinct claims. A successful `/v1/models` response establishes none of the others by itself.
- A confirmed zero request charge is not zero infrastructure expense. Unknown provider usage/charges remain unknown.
- An activation can stop accepting work before its infrastructure shutdown is confirmed. No missing acknowledgement proves that compute was never created or that billing ended.
- Native harness Workers/Hosts and application Worktrees/Sessions remain separate. Reuse appropriate money/fencing helpers without constructing a fake native Run for a model server.

## 2. Public operation flow

Use the endpoint and exact field definitions in the [shared contract](hugging-face-model-deployments-contract.md). The intended sequence is: inspect the source without compute → create deployment metadata with its first immutable revision → obtain a quote → activate that revision → inspect activation readiness → invoke through `/v1/inferences` → stop the activation → reconcile shutdown and provider cost. Later source/runtime changes use the explicit new-revision operation.

`InferenceBinding` becomes the union of the existing provider binding and the deployment binding. Keep `DecisionBinding` and the reviewed scoring protocol registry separate; this change does not make arbitrary vLLM models compatible with Jev/Decision 1 or automatically broaden bounded/native-agent execution. The current native-harness catalog's 128k context floor does not apply to deployment inference.

Deployment inference uses no `input.model`; the trusted adapter inserts the revision's served alias. Mixed provider/deployment bindings and caller-supplied model aliases fail before admission. Preserve allowed customer messages and native options; do not apply OpenRouter `provider` or `reasoning` rewrites to vLLM requests. Unsupported options fail explicitly rather than disappearing.

All control mutations use existing idempotency, request IDs, error envelopes, finite operation deadlines and pagination conventions. Exact immutable identities plus transactional current-state checks fence each action; the initial API has no metadata PATCH or separate mutable `expected_revision` field. Repeating an accepted request observes its original operation; it does not purchase another endpoint. Ordinary `GET` calls perform no lifecycle mutation or paid qualification.

## 3. Persistence and identity

Use existing UUIDv7 IDs, PostgreSQL tenant transactions, decimal-string public money, bigint internal micro-USD and the restricted runtime role. Add numbered forward migrations; do not alter historical migrations or introduce legacy schemas for the pre-launch product.

The following are logical relation responsibilities. The implementation may colocate compact columns with an existing operation owner, but must retain the same uniqueness, foreign-key and transaction guarantees.

| Relation | Stored facts and constraints |
| --- | --- |
| `model_deployments` | Tenant ID, resource ID, display name, creator and retirement intent. No mutable model weights or active provider credential in display metadata. |
| `model_deployment_revisions` | Immutable revision ID, deployment/tenant FK, normalized source, resolved HF commit, artifact manifest/hash, runtime image/config, effective limits, declared capabilities and provenance assurance. Unique immutable content digest within a deployment. |
| `model_deployment_grants` | Exact deployment/workspace/subject use grant, approving connection owner, delegation ceiling and revocation revision. Reuse existing resource-grant representation where it already expresses these facts. |
| `model_deployment_quotes` | Immutable revision/connection/provider/region/GPU offer, list-price source/time/expiry, resource limits and quoted financial assumptions. A quote is neither entitlement nor a resource reservation. |
| `model_deployment_activations` | Exact revision/quote/grants, creator, finite authorization/expiry, provider type, desired lifecycle, control generation, external identity, readiness/qualification ID, request capacity and cost-observation state. At most one nonterminal activation per deployment in the initial release. |
| `model_deployment_operations` | Stable activation operation/attempt identity, action, request digest, last confirmed provider outcome, uncertainty and next bounded reconciliation. This can use the existing operation store where its resource/scoping contract permits. |
| `model_deployment_qualifications` | Immutable tested revision/manifest/runtime/config, qualification protocol revision, capability results, test scope and timestamps. Store synthetic test outputs only under the existing protected evidence/retention owner. |
| `model_deployment_cost_observations` | Activation/account/rate attribution, observation interval, estimated or provider-reported amount, completeness, provider reference and immutable correction/supersession relation. Never mutate financial journals or fabricate per-call allocation prices. |

Reuse `runs.config` and the existing immutable invocation snapshot for the accepted deployment binding, artifact/runtime hashes, qualification ID, activation generation and request-charge policy. Do not copy the full model manifest or source files into every request. Immutable revision records retain the referenced manifest. Preserve minimal identity and financial references after content retention expires.

Every tenant FK includes the organization relationship. Apply FORCE RLS and existing transaction-local tenant context; public UUIDs are selectors, not authorization. Required indexes cover deployment list by organization, revision lookup by deployment, live activation by deployment, reconciliation due-time/status and cost observations by activation/time. Do not scan every historical Run to decide readiness or capacity.

### Identity changes

Changing weights, tokenizer, chat template, quantization, serving image, tensor-parallel layout, context/output bounds, credential binding/account or behavior-affecting serving flags creates a new revision. Cosmetic naming does not. An activation never changes its revision. Rotating a secret within the same connection changes its credential generation and current authorization; it does not rewrite historical revision evidence. Readiness is invalidated until current credentials, delegation and runtime access are reverified. Rotating a value must not secretly rebind a connection to a different provider account.

Readiness from an old provider generation or qualification cannot bless a replacement worker. Store the provider endpoint/worker generation where available and require the current wrapper manifest to match the exact accepted revision. A new worker may serve under an existing finite activation only after that check; replacement does not renew its budget or expiry.

## 4. Authorization and credential delegation

Add `model-deployments:read`, `model-deployments:use` and `model-deployments:write` consistently to API keys, resource restrictions, operation dispatch, CLI/SDK contracts and customer MCP capability exposure. Write authority covers metadata, quotes and explicitly funded finite activations; it is not granted by a model result. Management MCP remains read-only.

The OpenLegend backend needs read/use for its specific deployment plus ordinary Run read/write. It does not need deployment write, connection administration, provider account credentials or model download rights. A workspace-restricted key must satisfy both workspace and deployment-use restrictions; possession of one ID cannot widen either.

Existing BYOK resolution binds a connection to its owner. Do not bypass that check to share a personal provider key across an organization. The connection owner must explicitly delegate the exact compute/source connection to the deployment and approved use scope. Persist the approving principal, connection identity and authorization revision. Recheck current delegation, connection health and credential generation before provisioning, qualification and inference dispatch; a saved revision does not freeze permissions forever.

The first-release owner, inline acknowledgment, immutable grant creation/revocation and next-activation expansion rules are exact in contract §2–3. All selected private connections share that owner; multi-owner composition is unsupported. Do not build a second general connection-permissions system or require nonexistent approval IDs. Safe passive reads carry the same trusted workspace context as inference and expose accepted nonsecret financial terms for consumers.

Keep RunPod, Hugging Face and endpoint credentials separately encrypted. The inference client receives none of them. The serving container receives only its limited model-download access and per-activation serving/control material; it never receives the RunPod account administration key or unrelated platform secrets. Do not put secret values in quotes, manifests, image layers, URLs, argv, logs, traces or API responses.

Revocation closes new spending and inference. It must not erase the bounded cleanup authority needed to stop already-owned paid infrastructure. Retain the minimum sealed cleanup capability/reference until shutdown is resolved, with audited operator access; cleanup cannot perform inference or provision replacement capacity. If the upstream owner revokes the provider credential itself and remote shutdown becomes inaccessible, preserve the unresolved state and give the owner the provider resource identity needed to stop it directly.

## 5. Hugging Face source preparation

Accept only the source forms in the contract. Normalize a repository URL into a repository ID and optional requested revision; never fetch arbitrary URLs embedded in a model card. Use maintained Hugging Face interfaces with explicit host restrictions, bounded responses, timeouts, redirects and credential scoping.

Metadata preparation performs no GPU call. Resolve the requested ref to the complete immutable commit. Inspect task, architecture/configuration, safetensors index/shards or supported quantization files, tokenizer assets, chat template, advertised context and repository license/access metadata. Model-card prose supplies untrusted descriptive evidence, never commands or runtime flags.

Produce explicit compatibility findings for missing assets, ambiguous tokenizer/template, unsupported task/architecture/quantization, adapter-only artifacts, remote-code requirement, gated access and unknown memory. Do not turn “not found” during a timeout into an absent repository. An initial managed profile requires safetensors and `trust_remote_code=false`; pickle-bearing or executable artifacts are not silently loaded.

The model/tokenizer commits can differ only when explicitly selected and recorded. Use the resolved commit for every download, including tokenizer and template. Do not follow `refs/main`, choose the first local snapshot directory, or download a newer revision after a failed load. A user-authored chat template becomes an explicitly reviewed/hash-pinned revision input, not a string copied from an untrusted README into executable shell.

Calculate a transparent memory estimate from actual weight bytes/quantization, runtime overhead, KV-cache requirements at selected context/concurrency and temporary loading/workspace needs. Record estimate assumptions and uncertainty. Parameter count × bytes per parameter is not a sufficient fit test; quantization reduces some weight storage but does not make KV cache free. Final fit is established only by paid startup and representative qualification. An out-of-memory result cannot automatically purchase a larger GPU.

## 6. Runtime profile and serving wrapper

Maintain a small operator-reviewed registry of immutable runtime image digests and supported architectures/quantization, tokenizer/template handling, schema engine and transport options. A deployment references a concrete entry; no arbitrary Docker image, package installer, runtime Python module or shell command arrives from the public API. The registry is configuration/source with a clear owner, not a new general plugin marketplace.

The initial image layers a narrow wrapper around a pinned official vLLM runtime. Its work is necessary for authentication, immutable loading, health and provenance; it must not implement token generation or duplicate vLLM's scheduler.

### Startup sequence

1. Validate the supplied revision/activation manifest and finite expiry before contacting Hugging Face. Read credentials through the approved secret delivery mechanism, never command interpolation.
2. Download exactly the selected files at the resolved commits into an activation-scoped or verified content-addressed cache. Reject traversal, symlink escape, unexpected executable files and partial downloads. Verify file size and available repository content hashes; compute final SHA-256 hashes of the loaded artifacts for the manifest.
3. Record the actual model, tokenizer and template hashes, runtime image digest, serving flags, hardware and effective context/output/concurrency in the startup manifest. A model alias is only an alias. No invented hash is returned for an operator-asserted external endpoint.
4. Launch vLLM with exec-form arguments and explicit model/tokenizer revision or verified local snapshot paths. Use the revision-specific served alias, bounded `max-model-len` and `max-num-seqs`, supported quantization and explicit remote-code prohibition. Remove the HF download credential and wrapper/control secret from the child environment; the engine receives neither after the verified snapshot is prepared. Do not infer support from an arbitrary provider model name.
5. Bind vLLM only to the container's loopback serving port. Expose the wrapper on the provider's configured port. Keep provider routing health unready until model loading, manifest verification and basic transport readiness finish. Then allow provider routing so Macrofold can run qualification; application `admission_open` remains false.
6. Complete bounded synthetic qualification within the activation's time/cost allowance. Publish the activation as ready only after the current revision/worker generation and required capability checks pass. Provider routing health and Macrofold application admission are separate state predicates.

Startup/download work consumes real provider time. The initial v2 integration does not rely on undocumented `cachedModels` fields or an unverified mutable model cache. Cache optimization is permitted only when exact revision/path/hash verification and its storage charges remain visible.

### HTTP surface and defense in depth

The exposed wrapper permits only the necessary chat and model/provenance inspection routes defined by its private protocol. All non-health routes require a generated per-activation secret in a dedicated header, constant-time verification and body/time limits. It defaults to deny for every other route, including vLLM administrative or alternate inference routes. Health exposes only readiness, never source credentials or prompts. Do not assume stock vLLM's API-key flag secures every route.

RunPod edge authentication and wrapper authentication have separate purposes. The Macrofold adapter supplies RunPod's bearer to the provider and the dedicated wrapper header to the worker; the worker does not need the account bearer. Actual header forwarding and absence of unauthenticated/direct-port bypass are mandatory provider acceptance tests. If either fails, the backend remains disabled until a supported transport satisfies the same boundary; do not silently remove wrapper authentication.

The wrapper checks its immutable activation expiry locally and rejects new generation after it. This limits useful inference if the control plane is unavailable; it is not proof that GPU billing stopped. Bound request bodies, queue entries, streaming buffers and total deadlines. A non-sensitive manifest response is authenticated and includes only current runtime evidence, not model payload bytes or secret material.

Before forwarding a chat request to the inference engine, count its actual rendered input with the pinned tokenizer/template, including tool/schema text only when that runtime renders it into the prompt. Check input plus requested completion against the effective window; validate the exact grammar/schema against the pinned engine. Reuse the serving engine's maintained tokenizer/template/grammar preparation rather than implement a second approximation. The ordinary wrapper request performs this check once; do not introduce a separate per-call management or `/prepare` network round trip. vLLM retains its own final context enforcement with truncation disabled.

A trusted wrapper rejection that definitively occurred before model-engine forwarding can finalize the already-admitted Macrofold Run with `provider_outcome:not_invoked`, the typed overflow/schema reason and zero request fee. Its warm host may still cost money. A lost response or an unverified external error is not proof of nonexecution and follows normal uncertainty handling. External endpoints need certified overflow rejection/no-truncation and a trustworthy tokenizer/context contract for the in-game bounded-context profile; otherwise they remain explicitly offline screening candidates.

### Private wrapper protocol

Keep this small protocol inside the model-serving implementation; it is not a second customer API or native Host-control protocol. Add its exact types/validators together with the image and adapter, and pin a protocol revision in the runtime profile. The following minimum surface is sufficient:

| Route | Authentication and behavior |
| --- | --- |
| `GET /ping` | Provider routing health only: 204 while initializing, 200 after model loading, manifest verification and basic transport readiness. This permits qualification traffic while application admission remains closed. No content or identity details, token generation or activation extension. |
| `GET /_macrofold/manifest` | Require `X-Macrofold-Worker-Key`; return protocol revision, the exact ID triple, verified manifest/hash, image digest, worker boot ID, served alias, effective limits and `transport_ready`. It cannot grant application admission. |
| `POST /v1/chat/completions` | Require the worker key and trusted invocation/activation/revision headers; validate identity, expiry, request bounds, schema and exact context before forwarding to loopback vLLM. Preserve native JSON/SSE semantics and return the current manifest/boot identity in response headers. |
| All other paths/methods | Default deny; no raw `/invocations`, tokenizer, admin, documentation, metrics or filesystem route exposed by accident. |

The worker key is distinct from RunPod's bearer. The managed adapter supplies an invocation UUID for correlation, never as proof of authority. Validate the requested activation/revision against the immutable startup manifest, and compare the returned identity before accepting a successful result. The wrapper's bounded errors identify a stable code and whether the model engine was definitively not called; only authenticated, expected-manifest responses from this trusted wrapper can establish that fact. A timeout, proxy-generated error or missing terminal marker remains uncertain as appropriate.

Version the private protocol as `macrofold-model-serving/1`. Use the following headers on the adapter-to-wrapper hop; none is accepted from a customer as authority, and none includes a credential reference beyond the dedicated secret itself:

| Header | Exact value and validation |
| --- | --- |
| `X-Macrofold-Worker-Key` | Per-activation cryptographically random secret; compare in constant time, redact everywhere and never echo. |
| `X-Macrofold-Invocation-Id` | Existing accepted inference invocation UUID; synthetic qualification uses its separately persisted qualification-case UUID. It is a correlation key, not a promise of replay safety. |
| `X-Macrofold-Deployment-Revision-Id` | Exact UUID matching the startup manifest. |
| `X-Macrofold-Activation-Id` | Exact UUID matching the startup manifest. |
| `X-Macrofold-Request-Deadline` | Absolute UTC RFC3339 timestamp from the accepted Run; reject a past deadline or one later than the activation's `admit_until`. Never reset its duration when forwarding. |
| `X-Macrofold-Serving-Protocol` | Exact `macrofold-model-serving/1`; reject unsupported versions. |

Successful or definite pre-engine error responses echo the serving-protocol version and include `X-Macrofold-Artifact-Manifest-Sha256` and `X-Macrofold-Worker-Boot-Id`. The former must match the accepted verified manifest; the latter identifies the qualified current process generation. A missing or mismatched value cannot finalize a trusted success. Keep native ChatCompletion/SSE bodies unchanged on successful calls. A private wrapper error uses `{error:{code,message,engine_invoked:false}}` only when rejection is definitive before forwarding; codes include `activation_expired`, `binding_mismatch`, `context_window_exceeded`, `schema_unsupported`, `request_limit_exceeded` and `wrapper_unready`. Once forwarding starts, omit a nonexecution claim even if downstream transport fails. The adapter maps these private errors into the existing Macrofold Run error/recovery envelope and never leaks the serving secret or full internal response.

Use the serving image's existing maintained Python HTTP/ASGI stack and streaming client where practical; pin any extra dependency with the image. No additional orchestration service or database is needed inside the image. Forward streaming with backpressure, bounded frames/total output and one upstream request; disable HTTP-client automatic retries and redirects. Client cancellation closes upstream transport, but the control plane retains uncertainty unless completion/cancellation evidence is definitive. No wrapper guarantee of exactly-once inference survives arbitrary remote failure; the existing Macrofold dispatch identity remains controlling.

The wrapper must enforce context, grammar and expiry using the same resolved runtime settings it serves. It may use documented vLLM preparation/tokenization APIs internally over loopback or a pinned maintained tokenizer library, but may not approximate another template or assume serialized JSON bytes equal tokens. Treat a mismatch between preparation and engine enforcement as a qualification failure. The implementation records the exact supported preparation path in the runtime profile; changing it creates a new revision/certificate.

### Imported endpoint evidence mode

The ID-bound startup secret/expiry protocol above applies to managed activations. An externally operated server must not be implicitly restarted or rebound every time Macrofold creates an activation. The same reviewed wrapper has a separately registered `external_evidence` mode: its immutable startup configuration binds artifact/runtime/template/limits and a stable endpoint credential, with no Macrofold deployment/activation UUID or lifetime embedded. Authenticate through the existing encrypted endpoint connection; the wrapper key is endpoint-scoped in this mode. Manifest and response headers attest the measured source/runtime hash and current boot ID, not the current Macrofold activation.

The imported adapter sends the protocol version, invocation ID and accepted absolute request deadline, but does not require activation/revision headers to match an external startup manifest. It checks the qualified stable manifest/boot, while Macrofold independently enforces current grants, exact binding, activation expiry and stop. The wrapper enforces each authenticated request deadline plus exact context/schema/byte/output bounds. Macrofold writes its accepted binding triple into the receipt; it never infers external lifecycle control from that receipt. A newly observed boot must be qualified before application use. Stopping Macrofold use does not stop or reconfigure this server.

`verified_manifest` means measurement by the reviewed authenticated wrapper under the configured operator trust boundary, not cryptographic hardware/TEE attestation or immunity to a malicious hosting owner. An arbitrary endpoint's self-reported hash or `/v1/models` alias remains `operator_declared`. The initial imported route supports private offline screening without the wrapper; promotion to OpenLegend gameplay requires the compatible measured wrapper, exact-tokenizer/no-truncation behavior and all application qualifications. Pin the external wrapper mode/version in its runtime profile so the adapter cannot silently weaken managed checks.

## 7. RunPod adapter and finite activation lifecycle

Use the verified REST v2 serverless API, not deprecated GraphQL or guessed fields from older documentation. The provider adapter maps a trusted plan into a Load Balancer endpoint with an inline owned container configuration, a pinned image, exec-form arguments, approved env/secret delivery, explicit port, selected GPU pool/count and explicit worker/scaling values. The research appendix records current vendor field evidence.

The adapter's private request mapping is based on the current [official v2 OpenAPI source R05](hugging-face-model-deployments-research.md#source-register) and must be reverified against the pinned provider schema during implementation:

| Purpose | RunPod v2 mapping |
| --- | --- |
| Create/list | `POST` / `GET https://api.runpod.io/v2/serverless`; use bounded cursor pagination with `nextCursor`/`hasNextPage` during reconciliation. |
| Inspect/update/delete | `GET` / `PATCH` / `DELETE /v2/serverless/{id}`; workers are `GET /v2/serverless/{id}/workers`. |
| Endpoint type | Top-level `type:"LOAD_BALANCER"`. Queue-based `/run` is not used. |
| Owned image/config | Top-level `image` is the immutable OCI digest; `cmd` is an argv string array and `entrypoint`, if required by the reviewed image, is also an argv array. No shell expansion or shared `templateId`. |
| Disk/ports | Explicit `disk` in GB, sized by the profile, and `ports:["8000/http"]`; the engine port remains loopback-only. |
| Environment/health | `env` maps strings to strings and includes `PORT:"8000"`, `PORT_HEALTH:"8000"`, `HEALTH_CHECK_PATH:"/ping"`, nonsecret identity tags and the approved secret material. Provider env visibility must be restricted to authorized account operators. |
| GPU | `gpu:{pools:[catalogPoolId],count:...}` from the accepted offer. Pool IDs are not GPU type/display IDs. Use the profile's supported `allowedCudaVersions` or `minCudaVersion`, never incompatible simultaneous constraints. |
| Placement | `dataCenterIds` expresses documented preferred data centers. It is not a provider guarantee of strict residency. |
| Worker/scaler | Explicit `workers:{min:1,max:1,idleTimeout:...}` with idle timeout in seconds within 1–3600; `scaling:{type:"REQUEST_COUNT",requestCount:...}` uses the qualified positive integer concurrency target. Fixed min/max still bounds capacity to one. |
| Provider request timeout | Explicit `timeout` in milliseconds; keep it consistent with profile/transport limits. It cannot extend Macrofold's accepted deadline or 240-second effective execution ceiling. |
| Optimizations | `flashboot:"OFF"` until that optimization is separately qualified for immutable identity. No guessed `cachedModels`, provider idempotency or labels fields. |
| Stop | `PATCH /v2/serverless/{id}` with `workers:{min:0,max:0}`, followed by observation and owned-endpoint deletion as required. No unrelated config rewrite. |
| Inference origin | Validate the returned HTTPS `requestUrls.base` against the approved provider-origin policy, then use `/v1/chat/completions`; never send inference to the management API origin or follow an arbitrary redirect. |

An accepted offer freezes eligible GPU types and the pool's maximum accepted rate separately. The provider can add a new GPU type to an existing pool; its optional `gpu.excludedTypes` is an exclusion list, not a permanent inclusive allowlist. This threatens compatibility/provenance even when the pool price is unchanged. Verify actual worker GPU, accepted location, image and applicable pool rate before application readiness. An unaccepted type/location or unknown/excess rate closes admission and triggers cleanup; startup exposure remains reportable. If strict residency cannot be guaranteed by the provider, reject a policy requiring that guarantee instead of presenting preferred placement as enforcement.

For the first release, configure a finite warm activation with minimum and maximum workers both one. Always send the maximum explicitly; the provider's default is larger. There is no request-triggered sleep/wake policy in this feature. A starting or replacement worker is not application-ready until its exact manifest and qualification pass. Current provider availability is not guaranteed by a catalog quote.

Do not PATCH an active endpoint to new weights/image/environment and call the same immutable revision ready. Provider updates can leave old workers serving until they cycle. A new revision receives a distinct endpoint/activation after the previous activation is stopped, or a separately authorized deployment when parallel comparison is intended. The initial one-nonterminal-activation rule prevents accidental overlap on one deployment; two deliberate deployments still consume two budgets.

### Provisioning identity and ambiguous creation

Before provider POST, commit the activation, exact desired configuration digest, provider attempt ID, current authority and accepted funding. Include nonsecret Macrofold deployment/activation/attempt/manifest identifiers in the provider configuration so a later inventory can identify that exact attempt. Provider names are not assumed unique.

Make one creation attempt. On a definitive success, persist the returned endpoint identity before readiness work. On an ambiguous network/response/commit failure, retain the same attempt and unresolved exposure. Inspect the owned provider account's bounded, paginated endpoint inventory and compare the full configured identity. A matching resource may be adopted only when identity and configuration match. Multiple matches or conflicting configuration require explicit reconciliation; do not choose the first match.

A successful inventory with no match is not automatically proof of noncreation when the provider's consistency contract is unknown. Do not repeat POST without a supported definitive absence/idempotency guarantee or an explicit operator reconciliation of the old attempt. This is a deliberate availability tradeoff to avoid duplicate paid resources.

### Bounded state transitions

Persist desired state, observed stage, control generation and financial certainty separately. Public enum names are owned by the shared contract; the lifecycle must represent these distinct facts:

| Transition | Required durable condition |
| --- | --- |
| Metadata to activation accepted | Exact quote/revision/connection/grants, finite expiry and limits commit before external mutation. |
| Provisioning to loading | Provider resource identity is known and matches the accepted attempt. |
| Loading to qualification | Current runtime manifest matches the pinned artifact/runtime; health and finite remaining time permit checks. |
| Qualification to ready | Required capability evidence matches this revision/generation; accepted use authority/funding remains valid. |
| Ready to draining | Stop, expiry, revocation, budget threshold or failure atomically blocks new admissions and increments control generation. |
| Draining to stopped | Accepted requests have finished/cancelled within their deadlines and provider capacity is confirmed stopped, or external lifecycle is explicitly recorded as unmanaged. |
| Any ambiguous external outcome | Retain operation identity, known resource references and uncertain financial tail; reconciliation cannot replay generation or provision again. |

Use existing bounded maintenance/operation scheduling and short fenced SQL claims. Provider requests happen outside SQL transactions. A lease/generation check prevents late create/health/qualification callbacks from overriding stop intent. A stale process can report evidence, but cannot reactivate or grant dispatch. Bound reconciliation attempts, pagination, response bytes and total time; exhaustion surfaces recovery-required state without discarding obligations.

### Stop, expiry and cleanup

Stop first prevents new admissions and captures the exact control generation. Gracefully drain accepted requests within their already accepted deadlines and the quote's drain allowance, bounded by the activation's finite lifetime. New calls that cannot fit their execution plus cleanup allowance before expiry reject before admission. When the drain deadline arrives, cancel remaining Runs through their normal cancellation owner and continue provider shutdown; do not pretend remote work was never dispatched. The initial stop API has no separate force option.

For managed RunPod capacity, make a bounded request for workers minimum/maximum zero as drain completes, then DELETE this activation's disposable owned endpoint. Deletion must not depend on successful scale-down or a zero-worker list: a failed PATCH/list must not strand capacity that DELETE can terminate. Preserve the known endpoint/attempt identity through timeout and retry only the idempotent cleanup under the same operation; never create replacement capacity. Use inline owned configuration so deleting an endpoint cannot destroy an unrelated shared template. Provider deletion/absence and worker observations require separate cost reconciliation; one successful control response is not proof of a final invoice. Late or stale workers remain unready and cannot accept newly admitted calls.

Separate metadata retirement from resource cleanup. Do not delete deployment/revision/activation records while they are referenced by Runs, unresolved operations or money. Archival is metadata-only after cleanup is resolved; the proposed delete operation must preserve immutable history. Disabling the feature still runs cleanup/reconciliation for outstanding activations.

The proposed deployment DELETE operation records retirement intent and runs the same stop/cleanup owner; it never removes financial or historical evidence. A provisioning failure is terminal `failed` only when absence or final teardown of owned capacity is established. Otherwise the activation remains `cleanup_pending`, with its failure reason preserved. `stopped` may coexist with a pending invoice once compute is confirmed stopped; an uncertain stop must not be mislabeled stopped. Old stopped-but-unreconciled financial references remain counted in account reporting when a deliberate new activation is authorized.

## 8. Inference integration and request capacity

Resolve the exact binding and current permitted activation in preparation. Select the runtime adapter from trusted revision metadata. Prepare the canonical provider body once, validate supported fields/schema/limits and reuse the encoded bytes through admission and dispatch. Never fetch Hugging Face, discover prices or start model servers on the inference critical path.

Admission composes with the current short inference transaction: current principal/workspace/use grants, activation revision/generation/expiry, qualification, finite request capacity, existing Run concurrency, exact request-charge policy and idempotency. Claim an activation slot atomically with the accepted Run so two API instances cannot overbook the one-worker profile. Release the slot only at the existing terminal/recovery boundary that proves active dispatch ownership ended; unresolved dispatch must not be treated as free capacity prematurely.

The first profile's concurrency is selected from representative qualification and advertised as an effective limit; do not assume all single-GPU models safely handle the same number of sequences. The initial request returns one completion (`n=1`), with supported native maximum-token fields absent or exactly equal to the declared output allowance. Capacity exhaustion is a confirmed pre-admission refusal with the contract's retry guidance. Do not add a durable per-model inference queue or use RunPod's queue-based `/run` semantics. Provider-side bounded batching inside vLLM remains an implementation detail within the accepted request deadline.

The effective direct-inference execution limit remains the current 240 seconds, even though a shared schema also supports other modes. Shorter application/activation/provider limits win. Cold startup and qualification happen before readiness; the RunPod load-balancer wait limit does not extend a request's accepted deadline.

Current authority observation must include deployment-use revocation, activation stop/generation and expiry with the existing batched content-free controls. It does not reread full manifests or prompt bodies. Immediately before dispatch, verify current authorization within the normal owner window. If readiness disappears between admission and provider call, preserve the same admitted identity and classify the observed failure; never create another activation or model call to hide the race.

### Output and recovery

The custom adapter returns the same native chat response shape under `result.inference.value`. It preserves complete supported text/tool/structured response content and token usage, validates the expected served alias and records actual provenance separately. Unknown/malformed usage is not invented. Refusal, truncation, invalid structured output, transport failure and uncertain completion retain the existing distinction; no generic successful canned answer is generated.

Use the existing transient output event/terminal receipt path for streaming. No SQL write per token, no automatic POST reconnect and no execution from partial tool arguments. Cancellation/timeout may leave provider work or charges uncertain. An HTTP 202 continues to mean the original admitted Run needs observation or finalization, never that a model server is being cold-started for the caller.

The receipt's deployment and cost-attribution objects are specified in the shared contract. Save them with final output/accounting before terminal success. Replayed results retain the original deployment/activation evidence even if those resources have since stopped or a newer revision exists. Historical evidence does not grant present use authority.

## 9. Billing and infrastructure-cost treatment

The initial activation uses the customer's exact RunPod account or an externally managed endpoint. Macrofold does not resell GPU time in this release. There is no managed-key fallback, token-derived invented GPU rate or second reservation for the same infrastructure expense.

For deployment-backed requests, the frozen request-charge policy is zero; the existing request billing fields therefore describe zero request liability. The separate `cost_attribution` object explicitly says infrastructure expense is not included and identifies its activation. Missing token usage may remain missing while the known request fee is zero. Neither fact establishes the provider bill. Existing token-priced provider bindings preserve their current financial behavior.

### Quote and planning calculation

Obtain current compatible GPU offers through the reviewed provider catalog. Normalize decimal prices with exact arithmetic, record source and retrieval/expiry time, and include GPU count and the highest authorized pool rate. No mutable environment price JSON or floating-point dollar arithmetic is introduced. Quotes exclude unaccepted discounts and disclose storage, download/startup and any known additional billable dimensions. Reject an offer with an unknown required charge rather than pricing it at zero.

An activation's conservative compute projection starts at the committed provider-submission time and assumes its maximum authorized worker count at the maximum accepted rate until confirmed stop. Round duration to the provider's billable quantum **before** rounding money: for a worker epoch at a per-GPU hourly rate, `billable_seconds = ceil(elapsed_milliseconds / 1000)` and `cost_micro_usd = ceil(rate_micro_usd_per_gpu_hour × gpu_count × billable_seconds / 3600)`. Sum distinct observed worker epochs, retaining possible startup/replacement overlap; `max_replicas:1` is not evidence that historical billed epochs never overlap. An unknown worker interval is unresolved exposure, not zero. Maintain cumulative observations by epoch so polling frequency cannot change totals. For example, at $0.69/GPU-hour a positive one-millisecond epoch projects one billable second, or 192 micro-USD, not one micro-USD.

Disk/storage meters likewise retain their documented quantum (currently five-minute container-disk billing) and exact provider period conversion. Round each billable resource epoch up to that quantum, then compute exact decimal-rational cost and ceil to micro-USD; do not substitute a guessed 30-day month for an unspecified vendor conversion. A managed quote is unavailable until required units/conversions are established by the adapter's verified price metadata or a conservative documented upper bound. Include all known startup/download/idle/busy/cleanup dimensions once. Reuse existing exact pricing helpers only when their units/rounding match. Unknown replacement or shutdown intervals prevent a hard financial-bound claim and remain visible in cost observations.

The quote fixes an absolute authorization expiry from its creation time and requested duration. Its acceptance deadline is no later than the configured quote freshness window or the remaining start/drain allowance. Activation echoes that exact authorization expiry; accepting a quote later does not reset or extend the purchased period. Re-quote explicitly when the useful experiment window has become too short.

The activation must fit its declared startup, useful execution and drain allowance inside its time and planning ceiling. Start draining when remaining conservative allowance cannot cover another bounded call plus cleanup. The quote/activation UI must not call this a guaranteed provider hard-dollar cap: a failed stop or delayed provider observation can leave real BYOK exposure beyond the planning estimate.

Use the contract's single budget invariant `C(t) + R <= B`, where cleanup reserve `R` is contained in accepted maximum `B`; do not include the same future cleanup interval in both terms. Derive the budget admission deadline conservatively, intersect it with the frozen wall-clock `admit_until`, and require every proposed request deadline to fit. Admission/reservation is per activation, not a repeated infrastructure reservation per concurrent inference. Persist a maintenance wake-up for the boundary so idle capacity stops without a new application call. If new worker/charge evidence invalidates the bound, close admission immediately and reconcile rather than silently expanding authorization.

Keep estimates, provider-reported amounts and reconciled account evidence distinct. RunPod's aggregate billing buckets may include several activations or endpoint periods; do not assign a bucket's entire expense to every invocation. Preserve activation/provider identity and interval; report an attributable range or unknown amount when precise allocation is impossible. Rate changes affect new quotes; accepted terms are never silently repriced. A newly observed charge outside accepted assumptions blocks new work and requires reconciliation.

Implement the contract's owner-authorized append-only cost reconciliation operation. Confirm resource shutdown/coverage first, store the owner's provider statement/invoice reference and digest without exposing the invoice, and publish the explicit owner-attested basis. This is the minimal path to final financial evidence because the provider API supplies no finality flag. Corrections supersede rather than mutate; later conflicting charges reopen uncertainty. Reuse the existing restricted audit/evidence and cost-observation owners, not an inference charge or invented ledger credit.

### External endpoint accounting

An externally managed endpoint must have the owner-declared zero marginal request charge required by the initial contract, with a separately known, estimated or unknown host cost. Preserve that declaration and the explicit external-cost acknowledgment. Its activation authorizes finite Macrofold use; it does not purchase, cap or control the external host. The quote's infrastructure amount/rate may therefore be null with `external_unknown`, unlike managed RunPod pricing, where unknown required charges block activation. An unknown pay-per-request endpoint is ineligible; do not use the zero-request-cost path to bypass billable upstream inference. A local machine's purchased hardware/electricity is not an automatic zero total-cost claim.

## 10. Qualification and immutable capability evidence

Metadata establishes candidacy. Paid startup establishes loadability. Bounded transport tests establish only the capabilities exercised on the exact source/runtime/configuration. OpenLegend's held-out character evaluation establishes application quality separately.

Qualification records at least: exact manifest/runtime identity, actual served alias, plain chat request/response, final token usage status, maximum tested context/output, unsupported-option behavior, structured schema compile/response where offered, streaming framing/terminal markers when offered, cancellation/deadline behavior and observed latency/memory. A generated answer does not prove immutable model identity; a schema-shaped answer does not prove its meaning.

Implement qualification suites as versioned deterministic case manifests in the application, not runtime-authored model instructions. A suite names every permitted generation request, its maximum input/output, expected transport/schema properties and total request count. Quote the exact suite digest and aggregate allowances before activation. Do not probe an unadvertised mode, continue past the suite ceiling or retry a failed/ambiguous generation. Completion of a subset leaves untested capabilities false/unqualified.

The initial core suite covers: one bounded plain chat with complete usage; one refusal/truncation/error decoding fixture at the adapter boundary without paying for a deliberately unreliable real response; actual requested JSON-schema cases for advertised features; one actual streaming request only when streaming is being advertised; and context-boundary/no-truncation preparation checks through the protected runtime. Deterministic permission, malformed-frame and fault-injection cases belong in local fixtures, not a costly repeated live sweep. OpenLegend supplies its actual schema-family corpus to a separately selected qualification/evaluation suite with its own finite request count. Case manifests explicitly distinguish zero-generation preparation checks from charged model generation.

Each initial runtime profile must provide an operator-reviewed image digest, exact supported input/parameter schema, nonzero context/output/concurrency bounds, startup and drain deadlines, bounded disk/download allowance, maximum response/stream buffer sizes, and the available qualification suite IDs. These are explicit required profile values, validated and displayed in the quote; there is no magic unbounded or guessed default. The 300-second quote freshness default, one-replica initial limit and 240-second immediate inference ceiling remain owned by the shared contract and existing inference policy. Concrete GPU/model tuning is supplied by the profile and then verified, not hardcoded as a universal property of all Hugging Face models.

Treat strict JSON schema as a profile capability with an explicit supported dialect/keyword set and tested schema corpus. Reject obviously unsupported schema keywords before Run admission; the trusted wrapper compiles the exact grammar before model execution without a second network preparation request. Never silently downgrade strict schema to JSON mode, textual instructions or a repair model. OpenLegend additionally qualifies its actual generated schema families and near-window contexts; Macrofold's general capability report is necessary but not sufficient for game promotion.

Capabilities include native text, JSON schema, tool-call formatting, streaming and effective limits separately. Do not advertise embeddings, multimodal input, native harness use or Jev scoring because chat works. Unsupported modes fail before dispatch. Qualification consumes the same finite activation and appears in its cost accounting; it is not a hidden free provider call on every status request.

For an external endpoint without the wrapper, label artifact/runtime evidence as operator asserted or unavailable. Store its exact origin, asserted source and served alias without manufacturing file hashes. Capabilities may still be empirically qualified, but provenance assurance remains weaker. A changed external manifest or reported model/limits invalidates the old qualification; readiness must not continue from stale evidence.

## 11. Client, dashboard and operational integration

Extend the existing OpenAPI owner and regenerate the TypeScript, Python, Go, Rust and Java contracts/resources through the established tooling. Update maintained union/serialization helpers where the pinned generators need them; never hand-edit generated clients. Preserve absent versus null, exact decimal strings, binding exclusivity, mutation identity and stream recovery.

CLI operations mirror metadata, revision, quote, activation inspection/start/stop and ordinary inference. Machine-readable stdout contains only the contractual result; progress goes to the existing diagnostic channel. Never accept secrets in command-line arguments. The dashboard composes the same public/domain operations and shows planning, startup/qualification, ready, draining, uncertainty and unreconciled-cost states without optimistic false success.

The normal use path is paste repository → inspect compatible revision → review quote/finite limits → start → copy application binding → stop. Advanced source/runtime details are available for diagnosis and reproducibility. A user cannot accidentally treat “stop Macrofold use” for an external endpoint as “stop its hosting bill.” Documentation and client examples must preserve that distinction.

The existing maintenance host/poller owns bounded provider observation, expiry and cleanup. No dedicated queue, Redis, Kubernetes or new always-running controller is required just to implement these operations. Deployment credentials, provider quotas, immutable image digests and supported offerings are operator configuration. Defaults and permitted user controls are application-owned policy with one source.

Expose content-free operational metrics: active/starting/uncertain activations, provider-create and readiness durations, startup failures, current slots, accepted/rejected inference, request/first-token latency, model usage completeness, estimated/reported costs, stop latency and outstanding cleanup. Existing protected tracing owns prompt/output retention; deployment administration does not grant access to other users' inference content.

## 12. Implementation map and dependency order

| Stage | Concrete code ownership and required completion |
| --- | --- |
| MD02: contract and storage | Add authored OpenAPI schemas/operations and `InferenceBinding`; tenant migrations, resource/scopes, immutable revision/activation models and grants. Update `core/http-contract.ts`, operation registry, API handlers, generated clients and resource restrictions together. |
| MD03: deployment inference | Add narrow core deployment resolution and trusted custom-chat protocol; integrate `inferences.ts`, invocation preparation, authority controls, direct/streaming result publication and receipt attribution. Preserve ordinary provider/Decision bindings. Exercise a real local synthetic endpoint through HTTP and SDK. |
| MD04: managed lifecycle | Add core quote/activation/reconciler owners and provider Hugging Face/RunPod adapters. Use existing operations/maintenance scheduling, exact pricing and current authorization; complete uncertain-create/stop and finite-expiry behavior. |
| MD05: serving image and qualification | Add the small pinned wrapper image/manifest protocol, bounded source loading and capability checks. Verify all exposed routes, snapshot integrity, no remote code, actual limits and worker-generation readiness. |
| MD06: user surfaces and rollout | Add CLI/dashboard lifecycle paths, API/SDK guidance and provider configuration. Publish/regenerate docs only when runtime capability ships. Coordinate with the OpenLegend consumer and both release revisions. |
| MD07: live and failure qualification | Complete the real provider/credential/cost/cleanup and cross-repository matrix below before enabling an offer; retain fixture/live distinctions and measured limits. |

Existing owners to inspect before implementation include `core/inferences.ts`, `direct-inference.ts`, `inference-invocations.ts`, `inference-control.ts`, `inference-receipt.ts`, `decision.ts`, `decision-models.ts`, `model-credentials.ts`, `model-gateway.ts`, `worker-pricing.ts`, `operations.ts`, `http-contract.ts`, provider `decision-protocols.ts`/`native-inference.ts`, the numbered database migrations, API schema/generation and affected SDK transports. New deployment modules should compose those owners rather than copy their authorization, Run lifecycle or ledger SQL.

Do not extend native harness admission or merge custom deployment selection into the global provider model cache in this project. Deployment discovery is tenant-scoped; reviewed scoring-model catalogue discovery remains its separate tracked feature.

## 13. Verification matrix and release gates

Implement behavioral tests under the repository's [testing policy](../../TESTING.md). This design-only change does not create runtime tests. Later fixtures use disposable tenants/databases, synthetic credentials and network guards; paid live checks require an explicit finite experiment authorization. A test cannot import spending permission from OpenLegend's repository policy.

| Boundary | Required evidence |
| --- | --- |
| Public binding | Existing provider calls unchanged; deployment binding accepted only on intended inference paths; mixed/missing IDs and caller `input.model` rejected; all-five-SDK serialization agrees. |
| Tenant/grant/credential | Wrong tenant/workspace/deployment denied, owner delegation explicit, revoked source/compute/use grants block new effects, no platform fallback or secret disclosure. Cleanup remains possible under its narrow authority. |
| Source/runtime | Exact branch-to-commit resolution, gated denial, shard/template/tokenizer changes, cache corruption, unsupported format/remote code, wrong image/manifest, failed download and out-of-memory produce explicit outcomes and cleanup. |
| Provider lifecycle | One POST under concurrent activation attempts; lost acknowledgement/late callback/stale inventory cannot duplicate create or override stop; no-match does not prove absence; zero/max-worker updates and deletion preserve uncertainty correctly. |
| Capacity/expiry | Two API instances cannot overbook accepted slots; stop/revocation races fence dispatch; requests cannot overrun activation lifetime; no hidden cold start, renewal or replacement model. |
| Accounting | Exact decimal/rate-unit conversion and cumulative rounding, simultaneous calls counted once for infrastructure, real-zero request fee versus missing provider bill, delayed/out-of-order billing, failed stop, changed rates and externally managed cost. |
| Inference transport | Native payload preservation, strict schema support/rejection, model mismatch, refusal/truncation/missing usage, split SSE/UTF-8/final usage/EOF, cancellation and response-persistence failure. Same identity recovers without another provider request. |
| Wrapper security | No unauthenticated alternate route or direct-port bypass; RunPod custom-header forwarding proven; denied expiry/malformed signatures/oversized bodies; credentials absent from logs/image/child environments. |
| User surfaces | API/CLI/dashboard complete lifecycle and uncertainty paths; external stop cannot imply external billing stopped; no false ready from metadata alone. |
| Cross-repository | OpenLegend exact schema/profile request accepted by intended Macrofold release; final receipt provenance/cost parsed correctly; invalid output does not mutate game state, and failed targets do not silently fall back. |
| Live provider | One bounded real model activation, startup, structured/chat/streaming where supported, idle cost, expiry/stop/revocation, zero-worker observation and provider billing comparison. Record source/runtime/region/GPU/request revisions and unresolved provider guarantees. |

Performance acceptance measures metadata planning separately from paid cold start; warm dispatch overhead separately from model prefill/decode; queue/first-token/total time separately; and per-activation total cost separately from per-request tokens. Include concurrent requests, near-context inputs, slow readers and provider failure. Compare with the existing immediate inference baseline on a declared topology. No invented throughput, latency or break-even promise is a release criterion.

Run applicable contract generation, targeted domain/provider/SDK tests, image/security acceptance, browser/CLI journey and documentation checks. Let CI run full gates once; do not repeatedly rerun unrelated suites. A local synthetic pass does not establish hosted header forwarding, GPU memory, model quality or provider invoice correctness.

## 14. Rollout, rollback and remaining choices

Ship migrations and all current contract consumers together. Keep the feature/offer disabled until its required fixture and live qualification is recorded. Existing provider-model inference remains available. Activate only reviewed immutable images, finite resource policies and exact accounts. Do not automatically create an experiment during upgrade or application startup.

Coordinate release order: Macrofold contract/endpoint path and lifecycle → deployed capability qualification → OpenLegend consumer configuration and application qualification. Record both actual release revisions in the experiment manifest; an unmerged design branch or a fixture does not prove compatibility in a running environment.

Rollback first disables new deployment/activation admissions and drains/stops existing managed activations through their current cleanup owner. Preserve resource identities, accepted obligations and historic receipt readers. Never roll back schema/code in a way that strands an unresolved paid endpoint or erases cost facts. Model revision rollback is a deliberate new activation of a retained immutable revision, not mutation of already accepted requests.

Architecture decisions are resolved for the stated initial scope. Deployment-specific inputs remain the chosen candidate, licensed/access-approved account, current compatible offer, actual image digest, finite experiment budget and measured acceptance thresholds. Provider auth/immutable-loading/cost-finality questions are explicit qualification gates with fail-closed or uncertainty behavior above. They do not require an implementation agent to invent a protocol, ignore a charge or broaden scope.
