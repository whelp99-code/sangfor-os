#!/usr/bin/env bash
# Single entrypoint for the local MCP/console runtime.
#
#   scripts/stack.sh up        bring everything to all-green (idempotent)
#   scripts/stack.sh down      stop containers + host workflow console
#   scripts/stack.sh status    deep health check (real deps, not bare 200)
#   scripts/stack.sh provision install host deps for the engineer-mcp workspace
#
# Topology:
#   - postgres / redis                     containers
#   - sangfor-engineer-mcp                 container → bridge :3600 + console :3502
#   - sangfor-mcp-mock-console             container → mock :3400
#   - workflow console                     HOST process → :3500 (image can't build,
#                                          see docs/plans/...durability-plan.md A3)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENGINEER_DIR="$REPO/services/sangfor-engineer-mcp"
WORKFLOW_DIR="$REPO/services/sangfor-mcp-workflow"
COMPOSE_SERVICES="postgres redis sangfor-engineer-mcp sangfor-mcp-mock-console"

# name|url|expected_http  (3500 is host; the rest are containers)
ENDPOINTS="
bridge:3600|http://localhost:3600/health|200
console:3502|http://localhost:3502/api/health/store|200
mock:3400|http://localhost:3400/|200
workflow:3500|http://localhost:3500/api/system/health|200
"

c_green() { printf '\033[32m%s\033[0m' "$1"; }
c_red()   { printf '\033[31m%s\033[0m' "$1"; }

probe() { # url -> http code (000 on failure)
  curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$1" 2>/dev/null || echo 000
}

wait_healthy() { # name url -> 0 if 200 within 60s
  local name="$1" url="$2" i=0
  while [ "$i" -lt 60 ]; do
    [ "$(probe "$url")" = "200" ] && { echo "  $(c_green "✓") $name"; return 0; }
    i=$((i + 1)); sleep 1
  done
  echo "  $(c_red "✗") $name (timeout: $url)"; return 1
}

provision() {
  # The host workflow console spawns engineer-mcp as a stdio subprocess; it
  # needs full deps + a generated Prisma client or it crashes → MCP stub.
  if [ ! -d "$ENGINEER_DIR/node_modules/pptxgenjs" ] \
     || [ ! -d "$ENGINEER_DIR/node_modules/.prisma/client" ]; then
    echo "[stack] provisioning engineer-mcp host deps…"
    (cd "$ENGINEER_DIR" && pnpm install --prod=false && pnpm exec prisma generate)
  fi
  [ -d "$WORKFLOW_DIR/node_modules" ] || (cd "$WORKFLOW_DIR" && pnpm install)
}

up() {
  echo "[stack] starting containers: $COMPOSE_SERVICES"
  docker compose -f "$REPO/docker-compose.yml" up -d $COMPOSE_SERVICES
  provision
  echo "[stack] starting host workflow console (:3500)"
  "$WORKFLOW_DIR/start-console.sh" >/dev/null 2>&1 || true
  echo "[stack] waiting for health…"
  printf '%s\n' "$ENDPOINTS" | while IFS='|' read -r name url _; do
    [ -z "$name" ] && continue
    wait_healthy "$name" "$url" || true
  done
  status
}

down() {
  echo "[stack] stopping host workflow console"
  "$WORKFLOW_DIR/start-console.sh" stop >/dev/null 2>&1 || true
  echo "[stack] stopping containers"
  docker compose -f "$REPO/docker-compose.yml" stop $COMPOSE_SERVICES
}

status() {
  echo "── deep status ───────────────────────────────"
  local rc=0
  # HTTP endpoints
  printf '%s\n' "$ENDPOINTS" | while IFS='|' read -r name url want; do
    [ -z "$name" ] && continue
    local code; code="$(probe "$url")"
    if [ "$code" = "$want" ]; then printf '  %s %-14s %s\n' "$(c_green ✓)" "$name" "$code"
    else printf '  %s %-14s %s\n' "$(c_red ✗)" "$name" "$code"; fi
  done
  # Real dependency checks (not just a 200 frame)
  local pg redis mcp
  pg="$(docker exec sangfor-postgres pg_isready -U sangfor 2>/dev/null | grep -o 'accepting' || echo down)"
  redis="$(docker exec sangfor-redis redis-cli ping 2>/dev/null || echo down)"
  printf '  %s postgres       %s\n' "$([ "$pg" = accepting ] && c_green ✓ || c_red ✗)" "$pg"
  printf '  %s redis          %s\n' "$([ "$redis" = PONG ] && c_green ✓ || c_red ✗)" "$redis"
  # Workflow console MCP mode: connected vs stub
  local log="${TMPDIR:-/tmp}/sangfor-workflow-3500.log"
  if [ -f "$log" ]; then
    mcp="$(grep -oE 'MCP: (connected|stub)' "$log" | tail -1 | awk '{print $2}')"
    printf '  %s workflow MCP   %s\n' "$([ "${mcp:-}" = connected ] && c_green ✓ || c_red ⚠)" "${mcp:-unknown}"
  fi
  echo "──────────────────────────────────────────────"
}

case "${1:-status}" in
  up) up ;;
  down) down ;;
  provision) provision ;;
  status) status ;;
  *) echo "usage: scripts/stack.sh {up|down|status|provision}"; exit 2 ;;
esac
