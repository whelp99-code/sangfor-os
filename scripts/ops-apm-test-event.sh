#!/usr/bin/env bash
# POST staging APM test event (no secret output).
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

BASE_URL="${BASE_URL:-http://localhost:3100}"
resp="$(curl -sf -X POST "${BASE_URL}/api/ops/apm-test" -H 'Content-Type: application/json' 2>/dev/null || true)"

if [[ -z "$resp" ]]; then
  echo "FAIL: cannot reach ${BASE_URL}/api/ops/apm-test (is web running on BASE_URL?)"
  exit 1
fi

ok="$(node -e "const d=JSON.parse(process.argv[1]); console.log(d.ok===true?1:0)" "$resp" 2>/dev/null || echo 0)"
event_id="$(node -e "const d=JSON.parse(process.argv[1]); console.log(d.eventId||'')" "$resp" 2>/dev/null || echo "")"
issue_hint="$(node -e "const d=JSON.parse(process.argv[1]); console.log(d.issueUrlHint||'')" "$resp" 2>/dev/null || echo "")"
reason="$(node -e "const d=JSON.parse(process.argv[1]); console.log(d.reason||'')" "$resp" 2>/dev/null || echo "")"

if [[ "$ok" != "1" ]]; then
  echo "FAIL: apm-test route returned not ok (reason=${reason:-unknown})"
  echo "Ensure SENTRY_DSN, SENTRY_ENVIRONMENT=staging, APM_TEST_ROUTE_ENABLED=1 in .env"
  exit 1
fi

echo "PASS: APM test event sent"
echo "eventId: ${event_id:-<none>}"
if [[ -n "$issue_hint" ]]; then
  echo "issueUrlHint: ${issue_hint}"
fi
