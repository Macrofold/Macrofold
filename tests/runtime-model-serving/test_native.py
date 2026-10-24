"""CPU evidence for native recipe, HTTP protection and queue ownership, not model quality."""

import asyncio
import copy
import hashlib
import io
import json
from pathlib import Path
import queue
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

import httpx
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from test_runtime import COMMIT, TOKENIZER_COMMIT, SECRET, RUNTIME, serve

sys.path.insert(0, str(RUNTIME))
from config import DEADLINE_HEADER, ENDPOINT_SECRET_HEADER, ModelConfig
import kev_engine
import native_prepare
import server
from diagnostics import RuntimeFailure, failure


def artifact(name, content=b"fixture", git=False):
    return {"path": name, "size_bytes": len(content), "sha256": None if git else hashlib.sha256(content).hexdigest(),
            "git_blob_sha1": hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest() if git else None}


RECIPE = {
    "profile_id": "kev-systemone-v1",
    "source": {"repository": "fixture/kev", "revision": COMMIT, "weight_files": ["adapter_model.safetensors"],
               "native": {"format": "kev", "version": 1, "weights": "lora",
                          "checkpoint_files": [artifact("head.pt"), artifact("adapter_model.safetensors"), artifact("adapter_config.json", b'{"base_model_name_or_path":"fixture/base"}')],
                          "base": {"repository": "fixture/base", "revision": TOKENIZER_COMMIT, "files": [artifact("tokenizer_config.json", b"{}", True)]},
                          "licenses": [{"repository": "fixture/kev", "revision": COMMIT, "license": "Apache-2.0", "gated": False}]}},
    "parameters": {"context_window_tokens": 8192, "max_output_tokens": 1024, "max_concurrent_requests": 2},
    "served_alias": "revision-native",
}


def config(value=None):
    return ModelConfig.parse(json.dumps(value or RECIPE))


