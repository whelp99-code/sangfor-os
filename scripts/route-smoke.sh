#!/usr/bin/env bash
# Purpose: Phase 11+ route smoke — verify major portal routes return non-5xx responses.
set -euo pipefail

BASE_URL="${BASE_URL:-}"
if [[ -z "${BASE_URL}" ]]; then
  for candidate in "http://localhost:3100" "http://localhost:3000"; do
    if curl --connect-timeout 2 --max-time 3 -sf "${candidate}/api/health" >/dev/null 2>&1; then
      BASE_URL="${candidate}"
      break
    fi
  done
fi

if [[ -z "${BASE_URL}" ]]; then
  echo "FAIL health check - no responsive localhost base URL found (tried 3100 and 3000)."
  exit 1
fi

# Default curl limits; Phase13 orchestrator needs live LLM (multiple skills).
ROUTE_SMOKE_MAX_TIME="${ROUTE_SMOKE_MAX_TIME:-15}"
ROUTE_SMOKE_RETRIES="${ROUTE_SMOKE_RETRIES:-2}"
PHASE13_SMOKE_MAX_TIME="${PHASE13_SMOKE_MAX_TIME:-120}"
ROUTE_SMOKE_SKIP_MUTATING="${ROUTE_SMOKE_SKIP_MUTATING:-0}"

health_ok=0
for _ in $(seq 0 "${ROUTE_SMOKE_RETRIES}"); do
  if curl --connect-timeout 2 --max-time 3 -sf "${BASE_URL}/api/health" >/dev/null 2>&1; then
    health_ok=1
    break
  fi
  sleep 2
done
if [[ "$health_ok" != "1" ]]; then
  echo "FAIL health check ${BASE_URL}/api/health"
  exit 1
fi

ROUTES=(
  "/"
  "/dashboard"
  "/customers"
  "/partners"
  "/tasks"
  "/poc"
  "/opportunities"
  "/proposals"
  "/knowledge"
  "/commands"
  "/development"
  "/development/orchestrator"
  "/development/improvements"
  "/development/codex-tasks"
  "/development/cursor-sessions"
  "/development/github"
  "/approval"
  "/approvals"
  "/validation"
  "/portal"
  "/modules"
  "/blocks"
  "/agents"
  "/tools"
  "/settings"
  "/registry"
  "/api/health"
  "/api/commands"
  "/api/customers"
  "/api/partners"
  "/api/tasks"
  "/api/poc"
  "/api/opportunities"
  "/api/knowledge"
  "/api/proposals"
  "/api/portal"
  "/api/automation/skills"
  "/api/improvements"
  "/api/modules"
  "/api/actions"
  "/api/connectors"
)

fail=0
check_route() {
  local route="$1"
  local code="000"
  local attempt=0
  while [[ "$attempt" -le "$ROUTE_SMOKE_RETRIES" ]]; do
    code=$(curl --connect-timeout 2 --max-time "${ROUTE_SMOKE_MAX_TIME}" -s -o /dev/null -w "%{http_code}" "${BASE_URL}${route}" 2>/dev/null) || code="000"
    if [[ "$code" != "000" && ! "$code" =~ ^5 ]]; then
      break
    fi
    attempt=$((attempt + 1))
    if [[ "$attempt" -le "$ROUTE_SMOKE_RETRIES" ]]; then
      sleep 2
    fi
  done
  if [[ "$code" == "000" || "$code" =~ ^5 ]]; then
    echo "FAIL ${route} -> ${code}"
    fail=1
  else
    echo "OK   ${route} -> ${code}"
  fi
}

for route in "${ROUTES[@]}"; do
  check_route "$route"
done

# Customer search query
check_route "/customers?q=acme"
check_route "/api/customers?q=acme"

# Dynamic IDs from APIs
run_id=$(curl --connect-timeout 2 --max-time 5 -sf "${BASE_URL}/api/commands" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.runs?.[0]?.id||'');}catch{console.log('');}})" || true)
if [[ -n "$run_id" ]]; then
  check_route "/commands/${run_id}"
fi

customer_id=$(curl --connect-timeout 2 --max-time 5 -sf "${BASE_URL}/api/customers" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.customers?.[0]?.id||'');}catch{console.log('');}})" || true)
if [[ -n "$customer_id" ]]; then
  check_route "/customers/${customer_id}"
  check_route "/api/customers/${customer_id}"
