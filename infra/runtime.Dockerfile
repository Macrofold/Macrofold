# Build from the repository root: docker build -f infra/runtime.Dockerfile -t platform-runtime:0.1.0 .
FROM node:24.13.0-bookworm-slim AS build
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/runtime/package.json packages/runtime/package.json
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate && pnpm install --frozen-lockfile
COPY scripts/build-runtime.ts scripts/build-runtime.ts
COPY packages/runtime/src packages/runtime/src
RUN pnpm exec tsx scripts/build-runtime.ts && pnpm --config.inject-workspace-packages=true --filter @platform/runtime deploy --prod /runtime-package

FROM node:24.13.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 ripgrep curl procps sudo \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 agent && useradd -m -u 10001 -g 10001 -d /agent-home -s /bin/bash agent \
    && mkdir -p /workspace /platform-control && chmod 700 /platform-control && chown agent:agent /workspace
WORKDIR /opt/platform
USER root
COPY --from=build /runtime-package/node_modules ./node_modules
COPY --from=build /build/packages/runtime/dist/ ./
# The standalone pnpm deployment preserves exact lockfile versions; the agent UID cannot write it.
ENV PATH="/opt/platform/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENTRYPOINT []
CMD ["node", "/opt/platform/entry.mjs"]
