# Hugging Face model deployments — technical design

| Status      | Current progress                                                                                                       | Last updated |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | ------------ |
| In progress | Server, clients, runtime and management surfaces are implemented; final local and live release acceptance remain open. | 2026-10-22   |

## Scope and authoritative references

Implement the [feature specification](hugging-face-model-deployments-feature-spec.md) through existing inference, authorization, operations, database and client-generation owners. The [shared contract](hugging-face-model-deployments-contract.md) owns public DTOs, operations, examples and errors; [research](hugging-face-model-deployments-research.md) owns provider evidence; [maintainer TODO](../maintainers/TODO.md#hugging-face-model-deployments) owns delivery status. The reviewed base is `Macrofold/Macrofold` at `07ba0ee1bb5c76aeb4d0d3553339dc274854335a`.

The production path is a persistent model service. It must work without an experiment record, time-limited activation, qualification certificate, boot identity or manual cost-finality workflow. Optional comparisons use the same inference API and may pin revisions. They do not add a separate execution architecture.

## 1. Component ownership

| Owner                                   | Responsibility                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web` transport/composition        | Authenticate, validate public input, call domain operations and expose existing inference/stream/status results.                        |
| `packages/core` deployment domain       | Tenant ownership, immutable serving revisions, current grants, desired service policy, readiness, capacity and resource reconciliation. |
| Existing inference domain               | Run/idempotency, admission, accepted revision snapshot, dispatch, cancellation, output preservation and terminal receipt recovery.      |
| `packages/providers`                    | Hugging Face metadata/download, RunPod REST adaptation and compatible endpoint transport behind domain-owned ports.                     |
| Serving image                           | Maintained vLLM inference, exact source loading, health and narrowly required authentication/HTTP route protection.                     |
| Existing database/operations/accounting | Durable control attempts, tenant transactions, request charges and separate provider resource/cost observations.                        |
| OpenLegend                              | Character context and privacy, task-specific prompt/schema construction, output validation and current-world effects.                   |

A model deployment is distinct from a native-agent Worker, HostRun, Worktree or Session. Reuse existing operation, money and fencing helpers without manufacturing an agent Run to host a model. Keep `DecisionBinding`, Jev protocols and native harness capability admission separate; small text models do not inherit the native harness catalog's 128k context floor.

## 2. Persistence and identity

Use existing UUIDv7 IDs, tenant transactions, restricted database roles, public decimal-string money and exact integer/rational pricing. Add normal forward migrations and update current consumers together under the pre-launch compatibility policy.

| Logical record              | Required facts                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment                  | Tenant/owner, display metadata, current service generation, desired state/revision, serving revision, operating policy and retirement intent.                                          |
| Immutable revision          | Resolved model/tokenizer commits, selected files/template, reviewed runtime image/configuration or registered endpoint/model reference, supported protocol and effective model limits. |
| Current use grant           | Deployment, subject and workspace scope, approving connection owner and current revocation state; reuse an existing grant representation where sufficient.                             |
| Provider resource/operation | Exact resource, provider account, serving revision, desired configuration, control attempt/generation, observed lifecycle, uncertainty and next reconciliation time.                   |
| Cost observation            | Provider resource and attributable period, estimated/provider-reported amount, observation time and completeness; retain corrections without altering financial journals.              |

The first managed implementation needs one active provider endpoint per deployment. A revision change drains and removes that endpoint before creating the next one; no parallel blue-green fleet is required. Keep historical resource references for accepted Runs and outstanding cleanup/costs. Metadata retirement does not delete those obligations.

A revision identifies intended **model and serving configuration**, not one process lifetime. Pin weights, tokenizer/template, quantization, runtime image and behavior-affecting serving options. Changing those creates a new revision. Replica count, selected compatible hardware, health observations, boot/process IDs, spend limits and rotation of a secret in the same approved connection do not by themselves change that revision. A connection cannot silently switch provider account or endpoint identity.

Store only the deployment and resolved revision IDs plus necessary immutable execution/rate references in an accepted Run. Do not copy full artifact manifests or hardware observations per request. Ordinary receipts expose the resolved revision; diagnostics can retain hardware and restart observations separately.

Every tenant foreign key retains organization scope. Index deployment listing by tenant, revision lookup by deployment, current service/operations and reconciliation due time; cost observations index resource/time. Never scan historical Runs for readiness. Unique active-operation constraints and normal generation fences prevent concurrent starts or stale callbacks from overriding a stop.

## 3. Public control and authorization

Use the shared contract's inspection, deployment/revision/grant operations and idempotent `PUT /v1/model-deployments/{id}/service`. The service request selects desired running/stopped state, a revision and operating policy. Running is standing authorization for supported health/recovery and scaling within that policy. There is no mandatory expiration; optional `stop_at` schedules shutdown. Inference cannot create resources, raise limits or resume an operator-stopped service.

Add deployment read/use/write scopes consistently across API keys, resource restrictions, operation dispatch and generated clients. The game backend needs its scoped use/read permissions and ordinary Run permissions, not provider administration. Workspace restrictions and deployment grants both apply. Current permission changes take effect through existing authority checks; expanding a grant does not require restarting hosting.

Preserve existing owner-bound connections. The owner explicitly delegates the selected source/compute/endpoint connection to the deployment and allowed application scope. Do not bypass ownership to make a personal key organization-wide. Initial private connections share one approving owner; multi-owner credential composition is unnecessary. Use current grants rather than frozen experimental grant snapshots. Secret rotation within the same connection is picked up by credential resolution and subsequent provider operations without forcing a new model revision or user approval.

Control operations commit authorization, desired policy and attempt identity before provider mutation. Revalidate current permission before dispatch; model output never grants authority. Provider credentials remain encrypted and separate, absent from application bindings, browser bundles and logs. Cleanup retains narrow authority over already-created resources after ordinary use is revoked; revoked provider credentials may make cleanup uncertain and must be reported. Management MCP stays read-only.

## 4. Source preparation and runtime profiles

Accept a repository ID or allowed Hugging Face model URL, normalize into known Hub operations and resolve a requested branch/tag once to its full commit. Read bounded task/configuration, file index, tokenizer/template, license and access metadata without purchasing compute. Do not follow arbitrary model-card links or execute instructions from repository prose.

Use maintained HF download interfaces for the exact resolved model and tokenizer commits. Record selected files and known upstream hashes; use maintained download/cache integrity checks and atomic completed snapshots. A cache hit or mutable `refs/main` path is not sufficient. Do not add a bespoke artifact-signing, whole-model canonical-JSON hash or experimental attestation protocol. Exact source/image/configuration references and trustworthy loading provide the production identity boundary.

The initial managed profile requires compatible safetensors, supported architecture/quantization and `trust_remote_code=false`. Report missing templates, unsupported tasks, adapter-only repositories, private access denial or remote-code requirements explicitly. User-selected template content is a reviewed immutable revision input, never a shell fragment. Source license/access acceptance belongs to the connection owner and upstream provider.

Estimate memory from weights, quantization, KV-cache needs at selected context/concurrency and runtime/loading overhead. Show the assumptions; model size alone does not prove fit. Loading failure retains its actual cost and does not automatically purchase a larger GPU.

Maintain a small reviewed runtime-profile registry, including pinned image digest, supported architectures/options, context/output and concurrency constraints, startup/drain timeouts and byte/stream limits. This is a concrete configuration seam for vLLM and imported endpoints, not a general plugin framework. Unsupported profiles remain unavailable. Managed llama.cpp/MLX or another host adapter can be added when a real candidate or cost/performance need warrants it; imported endpoints already provide that extension path.

## 5. Serving and readiness

### Managed startup

1. Validate the desired revision and current service policy; use exact account/source references.
2. Download/reuse the pinned snapshot and launch the pinned vLLM image with exec-form arguments. Set the exact tokenizer/template/quantization/context options and a revision-specific served alias. Keep remote code disabled.
3. Bind the engine to loopback and expose only the necessary protected serving routes. Remove download and infrastructure-control credentials from the engine environment once loading preparation is complete.
4. Mark the worker ready only after model loading and normal engine health succeed. Record startup diagnostics, effective limits and actual hardware. An optional bounded smoke request during first configuration validates protocol behavior; do not run an application evaluation campaign on every restart.
5. The provider can replace a failed worker with the same revision/configuration under existing operating limits. Readiness recovers automatically. A replacement does not need a new certificate, application binding or manually authorized session.

The managed endpoint is tied to one immutable serving revision. Use the trusted configured alias and native engine model selection to reject a request routed to an actually different model. Process IDs and optional boot diagnostics are not request-admission or result-acceptance keys. A restart that serves the same configuration does not invalidate valid output already produced by another worker.

### Restricted HTTP surface

The small wrapper addresses a concrete RunPod/vLLM authentication gap: provider bearer handling and protection of every exposed inference/admin route must be verified. Bind vLLM only to loopback; default-deny exposed paths except health and required chat/model routes. Health reveals only readiness. Other routes use a generated endpoint-scoped secret in a separate header, with bounded body, streaming and deadline handling. Keep RunPod's account bearer out of the worker. There is no per-activation secret or expected-boot header.

Use the maintained HTTP/ASGI stack and streaming client, with redirects and automatic inference retries disabled. Preserve native OpenAI-chat JSON/SSE and final usage semantics. The wrapper performs authentication, route/body/deadline bounds and forwarding; it does not generate tokens, implement a scheduler or duplicate vLLM's tokenizer, chat-template or structured-output compiler. Use the engine's exact context enforcement with truncation disabled and its supported schema validation. Do not add a `/prepare` or provenance request before every inference.

An authenticated engine/wrapper rejection that definitely precedes generation may establish `not_invoked`; a proxy error, lost response or cancellation after forwarding may remain uncertain. Neither state erases warm infrastructure cost. Keep this distinction in the existing inference adapter/recovery owner rather than creating another result protocol.

### Imported production endpoints

Register origin/base path, connection, served model, declared source identity and supported native options/limits through owner-authorized control operations. Stock OpenAI-compatible servers are eligible for production. Their model/runtime assertions are operator-declared unless independently established; a missing manifest hash is not a failure. Require the actual capabilities the application uses, not a custom wrapper or model-quality certificate.

Reuse `packages/providers/src/network.ts`: exact-origin secret scoping, DNS-to-socket pinning, private/metadata address restrictions, redirect denial and bounded responses. Cloud rejects private/loopback origins. Self-hosting may use a separate exact-origin `LOCAL_MODEL_ENDPOINT_ALLOWED_ORIGINS` policy with the shared parser; do not inherit or broaden MCP/webhook allowances. Plain HTTP is allowed only under that explicit local policy.

The current shared transport's 50-second timeout must not silently truncate supported deployment calls. Pass the accepted inference deadline, at most the existing 240-second ceiling, and its response-byte/stream limits through a narrow option; do not relax unrelated consumers. Connection pooling and cancellation cleanup remain bounded. An external owner controls hosting, replacement and cost; stopping Macrofold use does not stop the host. A separately managed dedicated RunPod Pod can use this route immediately without waiting for an automatic Pods adapter.

## 6. RunPod provider adapter

Use REST v2, not deprecated GraphQL or guessed older fields. The [official evidence register](hugging-face-model-deployments-research.md#source-register) owns source URLs; reverify the pinned schema during implementation.

| Purpose               | Mapping                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create/list           | `POST` / `GET https://api.runpod.io/v2/serverless`; bounded cursor pagination with `nextCursor`/`hasNextPage`.                                                                    |
| Inspect/update/delete | `GET` / `PATCH` / `DELETE /v2/serverless/{id}`; workers at `/v2/serverless/{id}/workers`.                                                                                         |
| Endpoint              | `type:"LOAD_BALANCER"`; no provider queue-based `/run` protocol.                                                                                                                  |
| Owned runtime         | Inline immutable `image`, exec-form `cmd`/optional `entrypoint`, explicit `disk` and `ports:["8000/http"]`; no shared template ownership.                                         |
| Environment/health    | String `env` with `PORT:"8000"`, `PORT_HEALTH:"8000"`, `HEALTH_CHECK_PATH:"/ping"`, nonsecret attempt/revision correlation and approved secret delivery.                          |
| Hardware              | Accepted catalog `gpu.pools`, GPU count and compatible CUDA requirement. Pool IDs differ from display/type IDs.                                                                   |
| Placement             | `dataCenterIds` is preferred placement, not guaranteed residency. Reject a required guarantee the provider cannot supply.                                                         |
| Scaling               | Explicit `workers.min/max/idleTimeout` and `scaling:{type:"REQUEST_COUNT",requestCount:...}`. Warm default minimum is one; maximum is always explicit. Idle timeout uses seconds. |
| Timeout               | Explicit milliseconds consistent with accepted request/profile limits, never extending Macrofold's 240-second execution ceiling.                                                  |
| Origin                | Validate returned HTTPS `requestUrls.base`, append the native chat path and reject redirects.                                                                                     |
| Stop                  | Set worker bounds to zero and delete the exclusively owned endpoint after drain; deletion must remain possible if scale-down/listing fails.                                       |

Use provider-native worker health, replacement and supported scaling. Do not prohibit replacements or multiple replicas for experimental reproducibility. Hardware pools can evolve: inspect actual compatible hardware and current rates during background reconciliation. Unaccepted hardware/rates must not silently expand the operator's policy. Existing accepted Runs retain their execution facts; an observation change alone is not output corruption.

Warm minimum capacity remains billable between calls. Native serverless caching/FlashBoot may be used only through documented behavior compatible with the pinned image/source. The inspected v2 schema lacks exact model-cache selection fields, so initial correctness must work with bounded exact-revision downloads. Never invent `cachedModels`, idempotency or provider labels fields.

### Durable provisioning and ordinary recovery

Before creating an endpoint, persist one control attempt with provider account, desired revision/configuration and nonsecret correlation. After definitive success, save the provider ID before exposing readiness. A lost create acknowledgment or failed local commit is an ambiguous resource operation: reconcile the same attempt against bounded paginated inventory and exact configuration.

Do not assume names are unique or that an empty list proves noncreation. Adopt only one matching resource; conflicting/multiple candidates need operator recovery. Retry create only after definitive absence, a verified provider idempotency guarantee or explicit reconciliation. This prevents duplicate infrastructure, unlike automatic recovery of a known endpoint's workers, which is normal authorized provider behavior.

Use existing bounded maintenance scheduling and short SQL claims; never hold transactions during provider I/O. Internal control generations prevent late health/create callbacks from overriding stop or revision-change intent. Bounded exponential backoff and a startup deadline stop repeated failed recovery from endlessly consuming resources. Persist retry timing; one shared reconciliation path replaces a polling loop per request or process.

## 7. Service updates, drain and cleanup

Keep desired state/revision separate from actual serving state/revision. The following events use one lifecycle owner:

| Event                                  | Behavior                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start                                  | Commit current authorization, revision and policy; provision or reconcile its known endpoint, then expose ready capacity.                                               |
| Same-revision worker loss              | Provider replaces/restarts within policy; temporarily reduce availability, preserve deployment identity and recover readiness.                                          |
| Capacity change                        | Validate and persist policy before provider update. Scale within the approved range; no model-revision change.                                                          |
| Revision change or rollback            | Close new admission, retain accepted old-revision Runs, drain within their deadlines, remove old endpoint, start the selected revision. Show the interruption honestly. |
| Stop, optional stop time or retirement | Close admission and drain/cancel; requests cannot undo stop intent. Reconcile owned shutdown until confirmed.                                                           |
| Credential rotation                    | Resolve the new secret for the same approved account/connection; reconfigure securely if needed and recover readiness. No experiment approval or model-revision change. |
| Permission loss or policy violation    | Block affected new effects, preserve current cancellation/publication rules and clean up where authority requires it.                                                   |

Resolve an existing idempotency key/Run **before** selecting today's serving revision. A replay after a rollout observes the original request and receipt. A new request resolves the serving revision atomically with admission and saves it immutably. An optional revision pin must match the currently serving revision; it cannot implicitly revive an old resource. Default unpinned clients adopt a revision only after the explicit operator rollout makes it ready.

Do not PATCH new weights/image into an active endpoint: provider updates can leave mixed old/new workers during cycling. The initial drain/recreate sequence avoids that ambiguity without a blue-green coordinator. An accepted response from the old revision remains usable if its original request authority/context/deadline still permits publication. Never compare it against the deployment's newly selected revision and discard it merely because the rollout completed.

For managed shutdown, drain for the configured bound, cancel remaining Runs through their normal owner, request zero worker bounds and DELETE the owned endpoint. Attempt deletion even when PATCH or inventory fails. Retry only recoverable cleanup under the same resource/operation identity; never provision to repair uncertain teardown. Provider deletion and worker disappearance establish resource observations, not a final invoice. Preserve unresolved costs and owned cleanup references even when the feature is disabled or deployment metadata is retired.

## 8. Inference path and performance

Extend the existing `InferenceBinding` union with the shared deployment selector. Preserve catalog provider bindings and native decision protocols. Prepare the native body once using trusted revision metadata; callers cannot inject a provider URL, credential or conflicting model. Preserve supported parameters, tools and schemas. Multiple completions use existing aggregate output accounting when supported.

Use the normal short admission transaction for current principal/workspace/use grants, desired/serving state, optional revision match, accepted limits, existing Run concurrency and bounded deployment request capacity. Reuse the current capacity owner to claim/release a deployment permit atomically; do not build per-GPU scheduling. The configured in-flight ceiling and provider maximum worker count bound work. Provider/vLLM batching handles actual placement; unready/saturated capacity yields ordinary backpressure or an admitted failure according to where it occurs.

The hot path contains no Hugging Face lookup, price discovery, worker-list fetch, model-quality test, health probe or per-request experiment bookkeeping. Reuse immutable parsed revision/profile data by revision; combine current authorization/service/capacity checks with existing admission reads. Cache neither revocation nor authoritative capacity as immutable. Background observations may affect availability, but diagnostics need no synchronous write per token or response.

Execution deadlines remain at most 240 seconds and may be lower for the app/runtime. Optional `stop_at` prevents admission of a request that cannot finish/drain within the shutdown policy. Cold provisioning is control-plane work, not hidden behind an inference HTTP 202. The initial running policy keeps at least one warm replica; provider scale-to-zero is used for stopping, not hidden cold starts during gameplay.

Preserve native output under `result.inference.value`, the shared deployment receipt and existing terminal output/accounting persistence. Missing token usage stays missing; refusal, truncation, invalid structured output and uncertain transport remain distinct. A boot ID, worker replacement, changed capacity or absent artifact hash is not a reason to reject a valid response. Detect an actually wrong configured model through the trusted target/protocol boundary, not experimental metadata equality.

Streaming uses existing transient events and final receipt recovery, with bounded buffers/backpressure. No SQL write per token, automatic POST reconnect, repair model or silent fallback. Cancellation can leave upstream work uncertain. Recover the same accepted Run; a new provider call is never hidden inside recovery.

## 9. Capacity, cost and spending policy

Managed BYOK policy fixes the accepted provider account, supported capacity range and maximum hourly infrastructure cost, with optional stop time. Default one warm replica is a starting configuration, not a product ceiling. Show the ongoing cost of warm minimum capacity and maximum authorized capacity. An hourly limit constrains spending rate; it is not a total/monthly budget. Provider account controls and an explicit stop time can further bound operational use.

Before start or expansion, obtain sufficiently fresh provider rates and reject required unknown charges or rates above policy. Include GPU count, maximum replicas and known storage/other meters in the cost projection. Use exact decimal/rational arithmetic and documented provider rounding. Freeze accepted assumptions on the resource operation; never increase an already accepted request's charge because a catalog changed. Background reconciliation detects incompatible rates/resources and closes expansion/admission or stops as the service policy requires. A control-plane outage may still leave provider charges continuing; do not promise a hard provider-enforced dollar cap.

Record infrastructure estimates and provider-reported amounts by resource/period. RunPod bills worker epochs, including startup and warm idle; count overlapping replacement epochs and configured storage rather than treating maximum replica count as proof no past overlap occurred. Preserve unknown intervals. Polling must not add the same cumulative billing bucket repeatedly. Use provider resource/time identity for deduplication and retain corrections. Aggregate provider billing may not support exact per-request allocation or financial finality; expose those limits instead of introducing an owner invoice-attestation API.

The current deployment request fee is zero under BYOK. Existing request billing/reservation/settlement remains its single owner; the receipt separately identifies deployment infrastructure attribution. Count hosting once, not as a second per-token vendor charge. External hosting cost may be known, estimated or unknown, and Macrofold does not cap or stop it. An imported endpoint with additional metered per-call fees needs supported existing pricing/metering; it must not bypass accounting by claiming this zero-request-fee hosting route.

No new monthly budget-window scheduler, experimental allowance reset, quote lifecycle or cost-finality certificate is necessary. If a later product introduces infrastructure resale or automatic periodic funding, it must use the existing financial domain and a concrete accepted pricing contract.

## 10. Capabilities and operational acceptance

Separate source compatibility, runtime support, readiness and application quality. A runtime profile describes supported native text, JSON-schema options, tool formatting, streaming and effective limits. Initial integration verifies those advertised modes against actual serving behavior. Ordinary readiness is loading/health; it does not run a paid comparison suite every time the model server restarts.

Use maintained engine validation for exact schema and context support. Reject unsupported parameters rather than silently dropping them or downgrading strict schema. OpenLegend may explicitly select its own prompt-and-validate JSON mode when strict generation is unavailable; Macrofold does not make that decision for the application. Final schema/world validation stays in OpenLegend regardless of decoding mode.

Use deterministic fixtures for malformed responses, authority races, unavailable service and ambiguous transport. Live smoke checks establish the real account/runtime/endpoint behavior once during deployment acceptance; model-quality comparisons remain optional, separately authorized work. A model need not complete a fixed character-evaluation corpus to become an ordinary provider capability.

## 11. Implementation and user surfaces

| Task                        | Owners and completion                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MD02: contracts/storage     | Authored OpenAPI, `InferenceBinding`, deployment/revision/service/grant records, scopes, `http-contract.ts`, operation registry, API routes and five generated clients.      |
| MD03: inference integration | Core target resolution, preparation/admission, compatible-chat adapter, controls, streaming/final receipts and Run recovery. Deliver external endpoint production use first. |
| MD04: managed service       | Source/RunPod adapters, service policy, known-resource recovery, durable create attempts, capacity updates, drain/revision change and cleanup through existing maintenance.  |
| MD05: runtime               | Pinned vLLM image, exact source startup, health, necessary HTTP protection and advertised protocol capabilities; automatic same-revision restart/replacement acceptance.     |
| MD06: user surfaces         | API/CLI/dashboard inspect/create/revision/service/status/stop flow, safe credential setup, current grants, costs, production guidance and OpenLegend release coordination.   |
| MD07: release acceptance    | Real provider auth/loading/recovery/scaling/cleanup and cross-repository scenarios below, with measured performance and honest evidence limits.                              |

Inspect existing `core/inferences.ts`, `direct-inference.ts`, `inference-invocations.ts`, `inference-control.ts`, `inference-receipt.ts`, `model-credentials.ts`, `model-gateway.ts`, `operations.ts`, `http-contract.ts`, provider `native-inference.ts`, database migrations and SDK transports. Extend semantic owners rather than copying Run/ledger/authorization logic. New deployment policy and provider modules need no additional orchestration service, Redis, Kubernetes or custom scheduler.

CLI and dashboard call the same public/domain operations. The normal flow is paste model → select operating policy → start → copy deployment ID → use in the application. Show starting, ready/degraded, changing revision, stopped and cleanup-uncertain states without optimistic success. Advanced model/runtime evidence and optional experiment settings stay out of the normal setup path. Generate contracts/docs through existing tooling, never edit generated files manually.

Content-free metrics cover available capacity, startup/recovery time, queue/rejection rate, warm request/first-token latency, model throughput, provider cost and outstanding cleanup. Existing protected traces own optional prompt/output retention; hosting administration does not grant another application's private inference content.

### Authorized implementation plan

Implement MD02–MD07 on `feat/production-model-deployments`, incorporating the approved production design at `e79a2c066584037e369d80e626810de86aefe611` above main `07ba0ee1bb5c76aeb4d0d3553339dc274854335a`. The implementation instruction supersedes the historical design-only restriction. The GitHub connector owns branch publication and progress commits; preserve the detached managed checkout and existing preview.

1. Author the deployment schemas, tenant migration, current grant/connection delegation and safe projections; regenerate all five clients.
2. Extend existing immediate inference admission, native chat transport, control checks and terminal receipts. Preserve early same-key recovery before resolving the mutable serving revision, exact accepted identity, zero separate request fee and unknown per-call infrastructure cost.
3. Add HF inspection and immutable runtime preparation, RunPod REST v2 control, durable attempt reconciliation, bounded recovery, rate guards, drain/update/rollback and verified cleanup through existing maintenance.
4. Build the pinned vLLM image and protected HTTP surface; verify loading preparation, authentication, routing, streaming and process cleanup with deterministic CPU fixtures, then actual authorized GPU acceptance where access/budget permits.
5. Complete dashboard and CLI setup, grants, status, costs, updates and stopping against the public contract. Publish concise setup/call guidance for the subsequent OpenLegend consumer.
6. Run targeted isolation/recovery/concurrency/protocol tests during development, then generated-client, API, UI/CLI, image, build and documentation gates. Review the full affected diff and fix in-scope findings. Record exact tested source/runtime identities, actual costs and precise live or joint-consumer gaps without marking fixture evidence as live acceptance.

Contracts/storage and inference integration are owned in their existing domain/API modules; serving runtime and user surfaces can proceed independently against the canonical contract. No application request performs hosting administration or grants new spending. Missing live credentials/budget block only the affected live checks. The OpenLegend real-game joint acceptance awaits its subsequent consumer implementation.

## 12. Verification, rollout and rollback

| Boundary             | Required evidence                                                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract             | Existing provider and decision calls unchanged; stable selector/optional pin works; all five SDKs preserve native request/receipt shapes.                                                                       |
| Authority            | Cross-tenant/workspace denial, immediate grant changes, owner-bound credentials, secret rotation, no credential disclosure/fallback and narrow cleanup authority.                                               |
| Source/runtime       | Exact source/image/template loading, unsupported model/gated access, cache integrity, remote code rejection, out-of-memory and failed startup cleanup.                                                          |
| Lifecycle            | Start/stop/restart, lost create acknowledgment, stale callbacks, provider worker replacement, capacity updates, optional timed stop and revision rollback. No duplicated resource or restart after stop intent. |
| Requests             | Same-key replay after rollout returns original Run; old valid completion remains acceptable; new unpinned calls use new ready revision; stale pins reject.                                                      |
| Capacity/performance | Concurrent requests from multiple API instances, saturation/backpressure, warm/cold timings, bounded streams and no added provider-management round trip per inference.                                         |
| Output/recovery      | Native JSON/text/tools/SSE, missing usage, malformed/refused/truncated output, strict-schema rejection, cancellation and uncertain dispatch without a second model call.                                        |
| Cost/cleanup         | Exact units/rounding, continuing idle expense, replacement overlap, delayed/duplicate provider billing, rate guard, failed stop and externally managed obligations.                                             |
| Security             | Actual RunPod bearer/custom-header forwarding, no direct unauthenticated engine route, private-origin rules and body/deadline bounds.                                                                           |
| Application          | OpenLegend's normal character-generation configuration works without an experiment profile, preserves privacy/schema/current-world checks and handles unavailable service visibly.                              |

Run applicable existing targeted domain/provider/SDK, image, CLI/dashboard and documentation gates under [TESTING.md](../../TESTING.md). Ordinary CI adds the CPU serving protocol suite without enabling paid execution. Live calls remain within separately authorized finite test spending even though the product supports continuing production services.

### Current implementation evidence

The implementation branch is `feat/production-model-deployments`, [PR 14](https://github.com/Macrofold/Macrofold/pull/14), incorporating approved design `e79a2c066584037e369d80e626810de86aefe611` above main `07ba0ee1bb5c76aeb4d0d3553339dc274854335a`. [Setup and OpenLegend calls](../features/execution/model-deployments.md) use the actual API and generated methods. No package/image was published, production default changed, paid resource created or main merge performed.

The local Linux AMD64 wrapper config ID is `sha256:c338c00d3ba9ba4267b8eaefdda5df4db778027d74ef25d153eb99c29681f42b`, built from the serving sources at `389efbcef2e6de1f82b92af011dd1ab34eeff9a1`. This is a local image identity, **not a published registry manifest digest**. Its upstream vLLM base is pinned at `sha256:6ee133356d49ed24cee03dd0cda3d3980279a11c107ce3e752c89e76540f41c9`. Actual-image CPU transport/configuration/preparation tests pass 12/12, including protected routes, HEAD rejection, native JSON/SSE, deadlines and disconnect cleanup. CPU tests do not load a GPU model.

Focused disposable-database evidence covers tenant/workspace/current-owner grants, late revocation, accepted-result preservation across stop/rotation, explicit revision pins, capacity rejection, zero request accounting and unknown infrastructure costs. Lifecycle/rotation fixtures pass 28/28; RunPod protocol fixtures pass 22/22; the final source/access/cost follow-up passes 37/37. The public HF metadata-only smoke resolves `Qwen/Qwen3-0.6B` to `c1899de289a04d12100db370d81485cdf75e47ca` with no inspection findings and a 5,830,492,233-byte estimated memory requirement. It downloads no weights and performs no inference.

`pnpm check` passes. Documentation verification passes 68 published pages, 270 Markdown files and 54 requirement evidence mappings. All five clients are regenerated through the maintained generator; final actual-API SDK, optimized browser/CLI, aggregate coverage and complete-image scan outcomes are recorded here when complete. The initial optimized build compiled and passed framework checks, then correctly failed source-provenance verification because final fixes overlapped its snapshot; it establishes no browser acceptance.

The base main CI run `39257420297` already failed acceptance, application/native and combined gates; SDK generation and critical mutation passed. Base extended mutation run `39233807342` also failed. Keep those pre-existing failures separate from this candidate's results.

Actual paid-provider cost is **US $0**. No RunPod credential is configured. Publishing a reviewed wrapper registry digest, actual RunPod authentication/header forwarding, GPU loading and advertised decoding modes, replacement/scaling, warm/cold performance, real billing and confirmed provider cleanup remain live release gates. OpenLegend PR 40's design head `05d2bb034cea0f717c54efedee019f74906849c6` was consulted; its subsequent serializer/decoder and real-game acceptance remain a joint consumer gate, independent of server-owned implementation. Keep MD07 open until those exact environments and behaviors are exercised.

Measure preparation, cold startup, warm platform overhead, model prefill/decode, first-token/total latency and concurrency separately. Compare the same model/workload/topology; no invented throughput or cheapest-provider claim. Optional quality experiments and financial allocation reports do not block ordinary production capability acceptance.

Ship the current API/storage/generated clients together, then qualify the actual serving backend and OpenLegend integration. Keep unverified offers disabled. Record actual server/client/runtime versions in release evidence. Disabling new deployments must not stop cleanup of existing owned resources. Rollback stops new admission, drains safely and preserves unresolved provider resources and historical receipts; it must not strand paid capacity or erase money facts.

The architecture is selected. Remaining deployment inputs are model, account, immutable image, compatible hardware, operating limits and workload tuning. Provider authentication, real loading/recovery, cancellation and billing behavior require live evidence. Those are concrete release gates, not reasons to build an experiment-centric runtime.