fi

task_id=$(curl --connect-timeout 2 --max-time 5 -sf "${BASE_URL}/api/tasks" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.tasks?.[0]?.id||'');}catch{console.log('');}})" || true)
if [[ -n "$task_id" ]]; then
  check_route "/api/tasks/${task_id}"
  if [[ "$ROUTE_SMOKE_SKIP_MUTATING" != "1" ]]; then
    code=$(curl --connect-timeout 2 --max-time 5 -s -o /dev/null -w "%{http_code}" -X PATCH "${BASE_URL}/api/tasks/${task_id}" \
      -H "Content-Type: application/json" \
      -d '{"priority":"normal"}' || echo "000")
    if [[ "$code" =~ ^5 ]]; then
      echo "FAIL PATCH /api/tasks/${task_id} -> ${code}"
      fail=1
    else
      echo "OK   PATCH /api/tasks/${task_id} -> ${code}"
    fi
  else
    echo "SKIP PATCH /api/tasks/${task_id} (ROUTE_SMOKE_SKIP_MUTATING=1)"
  fi
fi

poc_id=$(curl --connect-timeout 2 --max-time 5 -sf "${BASE_URL}/api/poc" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.projects?.[0]?.id||'');}catch{console.log('');}})" || true)
if [[ -n "$poc_id" ]]; then
  check_route "/poc/${poc_id}"
  check_route "/api/poc/${poc_id}"
  if [[ "$ROUTE_SMOKE_SKIP_MUTATING" != "1" ]]; then
    code=$(curl --connect-timeout 2 --max-time 5 -s -o /dev/null -w "%{http_code}" -X PATCH "${BASE_URL}/api/poc/${poc_id}" \
      -H "Content-Type: application/json" \
      -d '{"action":"add_event","eventType":"smoke","summary":"route smoke event"}' || echo "000")
    if [[ "$code" =~ ^5 ]]; then
      echo "FAIL PATCH /api/poc/${poc_id} -> ${code}"
      fail=1
    else
      echo "OK   PATCH /api/poc/${poc_id} -> ${code}"
    fi
  else
    echo "SKIP PATCH /api/poc/${poc_id} add_event (ROUTE_SMOKE_SKIP_MUTATING=1)"
  fi
fi

opp_id=$(curl --connect-timeout 2 --max-time 5 -sf "${BASE_URL}/api/opportunities" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.opportunities?.[0]?.id||'');}catch{console.log('');}})" || true)
if [[ -n "$opp_id" ]]; then
  check_route "/opportunities/${opp_id}"
  check_route "/api/opportunities/${opp_id}"
  if [[ "$ROUTE_SMOKE_SKIP_MUTATING" != "1" ]]; then
    code=$(curl --connect-timeout 2 --max-time 5 -s -o /dev/null -w "%{http_code}" -X PATCH "${BASE_URL}/api/opportunities/${opp_id}" \
      -H "Content-Type: application/json" \
      -d '{"nextAction":"Follow up from smoke test"}' || echo "000")
    if [[ "$code" =~ ^5 ]]; then
      echo "FAIL PATCH /api/opportunities/${opp_id} -> ${code}"
      fail=1
    else
      echo "OK   PATCH /api/opportunities/${opp_id} -> ${code}"
    fi
  else
    echo "SKIP PATCH /api/opportunities/${opp_id} (ROUTE_SMOKE_SKIP_MUTATING=1)"
  fi
fi

proposal_id=$(curl --connect-timeout 2 --max-time 5 -sf "${BASE_URL}/api/proposals" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.documents?.[0]?.id||'');}catch{console.log('');}})" || true)
if [[ -n "$proposal_id" ]]; then
  check_route "/proposals/${proposal_id}"
  check_route "/api/proposals/${proposal_id}"
fi

module_key=$(curl --connect-timeout 2 --max-time 5 -sf "${BASE_URL}/api/modules" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.modules?.[0]?.moduleKey||'');}catch{console.log('');}})" || true)
if [[ -n "$module_key" ]]; then
  check_route "/api/modules/${module_key}"
  validate_code=$(curl --connect-timeout 2 --max-time 5 -s -o /tmp/module-validate.json -w "%{http_code}" -X POST "${BASE_URL}/api/modules/${module_key}/validate" \
    -H "Content-Type: application/json" \
    -d "{}" || echo "000")
  if [[ "$validate_code" =~ ^5 ]]; then
    echo "FAIL POST /api/modules/${module_key}/validate -> ${validate_code}"
    fail=1
  else
    echo "OK   POST /api/modules/${module_key}/validate -> ${validate_code}"
    if ! node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('/tmp/module-validate.json','utf8'));if(typeof j.valid!=='boolean')process.exit(1);" 2>/dev/null; then
      echo "FAIL POST /api/modules/${module_key}/validate payload check"
      fail=1
    fi
  fi
