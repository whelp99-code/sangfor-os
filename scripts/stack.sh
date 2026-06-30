#!/usr/bin/env bash
# Local MCP/console runtime helper.
#
# NOTE (2026-07-01): the MCP services were EXTRACTED to standalone sibling repos.
# This script no longer builds/runs them from an in-repo services/ tree. Run the
# MCP services from their own repos; `status` here still probes their endpoints.
#
#   ~/Playground/whelp99-code-sangfor-engineer-mcp   bridge :3600 + console :3502 (+ mock :3400)
#       → start: ./start-mcp.sh        (or docker build with ./Dockerfile)
#   ~/Playground/sangfor-mcp-workflow                workflow console :3500
#       → start: docker compose up -d  (repo has its own docker-compose.yml)
#
# For the full external-aware dev stack from sangfor-os, prefer:
#   scripts/start-integration-stack.sh
#
#   scripts/stack.sh status    deep health check against the running MCP services
#   scripts/stack.sh up|down|provision   → guidance (run from the external repos)
set -euo pipefail

PLAYGROUND="${AIOS_PLAYGROUND:-$HOME/Playground}"
ENGINEER_DIR="${WHELP99_PATH:-$PLAYGROUND/whelp99-code-sangfor-engineer-mcp}"
WORKFLOW_DIR="${SANGFOR_PATH:-$PLAYGROUND/sangfor-mcp-workflow}"

# name|url|expected_http
ENDPOINTS="
bridge:3600|http://localhost:3600/health|200
console:3502|http://localhost:3502/api/health/store|200
mock:3400|http://localhost:3400/|200
workflow:3500|http://localhost:3500/api/system/health|200
"

c_green() { printf '\033[32m%s\033[0m' "$1"; }
c_red()   { printf '\033[31m%s\033[0m' "$1"; }

probe() { curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$1" 2>/dev/null || echo 000; }

guidance() {
  cat <<EOF
[stack] MCP services live in standalone repos now — run them from there:
  engineer-mcp : (cd "$ENGINEER_DIR" && ./start-mcp.sh)
  workflow     : (cd "$WORKFLOW_DIR" && docker compose up -d)
Or use the external-aware launcher: scripts/start-integration-stack.sh
EOF
}

status() {
  echo "── deep status ───────────────────────────────"
  printf '%s\n' "$ENDPOINTS" | while IFS='|' read -r name url want; do
    [ -z "$name" ] && continue
    code="$(probe "$url")"
    if [ "$code" = "$want" ]; then printf '  %s %-14s %s\n' "$(c_green ✓)" "$name" "$code"
    else printf '  %s %-14s %s\n' "$(c_red ✗)" "$name" "$code"; fi
  done
  echo "──────────────────────────────────────────────"
}

case "${1:-status}" in
  status) status ;;
  up|down|provision) guidance ;;
  *) echo "usage: scripts/stack.sh {status|up|down|provision}"; exit 2 ;;
esac
