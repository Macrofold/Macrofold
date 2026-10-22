# Hugging Face model deployments: research and provider decision

| Field | Status |
| --- | --- |
| Project | In progress |
| Design and research | Complete for the proposed first delivery |
| Implementation | Not started |
| Live provider qualification | Not started; no paid deployment or inference performed for this research |
| Research date | 2026-10-22 |
| Owners | [Feature specification](hugging-face-model-deployments-feature-spec.md), [technical design](hugging-face-model-deployments-tech-design.md), [shared contract](hugging-face-model-deployments-contract.md) |

This appendix owns the evidence and tradeoffs behind the proposal. The linked design owns implementation requirements and the shared contract owns the OpenLegend interface. Existing feature guides continue to describe current runtime behavior. Remaining delivery work belongs in [maintainer TODO](../maintainers/TODO.md).

## Decision and scope

Use **Runpod Serverless Load Balancer through REST API v2**, with a pinned vLLM runtime, as the first managed hosting adapter. Support an imported, qualified OpenAI-compatible endpoint for deployments outside that first runtime profile. OpenLegend selects a Macrofold deployment revision; it does not acquire GPU-provider credentials or implement provider lifecycle logic.

The first delivery uses the customer's provider account and a persistent service with explicit operating limits. Inspection is read-only. Starting the service authorizes provider recovery and scaling within that policy; ordinary inference cannot override a stopped service or raise its limits. Warm minimum capacity is appropriate for interactive production use, with an optional stop time for temporary workloads. The feature specification owns these product decisions.

This selection favors direct production HTTP inference, provider-managed health/replacement/scaling, a small adapter surface and explicit resource ownership. Runpod documents direct worker routing, streaming suitability and no built-in load-balancer retries. Its official vLLM worker repository recommends the official vLLM image for load balancing instead of its queue worker. These properties fit Macrofold's single-attempt inference and durable recovery boundaries. They do not establish measured latency, guaranteed availability or lowest total cost. [R01] [R02]

The managed input can be any Hugging Face model repository for **inspection**; successful deployment requires a supported architecture, weight format, tokenizer, chat template and hardware profile. An unsupported inspection result must explain the missing capability. Repository availability and an OpenAI-compatible HTTP interface do not prove structured-output correctness, tool support, model quality or suitability for the NPC workload. [V01] [V02]

OpenLegend can use compatible low-refusal models through the same production provider path. Treat an author's “uncensored” description as model metadata, not a verified behavioral capability. Optional comparisons can record refusal behavior and output quality independently of hosting. Hosting selection does not establish the applicable model license or provider terms, and must not silently substitute another model when a deployment fails.

## Hosting alternatives and selection triggers

| Option | Useful properties | Costs and operational tradeoffs | Selection trigger |
| --- | --- | --- | --- |
| Runpod Serverless Load Balancer | Ordinary HTTP paths and streaming; custom containers; independently managed worker limits | Cold startup, finite request limits and dropped overload require bounded admission; warm minimum workers cost continuously, and runtime auth/shutdown need verification | First managed adapter for production text serving with supported warm capacity and scaling [R01] [R02] |
| Runpod queue-based Serverless | Durable provider job interface and asynchronous processing | Different request/stream envelope; automatic retries; adds provider job recovery to Macrofold's own execution identity | Reconsider only for a concrete long-running/offline workload whose replay and cancellation semantics have been designed [R01] |
| Hugging Face Inference Endpoints | Native HF model deployment; vLLM, SGLang, llama.cpp and custom-container options | Minute billing; cold starts after scale-to-zero; region/hardware rates differ | Choose when native HF setup, supported engine or required deployment controls reduce total operational effort enough to outweigh cost differences [H01] [H02] [H03] |
| Modal | Python-defined GPU applications; official vLLM example with pinned model revision and persistent model/compilation caches | Additional application/deployment integration; GPU, CPU, RAM and storage components | Add when measured cold-start needs, custom runtime composition or its deployment facilities justify the extra adapter surface [M01] [M02] |
| Runpod Pods | Dedicated GPU; published hourly prices can be lower for sustained work | Explicit start/stop/terminate operations, storage retention and restart capacity; exposed HTTP ports require application authentication | Use through the existing external-endpoint path now; automate Pods when measured sustained utilization justifies its additional lifecycle adapter [R03] [R12] [R13] |
| Imported OpenAI-compatible endpoint | Reuses a user's existing runtime; permits qualified llama.cpp/GGUF or other deployments | Hosting, costs and some provenance may be externally managed; protocol parity must be tested | First extension for models outside managed vLLM support; no additional GPU-provider adapter required [V02] [V04] |