fi

module_validate_case() {
  local label="$1"
  local route_module_key="$2"
  local payload="$3"
  local expected_code="$4"
  local code
  code=$(curl --connect-timeout 2 --max-time 5 -s -o /tmp/module-validate-case.json -w "%{http_code}" -X POST "${BASE_URL}/api/modules/${route_module_key}/validate" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null) || code="000"
  if [[ "$code" == "000" || "$code" =~ ^5 ]]; then
    echo "FAIL POST /api/modules/${route_module_key}/validate (${label}) -> ${code}"
    fail=1
    return
  fi
  echo "OK   POST /api/modules/${route_module_key}/validate (${label}) -> ${code}"
  if [[ "$code" != "$expected_code" ]]; then
    echo "FAIL POST /api/modules/${route_module_key}/validate (${label}) expected ${expected_code}"
    fail=1
  fi
}

if [[ -n "$module_key" ]]; then
  module_validate_case "missing dependency" "smoke-missing-dep" \
    '{"manifest":{"moduleKey":"smoke-missing-dep","displayName":"Smoke Missing Dependency","version":"1.0.0","status":"active","dependencyKeys":["definitely-missing-module"],"blocks":[],"nodes":[]}}' \
    "400"

  module_validate_case "disabled dependency" "smoke-disabled-dep" \
    '{"manifest":{"moduleKey":"smoke-disabled-dep","displayName":"Smoke Disabled Dependency","version":"1.0.0","status":"active","dependencyKeys":["command-center"],"blocks":[],"nodes":[]},"dependencyStatusByKey":{"command-center":"disabled"},"routeSmokeTargets":["/api/modules/smoke-disabled-dep"]}' \
    "400"

  module_validate_case "forbidden action" "smoke-forbidden-action" \
    '{"manifest":{"moduleKey":"smoke-forbidden-action","displayName":"Smoke Forbidden Action","version":"1.0.0","status":"active","dependencyKeys":[],"blocks":[],"nodes":[]},"actionKeys":["mail.send"],"routeSmokeTargets":["/api/modules/smoke-forbidden-action"]}' \
    "400"

  module_validate_case "missing credential" "development" \
    '{"manifest":{"moduleKey":"development","displayName":"Development","version":"1.0.0","status":"active","dependencyKeys":[],"blocks":[],"nodes":[]},"actionKeys":["github.sync-pr"],"connectorStatusByKey":{"github":"read_only"},"routeSmokeTargets":["/api/modules/development"]}' \
    "400"

  module_validate_case "route-smoke target missing" "smoke-no-route-target" \
    '{"manifest":{"moduleKey":"smoke-no-route-target","displayName":"Smoke No Route Target","version":"1.0.0","status":"active","dependencyKeys":[],"blocks":[],"nodes":[]},"routeSmokeTargets":[]}' \
    "400"
fi

check_route "/api/actions/github.sync-pr"
action_validate_code=$(curl --connect-timeout 2 --max-time 5 -s -o /tmp/action-validate.json -w "%{http_code}" -X POST "${BASE_URL}/api/actions/github.sync-pr/validate" \
  -H "Content-Type: application/json" \
  -d "{}" 2>/dev/null) || action_validate_code="000"
if [[ "$action_validate_code" == "000" || "$action_validate_code" =~ ^5 ]]; then
  echo "FAIL POST /api/actions/github.sync-pr/validate -> ${action_validate_code}"
  fail=1
else
  echo "OK   POST /api/actions/github.sync-pr/validate -> ${action_validate_code}"
  if ! node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('/tmp/action-validate.json','utf8'));if(typeof j.valid!=='boolean')process.exit(1);" 2>/dev/null; then
    echo "FAIL POST /api/actions/github.sync-pr/validate payload check"
    fail=1
  fi
fi

