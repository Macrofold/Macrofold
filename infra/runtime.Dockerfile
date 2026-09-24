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
COPY packages/contracts/harnesses.ts packages/contracts/media.ts packages/contracts/image-input.ts packages/contracts/
COPY packages/contracts/model-transport.ts packages/contracts/host-control.ts packages/contracts/sandbox-control.ts packages/contracts/
COPY packages/contracts/permissions.ts packages/contracts/permission-adapters.ts packages/contracts/
RUN --mount=type=cache,id=runtime-pnpm,target=/pnpm/store \
    node packages/runtime/build.ts && pnpm --config.inject-workspace-packages=true --filter @platform/runtime deploy --prod /runtime-package --store-dir=/pnpm/store

FROM node:24.13.0-bookworm-slim
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends git ca-certificates python3 ripgrep curl procps sudo \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 agent && useradd -m -u 10001 -g 10001 -d /agent-home -s /bin/bash agent \
    && mkdir -p /workspace /platform-control && chmod 700 /platform-control && chown agent:agent /workspace
RUN npm install --global npm@11.19.1 && npm cache clean --force
COPY --from=ghcr.io/astral-sh/uv:0.9.28 /uv /usr/local/bin/uv
# Pin the official Hermes core and its complete upstream Python lock. No install script or auto-update.
ADD https://github.com/NousResearch/hermes-agent.git#b2aa855b626ff8688eb34b95c60ee8b6a4af3679 /opt/hermes
RUN --mount=type=cache,target=/root/.cache/uv \
    cd /opt/hermes && UV_PYTHON_DOWNLOADS=never uv sync --frozen --no-dev --extra mcp --python /usr/bin/python3
COPY infra/runtime-python-security.txt /opt/platform-python-security.txt
RUN uv pip install --python /opt/hermes/.venv/bin/python --no-deps --require-hashes --only-binary :all: -r /opt/platform-python-security.txt \
    && uv pip check --python /opt/hermes/.venv/bin/python
WORKDIR /opt/platform
USER root
COPY --from=build /runtime-package/node_modules ./node_modules
COPY --from=build /build/packages/runtime/dist/ ./
# The standalone pnpm deployment preserves exact lockfile versions; the agent UID cannot write it.
ENV PATH="/opt/platform/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENTRYPOINT []
CMD ["node", "/opt/platform/entry.mjs"]
