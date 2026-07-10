#!/usr/bin/env bash
# Purpose: Bring the full local stack up after a reboot (launchd RunAtLoad).
# Order matters: Docker daemon -> postgres -> dev stack (:3101/:3200) -> main-fork prod (:3100/:3210).
set -uo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN_FORK="$HOME/orca/workspaces/sangfor-os/main-fork"
log() { printf '[boot-stack %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

if ! docker info >/dev/null 2>&1; then
  log "starting Docker Desktop…"
  open -a Docker || true
  for _ in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 5
  done
fi
docker info >/dev/null 2>&1 || { log "docker daemon unavailable — aborting"; exit 1; }

log "starting dev stack (postgres + api + web)…"
bash "$ROOT/scripts/dev-up.sh" || log "dev-up reported a problem (continuing to prod)"

if [ -d "$MAIN_FORK" ]; then
  log "starting main-fork prod stack…"
  bash "$MAIN_FORK/scripts/prod-local.sh" start || log "prod-local start reported a problem"
fi

log "done. web dev :3101 / api dev :3200 / prod :3100 / prod api :3210"
