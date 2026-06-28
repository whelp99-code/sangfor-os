#!/bin/sh
# Start the workflow operator console (port 3500) on the host.
#
# Why host instead of docker: the container build pulls in
# `@sangfor/chrome` via a file: link that points outside the build
# context (../sangfor-engineer-mcp/...), so the image cannot build.
# The console app itself does not use that package, so running it on the
# host (where the sibling dir resolves) is the simplest durable path.
#
# For a real MCP connection (not stub), set SANGFOR_MCP_CWD in .env to this
# repo's services/sangfor-engineer-mcp and make sure that workspace has been
# provisioned: `pnpm install` + `pnpm exec prisma generate`.
#
# Usage:  ./start-console.sh        # start (restarts if already running)
#         ./start-console.sh stop   # stop
set -e

PORT=3500
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="${TMPDIR:-/tmp}/sangfor-workflow-${PORT}.log"

stop() {
  pid="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    echo "[start-console] stopping existing pid(s): $pid"
    kill $pid 2>/dev/null || true
    sleep 1
  fi
}

if [ "$1" = "stop" ]; then
  stop
  echo "[start-console] stopped"
  exit 0
fi

stop
cd "$DIR"
echo "[start-console] launching on :${PORT} (log: ${LOG})"
PORT=${PORT} nohup pnpm dev:web > "$LOG" 2>&1 &
echo "[start-console] pid $!"

# Wait for health (boot includes a one-time MCP connect that may time out → stub)
i=0
while [ $i -lt 45 ]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:${PORT}/api/system/health" || true)"
  if [ "$code" = "200" ]; then
    echo "[start-console] healthy on http://localhost:${PORT} (200)"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done
echo "[start-console] WARN: not healthy after 45s — check ${LOG}"
exit 1
