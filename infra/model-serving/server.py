"""Protected native chat forwarding; vLLM owns generation and batching."""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import importlib.metadata
import json
import logging
import os
import signal
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from starlette.applications import Starlette
from starlette.requests import ClientDisconnect, Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from config import (
    DEADLINE_HEADER, ENDPOINT_SECRET_HEADER, ENGINE_ORIGIN, MAX_EXECUTION_SECONDS,
    MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, STARTUP_SECONDS, ModelConfig,
)

logger = logging.getLogger("macrofold.model")


def error(status: int, code: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": code.replace("_", " ")}}, status_code=status, headers={"cache-control": "no-store"})


async def connected(request: Request, operation):
    """Cancel the socket owner on disconnect, including before upstream headers."""
    async def disconnected():
        while (await request.receive())["type"] != "http.disconnect":
            pass

    owner = asyncio.ensure_future(operation)
    watcher = asyncio.create_task(disconnected())
    delivered = False
    try:
        done, _ = await asyncio.wait({owner, watcher}, return_when=asyncio.FIRST_COMPLETED)
        if watcher in done:
            raise ClientDisconnect()
        result = await owner
        delivered = True
        return result
    finally:
        owner.cancel()
        watcher.cancel()
        await asyncio.gather(owner, watcher, return_exceptions=True)
        if not delivered and not owner.cancelled() and owner.exception() is None:
            result = owner.result()
            if isinstance(result, httpx.Response):
                await result.aclose()


class NativeStream(Response):
    def __init__(self, upstream: httpx.Response, deadline: float):
        super().__init__(status_code=upstream.status_code, headers={"content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no"})
        self.raw_headers = [(k, v) for k, v in self.raw_headers if k != b"content-length"]
        self.upstream = upstream
        self.deadline = deadline

    async def __call__(self, scope, receive, send):
        request = Request(scope, receive)

        async def relay():
            async with asyncio.timeout_at(self.deadline):
                await send({"type": "http.response.start", "status": self.status_code, "headers": self.raw_headers})
                size = 0
                async for chunk in self.upstream.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise RuntimeError("Model stream exceeded response limit")
                    await send({"type": "http.response.body", "body": chunk, "more_body": True})
                await send({"type": "http.response.body", "body": b"", "more_body": False})

        try:
            await connected(request, relay())
        except (ClientDisconnect, OSError):
            pass
        finally:
            # Closing the upstream socket is cancellation, never a retry. An engine
            # may already have generated output, so the existing Run owner keeps uncertainty.
            await self.upstream.aclose()


def child_environment(environment: dict[str, str]) -> dict[str, str]:
    allowed = {"PATH", "HOME", "LANG", "LC_ALL", "LD_LIBRARY_PATH", "CUDA_VISIBLE_DEVICES", "NVIDIA_VISIBLE_DEVICES", "NVIDIA_DRIVER_CAPABILITIES", "CUDA_HOME", "CUDA_PATH", "OMP_NUM_THREADS", "TORCH_CUDA_ARCH_LIST"}
    result = {key: value for key, value in environment.items() if key in allowed}
    result.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "VLLM_NO_USAGE_STATS": "1", "DO_NOT_TRACK": "1", "VLLM_HOST_IP": "127.0.0.1", "VLLM_PLUGINS": ""})
    return result


async def stop_process(process):
    if process is None or process.returncode is not None:
        return
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGTERM)
    try:
        await asyncio.wait_for(process.wait(), 10)
    except TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        await process.wait()


