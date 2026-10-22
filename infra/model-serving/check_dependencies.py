"""Validate the image graph, including vLLM's deliberate native NCCL override."""

import importlib.metadata
import subprocess
import sys

result = subprocess.run([sys.executable, "-m", "pip", "check"], capture_output=True, text=True, check=False)
lines = result.stdout.strip().splitlines()
# Upstream v0.32.0 explicitly selects NCCL 2.30.7 for DeepEPv2's >=2.30.4
# requirement. Downgrading to torch's metadata pin breaks the reviewed engine.
# https://github.com/vllm-project/vllm/blob/v0.32.0/docker/Dockerfile
expected = 'torch 2.13.0+cu130 has requirement nvidia-nccl-cu13==2.29.7; platform_system == "Linux", but you have nvidia-nccl-cu13 2.30.7.'
allowed = (
    importlib.metadata.version("vllm") == "0.32.0"
    and importlib.metadata.version("torch") == "2.13.0+cu130"
    and importlib.metadata.version("nvidia-nccl-cu13") == "2.30.7"
)
if result.returncode and not (allowed and lines == [expected]):
    print(result.stdout, file=sys.stderr)
    print(result.stderr, file=sys.stderr)
    raise SystemExit(result.returncode)
print("Dependency graph verified with the upstream vLLM NCCL override")
