#!/bin/bash
# AIOSv2 Health Check Script
# Checks all critical endpoints and returns exit 0 if all healthy

FAILED=0
API_BASE="${API_URL:-http://localhost:3200}"
WEB_BASE="${WEB_URL:-http://localhost:3110}"

check() {
  local name="$1" url="$2" expected="$3"
  local status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  if [ "$status" = "$expected" ]; then
    echo "✅ $name ($status)"
  else
    echo "❌ $name (expected $expected, got $status)"
    FAILED=1
  fi
}

echo "=== AIOSv2 Health Check ==="
echo ""

check "API Health" "$API_BASE/health" 200
check "API Metrics" "$API_BASE/api/metrics" 200
check "Web Home" "$WEB_BASE/dashboard" 200
check "Web Settings" "$WEB_BASE/settings" 200
check "Web Mail" "$WEB_BASE/mail" 200
check "Web Briefing" "$WEB_BASE/briefing" 200
check "Web Ops Summary" "$WEB_BASE/api/ops/summary" 200
check "Web Settings API" "$WEB_BASE/api/settings" 200

echo ""
if [ $FAILED -eq 0 ]; then
  echo "✅ All checks passed"
else
  echo "❌ Some checks failed"
fi
exit $FAILED
