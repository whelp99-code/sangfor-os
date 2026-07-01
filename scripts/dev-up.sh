#!/usr/bin/env bash
# dev-up.sh — bring up the full local stack (postgres + api + web) with the
# quirks this repo needs, so you never hand-roll the "kill ports → ulimit →
# WATCHPACK → nohup → wait → smoke" dance again.
#
# Encodes the lessons from the improvement loop:
#   - macOS file-descriptor limit (EMFILE: too many open files) → `ulimit -n`
#   - Next.js watcher flakiness under low fd budget → WATCHPACK_POLLING=1
#   - CFO/finance API needs AUTH_BYPASS_ENABLED=1 + NODE_ENV=development in dev
#   - web proxies /api/finance/* → api via FINANCE_API_URL
#
# Usage:
#   scripts/dev-up.sh            # start everything, wait until healthy
#   API_PORT=3200 WEB_PORT=3101 scripts/dev-up.sh
#   scripts/dev-up.sh --no-db    # skip docker compose postgres
#
# Logs: /tmp/sangfor-api.log, /tmp/sangfor-web.log
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-3200}"
WEB_PORT="${WEB_PORT:-3101}"
DB_URL="${DATABASE_URL:-postgresql://sangfor:sangfor_password@localhost:5434/sangfor_os?schema=public}"
START_DB=1
[[ "${1:-}" == "--no-db" ]] && START_DB=0

log()  { printf '\033[1;34m[dev-up]\033[0m %s\n' "$*"; }
kill_port() { local p="$1"; local pid; pid="$(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"; [[ -n "$pid" ]] && { kill "$pid" 2>/dev/null || true; log "freed port $p (pid $pid)"; }; }

# 1) Postgres
if [[ "$START_DB" == 1 ]]; then
  if docker info >/dev/null 2>&1; then
    log "starting postgres (docker compose)…"
    docker compose up -d postgres >/dev/null 2>&1 || log "compose postgres already up / skipped"
    for _ in $(seq 1 15); do docker exec sangfor-postgres pg_isready -U sangfor -d sangfor_os >/dev/null 2>&1 && { log "postgres ready"; break; }; sleep 2; done
  else
    log "⚠ docker daemon not reachable — skipping postgres (start Docker Desktop, or pass --no-db)"
  fi
fi

# 2) API (finance/CFO needs the dev bypass flag + dev env)
kill_port "$API_PORT"
log "starting api on :$API_PORT…"
DATABASE_URL="$DB_URL" API_PORT="$API_PORT" API_KEY="" AUTH_BYPASS_ENABLED=1 NODE_ENV=development \
  CORS_ORIGIN="http://localhost:$WEB_PORT" \
  nohup pnpm --filter @sangfor/api dev >/tmp/sangfor-api.log 2>&1 &

# 3) Web (raise fd limit + poll watcher to dodge EMFILE)
kill_port "$WEB_PORT"
log "starting web on :$WEB_PORT (ulimit -n 4096, WATCHPACK_POLLING)…"
( ulimit -n 4096 2>/dev/null || true
  cd apps/web
  DATABASE_URL="$DB_URL" FINANCE_API_URL="http://localhost:$API_PORT/api/cfo" API_KEY="" \
    AUTH_BYPASS_ENABLED=1 WATCHPACK_POLLING=true \
    nohup pnpm exec next dev -p "$WEB_PORT" >/tmp/sangfor-web.log 2>&1 & )

# 4) Wait until web responds (Next compiles on first hit)
log "waiting for web to compile…"
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$WEB_PORT/home" 2>/dev/null || echo 000)"
  [[ "$code" =~ ^(200|307|302)$ ]] && { log "✅ web up at http://localhost:$WEB_PORT ($code after ~$((i*5))s)"; break; }
  sleep 5
  [[ "$i" == 20 ]] && log "⚠ web not responding after ~100s — check /tmp/sangfor-web.log"
done

log "api log: /tmp/sangfor-api.log   web log: /tmp/sangfor-web.log"
log "stop with: scripts/dev-down.sh"
