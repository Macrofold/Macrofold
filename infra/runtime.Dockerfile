# Build from the repository root: docker build -f infra/runtime.Dockerfile -t platform-runtime:0.1.0 .
FROM node:24.13.0-bookworm-slim AS build
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/runtime/package.json packages/runtime/package.json
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
# A runtime-only workspace avoids pnpm's full-workspace filtered install while retaining overrides and build policy.
COPY pnpm-workspace.yaml packages/runtime/pnpm-workspace.yaml
RUN --mount=type=cache,id=runtime-pnpm,target=/pnpm/store \
    pnpm --dir packages/runtime install --lockfile-dir=/build --frozen-lockfile --store-dir=/pnpm/store --network-concurrency=4
# Resolve the build tool from the runtime's dependencies without installing the web app or test suites.
COPY scripts/build-runtime.ts packages/runtime/build.ts
COPY packages/runtime/src packages/runtime/src
COPY packages/contracts/harnesses.ts packages/contracts/media.ts packages/contracts/image-input.ts packages/contracts/pagination.ts packages/contracts/
COPY packages/contracts/model-transport.ts packages/contracts/host-control.ts packages/contracts/
COPY packages/contracts/model-completion.ts packages/contracts/native-model.ts packages/contracts/
COPY packages/contracts/permissions.ts packages/contracts/permission-adapters.ts packages/contracts/
COPY packages/contracts/native-diagnostics.ts packages/contracts/
RUN --mount=type=cache,id=runtime-pnpm,target=/pnpm/store \
    node packages/runtime/build.ts && pnpm --config.inject-workspace-packages=true --filter @platform/runtime deploy --prod /runtime-package --store-dir=/pnpm/store

FROM node:24.13.0-bookworm-slim
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends git ca-certificates python3 ripgrep curl procps sudo \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 agent && useradd -m -u 10001 -g 10001 -d /agent-home -s /bin/bash agent \
    && mkdir -p /workspace /platform-control && chmod 700 /platform-control && chown agent:agent /workspace
# npm 11.21.1 still bundles vulnerable Undici 6.29.0.
# Replace only that exact payload, not npm's dependency graph; keep its notices.
# See docs/features/execution/runtime.md#runtime-image-and-process-isolation.
RUN npm install --global npm@11.21.1 \
    && node -e "const a=require('node:assert/strict');a.equal(require('/usr/local/lib/node_modules/npm/package.json').version,'11.21.1');a.equal(require('/usr/local/lib/node_modules/npm/node_modules/undici/package.json').version,'6.29.0')" \
    && curl --fail --silent --show-error --max-time 60 https://registry.npmjs.org/undici/-/undici-6.29.1.tgz -o /tmp/platform-undici.tgz \
    && echo '29c4b8e0b2d86cb8795571c1959012ce057a14ecfd34858335f47c31e770a04f  /tmp/platform-undici.tgz' | sha256sum --check --status \
    && rm -rf /usr/local/lib/node_modules/npm/node_modules/undici \
    && mkdir /usr/local/lib/node_modules/npm/node_modules/undici \
    && tar -xzf /tmp/platform-undici.tgz --strip-components=1 -C /usr/local/lib/node_modules/npm/node_modules/undici \
    && node -e "require('node:assert/strict').equal(require('/usr/local/lib/node_modules/npm/node_modules/undici/package.json').version,'6.29.1')" \
    && test "$(npm --version)" = '11.21.1' \
    && test "$(npm view npm@11.21.1 version --registry=https://registry.npmjs.org/ --fetch-retries=0 --fetch-timeout=30000)" = '11.21.1' \
    && rm /tmp/platform-undici.tgz && npm cache clean --force
COPY --from=ghcr.io/astral-sh/uv:0.9.28 /uv /usr/local/bin/uv
# Pin the official Hermes core and its complete upstream Python lock. No install script or auto-update.
ADD https://github.com/NousResearch/hermes-agent.git#b2aa855b626ff8688eb34b95c60ee8b6a4af3679 /opt/hermes
# Preserve the frozen upstream graph/agent code. Its three exact requirements
# must describe the reviewed security wheels installed below for pip check.
RUN python3 - <<'PY'
from pathlib import Path
p = Path('/opt/hermes/pyproject.toml')
text = p.read_text()
for previous, fixed in (
    ('"certifi==2026.5.20"', '"certifi==2026.10.19"'),
    ('"PyJWT[crypto]==2.13.0"', '"PyJWT[crypto]==2.14.0"'),
    ('"Pillow==12.3.0"', '"Pillow==13.0.0"'),
):
    assert text.count(previous) == 1, f'Unexpected upstream security requirement: {previous}'
    text = text.replace(previous, fixed)
p.write_text(text)
PY
RUN --mount=type=cache,target=/root/.cache/uv \
    cd /opt/hermes && UV_PYTHON_DOWNLOADS=never uv sync --frozen --no-dev --extra mcp --python /usr/bin/python3
COPY infra/runtime-python-security.txt /opt/platform-python-security.txt
RUN uv pip install --python /opt/hermes/.venv/bin/python --no-deps --require-hashes --only-binary :all: -r /opt/platform-python-security.txt \
    && uv pip check --python /opt/hermes/.venv/bin/python
# Exercise the security-major Pillow wheel and Hermes's unchanged normalization
# helper on bounded in-memory images; do not discover optional providers.
RUN /opt/hermes/.venv/bin/python - <<'PY'
from io import BytesIO
from importlib.util import spec_from_file_location, module_from_spec
from PIL import Image
import jwt
spec = spec_from_file_location('hermes_image_routing', '/opt/hermes/agent/image_routing.py')
routing = module_from_spec(spec)
spec.loader.exec_module(routing)
for mode, encoding in (('RGB', 'PNG'), ('RGB', 'JPEG'), ('RGBA', 'PNG'), ('P', 'PNG'), ('I', 'TIFF'), ('I;16', 'TIFF')):
    data = BytesIO()
    Image.new(mode, (8, 8)).save(data, format=encoding)
    with Image.open(BytesIO(routing._transcode_to_png(data.getvalue()))) as decoded:
        assert decoded.size == (8, 8)
        decoded.convert('RGBA').resize((4, 4), Image.Resampling.LANCZOS).load()
key = 'runtime-security-fixture-key-with-at-least-32-bytes'
assert jwt.decode(jwt.encode({'sub': 'fixture'}, key, algorithm='HS256'), key, algorithms=['HS256'])['sub'] == 'fixture'
PY
WORKDIR /opt/platform
USER root
COPY --from=build /runtime-package/node_modules ./node_modules
COPY --from=build /build/packages/runtime/dist/ ./
# The standalone pnpm deployment preserves exact lockfile versions; the agent UID cannot write it.
ENV PATH="/opt/platform/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENTRYPOINT []
CMD ["node", "/opt/platform/entry.mjs"]
