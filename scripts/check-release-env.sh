#!/usr/bin/env bash
# Purpose: Phase 11/12 final release environment validation.
# Checks existence and length of environment variables without printing their secret values.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

strict=1
for arg in "$@"; do
  if [[ "$arg" == "--soft" ]]; then
    strict=0
  fi
done

fail=0

# Helper to check required environment variable
check_required() {
  local var="$1"
  local val="${!var:-}"
  if [[ -z "$val" ]]; then
    echo "$var: MISSING required"
    fail=1
  else
    echo "$var: SET"
  fi
}

# Helper to check secret with length requirement
check_secret() {
  local var="$1"
  local min_len="$2"
  local required_for_final="$3"
  local val="${!var:-}"
  
  if [[ -z "$val" ]]; then
    if [[ "$required_for_final" == "true" ]]; then
      echo "$var: MISSING required"
      fail=1
    else
      echo "$var: UNSET optional"
    fi
  else
    local len=${#val}
    if [[ "$len" -lt "$min_len" ]]; then
      echo "$var: SET invalid (len=$len < $min_len)"
      fail=1
    else
      echo "$var: SET len>=$min_len"
    fi
  fi
}

# Helper to check optional variable
check_optional() {
  local var="$1"
  local val="${!var:-}"
  if [[ -z "$val" ]]; then
    echo "$var: UNSET optional"
  else
    echo "$var: SET"
  fi
}

echo "=== Release Environment Check ==="

# 1. Required core variables
check_required "DATABASE_URL"
check_required "REDIS_URL"

# 2. Required final credentials with length checks
# In --soft mode these remain advisory for local dev and won't fail the script.
if [[ "$strict" -eq 1 ]]; then
  check_secret "JWT_SECRET" 16 "true"
  check_secret "AUTH_DEMO_PASSWORD" 8 "true"
else
  check_secret "JWT_SECRET" 16 "false"
  check_secret "AUTH_DEMO_PASSWORD" 8 "false"
fi

# 3. Optional integration / staging mode variables
check_optional "CONNECTOR_STAGING_MODE"
check_optional "SENTRY_DSN"
check_optional "LANGFUSE_PUBLIC_KEY"
check_optional "LANGFUSE_SECRET_KEY"
check_optional "LANGFUSE_BASE_URL"
check_optional "OPENAI_API_KEY"
check_optional "NOTION_API_KEY"
check_optional "GITHUB_TOKEN"
check_optional "OUTLOOK_CLIENT_ID"
check_optional "OUTLOOK_CLIENT_SECRET"
check_optional "OUTLOOK_TENANT_ID"

echo "================================="

if [[ "$fail" -ne 0 ]]; then
  echo "Release environment validation failed."
  if [[ "$strict" -eq 1 ]]; then
    exit 1
  else
    echo "Strict mode disabled via --soft. Exiting with 0."
    exit 0
  fi
fi

echo "Release environment validation passed."
exit 0
