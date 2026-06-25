#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[[ -f .env ]] && set -a && source .env && set +a
[[ -f .env.local ]] && set -a && source .env.local && set +a

export CI_INTEGRATION="${CI_INTEGRATION:-1}"
BASE_URL="${BASE_URL:-http://localhost:3100}"
soft_mode=0
for arg in "$@"; do
  if [[ "$arg" == "--soft" ]]; then
    soft_mode=1
  fi
done

echo "=== Running Release Hardening Environmental Checks ==="
if [[ "$soft_mode" -eq 1 ]]; then
  bash ./scripts/check-release-env.sh --soft
else
  bash ./scripts/check-release-env.sh
fi
echo ""

echo "=== Running APM Readiness Checks ==="
if [[ "$soft_mode" -eq 1 ]]; then
  bash ./scripts/check-apm-readiness.sh --soft
else
  bash ./scripts/check-apm-readiness.sh --strict
fi
echo ""

if [[ -n "${MAIL_OAUTH_BASE_URL:-}" ]]; then
  echo "=== Running Mail OAuth Status Check ==="
  if [[ "$soft_mode" -eq 1 ]]; then
    bash ./scripts/check-mail-oauth.sh --soft
  else
    bash ./scripts/check-mail-oauth.sh
  fi
  echo ""
else
  echo "Skipping mail OAuth check; set MAIL_OAUTH_BASE_URL to enable it."
  echo ""
fi

echo "=== Running Database Restore Counts Checks ==="
if [[ -n "${DATABASE_URL:-}" ]]; then
  if [[ "$soft_mode" -eq 1 ]]; then
    bash ./scripts/check-restore-counts.sh || echo "Warning: check-restore-counts.sh execution failed (DB might be offline)."
  else
    bash ./scripts/check-restore-counts.sh
  fi
else
  echo "Skipping check-restore-counts.sh (DATABASE_URL is not set)."
fi
echo ""

echo "=== Running Standard Codebase Verification ==="
pnpm lint
CI_INTEGRATION=1 pnpm test
pnpm build

if command -v curl >/dev/null 2>&1 && curl -sf "${BASE_URL}/api/health" >/dev/null 2>&1; then
  echo "Health endpoint OK (dev server appears to be running)."
else
  echo "Skipping /api/health curl (start pnpm dev to verify manually, BASE_URL=${BASE_URL})."
fi

echo "All checks passed."
