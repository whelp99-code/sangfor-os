#!/usr/bin/env bash
# dev-smoke.sh — quick HTTP smoke test of key routes against a running web+api.
# Prints one line per route; exits non-zero if any core page is not 200/307.
set -uo pipefail
WEB_PORT="${WEB_PORT:-3101}"
API_PORT="${API_PORT:-3200}"
BASE="http://localhost:$WEB_PORT"

CORE=(/home /deals /customers /projects /tasks /proposals /poc /cfo/dashboard /cfo/projects /cfo/invoices)
fail=0
echo "── web ($BASE) ──"
for p in "${CORE[@]}"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p" 2>/dev/null || echo 000)"
  mark="ok"; [[ "$code" =~ ^(200|307|302)$ ]] || { mark="FAIL"; fail=1; }
  printf '  %-4s %s  %s\n' "$code" "$p" "$mark"
done
echo "── api (:$API_PORT, dev bypass) ──"
for p in "/api/cfo/dashboard/kpi?year=$(date +%Y)&month=$(date +%-m)" "/api/cfo/dashboard/receivables"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'X-API-Key:' "http://localhost:$API_PORT$p" 2>/dev/null || echo 000)"
  printf '  %-4s %s\n' "$code" "$p"
done
[[ "$fail" == 0 ]] && echo "✅ smoke passed" || { echo "❌ smoke failed"; exit 1; }
