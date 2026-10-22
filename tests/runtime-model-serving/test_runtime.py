"""CPU-only acceptance of the real protected HTTP boundary and startup recipe."""

from __future__ import annotations

import asyncio
import copy
import importlib
import json
import os
import socket
import sys
import tempfile
import time
import types
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import patch

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

RUNTIME = Path(os.environ.get("MF_MODEL_RUNTIME_PATH", str(Path(__file__).resolve().parents[2] / "infra" / "model-serving")))
sys.path.insert(0, str(RUNTIME))
config_module = importlib.import_module("config")
runtime = importlib.import_module("server")
prepare_module = importlib.import_module("prepare")

SECRET = "synthetic-endpoint-secret-0000000000000000"
COMMIT = "a" * 40
TOKENIZER_COMMIT = "b" * 40
RECIPE = {
    "source": {"repository": "fixture/model", "revision": COMMIT, "weight_files": ["model.safetensors"]},
    "parameters": {"context_window_tokens": 4096, "max_output_tokens": 512, "max_concurrent_requests": 8},
    "served_alias": "revision-fixture",
}


def config(value=None):
    return config_module.ModelConfig.parse(json.dumps(value or RECIPE))


@asynccontextmanager
async def serve(app):
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    address = f"http://127.0.0.1:{listener.getsockname()[1]}"
    instance = uvicorn.Server(uvicorn.Config(app, log_level="critical", access_log=False, timeout_graceful_shutdown=1))
    task = asyncio.create_task(instance.serve(sockets=[listener]))
    try:
        async with asyncio.timeout(5):
            while not instance.started:
                if task.done():
                    await task
                await asyncio.sleep(0)
        yield address
    finally:
        instance.should_exit = True
        await asyncio.wait_for(task, 5)
        listener.close()


