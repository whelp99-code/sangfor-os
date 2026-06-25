#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="${OPENKB_WORKDIR:-${ROOT_DIR}/knowledge}"
RAW_DIR="${WORKDIR}/raw"

if ! command -v openkb >/dev/null 2>&1; then
  echo "openkb CLI is not installed." >&2
  echo "Install it with: pip install openkb" >&2
  exit 1
fi

mkdir -p "${RAW_DIR}" "${WORKDIR}/wiki"

if [[ ! -d "${WORKDIR}/.openkb" ]]; then
  echo "OpenKB is not initialized in ${WORKDIR}." >&2
  echo "Run: pnpm knowledge:wiki:init" >&2
  exit 1
fi

if ! find "${RAW_DIR}" -mindepth 1 -print -quit | grep -q .; then
  echo "[openkb-add-raw] No files found in ${RAW_DIR}; nothing to add."
  exit 0
fi

cd "${WORKDIR}"
echo "[openkb-add-raw] adding raw documents from ${RAW_DIR}"
openkb add raw
echo "[openkb-add-raw] wiki output: ${WORKDIR}/wiki"
