#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRAPHIFY_OUT="${GRAPHIFY_OUT:-${ROOT_DIR}/knowledge/graphify-out}"
GRAPH_PATH="${GRAPHIFY_OUT}/graph.json"
if [[ "${1:-}" == "--" ]]; then
  shift
fi
QUESTION="$*"

if [[ -z "${QUESTION}" ]]; then
  echo "Usage: pnpm knowledge:codegraph:query -- \"question\"" >&2
  exit 1
fi

if ! command -v graphify >/dev/null 2>&1; then
  echo "graphify CLI is not installed." >&2
  echo "Install it with: uv tool install graphifyy" >&2
  exit 1
fi

if [[ ! -f "${GRAPH_PATH}" ]]; then
  echo "Graphify graph not found: ${GRAPH_PATH}" >&2
  echo "Run: pnpm knowledge:codegraph:build" >&2
  exit 1
fi

cd "${ROOT_DIR}"
graphify query "${QUESTION}" --graph "${GRAPH_PATH}"
