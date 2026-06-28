#!/bin/bash
set -u

FAILED=0
API_BASE="${API_URL:-http://localhost:3200}"
WEB_BASE="${WEB_URL:-http://localhost:3101}"
FINANCE_BASE="${FINANCE_URL:-http://localhost:4100}"

check_required() {
  local name="$1" url="$2" expected="$3"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)
  if [[ ",$expected," == *",$status,"* ]]; then
    echo "✅ required: $name ($status)"
  else
    echo "❌ required: $name (expected $expected, got ${status:-000})"
    FAILED=1
  fi
}

check_optional() {
  local name="$1" url="$2" expected="$3"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)
  if [ "$status" = "$expected" ]; then
    echo "✅ optional: $name ($status)"
  else
    echo "⚠️ optional: $name unavailable (expected $expected, got ${status:-000})"
  fi
}

echo "=== sangfor-os W1-W2 Health Check ==="
echo "web=$WEB_BASE"
echo "api=$API_BASE"
echo "finance=$FINANCE_BASE"
echo ""

check_required "Web Home" "$WEB_BASE/" 200,307
check_required "Web Operator" "$WEB_BASE/operator" 200
check_required "Web Security" "$WEB_BASE/security" 200
check_required "Web Mail Candidates API" "$WEB_BASE/api/mail-candidates?limit=1" 200

check_optional "API Health" "$API_BASE/health" 200
check_optional "Finance Health" "$FINANCE_BASE/health" 200
check_optional "Web Unified Health" "$WEB_BASE/api/unified-health" 200

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "✅ Required checks passed"
else
  echo "❌ Required checks failed"
fi
exit "$FAILED"
