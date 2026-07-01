#!/usr/bin/env bash
# dev-down.sh — stop the local api + web dev servers started by dev-up.sh.
# Leaves postgres running (data persists); pass --db to also stop the container.
set -euo pipefail
API_PORT="${API_PORT:-3200}"
WEB_PORT="${WEB_PORT:-3101}"
for p in "$API_PORT" "$WEB_PORT"; do
  pid="$(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "$pid" ]] && { kill "$pid" 2>/dev/null || true; echo "[dev-down] stopped :$p (pid $pid)"; }
done
if [[ "${1:-}" == "--db" ]]; then
  docker compose stop postgres >/dev/null 2>&1 && echo "[dev-down] postgres stopped (data kept; 'docker compose down -v' to wipe)"
fi
