# Sangfor Agentic OS — Web (Next.js 16)
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

# Dependencies stage — copy every workspace manifest so install is complete
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
RUN find apps packages -type f ! -name 'package.json' -delete \
 && find apps packages -type d -empty -delete 2>/dev/null || true

RUN pnpm install --frozen-lockfile --prod=false

# Build stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm --filter @sangfor/db db:generate
RUN pnpm --filter "@sangfor/web..." build

# Runner stage — Next.js standalone
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3101
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Standalone output bundles every transitive workspace dep we need
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma

USER nextjs
EXPOSE 3101
CMD ["node", "apps/web/server.js"]