class NativeRecipeTests(unittest.TestCase):
    def test_explicit_float_rejects_bf16_lora_before_loading_the_backbone(self):
        value = copy.deepcopy(RECIPE)
        value["parameters"]["dtype"] = "float"
        checkpoint = types.SimpleNamespace(full=False, meta=types.SimpleNamespace(
            base="fixture/base", base_revision=TOKENIZER_COMMIT, weights="lora",
            weights_dtype="bf16", temperature=2.4))
        with self.assertRaises(RuntimeFailure) as raised:
            kev_engine.validate_checkpoint(config(value), checkpoint)
        self.assertEqual(raised.exception.code, "checkpoint_precision_unsupported")
        checkpoint.meta.weights_dtype = "fp32"
        kev_engine.validate_checkpoint(config(value), checkpoint)

    def test_diagnostics_keep_stage_and_type_without_untrusted_exception_text(self):
        output = io.StringIO()
        with patch("sys.stderr", output):
            failure(ValueError("private customer content and sk-secret"), "load", "native_model_load_failed")
        self.assertEqual(json.loads(output.getvalue()), {"component": "model_serving", "stage": "load", "code": "native_model_load_failed", "error_type": "ValueError"})

    def test_native_recipe_requires_pins_safe_artifacts_and_supported_runtime_parameters(self):
        self.assertEqual(config().profile_id, "kev-systemone-v1")
        for mutate in [
            lambda value: value["source"]["native"]["base"].update(revision="main"),
            lambda value: value["source"]["native"]["checkpoint_files"][0].update(path="../head.pt"),
            lambda value: value["source"]["native"]["checkpoint_files"][0].update(sha256=None),
            lambda value: value["source"]["native"]["checkpoint_files"].append(artifact("model.py")),
            lambda value: value["parameters"].update(tensor_parallel_size=2),
            lambda value: value["parameters"].update(quantization="awq"),
            lambda value: value["source"].update(tokenizer={"repository": "fixture/other", "revision": TOKENIZER_COMMIT}),
        ]:
            value = copy.deepcopy(RECIPE)
            mutate(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                config(value)

    def test_preparation_verifies_both_snapshots_and_hides_unselected_cache_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = {}
            for repository, revision, files in [("fixture/kev", COMMIT, RECIPE["source"]["native"]["checkpoint_files"]), ("fixture/base", TOKENIZER_COMMIT, RECIPE["source"]["native"]["base"]["files"])]:
                path = root / repository / revision
                path.mkdir(parents=True)
                for item in files:
                    content = b'{"base_model_name_or_path":"fixture/base"}' if item["path"] == "adapter_config.json" else b"{}" if item["path"] == "tokenizer_config.json" else b"fixture"
                    (path / item["path"]).write_bytes(content)
                (path / "unselected.py").write_text("raise RuntimeError('not executable')")
                paths[repository] = path
            calls = []

            def download(**kwargs):
                calls.append(kwargs)
                return str(paths[kwargs["repo_id"]])

            hub = types.SimpleNamespace(snapshot_download=download)
            view = root / "worker"
            view.mkdir()
            with patch.dict(sys.modules, {"huggingface_hub": hub}):
                result = native_prepare.prepare_native(config(), view, "synthetic-source-secret")
            self.assertEqual([call["revision"] for call in calls], [COMMIT, TOKENIZER_COMMIT])
            self.assertTrue(all(call["token"] == "synthetic-source-secret" for call in calls))
            self.assertFalse((Path(result["checkpoint_path"]) / "unselected.py").exists())
            (paths["fixture/kev"] / "head.pt").write_bytes(b"corrupt")
            other = root / "other"
            other.mkdir()
            with patch.dict(sys.modules, {"huggingface_hub": hub}), self.assertRaises(RuntimeFailure) as raised:
                native_prepare.prepare_native(config(), other, None)
            self.assertEqual(raised.exception.code, "artifact_checksum_mismatch")


class FakePublisherServer:
    def __init__(self, checkpoint, tokenizer, model, device, **kwargs):
        self.checkpoint, self.tok, self.model = checkpoint, tokenizer, model
        self.__post_init__()

    def __post_init__(self):
        self.lock = threading.Lock()
        self.stopping = threading.Event()
        self.queue = queue.Queue()
        self.switch_interval = sys.getswitchinterval()
        def work():
            self.model.worker_gate.wait()
            self._work()
        self.thread = threading.Thread(target=work, daemon=True)
        self.thread.start()

    def _run(self, encodings):
        self.model.started.set()
        self.model.release.wait(5)
        self.model.calls += len(encodings)
        if self.model.fail:
            self.model.fail = False
            raise RuntimeError("untrusted fixture error must stay private")
        return [([[0.2, 0.8]], {"tokens": len(item["ids"]), "latency_ms": 1}) for item in encodings]

    def _body(self, request, metadata, probabilities, metrics):
        return {"model": request.model, "answers": {"arbitrary": {"type": "choice", "choice": "yes", "probabilities": {"yes": 0.8, "no": 0.2}, "confidence": 0.6}}, "usage": {"input_tokens": metrics["tokens"], "output_tokens": 12}, "latency_ms": metrics["latency_ms"], "native_extra": {"preserved": True}}


def fixture(delayed_start=False):
    model = types.SimpleNamespace(started=threading.Event(), release=threading.Event(), worker_gate=threading.Event(), calls=0, fail=False, graphs=None)
    if not delayed_start:
        model.worker_gate.set()
    publisher = types.SimpleNamespace(Server=FakePublisherServer, MAX_BATCH=64,
                                      admit=lambda model, tokenizer, record, truncate: {"ids": [1, 2, 3] if record.get("state") != "large" else list(range(8193))},
                                      SystemOneRequest=types.SimpleNamespace(model_validate=lambda value: types.SimpleNamespace(**value)),
                                      to_record=lambda request: ({"state": request.state}, []),
                                      models=lambda: {"models": [{"name": "revision-native"}]})
    return publisher, model, kev_engine.managed_server(publisher, None, None, model, config())


class NativeQueueTests(unittest.TestCase):
    def setUp(self):
        self.publisher, self.model, self.scorer = fixture()

    def tearDown(self):
        self.model.release.set()
        self.scorer.close()

    def test_cancelled_queued_request_skips_gpu_and_does_not_kill_model_thread(self):
        first = self.scorer.submit({"state": "first"})
        self.assertTrue(self.model.started.wait(2))
        cancelled = self.scorer.submit({"state": "cancel"})
        self.assertTrue(cancelled.cancel())
        self.model.release.set()
        first.result(2)
        self.scorer.queue.join()
        self.assertEqual(self.model.calls, 1)
        self.assertTrue(self.scorer.thread.is_alive())
        self.scorer.submit({"state": "healthy"}).result(2)
        self.assertEqual(self.model.calls, 2)

    def test_running_cancellation_retains_capacity_and_excess_work_is_rejected(self):
        first = self.scorer.submit({"state": "first"})
        self.assertTrue(self.model.started.wait(2))
        second = self.scorer.submit({"state": "second"})
        self.assertFalse(first.cancel())
        with self.assertRaises(queue.Full):
            self.scorer.submit({"state": "excess"})
        self.model.release.set()
        first.result(2)
        second.result(2)
        self.assertEqual(self.model.calls, 2)

    def test_expired_pending_and_over_context_requests_never_execute_and_failures_recover(self):
        first = self.scorer.submit({"state": "first"})
        self.assertTrue(self.model.started.wait(2))
        expired = self.scorer.submit({"state": "expired"}, time.time() - 1)
        self.model.release.set()
        first.result(2)
        with self.assertRaises(kev_engine.DeadlineExpired):
            expired.result(2)
        with self.assertRaises(kev_engine.NativeInputError) as raised:
            self.scorer.submit({"state": "large"})
        self.assertEqual(str(raised.exception), "native_context_exceeded")
        self.assertEqual(self.model.calls, 1)
        self.model.fail = True
        with self.assertRaises(RuntimeError):
            self.scorer.submit({"state": "failure"}).result(2)
        self.scorer.submit({"state": "healthy"}).result(2)
        self.assertTrue(self.scorer.thread.is_alive())
        self.assertEqual(self.model.calls, 3)


class NativeQueueSchedulingTests(unittest.TestCase):
    def setUp(self):
        self.publisher, self.model, self.scorer = fixture(delayed_start=True)

    def tearDown(self):
        self.model.worker_gate.set()
        self.model.release.set()
        self.scorer.close()

    def test_eager_pending_requests_remain_cancellable_until_their_actual_forward(self):
        first = self.scorer.submit({"state": "first"})
        second = self.scorer.submit({"state": "second"})
        self.model.worker_gate.set()
        self.assertTrue(self.model.started.wait(2))
        self.assertTrue(second.cancel())
        self.model.release.set()
        first.result(2)
        self.scorer.queue.join()
        self.assertEqual(self.model.calls, 1)
        self.assertTrue(self.scorer.thread.is_alive())

    def test_eager_pending_deadline_is_checked_immediately_before_its_forward(self):
        now = [1000]
        with patch.object(kev_engine.time, "time", side_effect=lambda: now[0]):
            first = self.scorer.submit({"state": "first"}, deadline=1100)
            second = self.scorer.submit({"state": "second"}, deadline=1001)
            self.model.worker_gate.set()
            self.assertTrue(self.model.started.wait(2))
            now[0] = 1002
            self.model.release.set()
            first.result(2)
            with self.assertRaises(kev_engine.DeadlineExpired):
                second.result(2)
            self.scorer.queue.join()
        self.assertEqual(self.model.calls, 1)


class NativeHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.publisher, self.model, self.scorer = fixture()
        self.engine_context = serve(kev_engine.create_app(config(), self.publisher, self.scorer))
        engine = await self.engine_context.__aenter__()
        self.origin_patch = patch.object(server, "ENGINE_ORIGIN", engine)
        self.origin_patch.start()
        self.wrapper_context = serve(server.create_app(config(), SECRET))
        origin = await self.wrapper_context.__aenter__()
        self.client = httpx.AsyncClient(base_url=origin, timeout=3, trust_env=False)

    async def asyncTearDown(self):
        self.model.release.set()
        await self.client.aclose()
        await self.wrapper_context.__aexit__(None, None, None)
        self.origin_patch.stop()
        await self.engine_context.__aexit__(None, None, None)
        self.scorer.close()

    async def test_protected_native_routes_preserve_answers_metadata_and_disallow_chat_or_streaming(self):
        self.model.release.set()
        body = {"model": "revision-native", "state": {"evidence": "fixture"}, "questions": {"arbitrary": {"type": "choice", "criteria": {"yes": "yes", "no": "no"}}}}
        self.assertEqual((await self.client.post("/v1/systemone", json=body)).status_code, 401)
        self.assertEqual((await self.client.post("/v1/chat/completions", json=body)).status_code, 404)
        headers = {ENDPOINT_SECRET_HEADER: SECRET}
        response = await self.client.post("/v1/systemone", json={**body, "stream": True}, headers=headers)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.model.calls, 0)
        response = await self.client.post("/v1/systemone", json=body, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answers"]["arbitrary"]["probabilities"], {"yes": 0.8, "no": 0.2})
        self.assertTrue(response.json()["native_extra"]["preserved"])
        self.assertTrue(response.headers["x-typesafe-request-id"])
        self.assertEqual((await self.client.get("/v1/models", headers=headers)).json(), {"models": [{"name": "revision-native"}]})
        self.assertEqual(self.model.calls, 1)

    async def test_native_failure_is_safe_and_later_requests_still_work(self):
        self.model.release.set()
        self.model.fail = True
        body = {"model": "revision-native", "state": "fixture", "questions": {"q": {"type": "noul"}}}
        headers = {ENDPOINT_SECRET_HEADER: SECRET}
        response = await self.client.post("/v1/systemone", json=body, headers=headers)
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("untrusted fixture", response.text)
        self.assertEqual((await self.client.post("/v1/systemone", json=body, headers=headers)).status_code, 200)

    async def test_context_overflow_has_an_actionable_code_without_execution(self):
        response = await self.client.post("/v1/systemone", json={"model": "revision-native", "state": "large", "questions": {"q": {"type": "noul"}}}, headers={ENDPOINT_SECRET_HEADER: SECRET})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "native_context_exceeded")
        self.assertEqual(self.model.calls, 0)

    async def test_expired_queued_http_request_is_cancelled_without_a_second_forward(self):
        body = {"model": "revision-native", "state": "fixture", "questions": {"q": {"type": "noul"}}}
        headers = {ENDPOINT_SECRET_HEADER: SECRET}
        first = asyncio.create_task(self.client.post("/v1/systemone", json=body, headers=headers))
        self.assertTrue(await asyncio.to_thread(self.model.started.wait, 2))
        response = await self.client.post("/v1/systemone", json=body, headers={**headers, DEADLINE_HEADER: str(int(time.time() * 1000) + 200)})
        self.assertEqual(response.status_code, 504)
        self.model.release.set()
        self.assertEqual((await first).status_code, 200)
        await asyncio.to_thread(self.scorer.queue.join)
        self.assertEqual(self.model.calls, 1)
        self.assertTrue(self.scorer.thread.is_alive())
        self.assertEqual((await self.client.post("/v1/systemone", json=body, headers=headers)).status_code, 200)

    async def test_caller_disconnect_is_expected_and_retains_running_capacity(self):
        disconnected = asyncio.Event()
        submitted = []
        original_connected, original_submit = kev_engine.connected, self.scorer.submit

        async def connected(request, operation):
            try:
                return await original_connected(request, operation)
            except kev_engine.ClientDisconnect:
                disconnected.set()
                raise

        def submit(*args):
            future = original_submit(*args)
            submitted.append(future)
            return future

        with patch.object(kev_engine, "connected", connected), patch.object(self.scorer, "submit", submit), patch.object(kev_engine, "failure") as diagnostic:
            request = asyncio.create_task(self.client.post("/v1/systemone", json={"model": "revision-native", "state": "fixture", "questions": {"q": {"type": "noul"}}}, headers={ENDPOINT_SECRET_HEADER: SECRET}))
            self.assertTrue(await asyncio.to_thread(self.model.started.wait, 2))
            request.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await request
            await asyncio.wait_for(disconnected.wait(), 2)
            self.assertTrue(submitted[0].running())
            self.assertFalse(submitted[0].cancel())
            self.assertTrue(self.scorer.capacity.acquire(blocking=False))
            try:
                self.assertFalse(self.scorer.capacity.acquire(blocking=False))
            finally:
                self.scorer.capacity.release()
            self.model.release.set()
            await asyncio.to_thread(submitted[0].result, 2)
            await asyncio.to_thread(self.scorer.queue.join)
            diagnostic.assert_not_called()
        self.assertEqual(self.model.calls, 1)
        self.assertTrue(self.scorer.thread.is_alive())

    async def test_output_limit_failure_retains_observed_answer_usage(self):
        self.model.release.set()
        value = copy.deepcopy(RECIPE)
        value["parameters"]["max_output_tokens"] = 1
        async with serve(kev_engine.create_app(config(value), self.publisher, self.scorer)) as origin:
            async with httpx.AsyncClient(base_url=origin, trust_env=False) as client:
                response = await client.post("/v1/systemone", json={"model": "revision-native", "state": "fixture", "questions": {"q": {"type": "noul"}}})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["usage"], {"input_tokens": 3, "output_tokens": 12})

    async def test_invalid_native_output_is_an_execution_failure_with_observed_usage(self):
        self.model.release.set()
        original = self.scorer._body

        def invalid(*args):
            body = original(*args)
            body["answers"]["arbitrary"]["probabilities"]["yes"] = float("nan")
            return body

        with patch.object(self.scorer, "_body", invalid):
            response = await self.client.post("/v1/systemone", json={"model": "revision-native", "state": "fixture", "questions": {"q": {"type": "noul"}}}, headers={ENDPOINT_SECRET_HEADER: SECRET})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["error"]["code"], "native_execution_failed")
        self.assertEqual(response.json()["usage"], {"input_tokens": 3, "output_tokens": 12})

    async def test_stopped_model_thread_cannot_pass_authenticated_model_readiness(self):
        self.model.release.set()
        self.scorer.close()
        headers = {ENDPOINT_SECRET_HEADER: SECRET}
        self.assertEqual((await self.client.get("/v1/models", headers=headers)).status_code, 503)
        self.assertEqual((await self.client.get("/ping")).json(), {"ready": False})


if __name__ == "__main__":
    unittest.main()