HF's documented scale-to-zero behavior returns 503 while a cold endpoint initializes; `X-Scale-Up-Timeout` can hold a request while it starts. Its guidance warns that startup can take minutes. Paused endpoints require explicit resume; scale-to-zero endpoints can wake from inference traffic. Interactive NPC use should select warm minimum capacity or explicitly accept cold-start latency; normal readiness/recovery does not require experimental certification. [H02] [H04]

Runpod Pod stop and terminate are materially different. Stopping releases GPU capacity while retained volume storage remains billable; terminating destroys Pod-local storage, while independent network volumes survive. A stopped Pod is not a reservation of its former GPU. A separately managed Pod is already usable through the external endpoint route. Automating its lifecycle is a later adapter choice; stopping it is not a cost-free reservation of capacity. [R12]

No paid benchmark was run. Compare providers using the same model revision, context, output allowance, concurrency and useful-result criteria before changing the default. GPU memory size alone does not establish equal throughput or latency.

## Price snapshot and cost interpretation

All amounts are USD. The following public list-price snapshot was inspected on the research date; Runpod's price page identifies an update date of 2026-10-08. A deployment plan must use fresh provider/catalog evidence and the accepted account configuration rather than these illustrative constants. [R03] [H01] [M01]

| GPU or pool | Runpod Serverless per GPU-hour | HF Endpoints per instance-hour | Modal GPU-only equivalent per hour |
| --- | ---: | ---: | ---: |
| L4 / economical 24 GB class | $0.69: L4/A5000/3090/MIG 24 GB pool | GCP L4 $0.70; AWS L4 $0.80 | L4 $0.7992 |
| RTX 4090, 24 GB | $1.10 | — | — |
| A40/A6000, 48 GB | $1.22 | — | — |
| L40S / faster 48 GB class | $1.75: L40/L40S/6000 Ada/MIG 48 GB pool | AWS L40S $1.80 | L40S $1.9512 |
| A100, 80 GB | $2.72 | AWS $2.50 | $2.4984 |
| H100, 80 GB | $4.79 | No equivalent selected for this comparison | $3.9492 |

Modal equivalents are the posted GPU rate per second multiplied by 3,600; CPU and RAM are additional. Different hardware in a Runpod pool may perform differently, so a placement profile must qualify eligible types and record the actual worker GPU. HF is already cheaper than the listed Runpod A100 rate, and its GCP L4 rate is close to the economical Runpod pool: “Runpod is always cheapest” is not supported. [R03] [H01] [M01]

Illustrative **charged worker time**, one GPU and one worker, excluding storage and other components:

| Runpod Serverless class | 1 charged hour | 10 charged hours |
| --- | ---: | ---: |
| Economical 24 GB | $0.69 | $6.90 |
| A40/A6000 48 GB | $1.22 | $12.20 |
| A100 80 GB | $2.72 | $27.20 |

These examples are arithmetic, not quotes for one hour of user interaction. Cost depends on the sum of all workers' billed seconds, GPU count, accepted placement rates and storage. For comparison, the Runpod Pod page lists L4 $0.59/hour, A40/A6000 $0.59/hour, L40S $1.09/hour and A100 80 GB $1.79/hour; cloud selection, stock and actual account rates must be checked at planning time. [R03]

Runpod Serverless bills from worker start until full stop, rounded up to seconds. Startup/model loading, inference and waiting during idle timeout are billable. Image pulls and provider-managed cached-model downloads normally occur before worker billing starts; application downloads during startup must not be assumed free. Container disk is approximately $0.10/GB/month in five-minute intervals; network volumes are listed at $0.07/GB/month below 1 TB and $0.05 above. Current active-worker discounts require a sales inquiry. [R04]

### Accounting implications

