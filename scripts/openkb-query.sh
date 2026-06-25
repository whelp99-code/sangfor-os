#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="${OPENKB_WORKDIR:-${ROOT_DIR}/knowledge}"
if [[ "${1:-}" == "--" ]]; then
  shift
fi
QUESTION="$*"

if [[ -z "${QUESTION}" ]]; then
  echo "Usage: pnpm knowledge:wiki:query -- \"question\"" >&2
  exit 1
fi

if ! command -v openkb >/dev/null 2>&1; then
  echo "openkb CLI is not installed." >&2
  echo "Install it with: pip install openkb" >&2
  exit 1
fi

if [[ ! -d "${WORKDIR}/.openkb" ]]; then
  echo "OpenKB is not initialized in ${WORKDIR}." >&2
  echo "Run: pnpm knowledge:wiki:init" >&2
  exit 1
fi

cd "${WORKDIR}"
openkb query "${QUESTION}"
