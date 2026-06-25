#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="${OPENKB_WORKDIR:-${ROOT_DIR}/knowledge}"

if ! command -v openkb >/dev/null 2>&1; then
  echo "openkb CLI is not installed." >&2
  echo "Install it with: pip install openkb" >&2
  exit 1
fi

mkdir -p "${WORKDIR}/raw" "${WORKDIR}/wiki"
cd "${WORKDIR}"

if [[ -d ".openkb" ]]; then
  echo "[openkb-init] OpenKB is already initialized in ${WORKDIR}"
  echo "[openkb-init] Obsidian vault: ${WORKDIR}/wiki"
  exit 0
fi

echo "[openkb-init] initializing OpenKB in ${WORKDIR}"
openkb init
echo "[openkb-init] Obsidian vault: ${WORKDIR}/wiki"
