# Managed text-model runtime

This image loads one immutable Hugging Face safetensors recipe into vLLM and exposes a protected native OpenAI chat interface. Macrofold's existing inference and service owners provide authorization, capacity, lifecycle and accounting; this process does not schedule or retry inference.

Build from the repository root:

```sh
docker build --platform linux/amd64 -f infra/model-serving/Dockerfile -t macrofold-model-serving:local .
```

The base is official vLLM **0.32.0**, pinned to the Linux AMD64 manifest `sha256:6ee133356d49ed24cee03dd0cda3d3980279a11c107ce3e752c89e76540f41c9`. The multi-platform release index is `sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34`. The built wrapper image needs its own immutable registry digest before hosted use; the base image alone does not include this wrapper.

## Private startup configuration

Set `MF_MODEL_CONFIG` to a JSON object with `source`, `parameters` and `served_alias`; [config.py](config.py) owns its strict schema. Both model and optional separate tokenizer revisions must be full lowercase 40-character commits. `source.weight_files` lists exact safetensors paths. An optional `source.chat_template` contains reviewed immutable template text. The revision alias must agree with Macrofold's stored serving target.

Required parameters are `context_window_tokens`, `max_output_tokens` and `max_concurrent_requests`. Supported optional parameters are dtype, quantization, tensor parallelism, memory utilization and built-in tool/reasoning parser selection. No shell, plugin path, arbitrary image or remote repository code is accepted. Native engine flags enforce exact context and output limits, with prompt truncation disabled at the protected boundary.

Set `MF_ENDPOINT_SECRET` to a generated ASCII secret of at least 32 characters. An optional owner-authorized `HF_TOKEN` is given only to the snapshot downloader and removed before the engine starts. RunPod's account token is never injected into the worker environment or forwarded by the wrapper to the engine. There are no image-build secrets. The server listens on `PORT` (default 8000), and the engine listens only on loopback port 8001.

Startup downloads the selected commits through maintained Hub snapshot/cache APIs and verifies their upstream checksums, including cache hits. A separate file view prevents another cached weight variant from entering the engine. Only a completed verified recipe starts vLLM. Failed download/loading or engine loss terminates this worker; provider replacement and Macrofold's bounded service recovery own subsequent attempts. No completed answer depends on a worker boot identity.

## HTTP boundary

- `GET /ping` and `GET /health` expose only `{"ready":true|false}`. Loading and unavailable engines return 503.
- `GET /v1/models` and `POST /v1/chat/completions` require `x-macrofold-endpoint-secret`. A provider bearer token does not replace it.
- An optional `x-macrofold-deadline-ms` contains an absolute Unix-millisecond deadline and can only shorten the 240-second limit.
- All other paths and methods are denied. Inference/admin/metrics/tokenizer routes on the raw engine are not exposed.

Requests are bounded to 8 MiB and responses/streams to 24 MiB, below the provider's 30 MB limit. Native JSON/SSE, final usage and errors pass through. The wrapper strips incoming credentials, disables redirects and inference retries, and closes the upstream socket on cancellation, disconnect or deadline. An interrupted forwarded request can remain uncertain; closing transport is not proof that generation never occurred. Streaming after a transport/size/deadline failure ends incompletely rather than fabricating a successful final event.

Macrofold sends the required RunPod bearer only to the validated RunPod endpoint origin. [RunPod's examples](https://docs.runpod.io/serverless/load-balancing/build-a-worker) require that bearer; whether the provider forwards it into the wrapper remains unverified and must be tested before managed release. [Endpoint-restricted keys](https://docs.runpod.io/get-started/credentials#api-keys) are documented, but a separate invocation-key lifecycle is not implemented or qualified.

## Verification and dependencies

CPU fixtures exercise the actual Uvicorn/HTTPX transport, configuration, source preparation and cancellation without GPU resources or external model calls:

```sh
python3 -m venv /tmp/macrofold-model-serving
/tmp/macrofold-model-serving/bin/python -m pip install -r infra/model-serving/requirements.txt
/tmp/macrofold-model-serving/bin/python -m unittest discover -s tests/runtime-model-serving -v
```

The pinned wrapper dependencies are HTTPX 0.28.1, Starlette 1.9.0 and Uvicorn 0.54.0 (BSD-3-Clause), plus Hugging Face Hub 1.33.0 (Apache-2.0). The upstream vLLM image and bundled project retain their original licenses/notices; vLLM is Apache-2.0, while its CUDA and other transitive components retain their own terms. Model licensing/access remains a separate owner responsibility. The Docker build overlays these exact versions, removes an orphan OTLP common package incompatible with the base telemetry graph, and checks the complete Python graph. The check accepts only the exact upstream vLLM override of NCCL 2.30.7 for DeepEPv2 against Torch's 2.29.7 metadata pin; any other dependency conflict fails the build. Scan the complete built OS/Python image under the existing dependency policy before release; a wrapper-only audit does not cover the GPU image.

Official interfaces: [vLLM 0.32.0 release](https://github.com/vllm-project/vllm/releases/tag/v0.32.0), [pinned serve flags](https://docs.vllm.ai/en/v0.32.0/cli/serve/), [HF exact-revision downloads](https://huggingface.co/docs/huggingface_hub/en/guides/download), [HF cache verification](https://huggingface.co/docs/huggingface_hub/en/guides/manage-cache), [HTTPX async streaming](https://www.python-httpx.org/async/) and [Starlette responses](https://starlette.dev/responses/).

CPU fixtures establish neither real GPU/model loading nor RunPod's bearer/custom-header ingress behavior. Actual pinned-image startup, authenticated provider routing, worker replacement, streaming/cancellation, model/schema/tool capabilities, resource cleanup and incurred hosting costs remain separately measured live acceptance.
