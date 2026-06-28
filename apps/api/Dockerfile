FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
RUN find apps packages -type f ! -name 'package.json' -delete \
 && find apps packages -type d -empty -delete 2>/dev/null || true

RUN pnpm install --frozen-lockfile --prod=false

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm --filter @sangfor/db db:generate

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3200

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./

EXPOSE 3200
WORKDIR /app/apps/api
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