forbidden_code=$(curl --connect-timeout 2 --max-time 5 -s -o /tmp/action-forbidden.json -w "%{http_code}" -X POST "${BASE_URL}/api/actions/mail.send/validate" \
  -H "Content-Type: application/json" \
  -d "{}" 2>/dev/null) || forbidden_code="000"
if [[ "$forbidden_code" == "000" || "$forbidden_code" =~ ^5 ]]; then
  echo "FAIL POST /api/actions/mail.send/validate -> ${forbidden_code}"
  fail=1
else
  echo "OK   POST /api/actions/mail.send/validate -> ${forbidden_code} (expect 400)"
  if [[ "$forbidden_code" != "400" ]]; then
    echo "FAIL POST /api/actions/mail.send/validate expected 400"
    fail=1
  fi
fi

automation_preview_post() {
  local label="$1"
  local route="$2"
  local payload="$3"
  local output="$4"
  local code
  code=$(curl --connect-timeout 2 --max-time 10 -s -o "$output" -w "%{http_code}" -X POST "${BASE_URL}${route}" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null) || code="000"
  if [[ "$code" == "000" || "$code" =~ ^5 ]]; then
    echo "FAIL POST ${route} (${label}) -> ${code}"
    fail=1
    return
  fi
  echo "OK   POST ${route} (${label}) -> ${code}"
  if ! node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(j.previewOnly!==true)process.exit(1);" "$output" 2>/dev/null; then
    echo "FAIL POST ${route} (${label}) previewOnly payload check"
    fail=1
  fi
}

automation_preview_post "analyze" "/api/automation/analyze" \
  '{"rawText":"Preview v1.0.2 automation scaffold absorption without DB writes"}' \
  "/tmp/automation-analyze.json"
automation_preview_post "plan" "/api/automation/plan" \
  '{"rawText":"Plan v1.0.2 automation scaffold absorption without DB writes"}' \
  "/tmp/automation-plan.json"
automation_preview_post "risk" "/api/automation/risk" \
  '{"rawText":"Assess mail.send schema migration risk","expectedFiles":["packages/db/prisma/schema.prisma"],"dbChangeRequired":true,"migrationRequired":true}' \
  "/tmp/automation-risk.json"

check_phase13_run() {
  local entity_type="$1"
  local entity_id="$2"
  local module="$3"
  local payload
  if [[ -n "$module" ]]; then
    payload=$(node -e "console.log(JSON.stringify({inputSummary:'Route smoke Phase 13 portal binding',phase:13,module:'${module}',executionProfile:'smoke',sourceEntityType:'${entity_type}',sourceEntityId:'${entity_id}'}))")
  else
    payload=$(node -e "console.log(JSON.stringify({inputSummary:'Route smoke Phase 13 portal binding',phase:13,executionProfile:'smoke',sourceEntityType:'${entity_type}',sourceEntityId:'${entity_id}'}))")
  fi
  local code
  code=$(curl --connect-timeout 2 --max-time "${PHASE13_SMOKE_MAX_TIME}" -s -o /tmp/phase13-run.json -w "%{http_code}" -X POST "${BASE_URL}/api/automation/phase13/run" \
    -H "Content-Type: application/json" \
    -d "$payload" || echo "000")
  if [[ "$code" != "201" ]]; then
    echo "FAIL POST /api/automation/phase13/run (${entity_type}) -> ${code}"
    fail=1
  else
    echo "OK   POST /api/automation/phase13/run (${entity_type}) -> ${code}"
    if ! node -e "
      const fs = require('fs');
      const j = JSON.parse(fs.readFileSync('/tmp/phase13-run.json','utf8'));
      if (!j.handoffDraft?.validationCommands?.length) process.exit(1);
      if (!j.workBreakdownItems?.[0]?.suggestedAgent) process.exit(2);
      if (!j.handoffDraft.guardrails?.some(g => /mail oauth/i.test(g))) process.exit(3);
      if (!j.contextPack?.summaryText) process.exit(4);
      if (!j.handoffDraft?.contextPackSummary) process.exit(5);
    " 2>/dev/null; then
      echo "FAIL POST /api/automation/phase13/run (${entity_type}) metadata check"
      fail=1
    else
      echo "OK   POST /api/automation/phase13/run (${entity_type}) handoff+assignment+contextPack"
    fi
  fi
}

if [[ "$ROUTE_SMOKE_SKIP_MUTATING" != "1" && -n "$opp_id" ]]; then
  check_phase13_run "opportunity" "$opp_id" ""
