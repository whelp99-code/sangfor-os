#!/usr/bin/env bash
# Purpose: Phase 11 staging connector gate.
# Verifies that external connectors are either explicitly mock-safe or have
# the credentials and rate limits required before a staging/beta cut.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

mode="${CONNECTOR_STAGING_MODE:-mock}"
rate_limit="${CONNECTOR_RATE_LIMIT_PER_MINUTE:-60}"
timeout_ms="${CONNECTOR_TIMEOUT_MS:-10000}"

fail=0

case "$mode" in
  mock|real) ;;
  *)
    echo "CONNECTOR_STAGING_MODE must be mock or real; got: $mode"
    fail=1
    ;;
esac

if ! [[ "$rate_limit" =~ ^[0-9]+$ ]] || [[ "$rate_limit" -lt 1 || "$rate_limit" -gt 600 ]]; then
  echo "CONNECTOR_RATE_LIMIT_PER_MINUTE must be an integer between 1 and 600; got: $rate_limit"
  fail=1
fi

if ! [[ "$timeout_ms" =~ ^[0-9]+$ ]] || [[ "$timeout_ms" -lt 1000 || "$timeout_ms" -gt 60000 ]]; then
  echo "CONNECTOR_TIMEOUT_MS must be an integer between 1000 and 60000; got: $timeout_ms"
  fail=1
fi

required_real_vars=(
  GITHUB_TOKEN
  OPENAI_API_KEY
  NOTION_API_KEY
  OUTLOOK_CLIENT_ID
  OUTLOOK_CLIENT_SECRET
  OUTLOOK_TENANT_ID
)

if [[ "$mode" == "real" ]]; then
  for var in "${required_real_vars[@]}"; do
    if [[ -z "${!var:-}" ]]; then
      echo "Missing required real connector env: $var"
      fail=1
    fi
  done
else
  echo "Connector mode: mock-safe. Real connector credentials are not required for CI/local beta checks."
fi

if [[ "$fail" -ne 0 ]]; then
  echo "Staging connector gate failed."
  exit 1
fi

echo "Staging connector gate passed: mode=$mode, rate_limit_per_minute=$rate_limit, timeout_ms=$timeout_ms"
