"""Download and verify pinned snapshots before starting the offline engine."""

from __future__ import annotations

import json
import os
import sys
from fnmatch import fnmatch
from pathlib import Path

from config import ModelConfig

TOKENIZER_FILES = [
    "config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
    "added_tokens.json", "vocab.json", "vocab.txt", "merges.txt", "tokenizer.model",
    "*.tiktoken", "chat_template.jinja", "chat_templates/*.jinja",
]


def prepare(config: ModelConfig, directory: Path, token: str | None) -> dict:
    # Maintained Hub checksums validate cache hits as well as new downloads. Missing
    # unrelated repository files are expected because only the selected recipe loads.
    # See docs/projects/hugging-face-model-deployments-tech-design.md#4-source-preparation-and-runtime-profiles.
    from huggingface_hub import HfApi, snapshot_download

    cache = directory.parent / "hub"
    cache.mkdir(parents=True, exist_ok=True)
    api = HfApi(token=token or False)

    def snapshot(source: dict, patterns: list[str]) -> Path:
        path = Path(snapshot_download(
            repo_id=source["repository"], repo_type="model", revision=source["revision"],
            cache_dir=cache, token=token or False, allow_patterns=patterns, max_workers=4,
        ))
        if path.name != source["revision"] or not path.is_dir():
            raise ValueError("Hub did not return the selected immutable snapshot")
        verified = api.verify_repo_checksums(repo_id=source["repository"], revision=source["revision"], cache_dir=cache)
        if verified.mismatches or verified.extra_paths or verified.checked_count == 0:
            raise ValueError("Pinned snapshot integrity verification failed")
        return path

    def materialize(path: Path, name: str, patterns: list[str], weights: list[str] | None = None) -> Path:
        # A Hub cache can contain files fetched by a different recipe at the same
        # commit. Expose only this revision's selected files to the native loader.
        result = directory / name
        result.mkdir()
        for file in path.rglob("*"):
            relative = file.relative_to(path).as_posix()
            if not file.is_file() or not any(fnmatch(relative, pattern) for pattern in patterns):
                continue
            if relative.endswith(".safetensors.index.json"):
                index = json.loads(file.read_text())
                if not isinstance(index.get("weight_map"), dict) or set(index["weight_map"].values()) != set(weights or []):
                    continue
            target = result / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(file)
        return result

    source = config.source
    patterns = source["weight_files"] + TOKENIZER_FILES + ["generation_config.json", "*.safetensors.index.json"]
    model = materialize(snapshot(source, patterns), "model", patterns, source["weight_files"])
    for name in ["config.json", *source["weight_files"]]:
        if not (model / name).is_file():
            raise ValueError("A selected model artifact is missing")
    tokenizer = materialize(snapshot(source["tokenizer"], TOKENIZER_FILES), "tokenizer", TOKENIZER_FILES) if source.get("tokenizer") else model
    tokenizer_config = tokenizer / "tokenizer_config.json"
    if not tokenizer_config.is_file():
        raise ValueError("Tokenizer configuration is missing")
    info = json.loads(tokenizer_config.read_text())
    template = source.get("chat_template")
    if not template and not info.get("chat_template") and not (tokenizer / "chat_template.jinja").is_file():
        raise ValueError("A chat template is required")
    template_path = None
    if template:
        template_path = directory / "chat-template.jinja"
        template_path.write_text(template, encoding="utf-8")
        template_path.chmod(0o600)
    return {"model_path": str(model), "tokenizer_path": str(tokenizer), "template_path": str(template_path) if template_path else None}


if __name__ == "__main__":
    try:
        config = ModelConfig.parse(os.environ["MF_MODEL_CONFIG"])
        directory = Path(os.environ["MF_PREPARE_DIRECTORY"])
        prepared = prepare(config, directory, os.environ.pop("HF_TOKEN", None))
        output = directory / "prepared.json.tmp"
        output.write_text(json.dumps(prepared))
        output.chmod(0o600)
        output.replace(directory / "prepared.json")
    except Exception:
        # Hub exceptions can contain private URLs; parent reports the safe startup stage.
        print("Model snapshot preparation failed", file=sys.stderr)
        sys.exit(1)
