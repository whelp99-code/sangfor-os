#!/usr/bin/env bash
set -euo pipefail

# External projects — override via env; default under $HOME (was a hardcoded
# /Users/jmpark/... path).
AIOS_DIR="${AIOS_V1_DIR:-$HOME/Playground/AIOS v1}"
MAIL_DIR="${MAIL_INTELLIGENCE_DIR:-$HOME/Playground/apps/mail-intelligence}"
LOG_DIR="${AIOS_DIR}/.launcher-logs"

mkdir -p "${LOG_DIR}"
cd "${AIOS_DIR}"

log() {
  printf '[AIOS Launcher] %s\n' "$*"
}

wait_for_docker() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  log "Docker is not ready. Opening Docker Desktop..."
  open -a Docker || true

  for _ in {1..90}; do
    if docker info >/dev/null 2>&1; then
      log "Docker is ready."
      return 0
    fi
    sleep 2
  done

  log "Docker did not become ready in time."
  log "Please start Docker Desktop, then run this launcher again."
  exit 1
}

run_step() {
  log "$*"
  "$@"
}

wait_for_docker

run_step docker compose -f docker-compose.yml -f docker-compose.knowledge.yml up -d postgres redis lightrag

if [[ ! -d node_modules ]]; then
  run_step pnpm install
fi

run_step pnpm db:generate

if [[ -d "${MAIL_DIR}" && -f "${MAIL_DIR}/package.json" && ! -d "${MAIL_DIR}/node_modules" ]]; then
  log "Installing Mail Intelligence dependencies..."
  (cd "${MAIL_DIR}" && pnpm install)
fi

log "Starting AIOS web dev server in a new Terminal window..."
osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "cd '${AIOS_DIR}' && echo 'Starting AIOS v1 web server...' && PORT=10100 pnpm dev"
end tell
APPLESCRIPT

if [[ -d "${MAIL_DIR}" && -f "${MAIL_DIR}/package.json" ]]; then
  log "Starting standalone Mail Intelligence in a new Terminal window..."
  osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "cd '${MAIL_DIR}' && echo 'Starting standalone Mail Intelligence...' && pnpm dev"
end tell
APPLESCRIPT
fi

log "Opening AIOS portal..."
sleep 3
open "http://localhost:10100" || true

log "Done."
log "Useful URLs:"
log "- AIOS web: http://localhost:10100"
log "- LightRAG: http://localhost:9621"
log "- Mail Intelligence: check its Terminal window for the bound port"
