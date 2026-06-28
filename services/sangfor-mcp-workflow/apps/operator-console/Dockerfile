FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
RUN find apps packages -type f ! -name 'package.json' -delete \
 && find apps packages -type d -empty -delete 2>/dev/null || true

RUN pnpm install --no-frozen-lockfile

COPY . .

RUN pnpm run build --filter=operator-console

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3500

COPY --from=builder /app/apps/operator-console/dist ./apps/operator-console/dist
COPY --from=builder /app/apps/operator-console/package.json ./apps/operator-console/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

EXPOSE 3500

CMD ["node", "apps/operator-console/dist/server.js"]