Managed services need durable resource identity, observed usage, cost observations and cleanup state. Token/call usage is useful attribution, but must not be charged again as though it were a second vendor inference bill. Retain platform charges and externally billed provider costs as distinct facts. The feature specification's zero initial request charge does not imply free infrastructure.

Check the authorized hourly cost against the permitted pool rate, GPU count, maximum workers and required storage/other meters. Record startup, idle and cleanup exposure separately from token usage. The v2 catalog exposes hourly list rates; account discounts are not reflected. The billing API returns endpoint/time-bucket amounts for GPU, CPU and disk, with a minimum bucket of one hour. Its deprecated fee field is always zero because platform charges are included in compute amounts. No inspected field proves that a returned amount is financially final. [R10] [R11] [R05]

A service policy can constrain capacity/rate, reject new requests and request provider shutdown; an optional stop time bounds intended runtime. It cannot guarantee an exact external spending ceiling during provider outages, delayed termination, restart behavior or delayed billing. Keep unresolved resources and uncertain costs visible until provider observations establish their actual state. A zero-cost observation is not proof of a free request, and HTTP cancellation is not proof of stopped compute.

## Runpod API evidence that constrains implementation

### Management API version and configuration

Use management base `https://api.runpod.io/v2`. Current v2 supports `LOAD_BALANCER`; older examples using GraphQL `LB` or REST v1 shapes must not be copied. GraphQL documentation marks that API deprecated with retirement planned for early 2027. Runtime HTTP remains a separate origin, `https://<endpoint-id>.api.runpod.ai`. [R06] [R14] [R01]

The create API accepts inline image, environment, exposed ports, disk and exec-form `cmd` arguments. Use those arguments instead of interpolated shell commands. `gpu.pools` contains catalog pool IDs, not individual display names; `REQUEST_COUNT` scaling is required for load balancing. Explicitly set maximum workers: the v2 creation default is three. Inline configuration also avoids a shared template ownership dependency. [R07] [R05]

The exact request/response mapping belongs in the technical design, not a duplicate schema here. The implementation must pin the provider schema/SDK version used for development and verify it against the deployed API. Relevant v2 observations are:

| Evidence | Design consequence |
| --- | --- |
| Worker `min` and `max` both permit zero; idle timeout permits 1–3,600 seconds | `min:0,max:0` is schema-supported for stopping worker admission. Explicit values avoid conflicting prose defaults; provider observation still determines completion [R05] [R08] |
| Worker/scaling updates apply promptly; image/environment changes take effect as workers cycle | Do not mutate an active immutable model revision and accept mixed old/new workers [R08] |
| Worker inventory includes stale/configuration version, image, actual GPU, start and uptime evidence | Readiness and drift checks inspect actual workers; configuration intent alone is insufficient [R09] |
| Create has no documented idempotency key, generic metadata field or unique-name guarantee | Persist an attempt before dispatch; store nonsecret correlation in supported environment fields; reconcile paginated endpoint listing after lost acknowledgement; never blindly create again [R05] |
| Delete documents termination of workers, cancellation of queued/in-progress jobs and deletion of the bound template | Delete only exclusively owned resources; distinguish request acknowledgement, observed teardown and financial reconciliation [R15] |
| Data-center input is described as preferred placement | Do not advertise guaranteed regional residency without separate verified enforcement [R07] |

### Readiness and bounded transport

The official direct vLLM instructions expose HTTP port 8000, set `PORT=8000`, and use its `/ping` or `/health` endpoint; the health path is configurable. Load balancing documents a two-minute no-worker timeout, a 5.5-minute processing limit and a 30 MB request/response limit. Misconfigured ports may leave a worker running for eight minutes before it terminates. Health responses distinguish healthy, initializing and unhealthy workers. [R01] [R02]

Keep a configured warm minimum for interactive production; service start authorizes its continuing cost. Passive status reads use management observations and must not invoke generation. Treat data-plane health requests as potentially activating a cold worker until qualified. Application execution deadlines must fit inside provider limits with room for cleanup. Bound requests before dispatch because the load balancer drops overload and provides no queue or built-in retry. A retry of a paid prompt is a new inference attempt, not a health check. [R01]

### Cache compatibility gap

Runpod documents cached HF repositories, including gated/private ones, and snapshot paths beneath `/runpod-volume/huggingface-cache/hub`. It currently supports one cached model per endpoint and may download every quantization in the selected repository. [R16]

