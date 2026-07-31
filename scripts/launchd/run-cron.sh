#!/usr/bin/env bash
# Wrapper launchd uses to invoke a repo script.
#
# launchd jobs start with a minimal PATH and no nvm, so resolve both `docker` and
# a Node binary explicitly. Prefer the Node 20 line the repo pins (.nvmrc) and
# fall back to whatever `node` is on PATH.
#
# Usage: run-cron.sh <script-path-relative-to-repo-root> [args...]
#
# The script path is an argument rather than hardcoded so the scheduled jobs that
# call an HTTP endpoint and the one that checks the stack's health share a single
# wrapper — duplicating this resolution is how the two would drift apart.
set -uo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_REL="${1:-}"
[ -n "$SCRIPT_REL" ] || { echo "cron: no script given" >&2; exit 64; }
shift
SCRIPT_ABS="$REPO_ROOT/$SCRIPT_REL"
[ -f "$SCRIPT_ABS" ] || { echo "cron: script not found: $SCRIPT_ABS" >&2; exit 66; }

NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v20.*/bin/node 2>/dev/null | tail -1)"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node || true)"
[ -x "$NODE_BIN" ] || { echo "cron: no node binary found" >&2; exit 69; }

command -v docker >/dev/null || { echo "cron: docker not on PATH" >&2; exit 69; }

exec "$NODE_BIN" "$SCRIPT_ABS" "$@"
