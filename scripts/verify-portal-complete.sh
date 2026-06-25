#!/usr/bin/env bash
# Full portal verification: API functional matrix + Playwright UI flows + route-smoke.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

export BASE_URL="${BASE_URL:-http://localhost:3100}"
export MAIL_OAUTH_BASE_URL="${MAIL_OAUTH_BASE_URL:-http://localhost:3010}"

echo "=== 1/3 API + page functional matrix ==="
node scripts/verify-portal-all-pages-functional.mjs

echo ""
echo "=== 2/3 Route smoke ==="
./scripts/route-smoke.sh

echo ""
echo "=== 3/3 Playwright full portal E2E ==="
pnpm exec playwright test tests/playwright/portal-full-functional.spec.ts

echo ""
echo "PASS: portal complete verification"
