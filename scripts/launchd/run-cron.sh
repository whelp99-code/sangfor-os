#!/usr/bin/env bash
# Wrapper launchd uses to invoke cron-call.mjs.
#
# launchd jobs start with a minimal PATH and no nvm, so resolve both `docker`
# and a Node binary explicitly. Prefer the Node 20 line the repo pins (.nvmrc)
# and fall back to whatever `node` is on PATH.
set -uo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v20.*/bin/node 2>/dev/null | tail -1)"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node || true)"
[ -x "$NODE_BIN" ] || { echo "cron: no node binary found" >&2; exit 69; }

command -v docker >/dev/null || { echo "cron: docker not on PATH" >&2; exit 69; }

exec "$NODE_BIN" "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-call.mjs" "$@"