async def supervise(app: Starlette, config: ModelConfig):
    """One worker startup; the hosting provider owns replacement, not prompt replay."""
    process = None
    app.state.startup = "downloading"
    with tempfile.TemporaryDirectory(prefix="model-", dir="/models") as temporary:
        directory = Path(temporary)
        try:
            async with asyncio.timeout(STARTUP_SECONDS):
                if importlib.metadata.version("vllm") != "0.32.0":
                    raise RuntimeError("Wrong registered engine version")
                download_environment = child_environment(dict(os.environ))
                download_environment.pop("HF_HUB_OFFLINE")
                download_environment.pop("TRANSFORMERS_OFFLINE")
                download_environment.update({"MF_MODEL_CONFIG": os.environ["MF_MODEL_CONFIG"], "MF_PREPARE_DIRECTORY": temporary})
                token = os.environ.pop("HF_TOKEN", None)
                if token:
                    download_environment["HF_TOKEN"] = token
                process = await asyncio.create_subprocess_exec(sys.executable, str(Path(__file__).with_name("prepare.py")), env=download_environment, start_new_session=True)
                download_environment.pop("HF_TOKEN", None)
                token = None
                if await process.wait() != 0:
                    raise RuntimeError("Model download or verification failed")
                prepared = json.loads((directory / "prepared.json").read_text())
                app.state.startup = "loading"
                process = await asyncio.create_subprocess_exec(*config.engine_arguments(**prepared), env=child_environment(dict(os.environ)), start_new_session=True)
                while True:
                    if process.returncode is not None:
                        raise RuntimeError("Model engine exited during loading")
                    try:
                        response = await app.state.client.get(ENGINE_ORIGIN + "/health", timeout=2)
                        if response.status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(1)
            app.state.startup = "ready"
            await process.wait()
            raise RuntimeError("Model engine stopped")
        finally:
            app.state.startup = "stopped"
            await stop_process(process)


