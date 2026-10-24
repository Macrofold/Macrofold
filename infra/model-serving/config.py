"""The private, immutable serving recipe; public validation remains in Macrofold."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import PurePosixPath

BASE_IMAGE = "vllm/vllm-openai:v0.32.0@sha256:6ee133356d49ed24cee03dd0cda3d3980279a11c107ce3e752c89e76540f41c9"
ENDPOINT_SECRET_HEADER = "x-macrofold-endpoint-secret"
DEADLINE_HEADER = "x-macrofold-deadline-ms"
MAX_REQUEST_BYTES = 8 * 1024 * 1024
MAX_RESPONSE_BYTES = 24 * 1024 * 1024
MAX_EXECUTION_SECONDS = 240
STARTUP_SECONDS = 900
ENGINE_ORIGIN = "http://127.0.0.1:8001"


def object_fields(value: object, allowed: set[str], required: set[str]) -> dict:
    if not isinstance(value, dict) or set(value) - allowed or required - set(value):
        raise ValueError("Invalid model configuration fields")
    return value


def positive_integer(value: object, maximum: int) -> int:
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError("Invalid model configuration integer")
    return value


def repository(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*/[A-Za-z0-9_][A-Za-z0-9_.-]*", value):
        raise ValueError("Invalid Hugging Face repository")
    if ".." in value:
        raise ValueError("Invalid Hugging Face repository")
    return value


def commit(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{40}", value):
        raise ValueError("Model sources require full immutable commits")
    return value


@dataclass(frozen=True)
class ModelConfig:
    source: dict
    parameters: dict
    served_alias: str
    profile_id: str = "vllm-0.32.0-text"

    @classmethod
    def parse(cls, raw: str) -> ModelConfig:
        if len(raw.encode()) > 8 * 1024 * 1024:
            raise ValueError("Model configuration is too large")
        value = json.loads(raw)
        if isinstance(value, dict) and value.get("profile_id") == "kev-systemone-v1":
            from native_config import parse_native_config
            return parse_native_config(value)
        value = object_fields(value, {"source", "parameters", "served_alias", "profile_id"}, {"source", "parameters", "served_alias"})
        if value.get("profile_id", "vllm-0.32.0-text") != "vllm-0.32.0-text":
            raise ValueError("Unsupported serving profile")
        source = object_fields(value["source"], {"repository", "revision", "weight_files", "tokenizer", "chat_template"}, {"repository", "revision", "weight_files"})
        repository(source["repository"])
        commit(source["revision"])
        files = source["weight_files"]
        if not isinstance(files, list) or not 1 <= len(files) <= 10000 or not all(isinstance(name, str) for name in files) or len(files) != len(set(files)):
            raise ValueError("Select exact safetensors weight files")
        for name in files:
            if not isinstance(name, str) or len(name) > 1024 or "\\" in name or any(c in name for c in "*?[]"):
                raise ValueError("Invalid weight filename")
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or str(path) != name or not name.endswith(".safetensors"):
                raise ValueError("Select exact safetensors weight files")
        if "tokenizer" in source:
            tokenizer = object_fields(source["tokenizer"], {"repository", "revision"}, {"repository", "revision"})
            repository(tokenizer["repository"])
            commit(tokenizer["revision"])
        template = source.get("chat_template")
        if template is not None and (not isinstance(template, str) or not template or len(template.encode()) > 64 * 1024):
            raise ValueError("Invalid immutable chat template")
        parameters = object_fields(value["parameters"], {"context_window_tokens", "max_output_tokens", "max_concurrent_requests", "dtype", "quantization", "tensor_parallel_size", "gpu_memory_utilization", "tool_call_parser", "reasoning_parser"}, {"context_window_tokens", "max_output_tokens", "max_concurrent_requests"})
        context = positive_integer(parameters["context_window_tokens"], 2_097_152)
        if positive_integer(parameters["max_output_tokens"], 1_048_576) > context:
            raise ValueError("Output limit exceeds model context")
        positive_integer(parameters["max_concurrent_requests"], 65536)
        positive_integer(parameters.get("tensor_parallel_size", 1), 16)
        if parameters.get("dtype", "auto") not in {"auto", "half", "float", "float16", "bfloat16", "float32"}:
            raise ValueError("Unsupported dtype")
        if parameters.get("quantization") not in {None, "awq", "gptq", "gptq_marlin", "fp8", "compressed-tensors", "bitsandbytes"}:
            raise ValueError("Unsupported managed quantization")
        utilization = parameters.get("gpu_memory_utilization", 0.9)
        if type(utilization) not in {int, float} or not math.isfinite(utilization) or not 0.1 <= utilization <= 0.95:
            raise ValueError("Invalid GPU memory utilization")
        # Built-in parsers only: a plugin path would execute unreviewed Python.
        for field in ["tool_call_parser", "reasoning_parser"]:
            parser = parameters.get(field)
            if parser is not None and (not isinstance(parser, str) or not re.fullmatch(r"[a-zA-Z0-9_]{1,64}", parser)):
                raise ValueError("Invalid built-in parser")
        alias = value["served_alias"]
        if not isinstance(alias, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", alias):
            raise ValueError("Invalid served model alias")
        return cls(source=source, parameters=parameters, served_alias=alias)

    def engine_arguments(self, model_path: str, tokenizer_path: str, template_path: str | None) -> list[str]:
        p = self.parameters
        arguments = [
            "vllm", "serve", model_path,
            "--host", "127.0.0.1", "--port", "8001",
            "--tokenizer", tokenizer_path,
            "--revision", self.source["revision"],
            "--tokenizer-revision", self.source.get("tokenizer", self.source)["revision"],
            "--served-model-name", self.served_alias,
            "--load-format", "safetensors", "--no-trust-remote-code",
            "--no-trust-request-chat-template", "--no-trust-request-mm-kwargs",
            "--no-enable-prompt-embeds", "--no-enable-log-requests", "--no-enable-log-outputs",
            "--disable-uvicorn-access-log", "--disable-fastapi-docs",
            "--generation-config", "vllm",
            "--override-generation-config", json.dumps({"max_new_tokens": p["max_output_tokens"]}),
            "--max-model-len", str(p["context_window_tokens"]),
            "--max-num-seqs", str(p["max_concurrent_requests"]),
            "--tensor-parallel-size", str(p.get("tensor_parallel_size", 1)),
            "--dtype", p.get("dtype", "auto"),
            "--gpu-memory-utilization", str(p.get("gpu_memory_utilization", 0.9)),
        ]
        if template_path:
            arguments += ["--chat-template", template_path]
        if p.get("quantization"):
            arguments += ["--quantization", p["quantization"]]
        if p.get("tool_call_parser"):
            arguments += ["--enable-auto-tool-choice", "--tool-call-parser", p["tool_call_parser"]]
        if p.get("reasoning_parser"):
            arguments += ["--reasoning-parser", p["reasoning_parser"]]
        return arguments