fi
if [[ "$ROUTE_SMOKE_SKIP_MUTATING" != "1" && -n "$poc_id" ]]; then
  check_phase13_run "poc" "$poc_id" "poc"
fi
if [[ "$ROUTE_SMOKE_SKIP_MUTATING" == "1" ]]; then
  echo "SKIP POST /api/automation/phase13/run (ROUTE_SMOKE_SKIP_MUTATING=1)"
fi

knowledge_id=$(curl --connect-timeout 2 --max-time 5 -sf "${BASE_URL}/api/knowledge" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.documents?.[0]?.id||'');}catch{console.log('');}})" || true)
if [[ -n "$knowledge_id" ]]; then
  check_route "/knowledge/${knowledge_id}"
  check_route "/api/knowledge/${knowledge_id}"
fi

# Phase 15 improvement loop smoke
if [[ "$ROUTE_SMOKE_SKIP_MUTATING" != "1" ]]; then
  imp_code=$(curl --connect-timeout 2 --max-time "${ROUTE_SMOKE_MAX_TIME}" -s -o /tmp/imp-create.json -w "%{http_code}" -X POST "${BASE_URL}/api/improvements" \
    -H "Content-Type: application/json" \
    -d '{"message":"route-smoke phase15 test failure","sourceType":"route_smoke"}') || imp_code="000"
  if [[ "$imp_code" != "201" ]]; then
    echo "FAIL POST /api/improvements -> ${imp_code}"
    fail=1
  else
    echo "OK   POST /api/improvements -> ${imp_code}"
  fi
  imp_id=$(node -e "try{const j=require('/tmp/imp-create.json');console.log(j.candidate?.id||'');}catch{console.log('');}" 2>/dev/null || true)
  if [[ -n "$imp_id" ]]; then
    patch_code=$(curl --connect-timeout 2 --max-time "${ROUTE_SMOKE_MAX_TIME}" -s -o /dev/null -w "%{http_code}" -X PATCH "${BASE_URL}/api/improvements/${imp_id}" \
      -H "Content-Type: application/json" \
      -d '{"status":"approved"}') || patch_code="000"
    if [[ "$patch_code" != "200" ]]; then
      echo "FAIL PATCH /api/improvements/${imp_id} -> ${patch_code}"
      fail=1
    else
      echo "OK   PATCH /api/improvements/${imp_id} approve -> ${patch_code}"
    fi
    run_code=$(curl --connect-timeout 2 --max-time "${PHASE13_SMOKE_MAX_TIME}" -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/improvements/${imp_id}/run-phase13") || run_code="000"
    if [[ "$run_code" != "201" ]]; then
      echo "FAIL POST /api/improvements/${imp_id}/run-phase13 -> ${run_code}"
      fail=1
    else
      echo "OK   POST /api/improvements/${imp_id}/run-phase13 -> ${run_code}"
    fi
  fi
else
  echo "SKIP POST/PATCH /api/improvements smoke (ROUTE_SMOKE_SKIP_MUTATING=1)"
fi

if [[ "$ROUTE_SMOKE_SKIP_MUTATING" != "1" && -n "$poc_id" ]]; then
  issue_id=$(curl --connect-timeout 2 --max-time 5 -sf "${BASE_URL}/api/poc/${poc_id}" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.project?.issues?.[0]?.id||'');}catch{console.log('');}})" || true)
  if [[ -n "$issue_id" ]]; then
    code=$(curl --connect-timeout 2 --max-time 5 -s -o /dev/null -w "%{http_code}" -X PATCH "${BASE_URL}/api/poc/${poc_id}" \
      -H "Content-Type: application/json" \
      -d "{\"action\":\"update_issue\",\"issueId\":\"${issue_id}\",\"status\":\"in_progress\"}" || echo "000")
    if [[ "$code" =~ ^5 ]]; then
      echo "FAIL PATCH /api/poc/${poc_id} update_issue -> ${code}"
      fail=1
    else
      echo "OK   PATCH /api/poc/${poc_id} update_issue -> ${code}"
    fi
  fi
elif [[ "$ROUTE_SMOKE_SKIP_MUTATING" == "1" ]]; then
  echo "SKIP PATCH /api/poc update_issue (ROUTE_SMOKE_SKIP_MUTATING=1)"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "Route smoke test failed"
  exit 1
fi
echo "Route smoke test passed"
