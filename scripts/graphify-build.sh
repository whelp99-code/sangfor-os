#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRAPHIFY_OUT="${GRAPHIFY_OUT:-${ROOT_DIR}/knowledge/graphify-out}"
GRAPHIFY_PARENT="$(dirname "${GRAPHIFY_OUT}")"

if ! command -v graphify >/dev/null 2>&1; then
  echo "graphify CLI is not installed." >&2
  echo "Install it with: uv tool install graphifyy" >&2
  exit 1
fi

mkdir -p "${GRAPHIFY_PARENT}"
cd "${ROOT_DIR}"

echo "[graphify-build] building AIOS code graph"
echo "[graphify-build] output: ${GRAPHIFY_OUT}"
GRAPHIFY_OUT="${GRAPHIFY_OUT}" graphify extract "${ROOT_DIR}" --out "${GRAPHIFY_PARENT}" --no-viz
