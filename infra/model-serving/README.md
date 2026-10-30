# Managed model-serving runtimes

These reusable images load an immutable Hugging Face recipe and expose a protected native protocol. The chat image uses vLLM; the decision image uses the publisher's Kev checkpoint loader, scoring head, calibration, batching and prefix cache. Macrofold's existing inference and service owners provide authorization, capacity, lifecycle and accounting. Neither image adds a model-request retry or another deployment controller.

Images contain runtime code and dependencies, never customer model weights. Publish a new image only when that runtime, its dependencies or its protection code changes. Model, customer and unrelated application releases select immutable configuration at deployment time without rebuilding the serving image.

## Chat image

Build from the repository root:

```sh
docker build --platform linux/amd64 -f infra/model-serving/Dockerfile -t macrofold-model-serving:local .
```

The base is official vLLM **0.32.0**, pinned to the Linux AMD64 manifest `sha256:6ee133356d49ed24cee03dd0cda3d3980279a11c107ce3e752c89e76540f41c9`. The multi-platform release index is `sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34`. The protected wrapper is public and anonymously pullable as `ghcr.io/macrofold/model-serving@sha256:ad0c99ffaaa3a868f1ff5c493af89feb9eafecc379b79449991d2a8ddacce385`, selected by the built-in chat profile. Its configuration ID is `sha256:1dc50b45a6d6e2c7d9ffa442fa0610820832fbdbe904f25a28f65cf1b57b1c1f`. Customers need no image setting or build. `MODEL_SERVING_IMAGE` is an optional installation-wide override; a replacement must be built, audited and published with its own immutable digest. The base image alone does not include this wrapper. Actual GPU acceptance and remaining gates belong to the [technical design](../../docs/projects/hugging-face-model-deployments-tech-design.md#customer-setup-without-image-configuration).

## Native decision image

Build the separate Linux AMD64 runtime from the repository root:

```sh
docker build --platform linux/amd64 -f infra/model-serving/Dockerfile.kev -t macrofold-model-serving:kev-local .
```

The image pins Python 3.12.15 on Debian 13 and [Kev source `2074cc44256200bb37540103fa4572901faa10f3`](https://github.com/jaredpalmer/kev/tree/2074cc44256200bb37540103fa4572901faa10f3). The build verifies the complete publisher archive SHA-256 before selecting its package, metadata, dependency lock and Apache-2.0 license. `uv sync --frozen --extra serve --no-dev` installs the publisher's exact lock, including Torch 2.8.0, Transformers 5.17.0, PEFT 0.21.0 and Accelerate 1.15.0. The shared HTTP dependencies and hash-pinned security overlays then replace corresponding compatible lock versions; a complete dependency-graph check rejects conflicts. The native overlay selects aiohttp 3.14.4 for its security fixes; remove it when the publisher lock includes them. CUDA 12.8 runtime libraries come from the locked Torch wheels; the provider supplies the NVIDIA driver/device interface. This graph stays separate from vLLM.

The qualified native release is public, anonymously pullable and selected by the built-in native runtime profile. Customers configure their connections and models through the existing database-backed app/API. No image environment setting is required. Self-hosted operators may optionally override the installation-wide image before creating revisions:

```sh
MODEL_DECISION_SERVING_IMAGE=ghcr.io/macrofold/model-serving-kev@sha256:f64e30cc0f40085bf15fa7c65a6886b5953edf3dbc8b8783f820ecd770780d5a
```

This release uses Docker configuration ID `sha256:3e78685725eebe46c7ee811d79a4bb08c69dca8174dc234c5214ee50d0f1a818`; that is not its registry manifest digest. Use the released image directly, or build/audit/publish a replacement only when runtime code or dependencies change. The [managed acceptance record](../../docs/projects/hugging-face-model-deployments-tech-design.md#corrected-managed-native-acceptance) identifies the actual GPU tests and remaining release gates. Do not use a base Python, PyTorch or upstream Kev image in place of the protected wrapper.

The native recipe uses `profile_id: "kev-systemone-v1"` and the same `MF_MODEL_CONFIG` envelope described below. `source.native` freezes `format: "kev"`, `version: 1`, `weights: "lora"|"full"`, checkpoint artifacts, exact base/tokenizer source and license evidence. Each artifact records its path, byte size and upstream SHA-256 or Git blob SHA-1. The [configuration parser](native_config.py) and [preparer](native_prepare.py) own this private shape; the deployment inspector supplies it, rather than requiring users to author manifests.

The preparer downloads the exact checkpoint and base snapshots directly from Hugging Face into `/models/hub`, checks every selected artifact including cache hits, and exposes only verified files to the loader. Native startup verifies that `head.pt` metadata agrees with the declared base commit and adapter/full layout. The publisher loader then reads the verified local base/tokenizer and checkpoint offline, applies its adapter and scoring head, and retains its calibration. Remote repository code and Hub kernels are disabled. Torch's restricted weights-only loader reads the checksum-verified head; the API host never deserializes it.

Initial native serving supports one GPU, bf16 or explicit fp32, and publisher-native choice, score and noul requests with multiple named questions. An explicit fp32 request is rejected before backbone loading when a BF16-trained LoRA checkpoint forces bf16 in the publisher loader; precision never changes silently. The checkpoint remains loaded across calls. The runtime keeps the publisher's bounded prefix cache and scoring; it does not use chat generation. The complete encoded input must fit the configured context capacity without truncation. Output-token counts follow Kev's serialized-answer accounting convention and are not generated text tokens. Exceeding that configured output capacity returns an error with observed usage retained.

The initial profile deliberately uses the publisher's eager Torch backend with `cuda_graphs=False` and `fused=False`. This keeps the verified correctness path free of runtime kernel installation. It reuses the warm loaded model, within-request named questions and bounded prefix cache; it does not claim cross-request GPU batching. Qualifying publisher CUDA graphs/fused kernels is an optional performance improvement requiring separate compatibility, cancellation and memory measurements.

Official Kev adapter/full checkpoint format is required. The community `SargeDev/JEV-27B-Uncensored` uses a different fixed-slot head and prompt/calibration format, so it is not compatible with this loader. Its earlier separately operated reader does not qualify managed Kev hosting. Official Kev is not described as uncensored.

### Native queue, cancellation and failure ownership

The native engine binds only to loopback. Outstanding native requests and queue entries are both bounded by configured `max_concurrent_requests`; excess work returns HTTP 429 before enqueueing. The publisher's model thread retains cache/scoring, with a narrow queue-owner correction: Futures enter the running state immediately before GPU dispatch. The initial eager backend processes queued requests individually because the publisher executes that path sequentially; later requests remain cancellable until their actual forward. Cancelled or expired queued work is skipped safely. Configured context overflow returns HTTP 422 with `native_context_exceeded`, without truncation or GPU execution. Cancelling an already-running CUDA operation may detach its answer, but retains the capacity slot until that operation actually finishes. There is no model retry or claim that disconnecting proves remote work stopped.

The protected wrapper propagates the accepted absolute deadline, closes the engine transport on disconnect/timeout and preserves native response metadata and request IDs. A caller disconnect is expected transport cancellation (HTTP 499 if a response can still be delivered), rather than a native model-failure diagnostic; it does not prove running GPU work stopped. A failure returns a safe error code without arbitrary model exception text; the model thread can accept later healthy requests after an ordinary inference failure. A loading or engine-process failure makes the worker unavailable and exits for the existing provider/service recovery owner. No request loads model weights, fetches metadata or installs a package.

## Private startup configuration

Set `MF_MODEL_CONFIG` to a JSON object with `source`, `parameters` and `served_alias`; [config.py](config.py) owns its strict schema. Both model and optional separate tokenizer revisions must be full lowercase 40-character commits. `source.weight_files` lists exact safetensors paths. An optional `source.chat_template` contains reviewed immutable template text. The revision alias must agree with Macrofold's stored serving target.

Required parameters are `context_window_tokens`, `max_output_tokens` and `max_concurrent_requests`. Chat supports dtype, quantization, tensor parallelism, memory utilization and built-in tool/reasoning parser selection. Native decisions support their narrower profile described above. No shell, plugin path, arbitrary image or remote repository code is accepted. Engine validation enforces configured limits with truncation disabled.

Set `MF_ENDPOINT_SECRET` to a generated ASCII secret of at least 32 characters. An optional owner-authorized `HF_TOKEN` is given only to the snapshot downloader and removed before the engine starts. RunPod's account token is never injected into the worker environment or forwarded by the wrapper to the engine. There are no image-build secrets. The server listens on `PORT` (default 8000), and the engine listens only on loopback port 8001.

Startup downloads the selected commits through maintained Hub snapshot/cache APIs and verifies their upstream checksums, including cache hits. A separate file view prevents another cached weight variant from entering the engine. Selected shards, including nested files with duplicate basenames, receive unique root-level links for vLLM's native safetensors loader; no weight bytes are copied or converted. Source indexes are omitted because their original paths do not describe that view. Inline tokenizer templates and the canonical pinned `chat_template.jinja` file are supported. Only a completed verified recipe starts vLLM. Failed download/loading or engine loss terminates this worker; provider replacement and Macrofold's bounded service recovery own subsequent attempts. No completed answer depends on a worker boot identity.

## HTTP boundary

- `GET /ping` follows [RunPod's load-balancer health contract](https://docs.runpod.io/serverless/load-balancing/overview#health-checks): an empty 204 means initial download/loading, 200 means ready, and 503 means failed, stopped or an unavailable engine. Initialization must not trigger worker replacement. `GET /health` remains strict application readiness: 200 only when ready, otherwise 503. JSON health responses expose only `{"ready":true|false}`.
- `GET /v1/models` and the selected profile's inference route require `x-macrofold-endpoint-secret`. Chat exposes `POST /v1/chat/completions`; native decisions expose `POST /v1/systemone` and reject streaming. A provider bearer token does not replace the endpoint secret.
- An optional `x-macrofold-deadline-ms` contains an absolute Unix-millisecond deadline and can only shorten the 240-second limit.
- All other paths and methods are denied. Inference/admin/metrics/tokenizer routes on the raw engine are not exposed.

Requests are bounded to 8 MiB and responses/streams to 24 MiB, below the provider's 30 MB limit. Native JSON/SSE, final usage and errors pass through. The wrapper strips incoming credentials, disables redirects and inference retries, and closes the upstream socket on cancellation, disconnect or deadline. An interrupted forwarded request can remain uncertain; closing transport is not proof that generation never occurred. Streaming after a transport/size/deadline failure ends incompletely rather than fabricating a successful final event.

Macrofold sends the required RunPod bearer only to the validated RunPod endpoint origin. [RunPod's examples](https://docs.runpod.io/serverless/load-balancing/build-a-worker) require that bearer; the real native Serverless ingress test requires both the provider bearer and wrapper secret (401 when either is missing, 200 together). The wrapper removes caller credentials before forwarding to the engine. [Endpoint-restricted keys](https://docs.runpod.io/get-started/credentials#api-keys) are documented, but a separate invocation-key lifecycle is not implemented or qualified.

## Verification and dependencies

CPU fixtures exercise the actual Uvicorn/HTTPX transport, configuration, source preparation and cancellation without GPU resources or external model calls:

```sh
python3 -m venv /tmp/macrofold-model-serving
/tmp/macrofold-model-serving/bin/python -m pip install -r infra/model-serving/requirements.txt
/tmp/macrofold-model-serving/bin/python -m unittest discover -s tests/runtime-model-serving -v
```

The pinned wrapper dependencies are HTTPX 0.28.1, Starlette 1.9.0 and Uvicorn 0.54.0 (BSD-3-Clause), plus Hugging Face Hub 1.33.0 (Apache-2.0). Upstream projects retain their original licenses/notices: Kev, Transformers, PEFT and Accelerate are Apache-2.0; Torch is BSD-3-Clause; CUDA libraries retain NVIDIA's terms. Model licensing/access remains a separate owner responsibility. The chat Docker build removes an orphan OTLP common package incompatible with the base telemetry graph and accepts only the exact upstream vLLM override of NCCL 2.30.7 for DeepEPv2 against Torch's 2.29.7 metadata pin. The native image uses its independent checked lock. Scan each complete built OS/Python image under the existing dependency policy before release; a wrapper-only audit does not cover either GPU graph.

The chat security overlay pins Ubuntu GnuPG 2.4.4-2ubuntu17.6, OpenSSL 3.0.13-0ubuntu3.16 and hash-verified certifi 2026.10.19 (MPL-2.0). After dependency validation, the final image removes unused pip and uv installers, including their bundled vulnerable libraries and CA stores. The fixed engine and immutable Hub downloader do not install packages at runtime; required engine packages and notices remain. No vulnerability or package is excluded from the release scan.

The native Debian 13 image audit found no critical or fixable high findings after the aiohttp overlay. Its retained report still contains unfixed high findings in eight CVE families affecting util-linux, ACL, ncurses, systemd and Perl archive tooling. The non-root serving image exposes none of their privileged mount/login, terminal or archive interfaces; this limits exposure but is not a guarantee of non-exploitability. Retain the complete report and reassess available fixes for each release. Do not suppress these packages or findings.

Official interfaces: [vLLM 0.32.0 release](https://github.com/vllm-project/vllm/releases/tag/v0.32.0), [pinned serve flags](https://docs.vllm.ai/en/v0.32.0/cli/serve/), [HF exact-revision downloads](https://huggingface.co/docs/huggingface_hub/en/guides/download), [HF cache verification](https://huggingface.co/docs/huggingface_hub/en/guides/manage-cache), [HTTPX async streaming](https://www.python-httpx.org/async/) and [Starlette responses](https://starlette.dev/responses/).

CPU fixtures establish neither real GPU/model loading nor RunPod's bearer/custom-header ingress behavior. The [native managed acceptance](../../docs/projects/hugging-face-model-deployments-tech-design.md#corrected-managed-native-acceptance) separately verifies final-image GPU loading, both ingress credentials, two exact loaded workers, native decisions, cancellation, recovery, tracing and normal cleanup. The refreshed chat artifact separately passes [real managed Huihui acceptance](../../docs/projects/hugging-face-model-deployments-tech-design.md#managed-chat-acceptance-in-the-normal-local-account): explicit thinking control, JSON/schema, SSE/final usage, cancellation, grants/replay and verified cleanup. Tool formatting is disabled for that recipe and rejects; broader tool/runtime/load qualification and final provider billing remain release gates.

Run the native fixtures inside the built artifact as well. This requires the actual pinned publisher API, encoder and server, with synthetic CPU probabilities; no backbone weights are loaded:

```sh
docker run --rm --platform linux/amd64 --network none \
  --entrypoint /opt/kev/.venv/bin/python \
  -e MF_MODEL_RUNTIME_PATH=/opt/macrofold-model -e MF_NATIVE_PUBLISHER_REQUIRED=1 \
  -v "$PWD/tests/runtime-model-serving:/tests:ro" \
  macrofold-model-serving:kev-local -m unittest discover -s /tests -v
```

The explicit publisher requirement fails rather than skipping if that image's installed package is missing. A separate bounded source check loads the real pinned `head.pt` through the safe publisher loader and verifies metadata/calibration without purchasing a GPU. Real backbone/adapter/head execution and managed lifecycle are verified separately in the native acceptance record, rather than inferred from these CPU fixtures.