The inspected strict v2 create schema contains no model/cache selection or cached revision field. Console support therefore does not establish an API for selecting an exact immutable cached snapshot. The first delivery must work using an exact-revision download within its bounded startup/storage plan. Native caching is an optimization only after a verified API and SHA-specific lookup are available. Do not resolve `refs/main`, select the first snapshot directory, or assume a cache hit proves the requested model revision. [R05] [R16]

### Authentication and immutable runtime evidence

Runpod's load-balancer examples authenticate with the Runpod API key in the bearer header. The inspected documentation does not establish how that header is forwarded/rewritten, or that every direct worker ingress path is inaccessible. Adding a second vLLM bearer requirement without checking the transport could break authentication. vLLM itself warns that its API-key option covers selected prefixes while other inference routes can remain unauthenticated. [R01] [V03]

The technical design therefore uses a small controlled gateway around the pinned inference runtime: provider edge authentication, an independently authenticated Macrofold-to-worker channel, explicitly allowed routes, and loopback-only access to vLLM. This is proposed application behavior, not a claimed Runpod feature. The exposed health path must reveal no secrets; raw inference/admin/debug routes must not bypass authorization. Verify custom-header forwarding and both ordinary and direct ingress paths before enabling the adapter.

vLLM supports separate model and tokenizer revision flags. Its served model name is a configurable alias, so `/v1/models` is not proof of loaded artifact identity. Pin the runtime image digest, model commit, tokenizer commit, chat-template content and relevant inference settings. Macrofold must load the intended pinned source/configuration through maintained download/engine mechanisms. No custom boot certificate or extra provenance request is needed on the normal inference path. [V03]

## Hugging Face source and runtime compatibility

### Immutable source inspection

HF's model-info API accepts a revision and can return its SHA plus file size/LFS metadata. Resolve a branch/tag once, then inspect and download by the full commit. A token can read an authorized private repository; gated-model permission belongs to the individual user. License metadata helps discovery but the actual repository license remains the authority. [H05] [H06] [H07] [H08]

Parse a Hugging Face repository identifier or allowed HF URL into known API operations instead of fetching arbitrary user URLs. Bound metadata/file reads and redirects; distinguish a model from a dataset, Space, adapter-only repository or unrelated artifact. Never expose HF credentials in OpenLegend, logs, image layers or public manifest fields. Recheck access before provisioning and give an actionable access/unsupported result without automatic credential substitution.

Remote-code loading executes repository code; disable it in the initial managed profile. Safetensors avoids pickle-based weight deserialization; that narrower protection does not establish trust in repository Python, tokenizer extensions, templates or arbitrary startup commands. Record the exact profile and refuse unsupported custom code rather than silently enabling `trust_remote_code`. [H09] [H11] [V03]

### Runtime choices

| Runtime | First-delivery decision | Reason and extension trigger |
| --- | --- | --- |
| vLLM | Managed text-generation default, for qualified architectures/formats | Maintained OpenAI-compatible serving and supported-model matrix; validate the exact image/model/hardware combination and each advertised capability [V01] [V02] |
| llama.cpp / GGUF | Imported endpoint first | A separate engine is appropriate for GGUF; vLLM describes its GGUF support as experimental and under-optimized. Add managed llama.cpp only when repeated imported-endpoint demand justifies its own image/profile/lifecycle qualification [V04] [V05] |
| SGLang | Extension, not a second default implementation | HF supports it as an engine; adopt for a demonstrated model/capability/performance requirement with equivalent deployment evidence [H03] |
| TGI | Do not choose for new default | HF marks TGI in maintenance mode and recommends maintained alternatives for new work [H10] |

Determine usable context and concurrency from the complete runtime profile, not weight file size alone. Model memory, KV cache, context, quantization kernels, driver/GPU compatibility and serving concurrency all affect feasibility. Deployment acceptance must distinguish ordinary text, streaming, structured JSON and tool calls; ordinary worker recovery uses health/readiness, not a repeated evaluation suite. Reject unsupported parameters/capabilities before paid inference instead of silently dropping them. [V01] [V02] [V03]

