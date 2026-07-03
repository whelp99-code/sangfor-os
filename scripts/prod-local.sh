#!/usr/bin/env bash
# Local single-user production runner for SANGFOR Partner OS.
# Usage: scripts/prod-local.sh {start|stop|restart|status|logs} [--build]
#
# Runs the production builds of apps/web (next start) and apps/api
# (node dist) with env from the repo root .env. State lives in .local-prod/
# (pids + logs), which is gitignored.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/.local-prod"
mkdir -p "$STATE"

WEB_PORT="${WEB_PORT:-3100}"
API_PORT="${API_PORT:-3210}"

load_env() {
  set -a
  # shellcheck disable=SC1091
  [ -f "$ROOT/.env" ] && source "$ROOT/.env"
  set +a
  export API_PORT
  export FINANCE_API_URL="${FINANCE_API_URL:-http://localhost:$API_PORT/api/cfo}"
}

pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

build_all() {
  echo "[build] apps/api + apps/web (takes a few minutes)"
  (cd "$ROOT" && pnpm --filter "./packages/**" build)
  (cd "$ROOT/apps/api" && pnpm build)
  (cd "$ROOT/apps/web" && pnpm build)
}

start_api() {
  if pid_alive "$STATE/api.pid"; then echo "[api] already running (pid $(cat "$STATE/api.pid"))"; return; fi
  (cd "$ROOT/apps/api" && load_env && nohup node dist/index.js >> "$STATE/api.log" 2>&1 & echo $! > "$STATE/api.pid")
  echo "[api] started on :$API_PORT (pid $(cat "$STATE/api.pid"))"
}

start_web() {
  if pid_alive "$STATE/web.pid"; then echo "[web] already running (pid $(cat "$STATE/web.pid"))"; return; fi
  (cd "$ROOT/apps/web" && load_env && ulimit -n 65536 && nohup npx next start -p "$WEB_PORT" >> "$STATE/web.log" 2>&1 & echo $! > "$STATE/web.pid")
  echo "[web] started on :$WEB_PORT (pid $(cat "$STATE/web.pid"))"
}

stop_one() {
  local name="$1" pidfile="$STATE/$1.pid"
  if pid_alive "$pidfile"; then
    kill "$(cat "$pidfile")" 2>/dev/null || true
    sleep 1
    pid_alive "$pidfile" && kill -9 "$(cat "$pidfile")" 2>/dev/null || true
    echo "[$name] stopped"
  else
    echo "[$name] not running"
  fi
  rm -f "$pidfile"
}

status() {
  for name in api web; do
    if pid_alive "$STATE/$name.pid"; then
      echo "[$name] running (pid $(cat "$STATE/$name.pid"))"
    else
      echo "[$name] stopped"
    fi
  done
  curl -s -o /dev/null -w "[web] http://localhost:$WEB_PORT -> %{http_code}\n" "http://localhost:$WEB_PORT/login" --max-time 5 || true
  curl -s -o /dev/null -w "[api] http://localhost:$API_PORT/health -> %{http_code}\n" "http://localhost:$API_PORT/health" --max-time 5 || true
}

case "${1:-}" in
  start)
    [ "${2:-}" = "--build" ] && build_all
    start_api
    start_web
    sleep 3
    status
    echo
    echo "포털: http://localhost:$WEB_PORT  (로그인: .env의 AUTH_DEMO_PASSWORD)"
    ;;
  stop) stop_one web; stop_one api ;;
  restart) stop_one web; stop_one api; [ "${2:-}" = "--build" ] && build_all; start_api; start_web; sleep 3; status ;;
  status) status ;;
  logs) tail -n 40 -f "$STATE/web.log" "$STATE/api.log" ;;
  *) echo "usage: $0 {start|stop|restart|status|logs} [--build]"; exit 1 ;;
esac
