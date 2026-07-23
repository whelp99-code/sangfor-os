#!/usr/bin/env bash
# Isolated UX-test stack for real-usage QA loops. The selected profile must be
# explicit and local to this worktree; this script never borrows another tree's secrets.
# Usage: UXTEST_ENV_FILE=/absolute/path/inside/this/worktree/.env.uxtest scripts/uxtest-stack.sh {preflight|start|stop|restart|status|logs}
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/.local-uxtest"
mkdir -p "$STATE"

WEB_PORT="${WEB_PORT:-3110}"
API_PORT_FORCE="${API_PORT:-3230}"
API_PORT="$API_PORT_FORCE"
UXTEST_DB="${UXTEST_DB:-sangfor_os_uxtest_r20}"

load_env() {
  local env_profile="${UXTEST_ENV_FILE:-}"
  if [ -z "$env_profile" ]; then
    echo "UXTEST_CONFIG_MISSING: set UXTEST_ENV_FILE to an explicit profile under this worktree" >&2
    return 64
  fi
  case "$env_profile" in
    "$ROOT"/*) ;;
    *) echo "UXTEST_CONFIG_MISSING: UXTEST_ENV_FILE must be under the current worktree" >&2; return 64 ;;
  esac
  if [ ! -f "$env_profile" ]; then
    echo "UXTEST_CONFIG_MISSING: selected UXTEST_ENV_FILE does not exist" >&2
    return 64
  fi

  set -a
  # shellcheck disable=SC1090
  source "$env_profile"
  set +a

  local key missing=""
  for key in DATABASE_URL JWT_SECRET AUTH_DEMO_PASSWORD FINANCE_API_KEY; do
    if [ -z "${!key:-}" ]; then
      missing="${missing}${missing:+,}${key}"
    fi
  done
  if [ -n "$missing" ]; then
    echo "UXTEST_CONFIG_MISSING: ${missing}" >&2
    return 64
  fi

  local pw
  pw="$(printf '%s' "$DATABASE_URL" | sed -E 's/.*:\/\/sangfor:([^@]+)@.*/\1/')"
  if [ -z "$pw" ] || [ "$pw" = "$DATABASE_URL" ]; then
    echo "UXTEST_CONFIG_MISSING: DATABASE_URL must contain the local sangfor credential" >&2
    return 64
  fi

  export DATABASE_URL="postgresql://sangfor:$pw@localhost:5434/$UXTEST_DB?schema=public"
  export REDIS_URL="redis://localhost:6380/15"
  export API_PORT="$API_PORT_FORCE"
  export FINANCE_API_URL="http://localhost:$API_PORT/api/cfo"
  export SENTRY_ENVIRONMENT="uxtest"
  export NEXT_DIST_DIR=".next-uxtest-r20"
  unset AUTH_BYPASS_ENABLED
}

preflight() {
  load_env || return $?
  echo "[uxtest] preflight passed for ${UXTEST_ENV_FILE:-} (no processes started)"
}

pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

start_api() {
  if pid_alive "$STATE/api.pid"; then echo "[api] already running (pid $(cat "$STATE/api.pid"))"; return; fi
  (cd "$ROOT/apps/api" && load_env && nohup npx tsx src/index.ts >> "$STATE/api.log" 2>&1 & echo $! > "$STATE/api.pid")
  echo "[api] started on :$API_PORT (pid $(cat "$STATE/api.pid"))"
}

start_web() {
  if pid_alive "$STATE/web.pid"; then echo "[web] already running (pid $(cat "$STATE/web.pid"))"; return; fi
  (cd "$ROOT/apps/web" && load_env && ulimit -n 65536 && nohup npx next start -p "$WEB_PORT" >> "$STATE/web.log" 2>&1 & echo $! > "$STATE/web.pid")
  echo "[web] started on :$WEB_PORT (pid $(cat "$STATE/web.pid"))"
}

stop_one() {
  local name="$1" pidfile="$STATE/$1.pid" port
  case "$name" in web) port="$WEB_PORT" ;; api) port="$API_PORT" ;; esac
  if pid_alive "$pidfile"; then
    kill "$(cat "$pidfile")" 2>/dev/null || true; sleep 1
    pid_alive "$pidfile" && kill -9 "$(cat "$pidfile")" 2>/dev/null || true
  fi
  local leftover; leftover="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
  [ -n "$leftover" ] && echo "$leftover" | xargs kill -9 2>/dev/null || true
  echo "[$name] stopped"; rm -f "$pidfile"
}

status() {
  for name in api web; do
    if pid_alive "$STATE/$name.pid"; then echo "[$name] running (pid $(cat "$STATE/$name.pid"))"; else echo "[$name] stopped"; fi
  done
  curl -s -o /dev/null -w "[web] http://localhost:$WEB_PORT -> %{http_code}\n" "http://localhost:$WEB_PORT/login" --max-time 5 || true
  curl -s -o /dev/null -w "[api] http://localhost:$API_PORT/health -> %{http_code}\n" "http://localhost:$API_PORT/health" --max-time 5 || true
}

case "${1:-}" in
  preflight) preflight ;;
  start) preflight || exit $?; start_api || exit $?; start_web || exit $?; sleep 3; status; echo; echo "UXTEST 포털: http://localhost:$WEB_PORT (DB: $UXTEST_DB)" ;;
  stop) stop_one web; stop_one api ;;
  restart) preflight || exit $?; stop_one web || exit $?; stop_one api || exit $?; start_api || exit $?; start_web || exit $?; sleep 3; status ;;
  status) status ;;
  logs) tail -n 40 -f "$STATE/web.log" "$STATE/api.log" ;;
  *) echo "usage: $0 {preflight|start|stop|restart|status|logs}"; exit 1 ;;
esac
