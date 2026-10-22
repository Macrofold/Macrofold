# Hugging Face model deployments — feature specification

| Status | Current progress | Last updated |
| --- | --- | --- |
| In progress | The deployment and application integration are being designed; implementation and live provider qualification have not started. | 2026-10-22 |

## Purpose and document ownership

Let an application developer select a model from Hugging Face, inspect whether it can run, authorize a finite experiment, and call that exact deployment through Macrofold's existing inference API. OpenLegend is the first consumer: it needs to compare instruction-tuned and low-refusal models for fictional character simulation without maintaining GPU infrastructure inside the game.

This is a design, not an implemented capability. The [technical design](hugging-face-model-deployments-tech-design.md) owns internal implementation and rollout. The [shared contract](hugging-face-model-deployments-contract.md) is the canonical owner of public fields, wire examples, error semantics and the cross-repository agreement. The [research](hugging-face-model-deployments-research.md) owns provider comparisons and source evidence. [Maintainer work](../maintainers/TODO.md#hugging-face-model-deployments) owns implementation and acceptance status. Do not copy those contracts into independent schemas or treat this specification as permission to launch paid infrastructure.

The reviewed baseline is `Macrofold/Macrofold` at `07ba0ee1bb5c76aeb4d0d3553339dc274854335a`. Current [inference](../features/decisions/README.md) and [Worker](../architecture/worker-execution.md) documentation continues to describe what exists today.

## Product decisions

1. **Macrofold owns serving infrastructure.** A model deployment is an organization-owned resource with its own revision, activation, permissions and costs. It is distinct from a native-agent Worker, Worktree or Session. OpenLegend owns permitted character context, game rules, experiment grading and admission of model-proposed actions.
2. **Use an existing serving engine.** The initial managed lifecycle uses RunPod Serverless Load Balancer REST v2 with a pinned vLLM runtime and a small authentication/provenance wrapper. Macrofold does not implement inference kernels or a replacement GPU scheduler.
3. **Start an experiment explicitly.** Creating or inspecting a model deployment does not purchase compute. An activation accepts an exact revision, a fresh quote and finite limits. Ordinary inference never creates, resumes or renews an activation.
4. **Use the customer's provider account initially.** RunPod and any required Hugging Face credentials are exact owner-approved connections. This design does not launch Macrofold-funded GPU resale or silently substitute platform credentials. Provider charges and Macrofold request charges remain separate.
5. **Pin the whole experiment.** Model weights, tokenizer, chat template, quantization, serving image, relevant runtime settings and capability qualification determine the revision. Changing one requires another immutable revision. A request additionally selects one activation; it cannot slide to a replacement experiment after expiry.
6. **Start with one replica.** Each initial RunPod activation has a maximum of one worker. Concurrent requests share that bounded capacity. Larger fleets require a later measured scaling increment and a new accepted quote, not hidden autoscaling.
7. **Support qualified external endpoints.** An operator may register an existing OpenAI-compatible text endpoint, including a separately operated local server reachable from Macrofold. Its lifecycle and infrastructure bill remain externally managed. Report its provenance assurance and known/unknown cost explicitly.
8. **Model freedom does not change application authority.** Macrofold does not insert character policy, silently rewrite prompts, repair output with a second model, or require all customer outputs to be JSON. A low-refusal model remains an untrusted producer of application data.

## What “any Hugging Face model” means

Any repository may be submitted for inspection. A repository URL is not evidence that its files implement text generation, fit a GPU, have a usable chat template, or work in the selected serving engine.

| Candidate | Initial product behavior |
| --- | --- |
| Supported text-generation architecture with safetensors and a compatible tokenizer/template | Resolve an immutable revision, prepare a runtime plan and offer compatible capacity. Paid startup and qualification still have to succeed. |
| Supported quantized text model | Preserve the exact quantization files and supported runtime mode; do not silently convert or substitute weights. |
| GGUF or a model served by another engine | Register a qualified externally managed endpoint. Automatic llama.cpp/MLX deployment is not part of the initial RunPod backend. |
| Gated or private model | Require the owner's authorized Hugging Face connection and any necessary upstream access acceptance. Never substitute a public model. |
| Unknown architecture, missing chat template, adapter-only repository, or required remote Python code | Explain the specific compatibility blocker and retain the candidate. The initial managed runtime does not execute repository code or perform hidden fine-tuning/adapter merges. |
| Embedding, image, audio or other non-chat task | Report the unsupported task for this inference profile. Do not send it a chat request or advertise capability based on its presence on Hugging Face. |

The useful promise is a common inspection, deployment and invocation workflow with explicit compatibility results, not that one engine can execute every artifact. The [research](hugging-face-model-deployments-research.md) explains why vLLM is the first serving engine and when a different provider or runtime is worth adding.

“Uncensored” and “low refusal” are model-author claims or experiment labels, not trusted capability flags. The platform does not equate fewer refusals with better instruction following, stable characterization, valid structured output, or permission to perform an action. OpenLegend evaluates those dimensions separately.

## Main user journeys

### Deploy a Hugging Face candidate

1. An authorized owner opens the model-deployment controls or uses the API/CLI and supplies a Hugging Face repository link or repository ID. The UI never asks the user to paste a secret into a prompt.
2. Macrofold resolves the repository and requested revision through Hugging Face, identifies the artifact task/format, records source license/access information, and returns compatibility findings. No GPU is purchased. A branch such as `main` resolves to an immutable commit before it can be activated.
3. The owner selects an available runtime profile and capacity offer. The preview shows the exact artifact revision, tokenizer/template choices, effective context/output limits, hardware estimate, region, maximum replicas, download/startup exposure, idle policy and provider account. A weight-size estimate is explicitly different from measured successful loading.
4. The owner reviews a time-limited quote and starts an activation with a finite expiration and infrastructure-cost planning ceiling. The server rechecks the quote, current authority, connection and revision before any provider mutation. Changed terms require a new deliberate activation request.
5. The activation moves through provisioning, loading and qualification. Its status identifies the current stage and the paid time consumed. A failed download, out-of-memory error or qualification failure ends with cleanup and an honest cost record; it does not try progressively larger GPUs automatically.
6. Once the exact runtime is ready, the owner can copy a nonsecret application binding containing the deployment, revision and activation IDs. The game backend receives use access to that resource, not provider administration credentials.
7. The owner runs the application or comparison. Status includes current readiness, remaining lifetime, effective concurrency and infrastructure cost observations. Reading status does not keep the activation alive.
8. Explicit stop or expiry blocks new work, drains accepted calls within their existing bounds and requests provider shutdown. The UI distinguishes stopped capacity from a pending or uncertain final bill. A provider outage remains visible until reconciled.

### Compare candidates in OpenLegend

The developer selects a qualified deployment binding in OpenLegend's server-side experiment profile. The game sends its existing permitted messages and structured-response schema to `POST /v1/inferences`; Macrofold returns the ordinary result receipt plus deployment provenance and cost attribution.

OpenLegend's live structured character route requires the exact model/runtime to pass its schema and character-behavior checks. A plain-text-only candidate may be screened offline with an explicit output-validation mode. Macrofold must not claim that a schema-shaped response is truthful or an acceptable character action, and OpenLegend must not turn a provider failure into fabricated dialogue.

Each comparison records both repositories' revisions, model/runtime identity, prompt and schema identity, decoding settings, workload, output/usage, failures and the linked activation's infrastructure costs. This makes local/hosted and low-refusal/baseline comparisons possible without silently comparing different artifacts or charging shared idle cost once per request.

### Use an existing endpoint

The connection owner registers an exact reachable origin and served model identity, declares source/runtime evidence and the external lifecycle/cost arrangement, then authorizes a finite activation for Macrofold use. Macrofold runs the same transport/capability qualification under the accepted connection and limits.

An ordinary stock endpoint cannot prove its loaded file hashes merely by returning a model name. Status and receipts distinguish verified wrapper evidence from operator assertions. Unknown provenance or host cost is not presented as a verified hash or a free model. A cloud Macrofold service cannot reach a laptop's loopback address; local use needs a self-hosted Macrofold instance with explicitly configured private-origin access or a separately authorized network arrangement.

Stopping an imported activation revokes Macrofold use and cancels/drains its calls. It does not claim to stop a machine or bill that Macrofold does not manage. The owner sees the explicit remaining external shutdown responsibility.

## Application behavior and capability boundaries

- Applications use the existing immediate inference endpoint and existing result/recovery semantics. The exact new binding is specified once in the [shared contract](hugging-face-model-deployments-contract.md).
- An inference can use only a ready, authorized, unexpired activation of its requested revision. Unknown, starting, stopped, exhausted or wrong-revision targets reject before provider dispatch. No fallback model, activation, runtime, hardware tier or funding account is selected implicitly.
- Platform preparation controls model identity, maximum output, transport, deadlines and accounting. Customer message content and supported native parameters remain intact. OpenRouter-specific options do not leak to a vLLM endpoint.
- Streaming is advertised only when the qualified profile supports it. Partial text and tool arguments remain provisional. A final receipt is still required; reconnecting never repeats inference or replays unavailable transient tokens.
- Native text, strict JSON schema and tool-call formatting are separate capabilities. Model-serving support for a tool-call format never executes that tool in Macrofold's single-call inference path.
- The current native-harness context floor does not exclude smaller deployed models. Their actual qualified context, output and schema limits apply. Oversized context or unsupported schema fails explicitly; neither platform silently truncates evidence.
- The API exposes no raw endpoint credential, Hugging Face token, provider control secret, arbitrary container command or unreviewed image execution through the inference binding.

## Money and experiment limits

There are two different financial records: the request's own charge and the activation's infrastructure expense. The initial deployment-backed request charge is explicitly zero under the accepted policy. This does **not** mean the experiment is free. Startup, model downloads, active generation, retained idle workers and configured storage can contribute to the provider bill.

The activation owns its finite time and infrastructure planning ceiling. Ordinary request `max_cost_micro_usd` bounds request charges; it does not cap the provider account or pay for the entire activation. Token usage is a model/workload measurement, not a fabricated GPU price. Shared infrastructure cost is counted once at activation level, with any experiment allocation method separately labeled as an estimate.

The system uses a conservative cost projection and automatic drain/stop policy before its accepted limits. RunPod control-plane failure or delayed billing can leave an uncertain tail. The product must state that a BYOK planning/automatic-shutdown ceiling is not a provider-guaranteed hard dollar cap. It cannot release an unknown obligation merely because the application stopped reading responses.

No standing development allowance, stored key or model discovery result starts an activation. Each paid experiment has an exact owner, accepted account/quote and finite authorization. Automatic renewal and automatic second attempts are excluded.

## Failure and recovery experience

| Situation | Visible result and required behavior |
| --- | --- |
| Repository inaccessible or gated access missing | Compatibility report identifies the source/access blocker; no compute created. |
| Requested artifact/runtime unsupported | Exact reason and supported next route; no alternate weights, remote code or hidden conversion. |
| Quote expires or terms change | Reject activation; show the new quote for a new deliberate start. |
| Provider create acknowledgement is lost | Show provisioning outcome unknown; reconcile the same attempt before another create is allowed. |
| Startup fails or exceeds its bound | Stop new work, clean up owned capacity, retain incurred/unknown costs and diagnostic stage. |
| Capability/schema check fails | Candidate remains ineligible for that capability; no repair call or lowered acceptance claim. |
| Activation becomes unready, expires or loses permission | Reject new inference; existing accepted calls follow their cancellation/deadline and late-result policy. |
| Inference transport is ambiguous | Preserve the same Run/idempotency identity and uncertain accounting; never start another model call automatically. |
| Stop or provider billing confirmation is missing | Distinguish shutdown intent, observed worker state and unreconciled cost; expose the safe operator recovery action. |
| External endpoint is stopped in Macrofold | Macrofold use ends; externally managed hosting/shutdown remains the owner's responsibility. |

Errors use Macrofold's current error envelope and safe diagnostics. Detailed model output, credentials and other tenants' resource identities never appear in public failure messages.

## Delivery stages and acceptance

The complete feature is staged so both repositories can implement a shared contract without depending on unfinished GPU provisioning. Completion of an early stage does not complete the requested feature.

| Stage | Observable exit criterion |
| --- | --- |
| Contract and authorization | Both repositories consume identical bindings, capabilities, receipts and error rules; unsupported combinations fail before any external mutation. |
| External endpoint integration | A qualified synthetic/local endpoint can execute through the real Macrofold inference path with permissions, limits, one-call idempotency, streaming/final receipts and explicit cost/provenance status. |
| Managed RunPod activation | One pinned candidate can be planned, quoted, started, verified, invoked and stopped through the public lifecycle, with no duplicate endpoint after an ambiguous create. |
| OpenLegend integration | The game uses an exact approved binding and validates character output; baseline routes still work and custom failures produce no unauthorized action or invented replacement response. |
| Release qualification | Real provider startup, auth/private-route protection, immutable loading, revocation, capacity/cost controls and cleanup are verified within a separately authorized finite experiment. Results distinguish fixtures from live evidence. |

Acceptance also requires all-five-client contract generation/verification, an API/CLI/dashboard lifecycle journey, tenant/credential isolation, current-authority and expiry races, no hidden inference/provisioning retry, truthful unknown-cost handling, and coordinated documentation. The detailed matrix belongs in the technical design and central maintainer tracker.

## Deliberate initial limits and extension triggers

| Initial limit | Reason and expansion condition |
| --- | --- |
| Text-generation serving profile | OpenLegend's present need; add other tasks with their actual protocols and metering rather than pretending they are chat. |
| vLLM-compatible safetensors and supported quantization for automatic hosting | Smallest maintained path with broad text-model support; add managed llama.cpp/MLX/custom engines when concrete candidates require them. Qualified external endpoints remain available. |
| No repository remote code or arbitrary user container commands | Model data must not silently become privileged infrastructure code; any future code/image path needs its own explicit build, isolation, credential and review contract. |
| One serverless replica per initial activation | Simple bounded experiments and comprehensible costs; expand only after queue, fairness, model-memory and billing measurements justify it. |
| Finite explicit activation; no inference-triggered wake or renewal | Avoid hidden cold-start latency and spending. A future policy must specify who authorizes wake, lifetime, cost and ambiguous retries. |
| BYOK infrastructure only | Avoid inventing GPU retail billing before provider usage and reconciliation are qualified; managed resale is a separate pricing/credit-risk decision. |
| No automatic native-harness enablement | Model-serving readiness does not prove harness context/tool compatibility. Add harness use through its existing capability and runtime qualification owner. |

## Decisions and questions

The architecture and initial product scope above are selected for this design. There is no unresolved product decision that blocks implementation of the stated stages. Model choice, provider-account access, actual immutable image digest, available GPU offer, permitted spending and numerical experiment thresholds are deployment/qualification inputs; they must be supplied and recorded before the corresponding paid experiment, not invented by an implementation agent.

Provider-specific unknowns remain explicit release gates: authenticated RunPod custom-header forwarding and direct-route protection, actual pinned-model loading and memory, cancellation/scale-to-zero behavior, provider billing reconciliation, and workload-specific quality/latency. These are evidence requirements with specified failure behavior, not permission to weaken the contract or silently substitute a backend.
