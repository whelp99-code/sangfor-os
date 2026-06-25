#!/usr/bin/env bash
# Purpose: APM (Sentry) readiness validator.
# Validates that APM credentials exist without exposing them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi
if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a && source .env.local && set +a
fi

strict=0
for arg in "$@"; do
  if [[ "$arg" == "--strict" ]]; then
    strict=1
  fi
done

fail=0

check_apm() {
  local sentry_dsn="${SENTRY_DSN:-}"
  local next_public_sentry_dsn="${NEXT_PUBLIC_SENTRY_DSN:-}"
  local sentry_environment="${SENTRY_ENVIRONMENT:-}"
  local sentry_traces_sample_rate="${SENTRY_TRACES_SAMPLE_RATE:-}"
  local langfuse_base="${LANGFUSE_BASE_URL:-}"
  local apm_configured=0

  if [[ -n "$sentry_dsn" || -n "$next_public_sentry_dsn" ]]; then
    apm_configured=1
    echo "APM configuration (Sentry): CONFIGURED"
    [[ -n "$sentry_dsn" ]] && echo "SENTRY_DSN: SET (value hidden)"
    [[ -n "$next_public_sentry_dsn" ]] && echo "NEXT_PUBLIC_SENTRY_DSN: SET (value hidden)"
    [[ -n "$sentry_environment" ]] && echo "SENTRY_ENVIRONMENT: SET ($sentry_environment)" || echo "SENTRY_ENVIRONMENT: UNSET"
    [[ -n "$sentry_traces_sample_rate" ]] && echo "SENTRY_TRACES_SAMPLE_RATE: SET (value hidden)" || echo "SENTRY_TRACES_SAMPLE_RATE: UNSET optional"
  else
    echo "APM configuration (Sentry): OPTIONAL NOT CONFIGURED"
    echo "SENTRY_DSN: UNSET"
    echo "NEXT_PUBLIC_SENTRY_DSN: UNSET"
  fi

  if [[ -n "$langfuse_base" ]]; then
    apm_configured=1
    echo "LANGFUSE_BASE_URL: SET"
  else
    echo "LANGFUSE_BASE_URL: UNSET optional"
  fi

  if [[ "$strict" -eq 1 && "$apm_configured" -eq 0 ]]; then
    fail=1
  fi
}

echo "=== APM Readiness Check ==="
check_apm
echo "---------------------------"
echo "Instructions to send a test error event (Next.js client/server):"
echo "1. Run Sentry SDK error trigger in developer console or a dev API:"
echo "   Sentry.captureException(new Error('Staging APM validation check event'))"
echo "2. Check APM dashboard environment 'staging' to verify receipt and record event URL/ID."
echo "==========================="

if [[ "$fail" -ne 0 ]]; then
  echo "APM strict mode validation failed (missing SENTRY_DSN)."
  exit 1
fi

exit 0
