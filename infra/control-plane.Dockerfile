# Standalone web server plus a separate worker target. No secrets enter build arguments or layers.
FROM node:24.13.0-bookworm-slim AS source
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY sdk/typescript/package.json sdk/typescript/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
FROM source AS build
RUN pnpm check && pnpm build

FROM node:24.13.0-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3210 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
USER node
EXPOSE 3210
CMD ["node","apps/web/server.js"]

FROM node:24.13.0-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=source --chown=node:node /app/node_modules ./node_modules
COPY --from=source --chown=node:node /app/packages ./packages
COPY --from=source --chown=node:node /app/scripts ./scripts
COPY --from=source --chown=node:node /app/docs/api ./docs/api
COPY --from=source --chown=node:node /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.json ./
USER node
CMD ["node","--import","tsx","scripts/worker.ts"]
