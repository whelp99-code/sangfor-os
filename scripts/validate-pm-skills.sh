#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="${ROOT}/vendor/pm-skills"
VALIDATOR="${VENDOR}/validate_plugins.py"

if [[ ! -f "${VALIDATOR}" ]]; then
  echo "error: vendor/pm-skills submodule missing. Run: git submodule update --init --recursive" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required to validate pm-skills plugins" >&2
  exit 1
fi

echo "Validating pm-skills plugins at ${VENDOR}..."
if ! python3 "${VALIDATOR}"; then
  echo "error: pm-skills plugin validation failed" >&2
  exit 1
fi

echo "pm-skills validation passed."