An imported endpoint is eligible for production on owner trust and actual protocol compatibility. Preserve its declared source/runtime identity and limitations without requiring a custom attestation wrapper. A cloud Macrofold service cannot access a developer laptop through `localhost`; local Macrofold or an explicitly configured authenticated network path is required. Apply endpoint-origin, DNS/IP, redirect and credential-scope controls to prevent server-side request forgery. Imported hosting costs must remain externally declared/unknown when Macrofold cannot observe them.

## Launch acceptance unknowns

These are implementation/live qualification gates, not unresolved selection decisions. Their task owners and completion status belong in the technical design and maintainer TODO. Documentation evidence alone does not close them.

| Gate | Evidence required before enablement |
| --- | --- |
| Provider account/API compatibility | Exact v2 calls, least required credentials, actual pool/rate access, response validation and create/list/update/delete behavior |
| Ambiguous provisioning | Lost create acknowledgement, pagination/correlation, zero or multiple candidate handling, no duplicate automatic deployment, retained financial liability |
| Pause and deletion | Worker bounds zero, warm/in-flight behavior, provider restart behavior, observed termination, disappearance/404 interpretation and later billing reconciliation |
| Auth and ingress | Provider bearer handling, independent worker-secret forwarding, rejection without authorization, no direct inference route bypass, private health/identity disclosures |
| Artifact identity | Pinned image and HF commits, verified downloaded files, separate tokenizer/template settings, correct revision-specific launch/alias, safe revision rollout and same-revision replacement |
| Cold startup and storage | Measured download/load/warmup latency and charges, full-disk/failure cleanup, startup deadline, no assumed native-cache support |
| Inference correctness | Exact OpenAI response shape, SSE completion/usage, bounded context/output, structured-output qualification, malformed/refusal/truncation handling and no hidden fallback |
| Cancellation and outages | Aborted streams, upstream continuation ambiguity, provider/control-plane failure, optional timed stop, automatic worker recovery and no blind prompt replay |
| Financial evidence | Current authorized rate/capacity policy, actual GPU and worker counts, storage charges, hourly billing buckets, delayed/adjusted charges and no double-counted model/infrastructure cost |
| OpenLegend integration | Stable deployment selection and accepted revision receipts across both repositories; normal gameplay works without experiment configuration and survives service recovery |

Future runtime/provider additions must pass the same application contract through a different adapter. Native HF cache APIs, hard residency guarantees, automatic retail pricing, arbitrary custom code, managed GGUF and additional providers are not prerequisites for the first qualified path.

## Source register

All sources are primary vendor/project documentation or official repositories, inspected 2026-10-22. “Stable” and `main` documentation URLs can change; freeze the exact runtime, API schema and source commit used by implementation. Prices and published capabilities are a research snapshot, not deployment acceptance.

