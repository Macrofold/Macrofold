# Hugging Face model deployments — feature specification

| Status      | Current progress                                                                                                                                                          | Last updated |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| In progress | Macrofold API, service lifecycle, inference, runtime and operator surfaces are implemented locally; release verification and live provider qualification remain separate. | 2026-10-25   |

## Purpose and document ownership

Let an application use a chosen Hugging Face model as an ordinary production model provider. An operator supplies the model, selects compatible hosting and operating limits, and starts a service. The application keeps using its deployment while Macrofold manages serving, health and permitted recovery. OpenLegend is the first consumer: characters should be able to use compatible open and low-refusal models through the game's existing AI execution path. Comparing models is an optional use of this capability.

The approved implementation supersedes the historical design-only restriction. Current usage is documented in the [model deployment guide](../features/execution/model-deployments.md). The [technical design](hugging-face-model-deployments-tech-design.md) owns implementation and rollout; the [shared contract](hugging-face-model-deployments-contract.md) owns public fields, examples and errors; [research](hugging-face-model-deployments-research.md) owns provider evidence; [maintainer work](../maintainers/TODO.md#hugging-face-model-deployments) owns delivery status. The existing [inference](../features/decisions/README.md) and [Worker](../architecture/worker-execution.md) owners retain request recovery/accounting and native-agent execution respectively. Implementation and client/image identities are recorded in the technical design's acceptance section.

## Product decisions

1. **A deployment is a reusable service.** Starting it authorizes continued hosting within its operator-selected capacity and hourly cost limits. It has no mandatory expiration, per-experiment activation or repeated approval ritual. An optional stop time supports temporary use.
2. **Macrofold owns hosting; the application owns behavior.** Source resolution, serving infrastructure, provider credentials and health belong to Macrofold. OpenLegend owns permitted character context, task schemas, game rules and application of model-proposed actions. Hosting choices never become world laws.
3. **Use maintained serving software.** Managed hosting uses RunPod Serverless Load Balancer REST v2 with separate pinned native Kev and vLLM runtimes. Native decisions are the first required hosting use case. Provider scaling and each runtime’s maintained batching own scheduling. A small protected HTTP wrapper exists only where needed to secure the exposed routes.
4. **Applications select a stable deployment.** Production calls normally follow its currently serving revision. An optional revision pin supports deliberate rollout control or comparisons. Every accepted request records the exact revision it used.
5. **Normal recovery is automatic.** A replacement worker running the same model revision can resume service under existing authorization. A process restart, new machine, secret rotation or changed diagnostic identifier does not invalidate a valid completed answer. Changes to actual model or serving configuration require a deliberate revision selection.
6. **Capacity is explicit and extensible.** Default to one warm replica for interactive use; operators can choose supported minimum/maximum replicas and request concurrency. A larger replica count is configuration within provider and cost limits, not a new architecture project.
7. **Use the customer's provider account initially.** No GPU resale, platform-funded fallback or invented token price is required. Provider infrastructure expense remains separate from Macrofold's initially zero deployment request fee.
8. **Existing endpoints are a production path.** An operator can register a compatible OpenAI-chat or native SystemOne decision endpoint, including local or alternative engines. Supported protocol, authorization and application validation determine usability. A custom provenance wrapper or experimental certificate is not required.

## What “any Hugging Face model” means

Any repository may be inspected. Deployability depends on the actual task, architecture, weight format, tokenizer/template and available hardware; a Hugging Face URL alone does not establish those properties.

| Candidate                                                                                               | Initial behavior                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compatible text-generation model and safetensors                                                        | Resolve the source to immutable commits, prepare a vLLM configuration and offer compatible capacity. Loading must still succeed.                      |
| Official Kev-compatible adapter/full checkpoint plus native scoring head                                | Resolve checkpoint and base model to immutable commits, retain calibration and serve native SystemOne decisions. Never generate chat as a substitute. |
| Supported quantization                                                                                  | Keep the exact files and supported runtime settings; no silent conversion or weight substitution.                                                     |
| GGUF, MLX or another serving engine                                                                     | Use a registered compatible external endpoint. Add a managed runtime only when an actual use case needs it.                                           |
| Private or gated repository                                                                             | Use the owner's authorized Hugging Face connection and required upstream acceptance.                                                                  |
| Unsupported task/architecture, missing template, incompatible native checkpoint or required remote code | Explain the concrete blocker and retain the candidate; do not execute repository code or silently choose another model.                               |

Managed profiles cover native Kev scoring (`kev-systemone-v1`) and chat (`vllm-0.32.0-text`), with remote repository code disabled. Both reuse the same deployment controller, grants, direct-inference path and accounting. The native image reuses the publisher’s pinned loader/server, base model, adapter, scoring head and calibration. It downloads checksum-verified artifacts directly from Hugging Face at worker startup, then reuses one warm loaded model and its bounded caches. It does not imply embeddings, image/audio generation or native agent harness compatibility. Community checkpoints must match the supported native format; a mismatched head is an explicit incompatibility, never a chat fallback. The [research](hugging-face-model-deployments-research.md) records maintained runtime alternatives.

“Uncensored” and “low refusal” describe model-author claims or measured behavior, not authority. Macrofold preserves customer prompts and supported native output formats. OpenLegend continues validating proposals against the game's rules regardless of model choice.

## Main user journeys

### Host a model for the game

1. The owner supplies a Hugging Face repository ID/link. Macrofold resolves the requested ref to an immutable commit, reads bounded metadata and reports compatibility. Inspection creates no GPU resources.
2. The owner selects a runtime, hardware/capacity policy and provider account. The preview explains expected memory, hourly cost, optional stop time and the distinction between estimates and successful loading. Secrets stay in Connections.
3. The owner starts the deployment. Macrofold saves the exact desired revision and operating policy before provisioning. Compatible worker replacement and scaling within that policy are already authorized; a request cannot raise it.
4. After loading and ordinary readiness checks, the operator grants the game backend use of the deployment and copies its nonsecret deployment ID. The game requires no RunPod or Hugging Face credential.
5. Ordinary character requests use the existing inference endpoint. The deployment remains running between requests. Status reports health, configured limits, operational failures and estimated/provider-reported infrastructure costs.
6. A worker failure triggers provider recovery within the same policy. Healthy replacement workers serve the same revision. Incomplete in-flight requests retain the existing failure/recovery semantics; recovery never blindly resubmits an ambiguous prompt.
7. The owner can change capacity, stop the service, schedule a stop or select another immutable revision. A stopped service remains stopped until an authorized control action starts it.

The first revision-change operation drains the old service and starts the selected revision, with an interruption covering teardown and model loading. Already accepted requests keep their original revision and can finish within their deadlines. Production callers using only the deployment ID then follow the newly ready revision; explicitly pinned callers receive a revision-unavailable error until their selected revision is serving. Seamless blue-green upgrades are not needed for the initial complete feature.

### Use an existing endpoint

The owner registers an exact origin, connection, served model, protocol and supported limits/capabilities. Macrofold uses the same production inference path and current permissions. Chat's plain text, schema output, tool formatting and streaming are separately supported; SystemOne accepts native state/questions and returns complete noul/choice/score answers without streaming. Compatibility does not require a universal evaluation suite.

An external endpoint's source/runtime claims may be operator-declared. Show that honestly, without treating a missing artifact hash or boot ID as a reason to reject usable output. Trust in the operator-configured endpoint is the same kind of operational boundary used for ordinary model providers. Unsupported context/schema behavior remains a real limitation.

Cloud Macrofold cannot reach a laptop through `localhost`. Local use requires self-hosted Macrofold with explicitly permitted private origins or an authorized reachable endpoint. Stopping Macrofold use does not stop externally managed hosting or its bill.

### Compare models when useful

OpenLegend's optional benchmark runner uses the same deployment binding, request builder and output validation as production. It can pin a revision, record prompts/settings/results and compare it with the current ordinary model. A temporary deployment can use `stop_at` and its own capacity/rate limits.

Experimental reporting may distinguish cold/warm performance, hardware, failures, refusals and known/unknown costs. Those measurements do not add certificates, per-session identities, manual renewals or extra network calls to normal gameplay. Production capability delivery does not depend on completing a particular comparison campaign or building a financial reconciliation system for studies.

## Production request behavior

- Use existing `POST /v1/inferences`, Run identity, idempotency, cancellation, streaming and final receipt recovery. There is no deployment-specific inference queue or second request lifecycle.
- Resolve the serving revision once during admission. A running deployment may recover workers automatically, but an inference cannot create a deployment, override stop intent or purchase a larger tier.
- Validate current tenant/workspace/use permission and actual capability limits. Reuse prepared immutable model configuration; do not fetch Hugging Face metadata, prices, provider worker lists or experiment status on each character request.
- Preserve supported native parameters and response content. Multiple completions follow the existing aggregate output limit when the runtime supports them; OpenLegend normally requests one.
- vLLM or the selected serving engine owns exact token/template/schema processing. Macrofold enforces its request bounds and supported capability contract without duplicating the engine or performing a second preparation HTTP call.
- Streaming remains available when the runtime supports it. A final result is authoritative; partial output/tool arguments do not authorize application effects.
- A restart or capacity observation cannot invalidate a completed response. Wrong actual model/configuration, revoked authority, cancelled work, unusable output or expired application context retain their relevant rejection rules.
- Neither platform silently replaces the model, repairs a failed answer using another paid call or retries an ambiguous dispatched request. Confirmed pre-admission rejection may use the existing bounded retry rules.

## Operating limits and costs

Managed service policy specifies a supported replica range, request concurrency and a maximum authorized hourly infrastructure rate. Macrofold checks available rates/capacity before provisioning and reconciles observed service state in the background. A rate or resource change outside that policy prevents further expansion and triggers the documented stop/recovery behavior. Optional `stop_at` is useful for bounded development or temporary workloads; production has no default expiration.

An hourly limit is a burn-rate guard, not a monthly allowance or a guaranteed final invoice ceiling. The UI shows continuing hourly exposure and an illustrative ongoing estimate, and directs owners to their provider account's available billing controls. Provider outages and delayed teardown can leave continuing charges. Unknown costs stay unknown. No new monthly billing-window state machine or invoice-attestation API is required for this release.

Deployment-backed request billing starts at zero under the current BYOK policy. Startup, warm idle capacity, generation and storage can still cost money in the provider account. Count deployment infrastructure expense once by provider resource and period, not once per request. Usage tokens remain useful workload data but do not imply an invented per-token GPU price.

## Failure and recovery

Managed startup separates allocation/image startup (30 minutes) from authenticated model readiness (20 minutes after the first eligible worker observation), with one 50-minute absolute episode cap. Restarts within recovery cannot extend it; explicit restart begins a new episode. Scheduled stops and spending limits remain authoritative. The API/dashboard report the current phase and effective deadline. Repeated ordinary loading observations do not exhaust the separate management-error retry limit.

Owners can inspect a safe last-probe stage/code, timestamp, duration and optional HTTP status after cleanup. Keep endpoint addresses, credentials, raw responses and customer content private. Worker disappearance must not overwrite an actual probe failure with a synthetic waiting result; its timestamp makes the retained history explicit. GPU-ready status alone never establishes authenticated model readiness.

| Situation                                          | Required behavior                                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unsupported or inaccessible source                 | Actionable compatibility/access error; no GPU created.                                                                                                               |
| Startup fails or runs out of memory                | Report the stage, stop failed capacity and retain incurred/unknown costs; no automatic larger GPU purchase.                                                          |
| Worker restarts with the same revision             | Recover automatically under the existing operating policy; no new application binding or approval.                                                                   |
| Health degrades                                    | Route only to ready capacity; return ordinary unavailable/backpressure outcomes when none is ready. Bounded recovery backs off instead of creating a retry storm.    |
| Provider create acknowledgment is lost             | Reconcile the saved attempt before another create; do not duplicate billable resources.                                                                              |
| Owner stops, revokes access or a stop time arrives | Close the relevant admission, drain/cancel under existing deadlines and perform owned cleanup. Current grants take effect without a new hosting session.             |
| Serving revision changes                           | New requests use the operator-selected ready revision; accepted requests retain their recorded revision. Optional stale pins reject rather than silently substitute. |
| Inference outcome is ambiguous                     | Observe the same Run; preserve uncertainty and avoid a second provider call.                                                                                         |
| Shutdown or billing observation is unavailable     | Show the unresolved resource/cost state; continue bounded cleanup and surface operator recovery.                                                                     |

## Delivery stages and acceptance

| Stage                             | Observable exit criterion                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contract and authorization | Stable deployment selection, optional pins, current grants and receipts agree across both repositories and generated clients.                             |
| Production endpoint integration   | A compatible existing endpoint works through real HTTP/SDK and OpenLegend execution, including normal errors, recovery and local output validation.       |
| Managed hosting                   | One pinned HF model starts, remains available, recovers a worker and stops through RunPod under explicit capacity/rate controls.                          |
| Production operations             | Capacity updates, revision changes/rollback, credential rotation, unavailable service, revocation and cleanup work without experiment-specific setup.     |
| Release acceptance                | Actual provider authentication, source loading, bounded concurrent inference and cleanup are verified; cold/warm latency and costs are measured honestly. |

Local implementation covers the contract, source inspection, service policy/reconciliation, direct native chat and operator surfaces. Disposable-database and HTTP fixtures verify authority, concurrency, idempotent recovery, old-result publication, exact rates and cleanup uncertainty. The built Linux AMD64 wrapper passes CPU transport/source tests; those tests do not load a model on a GPU. A public HF metadata inspection resolves Qwen/Qwen3-0.6B to an immutable commit without credentials, weight downloads or generation.

The technical design records imported chat/native GPU checks and the subsequent [completed managed native acceptance](hugging-face-model-deployments-tech-design.md#corrected-managed-native-acceptance). The native image is public and anonymously pullable; real API-created official Kev serving, ingress authentication, recovery, cancellation, two loaded workers, tracing and normal deletion pass. The refreshed public chat wrapper also passes [normal-account managed Huihui acceptance](hugging-face-model-deployments-tech-design.md#managed-chat-acceptance-in-the-normal-local-account), including explicit thinking control, JSON/schema, SSE, cancellation, traces and normal deletion. Broader tool/concurrent-load qualification, final provider invoices and hosted application rollout remain release gates. OpenLegend's actual serializer and real-game acceptance await its subsequent consumer implementation; this does not block independent Macrofold verification. Optional model comparisons remain independent.

## Scope and remaining decisions

The production architecture is selected. Initial scope is managed native Kev and vLLM chat serving, BYOK infrastructure, imported compatible endpoints and graceful revision changes with a visible loading interruption. No custom scheduler, model marketplace, fine-tuning system, GPU resale or automatic cross-model fallback is needed. Additional runtimes/providers fit behind the existing serving/provider boundaries when required by an actual model or operating workload.

Concrete model choice, account access, published wrapper digest, capacity/rate policy and workload tuning are operator inputs. RunPod ingress authentication, actual GPU/model fit, restart behavior, cancellation and billing observations require live evidence before enabling the managed backend. These checks establish normal service reliability; they do not require a permanent experimental approval system.
