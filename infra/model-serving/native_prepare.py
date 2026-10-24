"""Resolve exact Hub data into verified local views before the engine starts."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from config import ModelConfig
from diagnostics import RuntimeFailure


def verify_artifact(path: Path, artifact: dict) -> None:
    if not path.is_file() or path.stat().st_size != artifact["size_bytes"]:
        raise RuntimeFailure("prepare", "artifact_size_mismatch")
    algorithm = "sha256" if artifact["sha256"] else "sha1"
    digest = hashlib.new(algorithm)
    if algorithm == "sha1":
        digest.update(f"blob {artifact['size_bytes']}\0".encode())
    with path.open("rb") as stream:
        while block := stream.read(8 * 1024 * 1024):
            digest.update(block)
    if digest.hexdigest() != (artifact["sha256"] or artifact["git_blob_sha1"]):
        raise RuntimeFailure("prepare", "artifact_checksum_mismatch")


def prepare_native(config: ModelConfig, directory: Path, token: str | None) -> dict:
    from huggingface_hub import snapshot_download

    recipe = config.source["native"]
    cache = directory.parent / "hub"
    cache.mkdir(parents=True, exist_ok=True)

    def snapshot(source: dict, files: list[dict], name: str) -> str:
        path = Path(snapshot_download(
            repo_id=source["repository"], repo_type="model", revision=source["revision"],
            allow_patterns=[item["path"] for item in files], cache_dir=cache,
            token=token or False, max_workers=4,
        ))
        if path.name != source["revision"] or not path.is_dir():
            raise RuntimeFailure("prepare", "snapshot_revision_mismatch")
        # Verify selected artifacts, including warm cache hits. A local view hides
        # unrelated variants already present in the shared Hub cache.
        view = directory / name
        view.mkdir()
        for item in files:
            file = path / item["path"]
            verify_artifact(file, item)
            target = view / item["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(file)
        return str(view)

    checkpoint = snapshot(config.source, recipe["checkpoint_files"], "checkpoint")
    base = snapshot(recipe["base"], recipe["base"]["files"], "base")
    for path in [Path(checkpoint) / "config.json", Path(base) / "config.json", Path(checkpoint) / "adapter_config.json", Path(base) / "tokenizer_config.json"]:
        if path.is_file():
            data = json.loads(path.read_text())
            if not isinstance(data, dict) or data.get("auto_map"):
                raise RuntimeFailure("prepare", "repository_code_unsupported")
    if recipe["weights"] == "lora":
        adapter = json.loads((Path(checkpoint) / "adapter_config.json").read_text())
        if adapter.get("base_model_name_or_path") != recipe["base"]["repository"] or adapter.get("revision") not in {None, recipe["base"]["revision"]}:
            raise RuntimeFailure("prepare", "adapter_base_mismatch")
    return {"checkpoint_path": checkpoint, "base_path": base}
