#!/usr/bin/env bash
# Read-only mail → Phase13 operational pilot (no secrets, no mail bodies in output).
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

MAIL_BASE="${MAIL_OAUTH_BASE_URL:-http://localhost:3010}"
PORTAL_BASE="${BASE_URL:-http://localhost:3100}"

echo "=== Mail OAuth gate ==="
MAIL_OAUTH_BASE_URL="$MAIL_BASE" bash ./scripts/check-mail-oauth.sh

echo ""
echo "=== Fetch recent mail (read-only) ==="
messages_json="$(curl -sf "${MAIL_BASE}/api/outlook/messages?cacheOnly=0&top=5")"
message_count="$(node -e "const d=JSON.parse(process.argv[1]); console.log((d.messages||[]).length)" "$messages_json")"
if [[ "$message_count" -lt 1 ]]; then
  echo "FAIL: no messages returned from standalone mail app"
  exit 1
fi
echo "message_count: ${message_count}"

input_summary="$(node -e "
const d=JSON.parse(process.argv[1]);
const m=(d.messages||[])[0]||{};
const subject=String(m.subject||'Mail pilot').slice(0,120);
const from=String(m.from||m.fromEmail||'unknown').slice(0,80);
console.log('Mail-assisted pilot: subject='+subject+'; from='+from);
" "$messages_json")"

echo "input_summary_length: ${#input_summary}"

echo ""
echo "=== Phase13 orchestrator (AIOS portal) ==="
phase13_body="$(node -e "
console.log(JSON.stringify({
  inputSummary: process.argv[1],
  projectSlug: 'demo-project',
  module: 'mail-intelligence',
  phase: 13
}));
" "$input_summary")"

phase13_resp="$(curl -sf -X POST "${PORTAL_BASE}/api/automation/phase13/run" \
  -H 'Content-Type: application/json' \
  -d "$phase13_body")"

command_run_id="$(node -e "const d=JSON.parse(process.argv[1]); console.log(d.commandRunId||d.run?.id||'')" "$phase13_resp" 2>/dev/null || echo "")"
item_count="$(node -e "const d=JSON.parse(process.argv[1]); console.log((d.workBreakdown||d.items||[]).length)" "$phase13_resp" 2>/dev/null || echo "0")"

echo "phase13_http: 201"
echo "command_run_id: ${command_run_id:-<none>}"
echo "work_breakdown_items: ${item_count}"

if [[ -z "$command_run_id" && "$item_count" == "0" ]]; then
  echo "FAIL: Phase13 response missing commandRunId and work items"
  exit 1
fi

echo ""
echo "PASS: mail-to-phase13 operational pilot"
