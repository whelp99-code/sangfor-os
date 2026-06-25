#!/usr/bin/env bash
# Start all integration upstream services + AIOSv2 Portal for live verification.
# Usage:
#   ./scripts/start-integration-stack.sh start
#   ./scripts/start-integration-stack.sh stop
#   ./scripts/start-integration-stack.sh status
#   ./scripts/start-integration-stack.sh wait-health

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${ROOT}/.aios/runtime/integration-stack"
mkdir -p "$STATE_DIR"

PLAYGROUND="$(cd "$ROOT/.." && pwd)"

AIOS_V1_DIR="${PLAYGROUND}/AIOS v1"
F_AIOS_DIR="${PLAYGROUND}/F - aios-v3-core"
SANGFOR_DIR="${PLAYGROUND}/sangfor-mcp-workflow"
VIBE_DIR="${PLAYGROUND}/vibe-coding-os"
MAIL_DIR="${PLAYGROUND}/apps/mail-intelligence"
WHELP99_DIR="${PLAYGROUND}/whelp99-code-sangfor-engineer-mcp"

log() { printf '[integration-stack] %s\n' "$*"; }

port_open() {
  local port="$1"
  lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

start_service() {
  local name="$1"
  local workdir="$2"
  local cmd="$3"
  local logfile="${STATE_DIR}/${name}.log"

  if [[ -f "${STATE_DIR}/${name}.cmd" ]]; then
    local old_port
    old_port="$(cat "${STATE_DIR}/${name}.cmd" 2>/dev/null || true)"
    # no-op marker file reuse below
  fi

  log "starting $name ..."
  : >"$logfile"
  nohup bash -lc "cd \"$workdir\" && $cmd" >>"$logfile" 2>&1 &
  echo $! >"${STATE_DIR}/${name}.pid"
  log "$name pid $(cat "${STATE_DIR}/${name}.pid") log $logfile"
}

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
    log "stopped port $port (pids $pids)"
  fi
}

stop_service() {
  local name="$1"
  local pidfile="${STATE_DIR}/${name}.pid"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      # Kill process group if possible
      pkill -P "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
}

wait_url() {
  local url="$1"
  local retries="${2:-45}"
  local i=0
  while (( i < retries )); do
    if curl -sf "$url" >/dev/null 2>&1; then
      log "ready: $url"
      return 0
    fi
    sleep 2
    ((i++)) || true
  done
  log "timeout: $url"
  return 1
}

cmd_start() {
  if [[ -f "${ROOT}/.env.local" ]]; then
    set -a
    # shellcheck disable=SC1091
    source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "${ROOT}/.env.local" | sed 's/\r$//')
    set +a
  fi

  start_service "mail" "$MAIL_DIR" "PORT=3010 node server.mjs"
  start_service "aios-v1" "$AIOS_V1_DIR" "pnpm dev"
  start_service "f-aios-v3" "${F_AIOS_DIR}/server" "PORT=3201 pnpm dev"
  start_service "sangfor" "$SANGFOR_DIR" "pnpm dev:web"
  start_service "vibe" "$VIBE_DIR" "pnpm dev"
  start_service "whelp99-bridge" "$WHELP99_DIR" "PORT=3600 pnpm dev:http-bridge"
  start_service "portal" "$ROOT" "pnpm --filter @aios/web dev"
}

cmd_stop() {
  stop_port 3110
  stop_port 3600
  stop_port 4000
  stop_port 3500
  stop_port 3201
  stop_port 3101
  stop_port 3010
  for name in portal whelp99-bridge vibe sangfor f-aios-v3 aios-v1 mail; do
    stop_service "$name"
  done
}

cmd_status() {
  for port_name in "3010:mail" "3101:aios-v1" "3201:f-aios-v3" "3500:sangfor" "4000:vibe" "3600:whelp99-bridge" "3110:portal"; do
    local port="${port_name%%:*}"
    local name="${port_name##*:}"
    if port_open "$port"; then
      log "$name: listening on $port"
    else
      log "$name: not listening on $port"
    fi
  done
}

cmd_wait_health() {
  wait_url "http://127.0.0.1:3010/api/outlook/status" 20 || true
  wait_url "http://127.0.0.1:3101/api/health" 60
  wait_url "http://127.0.0.1:3201/api/health" 40
  wait_url "http://127.0.0.1:3500/api/system/health" 40
  wait_url "http://127.0.0.1:4000/api/health" 60
  wait_url "http://127.0.0.1:3600/health" 40
  wait_url "http://127.0.0.1:3110/api/integrations/health" 60
  log "health wait complete"
}

ACTION="${1:-start}"
case "$ACTION" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  wait-health) cmd_wait_health ;;
  restart) cmd_stop; sleep 2; cmd_start ;;
  *)
    echo "Usage: $0 {start|stop|status|wait-health|restart}"
    exit 1
    ;;
esac
