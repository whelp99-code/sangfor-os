#!/usr/bin/env bash
# U007 — strict delegator to detached release mirror (u007-release).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 ]]; then
  echo "usage: run-all-checks.sh <outer-args... via run-detached-release-mirror>" >&2
  echo "required outer args are validated by run-detached-release-mirror (exit 64 if missing)" >&2
  exit 64
fi

exec bash scripts/run-workspace-runtime.sh root -- node scripts/run-detached-release-mirror.mjs --mode u007-release "$@"
