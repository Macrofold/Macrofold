"""Reviewed Kev checkpoint data. Model repositories cannot supply executable code."""

from __future__ import annotations

import re
import json
from pathlib import Path
from pathlib import PurePosixPath

from config import ModelConfig, commit, object_fields, positive_integer, repository

KEV_REVISION = json.loads(Path(__file__).with_name("kev-source.json").read_text())["revision"]
NATIVE_PROFILE = "kev-systemone-v1"


def artifacts(value: object) -> list[dict]:
    if not isinstance(value, list) or not 1 <= len(value) <= 10000:
        raise ValueError("Native snapshots require exact artifact manifests")
    names = set()
    for item in value:
        entry = object_fields(item, {"path", "size_bytes", "sha256", "git_blob_sha1"}, {"path", "size_bytes", "sha256", "git_blob_sha1"})
        name = entry["path"]
        if not isinstance(name, str) or len(name) > 1024 or "\\" in name or any(c in name for c in "*?[]"):
            raise ValueError("Invalid native artifact path")
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or str(path) != name or name in names:
            raise ValueError("Invalid native artifact path")
        names.add(name)
        if type(entry["size_bytes"]) is not int or not 0 <= entry["size_bytes"] <= 9007199254740991:
            raise ValueError("Invalid native artifact size")
        for key, length in [("sha256", 64), ("git_blob_sha1", 40)]:
            digest = entry[key]
            if digest is not None and (not isinstance(digest, str) or not re.fullmatch(f"[a-f0-9]{{{length}}}", digest)):
                raise ValueError("Invalid native artifact checksum")
        if entry["sha256"] is None and entry["git_blob_sha1"] is None:
            raise ValueError("Native artifacts require an upstream checksum")
        if name.endswith((".py", ".pkl", ".pickle", ".bin")):
            raise ValueError("Only reviewed native checkpoint data may be downloaded")
    return value


def parse_native_config(value: dict) -> ModelConfig:
    object_fields(value, {"profile_id", "source", "parameters", "served_alias"}, {"profile_id", "source", "parameters", "served_alias"})
    source = object_fields(value["source"], {"repository", "revision", "weight_files", "native"}, {"repository", "revision", "weight_files", "native"})
    repository(source["repository"])
    commit(source["revision"])
    recipe = object_fields(source["native"], {"format", "version", "weights", "checkpoint_files", "base", "licenses"}, {"format", "version", "weights", "checkpoint_files", "base", "licenses"})
    if recipe["format"] != "kev" or type(recipe["version"]) is not int or recipe["version"] != 1 or recipe["weights"] not in {"lora", "full"}:
        raise ValueError("Unsupported native checkpoint format")
    files = artifacts(recipe["checkpoint_files"])
    names = {item["path"] for item in files}
    if "head.pt" not in names or (recipe["weights"] == "lora" and not {"adapter_config.json", "adapter_model.safetensors"} <= names):
        raise ValueError("Missing Kev adapter or scoring head")
    weights = source["weight_files"]
    if not isinstance(weights, list) or not weights or any(not isinstance(name, str) or name not in names or not name.endswith(".safetensors") for name in weights) or len(set(weights)) != len(weights):
        raise ValueError("Select exact native safetensors artifacts")
    base = object_fields(recipe["base"], {"repository", "revision", "files"}, {"repository", "revision", "files"})
    repository(base["repository"])
    commit(base["revision"])
    artifacts(base["files"])
    licenses = recipe["licenses"]
    if not isinstance(licenses, list) or not 1 <= len(licenses) <= 2:
        raise ValueError("Native source license evidence is required")
    for item in licenses:
        object_fields(item, {"repository", "revision", "license", "gated"}, {"repository", "revision", "license", "gated"})
        repository(item["repository"])
        commit(item["revision"])
        if type(item["gated"]) is not bool or (item["license"] is not None and not isinstance(item["license"], str)):
            raise ValueError("Invalid native license evidence")
    parameters = object_fields(value["parameters"], {"context_window_tokens", "max_output_tokens", "max_concurrent_requests", "dtype", "tensor_parallel_size", "gpu_memory_utilization"}, {"context_window_tokens", "max_output_tokens", "max_concurrent_requests"})
    context = positive_integer(parameters["context_window_tokens"], 65536)
    if positive_integer(parameters["max_output_tokens"], 1048576) > context:
        raise ValueError("Output capacity exceeds context")
    positive_integer(parameters["max_concurrent_requests"], 64)
    if parameters.get("dtype", "auto") not in {"auto", "bfloat16", "float"} or parameters.get("tensor_parallel_size", 1) != 1:
        raise ValueError("Kev supports one GPU and bf16 or fp32 precision")
    utilization = parameters.get("gpu_memory_utilization", 0.9)
    if type(utilization) not in {int, float} or not 0.1 <= utilization <= 0.95:
        raise ValueError("Invalid GPU memory utilization")
    alias = value["served_alias"]
    if not isinstance(alias, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", alias):
        raise ValueError("Invalid served model alias")
    return ModelConfig(source=source, parameters=parameters, served_alias=alias, profile_id=NATIVE_PROFILE)
