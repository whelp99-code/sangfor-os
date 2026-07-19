# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS builder

WORKDIR /src

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/operator-console/package.json apps/operator-console/
COPY packages/shared/package.json packages/shared/
COPY packages/workflow-core/package.json packages/workflow-core/
COPY packages/workflow-engine/package.json packages/workflow-engine/
COPY packages/health-checker/package.json packages/health-checker/
COPY packages/wiki-sync/package.json packages/wiki-sync/

RUN corepack pnpm install --frozen-lockfile

COPY . .

RUN corepack pnpm build \
 && corepack pnpm --filter @sangfor/operator-console-workflow deploy --prod --legacy /opt/runtime

RUN mkdir -p /opt/image/apps/operator-console/dist/public /opt/image/data/vendors \
 && cp -a /opt/runtime/node_modules /opt/image/node_modules \
 && cp /src/apps/operator-console/dist/server.mjs /src/apps/operator-console/dist/server.mjs.map /opt/image/apps/operator-console/dist/ \
 && cp -a /src/apps/operator-console/dist/public/. /opt/image/apps/operator-console/dist/public/ \
 && cp /src/apps/operator-console/package.json /opt/image/apps/operator-console/package.json \
 && if [ -f /src/data/vendors/vendor-database.json ]; then cp /src/data/vendors/vendor-database.json /opt/image/data/vendors/; fi \
 && find /opt/image -type f \( -name '*.ts' -o -name '*.tsx' \) ! -path '*/node_modules/*' -delete \
 && find /opt/image -type d \( -name src -o -name tests \) ! -path '*/node_modules/*' -prune -exec rm -rf {} + 2>/dev/null || true

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3500 \
    HOST=0.0.0.0 \
    SANGFOR_DOCKER_LIVENESS=1 \
    WHELP99_ENFORCE_SAFE_TOOLS=true \
    SANGFOR_API_KEY=u004-docker-companion-operator-placeholder \
    MCP_API_KEY=u004-docker-companion-operator-placeholder \
    SANGFOR_OPERATOR_PRINCIPAL_ID=u004-docker-companion-principal

EXPOSE 3500

COPY --from=builder /opt/image /app

# Clear the base image entrypoint so Path=node and Config.Cmd is exact.
ENTRYPOINT []
CMD ["node", "apps/operator-console/dist/server.mjs"]
