#!/usr/bin/env bash
# Purpose: Bring the full local stack up after a reboot (launchd RunAtLoad).
# Order matters: Docker daemon -> production containers (they restart themselves)
# -> dev stack (:3101/:3200).
set -uo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
bash "$ROOT/scripts/dev-up.sh" || log "dev-up reported a problem"

# The production stack is the Docker one; its containers carry
# restart: unless-stopped, so starting the daemon above is enough to bring them
# back. main-fork/scripts/prod-local.sh used to be started here as a second
# "prod" stack from a recovery-branch worktree: it competed for :3200 with the
# dev api, and when that worktree was later moved its processes survived as
# orphans holding the port with a deleted working directory. Nothing starts it
# now.
log "done. production behind Caddy :80/:443 (docker restart policy) / web dev :3101 / api dev :3200"