def create_app(config: ModelConfig, secret: str, *, client: httpx.AsyncClient | None = None, manage_engine: bool = False) -> Starlette:
    if not isinstance(secret, str) or not 32 <= len(secret) <= 512 or not secret.isascii():
        raise ValueError("A generated endpoint secret is required")

    @asynccontextmanager
    async def lifespan(app):
        app.state.client = client or httpx.AsyncClient(
            transport=httpx.AsyncHTTPTransport(retries=0), follow_redirects=False,
            trust_env=False, timeout=httpx.Timeout(MAX_EXECUTION_SECONDS, connect=5),
            limits=httpx.Limits(max_connections=config.parameters["max_concurrent_requests"] + 4, max_keepalive_connections=16),
        )
        app.state.startup = "loading" if manage_engine else "ready"
        task = asyncio.create_task(supervise(app, config)) if manage_engine else None
        app.state.engine_task = task
        try:
            yield
        finally:
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            if client is None:
                await app.state.client.aclose()

    async def health(request):
        if request.app.state.startup != "ready":
            return JSONResponse({"ready": False}, status_code=503)
        try:
            response = await request.app.state.client.get(ENGINE_ORIGIN + "/health", timeout=2)
            ready = response.status_code == 200
        except httpx.HTTPError:
            ready = False
        return JSONResponse({"ready": ready}, status_code=200 if ready else 503)

    async def proxy(request):
        secrets = request.headers.getlist(ENDPOINT_SECRET_HEADER)
        if len(secrets) != 1 or not hmac.compare_digest(secrets[0].encode(), secret.encode()):
            return error(401, "unauthorized")
        if request.url.query:
            return error(400, "query_parameters_not_supported")
        if request.app.state.startup != "ready":
            return error(503, "model_loading")
        deadline = asyncio.get_running_loop().time() + MAX_EXECUTION_SECONDS
        supplied = request.headers.getlist(DEADLINE_HEADER)
        if supplied:
            if len(supplied) != 1 or len(supplied[0]) > 16 or not supplied[0].isascii() or not supplied[0].isdigit():
                return error(400, "invalid_deadline")
            remaining = int(supplied[0]) / 1000 - time.time()
            if remaining <= 0:
                return error(408, "deadline_expired")
            deadline = min(deadline, asyncio.get_running_loop().time() + remaining)
        body = bytearray()
        streaming = False
        try:
            async with asyncio.timeout_at(deadline):
                if request.method == "POST":
                    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json" or request.headers.get("content-encoding"):
                        return error(415, "json_body_required")
                    async for chunk in request.stream():
                        body.extend(chunk)
                        if len(body) > MAX_REQUEST_BYTES:
                            return error(413, "request_too_large")
                    try:
                        native = json.loads(body)
                    except (ValueError, UnicodeError, RecursionError):
                        return error(400, "invalid_json")
                    if not isinstance(native, dict) or native.get("model") != config.served_alias:
                        return error(400, "model_mismatch")
                    if type(native.get("stream", False)) is not bool:
                        return error(400, "invalid_stream")
                    # Source/template changes are revision operations, and prompt
                    # truncation must never turn a supported-context failure into success.
                    if native.get("truncate_prompt_tokens") is not None or any(k in native for k in ["chat_template", "prompt_embeds", "mm_processor_kwargs", "media_io_kwargs"]):
                        return error(400, "unsupported_model_parameter")
                    streaming = native.get("stream", False)
                else:
                    # Drain an empty GET body before the disconnect watcher owns receive.
                    async for chunk in request.stream():
                        if chunk:
                            return error(400, "unexpected_body")
                upstream_request = request.app.state.client.build_request(request.method, ENGINE_ORIGIN + request.url.path, content=bytes(body) if body else None, headers={"content-type": "application/json", "accept": "text/event-stream" if streaming else "application/json", "accept-encoding": "identity"})
                upstream = await connected(request, request.app.state.client.send(upstream_request, stream=True))
                content_type = upstream.headers.get("content-type", "").split(";")[0].lower()
                if 300 <= upstream.status_code < 400 or content_type not in {"application/json", "text/event-stream"}:
                    await upstream.aclose()
                    return error(502, "invalid_engine_response")
                if streaming and upstream.is_success and content_type == "text/event-stream":
                    return NativeStream(upstream, deadline)

                async def read_response():
                    result = bytearray()
                    try:
                        async for chunk in upstream.aiter_bytes():
                            result.extend(chunk)
                            if len(result) > MAX_RESPONSE_BYTES:
                                raise ValueError("Response limit exceeded")
                        return bytes(result)
                    finally:
                        await upstream.aclose()

                result = await connected(request, read_response())
                return Response(result, status_code=upstream.status_code, media_type=content_type, headers={"cache-control": "no-store"})
        except TimeoutError:
            return error(504, "model_deadline_exceeded")
        except ClientDisconnect:
            return Response(status_code=499)
        except (httpx.HTTPError, ValueError):
            return error(502, "model_transport_failed")

    return Starlette(routes=[Route("/ping", health, methods=["GET"]), Route("/health", health, methods=["GET"]), Route("/v1/models", proxy, methods=["GET"]), Route("/v1/chat/completions", proxy, methods=["POST"])], lifespan=lifespan)


async def main():
    import uvicorn

    config = ModelConfig.parse(os.environ["MF_MODEL_CONFIG"])
    app = create_app(config, os.environ["MF_ENDPOINT_SECRET"], manage_engine=True)
    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), access_log=False, log_level="warning", timeout_graceful_shutdown=10, h11_max_incomplete_event_size=16 * 1024))
    serving = asyncio.create_task(server.serve())
    while not server.started and not serving.done():
        await asyncio.sleep(0.05)
    if serving.done():
        await serving
        return
    engine = app.state.engine_task
    done, _ = await asyncio.wait({serving, engine}, return_when=asyncio.FIRST_COMPLETED)
    server.should_exit = True
    await serving
    if engine in done:
        # No raw provider/model exception contents enter ordinary runtime logs.
        logger.error("Model worker stopped during %s", app.state.startup)
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (ValueError, KeyError, json.JSONDecodeError):
        logger.error("Invalid model worker configuration")
        raise SystemExit(1)