class ConfigurationTests(unittest.TestCase):
    def test_exact_source_and_no_executable_configuration(self):
        for mutation in [
            lambda x: x["source"].update(revision="main"),
            lambda x: x["source"].update(weight_files=["../model.safetensors"]),
            lambda x: x["source"].update(weight_files=["*.safetensors"]),
            lambda x: x["source"].update(weight_files=["model[1].safetensors"]),
            lambda x: x["source"].update(weight_files=[{}]),
            lambda x: x["parameters"].update(trust_remote_code=True),
            lambda x: x["parameters"].update(tool_call_parser="/tmp/plugin.py"),
            lambda x: x["parameters"].update(context_window_tokens=True),
            lambda x: x["parameters"].update(gpu_memory_utilization=1),
        ]:
            value = copy.deepcopy(RECIPE)
            mutation(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                config(value)

    def test_engine_uses_pins_alias_native_limits_and_separate_tokenizer(self):
        value = copy.deepcopy(RECIPE)
        value["source"]["tokenizer"] = {"repository": "fixture/tokenizer", "revision": TOKENIZER_COMMIT}
        arguments = config(value).engine_arguments("/model", "/tokenizer", "/template.jinja")
        for flag, expected in {"--host": "127.0.0.1", "--port": "8001", "--revision": COMMIT, "--tokenizer-revision": TOKENIZER_COMMIT, "--served-model-name": "revision-fixture", "--load-format": "safetensors", "--max-model-len": "4096", "--max-num-seqs": "8", "--chat-template": "/template.jinja"}.items():
            self.assertEqual(arguments[arguments.index(flag) + 1], expected)
        self.assertIn("--no-trust-remote-code", arguments)
        self.assertIn("--no-trust-request-chat-template", arguments)
        self.assertIn("--no-enable-log-requests", arguments)
        self.assertNotIn("--trust-remote-code", arguments)

    def test_engine_environment_removes_all_account_and_download_secrets(self):
        child = runtime.child_environment({"PATH": "/bin", "HF_TOKEN": "private-source", "MF_ENDPOINT_SECRET": SECRET, "RUNPOD_API_KEY": "private-hosting", "MF_MODEL_CONFIG": "private-recipe", "AWS_SECRET_ACCESS_KEY": "unrelated", "HTTP_PROXY": "untrusted", "VLLM_PLUGINS": "unreviewed"})
        self.assertEqual(child["PATH"], "/bin")
        for name in ["HF_TOKEN", "MF_ENDPOINT_SECRET", "RUNPOD_API_KEY", "MF_MODEL_CONFIG", "AWS_SECRET_ACCESS_KEY", "HTTP_PROXY"]:
            self.assertNotIn(name, child)
        self.assertEqual(child["HF_HUB_OFFLINE"], "1")
        self.assertEqual(child["VLLM_PLUGINS"], "")

    def test_source_cache_integrity_selected_weights_and_template(self):
        calls = []
        verified = types.SimpleNamespace(mismatches=[], extra_paths=[], checked_count=3)
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            snapshot = base / "snapshots" / COMMIT
            snapshot.mkdir(parents=True)
            (snapshot / "config.json").write_text("{}")
            (snapshot / "tokenizer_config.json").write_text(json.dumps({"chat_template": "{{ messages }}"}))
            (snapshot / "model.safetensors").write_bytes(b"synthetic selected weights")
            (snapshot / "other.safetensors").write_bytes(b"different cached variant")
            (snapshot / "untrusted.py").write_text("raise RuntimeError('never execute')")
            directory = base / "worker"
            directory.mkdir()

            def download(**kwargs):
                calls.append(kwargs)
                return str(snapshot)

            api = types.SimpleNamespace(verify_repo_checksums=lambda **kwargs: verified)
            hub = types.SimpleNamespace(HfApi=lambda **kwargs: api, snapshot_download=download)
            with patch.dict(sys.modules, {"huggingface_hub": hub}):
                result = prepare_module.prepare(config(), directory, "synthetic-download-secret")
            self.assertEqual(calls[0]["revision"], COMMIT)
            self.assertEqual(calls[0]["token"], "synthetic-download-secret")
            self.assertEqual((Path(result["model_path"]) / "weights-00000.safetensors").read_bytes(), b"synthetic selected weights")
            self.assertFalse((Path(result["model_path"]) / "other.safetensors").exists())
            self.assertFalse((Path(result["model_path"]) / "untrusted.py").exists())
            verified.mismatches.append("corrupt cached weights")
            corrupt = base / "corrupt"
            corrupt.mkdir()
            with patch.dict(sys.modules, {"huggingface_hub": hub}), self.assertRaises(ValueError):
                prepare_module.prepare(config(), corrupt, None)

    def test_nested_weight_variants_are_exposed_to_the_pinned_root_only_loader(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            snapshot = base / "snapshots" / COMMIT
            snapshot.mkdir(parents=True)
            (snapshot / "config.json").write_text("{}")
            (snapshot / "tokenizer_config.json").write_text("{}")
            (snapshot / "chat_template.jinja").write_text("{{ messages }}")
            for variant in ["a", "b", "unselected"]:
                (snapshot / variant).mkdir()
                (snapshot / variant / "model.safetensors").write_bytes(variant.encode())
            # The source index refers to original paths, which must not filter
            # the flat, selected loader view back to an empty set.
            (snapshot / "model.safetensors.index.json").write_text(json.dumps({"weight_map": {"first": "a/model.safetensors", "second": "b/model.safetensors"}}))
            value = copy.deepcopy(RECIPE)
            value["source"]["weight_files"] = ["a/model.safetensors", "b/model.safetensors"]
            directory = base / "worker"
            directory.mkdir()
            api = types.SimpleNamespace(verify_repo_checksums=lambda **kwargs: types.SimpleNamespace(mismatches=[], extra_paths=[], checked_count=6))
            hub = types.SimpleNamespace(HfApi=lambda **kwargs: api, snapshot_download=lambda **kwargs: str(snapshot))
            with patch.dict(sys.modules, {"huggingface_hub": hub}):
                result = prepare_module.prepare(config(value), directory, None)
            model = Path(result["model_path"])
            self.assertEqual(sorted(file.read_bytes() for file in model.glob("*.safetensors")), [b"a", b"b"])
            self.assertFalse((model / "model.safetensors.index.json").exists())
            self.assertTrue((model / "chat_template.jinja").is_file())


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = []
        self.released = asyncio.Event()
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()
        self.mode = "json"

        async def engine(request):
            if request.url.path == "/health":
                return JSONResponse({"engine_diagnostic": "not public"})
            if request.url.path == "/v1/models":
                return JSONResponse({"data": [{"id": "revision-fixture"}]})
            body = await request.json()
            self.calls.append({"body": body, "headers": dict(request.headers)})
            self.started.set()
            if self.mode == "redirect":
                return JSONResponse({}, status_code=307, headers={"location": "http://169.254.169.254/"})
            if self.mode == "oversized":
                return JSONResponse({"large": "x" * 1024})
            if self.mode in {"stream", "held"}:
                async def chunks():
                    try:
                        if self.mode == "held":
                            await self.released.wait()
                        yield b'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'
                        if self.mode == "stream":
                            await self.released.wait()
                        yield b'data: {"usage":{"completion_tokens":1}}\n\ndata: [DONE]\n\n'
                    finally:
                        self.cancelled.set()
                return StreamingResponse(chunks(), media_type="text/event-stream")
            return JSONResponse({"id": "fixture-completion", "model": body["model"], "choices": [{"message": {"role": "assistant", "content": "hello", "tool_calls": []}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 2, "completion_tokens": 1}, "native_extra": {"retained": True}})

        self.engine_context = serve(Starlette(routes=[Route("/health", engine), Route("/v1/models", engine), Route("/v1/chat/completions", engine, methods=["POST"])]))
        origin = await self.engine_context.__aenter__()
        self.origin_patch = patch.object(runtime, "ENGINE_ORIGIN", origin)
        self.origin_patch.start()
        self.wrapper = runtime.create_app(config(), SECRET)
        self.wrapper_context = serve(self.wrapper)
        self.base = await self.wrapper_context.__aenter__()
        self.client = httpx.AsyncClient(base_url=self.base, timeout=5, trust_env=False)

    async def asyncTearDown(self):
        self.released.set()
        await self.client.aclose()
        await self.wrapper_context.__aexit__(None, None, None)
        self.origin_patch.stop()
        await self.engine_context.__aexit__(None, None, None)

    async def post(self, body=None, headers=None):
        return await self.client.post("/v1/chat/completions", json=body or {"model": "revision-fixture", "messages": [{"role": "user", "content": "synthetic prompt"}]}, headers=headers or {config_module.ENDPOINT_SECRET_HEADER: SECRET})

    async def test_default_deny_secret_scoping_and_minimal_readiness(self):
        response = await self.client.get("/ping")
        self.assertEqual(response.json(), {"ready": True})
        self.assertEqual((await self.client.head("/ping")).status_code, 405)
        self.assertEqual((await self.client.head("/v1/models", headers={config_module.ENDPOINT_SECRET_HEADER: SECRET})).status_code, 405)
        for path in ["/metrics", "/tokenize", "/docs", "/openapi.json", "/v1/completions", "/load_lora_adapter", "/v1/systemone"]:
            self.assertEqual((await self.client.get(path)).status_code, 404)
        for headers in [{}, {"authorization": "Bearer unrelated-provider-key"}, {config_module.ENDPOINT_SECRET_HEADER: "wrong"}]:
            self.assertEqual((await self.client.post("/v1/chat/completions", json={"model": "revision-fixture"}, headers=headers)).status_code, 401)
        self.assertEqual((await self.client.get("/v1/models")).status_code, 401)
        response = await self.client.get("/v1/models", headers={config_module.ENDPOINT_SECRET_HEADER: SECRET})
        self.assertEqual(response.json()["data"][0]["id"], "revision-fixture")
        self.assertEqual(len(self.calls), 0)

    async def test_native_payload_and_request_preserved_without_forwarded_secrets(self):
        body = {"model": "revision-fixture", "messages": [{"role": "user", "content": "fixture"}], "temperature": 0.25, "response_format": {"type": "json_object"}, "max_tokens": 20}
        response = await self.post(body, {config_module.ENDPOINT_SECRET_HEADER: SECRET, "authorization": "Bearer provider-account-token"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["native_extra"]["retained"])
        self.assertEqual(self.calls[0]["body"], body)
        self.assertNotIn("authorization", self.calls[0]["headers"])
        self.assertNotIn(config_module.ENDPOINT_SECRET_HEADER, self.calls[0]["headers"])

    async def test_incompatible_model_truncation_loading_and_expired_deadline_do_not_dispatch(self):
        for body in [{"model": "different"}, {"model": "revision-fixture", "truncate_prompt_tokens": 1}, {"model": "revision-fixture", "chat_template": "injected"}]:
            self.assertEqual((await self.post(body)).status_code, 400)
        self.wrapper.state.startup = "loading"
        self.assertEqual((await self.post()).status_code, 503)
        self.assertEqual((await self.client.get("/ping")).json(), {"ready": False})
        self.wrapper.state.startup = "ready"
        response = await self.post(headers={config_module.ENDPOINT_SECRET_HEADER: SECRET, config_module.DEADLINE_HEADER: str(int(time.time() * 1000) - 1)})
        self.assertEqual(response.status_code, 408)
        self.assertEqual(self.calls, [])

    async def test_body_and_json_response_bounds_and_redirects(self):
        with patch.object(runtime, "MAX_REQUEST_BYTES", 32):
            self.assertEqual((await self.post()).status_code, 413)
        self.assertEqual(self.calls, [])
        self.mode = "oversized"
        with patch.object(runtime, "MAX_RESPONSE_BYTES", 32):
            self.assertEqual((await self.post()).status_code, 502)
        self.mode = "redirect"
        self.assertEqual((await self.post()).status_code, 502)
        self.assertEqual(len(self.calls), 2)

    async def test_concurrent_requests_use_native_engine_without_serialization(self):
        responses = await asyncio.gather(*(self.post() for _ in range(8)))
        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertEqual(len(self.calls), 8)

    async def test_sse_is_incremental_and_keeps_usage_and_done(self):
        self.mode = "stream"
        async with self.client.stream("POST", "/v1/chat/completions", json={"model": "revision-fixture", "stream": True}, headers={config_module.ENDPOINT_SECRET_HEADER: SECRET}) as response:
            self.assertEqual(response.status_code, 200)
            iterator = response.aiter_bytes()
            first = await anext(iterator)
            self.assertIn(b'"content":"hello"', first)
            self.released.set()
            tail = b"".join([chunk async for chunk in iterator])
            self.assertIn(b'"completion_tokens":1', tail)
            self.assertIn(b"[DONE]", tail)
        self.assertEqual(len(self.calls), 1)

    async def test_cancelled_stream_closes_engine_without_another_request(self):
        self.mode = "stream"
        async with self.client.stream("POST", "/v1/chat/completions", json={"model": "revision-fixture", "stream": True}, headers={config_module.ENDPOINT_SECRET_HEADER: SECRET}) as response:
            await anext(response.aiter_bytes())
        await asyncio.wait_for(self.cancelled.wait(), 2)
        self.assertEqual(len(self.calls), 1)

    async def test_absolute_deadline_bounds_waiting_for_engine_output(self):
        self.mode = "held"
        headers = {config_module.ENDPOINT_SECRET_HEADER: SECRET, config_module.DEADLINE_HEADER: str(int(time.time() * 1000) + 1000)}
        response = await self.post(headers=headers)
        self.assertEqual(response.status_code, 504)
        await asyncio.wait_for(self.cancelled.wait(), 2)
        self.assertEqual(len(self.calls), 1)


if __name__ == "__main__":
    unittest.main()
