#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

missing=0
for var in DATABASE_URL REDIS_URL; do
  if [[ -z "${!var:-}" ]]; then
    if [[ -f .env ]]; then
      # shellcheck disable=SC1091
      set -a && source .env && set +a
    fi
  fi
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required env: $var (copy .env.example to .env)"
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

echo "Environment OK: DATABASE_URL and REDIS_URL are set."