| ID | Official source | Evidence used |
| --- | --- | --- |
| R01 | [Runpod load balancing][R01] | Direct routing, retry/backpressure differences, health, auth examples, time/payload limits |
| R02 | [Runpod vLLM worker repository][R02] | Official-image recommendation for direct load balancing and port configuration |
| R03 | [Runpod pricing][R03] | Serverless and Pod price snapshot |
| R04 | [Runpod Serverless billing][R04] | Charged phases, rounding and storage components |
| R05 | [Official Runpod v2 OpenAPI source][R05] | Exact supported fields, bounds, absent idempotency/cache fields and billing units |
| R06 | [Runpod REST v2 overview][R06] | Management API origin and schema location |
| R07 | [Create serverless endpoint][R07] | Inline configuration, load-balancer type, placement and defaults |
| R08 | [Update serverless endpoint][R08] | Autoscaler and rolling configuration behavior |
| R09 | [List endpoint workers][R09] | Actual worker/configuration observations |
| R10 | [GPU catalog][R10] | Pool IDs, availability and hourly list-rate interpretation |
| R11 | [Serverless billing history][R11] | Endpoint/time-bucket amounts and reconciliation inputs |
| R12 | [Manage Pods][R12] | Stop, resume, terminate and storage distinctions |
| R13 | [Expose Pod ports][R13] | Public HTTP proxy requires application authentication |
| R14 | [GraphQL configurations][R14] | Deprecation and retirement guidance |
| R15 | [Delete serverless endpoint][R15] | Worker/job/template cleanup semantics |
| R16 | [Cached models][R16] | Model cache behavior, snapshot path and current limitations |
| H01 | [HF Endpoint pricing][H01] | Per-instance prices, minute billing and initialization charges |
| H02 | [HF autoscaling][H02] | Cold-start and scale-to-zero behavior |
| H03 | [HF custom containers][H03] | Engine/custom-container integration and mounted repository |
| H04 | [HF Hub endpoint management][H04] | Pause/resume/scale-to-zero distinction |
| H05 | [HF model-info and tree APIs][H05] | Revision resolution, artifact metadata and access errors |
| H06 | [HF download guide][H06] | Full-commit revision pinning |
| H07 | [HF gated models][H07] | Individual access requirements |
| H08 | [HF repository licenses][H08] | License metadata and repository license files |
| H09 | [Transformers model loading][H09] | Remote-code execution and revision precautions |
| H10 | [TGI documentation][H10] | Maintenance mode and recommended alternatives |
| H11 | [Safetensors documentation][H11] | Tensor serialization without pickle |
| V01 | [vLLM supported models][V01] | Architecture support boundaries |
| V02 | [vLLM OpenAI-compatible server][V02] | Serving interface, chat templates and capability differences |
| V03 | [vLLM serve flags][V03] | Revision, tokenizer, context, served alias, remote code and auth limitations |
| V04 | [llama.cpp server][V04] | GGUF serving and supported API features |
| V05 | [vLLM GGUF][V05] | Experimental/under-optimized support limitation |
| M01 | [Modal prices][M01] | GPU per-second rates and additional CPU/RAM/storage components |
| M02 | [Modal vLLM example][M02] | Pinned model/runtime and cache deployment example |

[R01]: https://docs.runpod.io/serverless/load-balancing/overview
[R02]: https://github.com/runpod-workers/worker-vllm#option-3-load-balancing-with-the-vllm-image
[R03]: https://www.runpod.io/pricing
[R04]: https://docs.runpod.io/serverless/pricing
[R05]: https://github.com/runpod/docs/blob/main/api-reference-v2/openapi.json
[R06]: https://docs.runpod.io/api-reference-v2/overview
[R07]: https://docs.runpod.io/api-reference-v2/serverless/create-a-serverless-endpoint
[R08]: https://docs.runpod.io/api-reference-v2/serverless/update-a-serverless-endpoint
[R09]: https://docs.runpod.io/api-reference-v2/serverless/list-serverless-endpoint-workers
[R10]: https://docs.runpod.io/api-reference-v2/catalog/list-gpu-types
[R11]: https://docs.runpod.io/api-reference-v2/billing/get-serverless-billing-history
[R12]: https://docs.runpod.io/pods/manage-pods
[R13]: https://docs.runpod.io/pods/configuration/expose-ports
[R14]: https://docs.runpod.io/sdks/graphql/configurations
[R15]: https://docs.runpod.io/api-reference-v2/serverless/delete-a-serverless-endpoint
[R16]: https://docs.runpod.io/serverless/endpoints/model-caching
[H01]: https://huggingface.co/docs/inference-endpoints/en/pricing
[H02]: https://huggingface.co/docs/inference-endpoints/en/guides/autoscaling
[H03]: https://huggingface.co/docs/inference-endpoints/en/engines/custom_container
[H04]: https://huggingface.co/docs/huggingface_hub/en/guides/inference_endpoints
[H05]: https://huggingface.co/docs/huggingface_hub/en/package_reference/hf_api
[H06]: https://huggingface.co/docs/huggingface_hub/en/guides/download
[H07]: https://huggingface.co/docs/hub/models-gated
[H08]: https://huggingface.co/docs/hub/repositories-licenses
[H09]: https://huggingface.co/docs/transformers/model_doc/auto
[H10]: https://huggingface.co/docs/text-generation-inference/index
[H11]: https://huggingface.co/docs/safetensors/index
[V01]: https://docs.vllm.ai/en/stable/models/supported_models/
[V02]: https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/
[V03]: https://docs.vllm.ai/en/stable/cli/serve/
[V04]: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
[V05]: https://docs.vllm.ai/en/stable/features/quantization/gguf/
[M01]: https://modal.com/pricing
[M02]: https://modal.com/docs/examples/vllm_inference

