"""Pinned publisher scoring behind a bounded, cancellation-safe loopback server.

Kev owns encoding, adapter merging, calibration, scoring, batching and prefix cache.
Only queue ownership differs: concurrent Futures must be marked running before a
CUDA batch, so cancellation cannot kill the model thread or free busy capacity.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
import os
import queue
import sys
import threading
import time
import traceback
import uuid
from concurrent.futures import Future
from pathlib import Path

from starlette.applications import Starlette
from starlette.requests import ClientDisconnect, Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from config import DEADLINE_HEADER, MAX_EXECUTION_SECONDS, ModelConfig
from diagnostics import RuntimeFailure, failure
from native_config import KEV_REVISION
from server import connected


class DeadlineExpired(Exception):
    pass


class NativeInputError(ValueError):
    pass


class DecisionFuture(Future):
    def __init__(self, deadline: float):
        super().__init__()
        self.deadline = deadline


def managed_server(publisher, checkpoint, tokenizer, model, config: ModelConfig, device="cuda"):
    class ManagedServer(publisher.Server):
        def __post_init__(self):
            self.capacity = threading.BoundedSemaphore(config.parameters["max_concurrent_requests"])
            super().__post_init__()
            # No request can reach the unpublished instance yet. Bound cancelled
            # entries too; an impatient caller cannot grow the native queue forever.
            self.queue.maxsize = config.parameters["max_concurrent_requests"]

        def submit(self, rec, deadline=None):
            if self.stopping.is_set():
                raise RuntimeError("Native engine is stopping")
            if not self.capacity.acquire(blocking=False):
                raise queue.Full()
            try:
                try:
                    encoded = publisher.admit(self.model, self.tok, rec, truncate=False)
                except ValueError as error:
                    if isinstance(error, getattr(publisher, "ContextOverflow", ())):
                        raise NativeInputError("native_context_exceeded") from None
                    raise
                if len(encoded["ids"]) > config.parameters["context_window_tokens"]:
                    raise NativeInputError("native_context_exceeded")
                future = DecisionFuture(deadline or time.time() + MAX_EXECUTION_SECONDS)
                future.add_done_callback(lambda _: self.capacity.release())
                self.queue.put_nowait((encoded, future))
                return future
            except BaseException:
                self.capacity.release()
                raise

        def _work(self):
            graphs = getattr(self.model, "graphs", None)
            while not self.stopping.is_set():
                try:
                    pending = [self.queue.get(timeout=0.05)]
                except queue.Empty:
                    if graphs is not None and graphs.capture_due(idle=True):
                        with self.lock:
                            graphs.capture_pending(limit=1)
                    continue
                # The non-graph publisher path runs requests sequentially. Leave
                # later requests queued until their actual forward so cancellation
                # and deadlines remain effective while an earlier request runs.
                while graphs is not None and len(pending) < publisher.MAX_BATCH:
                    try:
                        pending.append(self.queue.get_nowait())
                    except queue.Empty:
                        break
                batch = []
                for encoded, future in pending:
                    if not future.set_running_or_notify_cancel():
                        self.queue.task_done()
                    elif time.time() >= future.deadline:
                        future.set_exception(DeadlineExpired())
                        self.queue.task_done()
                    else:
                        batch.append((encoded, future))
                if not batch:
                    continue
                try:
                    with self.lock:
                        results = self._run([encoded for encoded, _ in batch])
                except Exception as error:
                    traceback.clear_frames(error.__traceback__)
                    results = [error] * len(batch)
                for (_, future), result in zip(batch, results):
                    if isinstance(result, Exception):
                        future.set_exception(result)
                    else:
                        future.set_result(result)
                    self.queue.task_done()
                if graphs is not None and graphs.capture_due(idle=False):
                    with self.lock:
                        graphs.capture_pending(limit=1)

        def close(self):
            if self.stopping.is_set():
                return
            self.stopping.set()
            self.thread.join()
            while True:
                try:
                    _, future = self.queue.get_nowait()
                except queue.Empty:
                    break
                if future.set_running_or_notify_cancel():
                    future.set_exception(RuntimeError("Native engine stopped"))
                self.queue.task_done()
            sys.setswitchinterval(self.switch_interval)

    return ManagedServer(checkpoint, tokenizer, model, device, release_date="unknown", truncate_states=False)


def validate_checkpoint(config: ModelConfig, checkpoint):
    recipe = config.source["native"]
    if checkpoint.meta.base != recipe["base"]["repository"] or checkpoint.meta.base_revision != recipe["base"]["revision"] or checkpoint.meta.weights != recipe["weights"]:
        raise RuntimeFailure("load", "checkpoint_metadata_mismatch")
    if not math.isfinite(checkpoint.meta.temperature) or checkpoint.meta.temperature <= 0:
        raise RuntimeFailure("load", "checkpoint_calibration_invalid")
    if checkpoint.full != (recipe["weights"] == "full"):
        raise RuntimeFailure("load", "checkpoint_layout_mismatch")
    # The publisher intentionally preserves BF16-trained LoRA backbones in BF16.
    # An explicit FP32 recipe must fail instead of silently changing precision.
    if recipe["weights"] == "lora" and checkpoint.meta.weights_dtype == "bf16" and config.parameters.get("dtype") == "float":
        raise RuntimeFailure("load", "checkpoint_precision_unsupported")


def load_native(config: ModelConfig, prepared: dict):
    # These settings precede Torch/Transformers import. Checkpoint Python and Hub
    # kernels never execute; the one reviewed runtime source lives in this image.
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", USE_HUB_KERNELS="NO", TORCH_FORCE_WEIGHTS_ONLY_LOAD="1")
    import torch
    import kev.serve as publisher
    from kev.checkpoint import Checkpoint, LoadOptions

    stamp = Path(publisher.__file__).resolve().parent.parent / ".macrofold-source-revision"
    if not stamp.is_file() or stamp.read_text().strip() != KEV_REVISION:
        raise RuntimeFailure("load", "runtime_source_mismatch")
    checkpoint = Checkpoint(prepared["checkpoint_path"])
    validate_checkpoint(config, checkpoint)
    recipe = config.source["native"]
    # Publisher code reads the base and tokenizer by this metadata field. Point it
    # at the verified local view after checking the original immutable identity.
    checkpoint.meta.base = prepared["base_path"]
    dtype = torch.float32 if config.parameters.get("dtype") == "float" else torch.bfloat16
    torch.cuda.set_per_process_memory_fraction(config.parameters.get("gpu_memory_utilization", 0.9), device=0)
    tokenizer, model = checkpoint.load("cuda", LoadOptions(dtype=dtype, backend="torch", merge=True, cuda_graphs=False, fused=False))
    if model.dtype != str(dtype).removeprefix("torch."):
        raise RuntimeFailure("load", "effective_precision_mismatch")
    checkpoint.meta.base = recipe["base"]["repository"]
    checkpoint.requested = f"{config.source['repository']}@{config.source['revision']}"
    scorer = managed_server(publisher, checkpoint, tokenizer, model, config)
    publisher.app.state.server = scorer
    publisher.MODEL_NAMES = (config.served_alias,)
    return publisher, scorer


def create_app(config: ModelConfig, publisher, scorer) -> Starlette:
    def error(status: int, code: str, usage=None):
        body = {"error": {"code": code, "message": code.replace("_", " ")}}
        if usage is not None:
            body["usage"] = usage
        return JSONResponse(body, status_code=status)

    async def health(_):
        ready = scorer.thread.is_alive() and not scorer.stopping.is_set()
        return JSONResponse({"ready": ready}, status_code=200 if ready else 503)

    async def models(_):
        if not scorer.thread.is_alive() or scorer.stopping.is_set():
            return error(503, "native_engine_unavailable")
        return JSONResponse(publisher.models())

    async def answer(request: Request):
        future = None
        wrapped = None
        observed_usage = None
        try:
            value = await request.json()
            if not isinstance(value, dict) or set(value) - {"model", "state", "questions"} or value.get("model") != config.served_alias:
                return error(422, "invalid_native_request")
            if isinstance(value.get("questions"), dict) and any(isinstance(q, dict) and set(q) - {"type", "instructions", "criteria"} for q in value["questions"].values()):
                return error(422, "invalid_native_question")
            native = publisher.SystemOneRequest.model_validate(value)
            rec, metadata = publisher.to_record(native)
            supplied = request.headers.get(DEADLINE_HEADER)
            if supplied is not None and (not supplied.isascii() or not supplied.isdigit() or len(supplied) > 16):
                return error(400, "invalid_deadline")
            deadline = min(time.time() + MAX_EXECUTION_SECONDS, int(supplied) / 1000 if supplied else float("inf"))
            if deadline <= time.time():
                return error(408, "deadline_expired")
            future = scorer.submit(rec, deadline)
            # Shield the original concurrent Future. Cancellation can remove queued
            # work, but an already-running CUDA batch retains capacity until done.
            wrapped = asyncio.wrap_future(future)
            async with asyncio.timeout(max(0, deadline - time.time())):
                probabilities, metrics = await connected(request, asyncio.shield(wrapped))
            observed_usage = {"input_tokens": metrics.get("tokens"), "output_tokens": None}
            body = scorer._body(native, metadata, probabilities, metrics)
            observed_usage = body["usage"]
            if body["usage"]["output_tokens"] > config.parameters["max_output_tokens"]:
                return error(422, "native_answer_exceeds_output_capacity", body["usage"])
            return JSONResponse(body, headers={"x-typesafe-request-id": uuid.uuid4().hex})
        except queue.Full:
            return error(429, "model_capacity_exhausted")
        except (TimeoutError, DeadlineExpired):
            return error(504, "model_deadline_exceeded")
        except ClientDisconnect:
            # Expected transport cancellation, not a model error. The finally
            # block still cancels queued work and retains running GPU capacity.
            return Response(status_code=499)
        except NativeInputError as error_value:
            return error(422, str(error_value))
        except (ValueError, TypeError, KeyError, UnicodeError) as error_value:
            if future is not None:
                failure(error_value, "execute", "native_output_invalid")
                return error(500, "native_execution_failed", observed_usage)
            return error(422, "invalid_native_request")
        except asyncio.CancelledError:
            raise
        except Exception as error_value:
            code = "native_out_of_memory" if type(error_value).__name__ == "OutOfMemoryError" else "native_execution_failed"
            failure(error_value, "execute", code)
            return error(500, code, observed_usage)
        finally:
            if future is not None and not future.done():
                future.cancel()
            if wrapped is not None:
                # A detached running operation may finish exceptionally later. Its
                # result is consumed without publishing it or leaking error text.
                def consume(done):
                    if not done.cancelled():
                        with contextlib.suppress(Exception):
                            done.exception()
                wrapped.add_done_callback(consume)

    return Starlette(routes=[Route("/health", health), Route("/v1/models", models), Route("/v1/systemone", answer, methods=["POST"])])


def main():
    import uvicorn

    try:
        config = ModelConfig.parse(os.environ["MF_NATIVE_CONFIG"])
        prepared = json.loads(Path(os.environ["MF_PREPARED_CONFIG"]).read_text())
    except Exception as error:
        failure(error, "config", "native_configuration_invalid")
        raise SystemExit(1) from None
    try:
        publisher, scorer = load_native(config, prepared)
    except Exception as error:
        failure(error, "load", "native_model_load_failed")
        raise SystemExit(1) from None
    try:
        uvicorn.run(create_app(config, publisher, scorer), host="127.0.0.1", port=8001, access_log=False, log_level="critical", timeout_graceful_shutdown=10)
    finally:
        scorer.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        failure(error, "serve", "native_engine_failed")
        raise SystemExit(1)
