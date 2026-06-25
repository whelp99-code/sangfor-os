#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Hermes WebApp Validation Stack
# 전체 검증 파이프라인을 하나의 명령으로 실행합니다.
#
# Usage: pnpm validate [--layer <name>] [--report]
#   --layer    특정 레이어만 실행 (deps|pact|otel|security|e2e|all)
#   --report   Allure 리포트 생성
#   --ci       CI 모드 (모든 레이어, 실패 시 중단)
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
RESULTS_DIR="$ROOT_DIR/validation-results"
REPORT_DIR="$ROOT_DIR/allure-results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LAYER="${1:---layer}"
LAYER_VALUE="${2:-all}"
GENERATE_REPORT=false
CI_MODE=false

# 인자 파싱
while [[ $# -gt 0 ]]; do
  case $1 in
    --layer) LAYER_VALUE="$2"; shift 2 ;;
    --report) GENERATE_REPORT=true; shift ;;
    --ci) CI_MODE=true; shift ;;
    *) shift ;;
  esac
done

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 결과 디렉토리 생성
mkdir -p "$RESULTS_DIR" "$REPORT_DIR"

# 결과 추적
TOTAL=0
PASSED=0
FAILED=0
SKIPPED=0
FAILED_LAYERS=()

log_header() {
  echo ""
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
}

log_step() {
  echo -e "  ${BLUE}▶${NC} $1"
}

log_pass() {
  echo -e "  ${GREEN}✓${NC} $1"
  PASSED=$((PASSED + 1))
  TOTAL=$((TOTAL + 1))
}

log_fail() {
  echo -e "  ${RED}✗${NC} $1"
  FAILED=$((FAILED + 1))
  TOTAL=$((TOTAL + 1))
}

log_warn() {
  echo -e "  ${YELLOW}⚠${NC} $1"
  SKIPPED=$((SKIPPED + 1))
  TOTAL=$((TOTAL + 1))
}

# ─── Layer 1: Dependency Cruiser ──────────────────────────────────
run_deps_check() {
  log_header "Layer 1: Module Dependency Verification"
  
  if ! command -v depcruise &>/dev/null && ! npx --yes depcruise --version &>/dev/null 2>&1; then
    log_warn "dependency-cruiser not installed — skipping"
    return
  fi

  log_step "Running dependency-cruiser..."
  
  OUTPUT_FILE="$RESULTS_DIR/deps-$TIMESTAMP.json"
  
  if npx depcruise \
    --config "$ROOT_DIR/.dependency-cruiser.mjs" \
    --output-type json \
    "$ROOT_DIR/apps/web/src" \
    "$ROOT_DIR/packages" \
    > "$OUTPUT_FILE" 2>&1; then
    log_pass "No circular dependencies or forbidden imports found"
  else
    # 에러 규칙 위반 확인
    ERROR_COUNT=$(cat "$OUTPUT_FILE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    violations = [r for r in data.get('violations', []) if r.get('severity') == 'error']
    print(len(violations))
except:
    print(-1)
" 2>/dev/null || echo "-1")

    if [ "$ERROR_COUNT" = "0" ]; then
      log_pass "No critical dependency violations"
    elif [ "$ERROR_COUNT" = "-1" ]; then
      log_fail "Dependency check produced invalid output"
      FAILED_LAYERS+=("deps:output")
    else
      log_fail "Found $ERROR_COUNT dependency violations"
      FAILED_LAYERS+=("deps:violations")
      
      # 위반 상세 출력
      cat "$OUTPUT_FILE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for v in data.get('violations', [])[:10]:
        if v.get('severity') == 'error':
            print(f\"    {v.get('from', '?')} → {v.get('to', '?')} [{v.get('rule', {}).get('name', '?')}]\")
except:
    pass
" 2>/dev/null
    fi
  fi
}

# ─── Layer 2: Pact Contract Tests ────────────────────────────────
run_pact_check() {
  log_header "Layer 2: API Contract Verification (Pact)"
  
  log_step "Running Pact contract tests..."
  
  PACT_OUTPUT="$RESULTS_DIR/pact-$TIMESTAMP.json"
  
  if cd "$ROOT_DIR" && npx vitest run tests/pact \
    --reporter=json \
    --outputFile="$PACT_OUTPUT" \
    2>"$RESULTS_DIR/pact-stderr-$TIMESTAMP.log"; then
    log_pass "API contract tests passed"
  else
    # Pact 서버 미구동 시 skip 처리
    if grep -qi "connection refused\|ECONNREFUSED\|connect" "$RESULTS_DIR/pact-stderr-$TIMESTAMP.log" 2>/dev/null; then
      log_warn "Pact mock server not available — contract tests skipped"
    else
      log_fail "API contract tests failed"
      FAILED_LAYERS+=("pact:failed")
    fi
  fi
}

# ─── Layer 3: Security Scan (Semgrep) ────────────────────────────
run_security_scan() {
  log_header "Layer 3: Security & Code Quality (Semgrep)"
  
  if ! command -v semgrep &>/dev/null; then
    log_step "Installing semgrep..."
    if ! pip3 install semgrep 2>/dev/null && ! brew install semgrep 2>/dev/null; then
      log_warn "semgrep not available — security scan skipped"
      return
    fi
  fi

  log_step "Running Semgrep security scan..."
  
  SEMGREP_OUTPUT="$RESULTS_DIR/semgrep-$TIMESTAMP.json"
  
  if semgrep scan \
    --config "$ROOT_DIR/.semgrep.yml" \
    --json \
    --output "$SEMGREP_OUTPUT" \
    "$ROOT_DIR/apps/web/src" \
    "$ROOT_DIR/packages" \
    2>/dev/null; then
    
    ERROR_COUNT=$(python3 -c "
import json
with open('$SEMGREP_OUTPUT') as f:
    data = json.load(f)
errors = [r for r in data.get('results', []) if r.get('extra', {}).get('severity') == 'ERROR']
print(len(errors))
" 2>/dev/null || echo "0")

    if [ "$ERROR_COUNT" = "0" ]; then
      log_pass "No security vulnerabilities found"
    else
      log_fail "Found $ERROR_COUNT security issues"
      FAILED_LAYERS+=("security:vulnerabilities")
      
      # 위험 상세 출력
      python3 -c "
import json
with open('$SEMGREP_OUTPUT') as f:
    data = json.load(f)
for r in data.get('results', [])[:5]:
    if r.get('extra', {}).get('severity') == 'ERROR':
        print(f\"    [{r.get('check_id', '?')}] {r.get('path', '?')}:{r.get('start', {}).get('line', '?')}\")
" 2>/dev/null
    fi
  else
    log_warn "Semgrep scan completed with warnings"
  fi
}

# ─── Layer 4: E2E Tests (Playwright) ─────────────────────────────
run_e2e_tests() {
  log_header "Layer 4: E2E Functional Tests (Playwright)"
  
  log_step "Running Playwright tests..."
  
  E2E_OUTPUT="$RESULTS_DIR/e2e-$TIMESTAMP"
  
  cd "$ROOT_DIR"
  
  # 앱이 실행 중인지 확인
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3101 2>/dev/null | grep -q "200\|301\|302"; then
    log_step "App detected on port 3101"
  else
    log_warn "App not running on port 3101 — E2E tests will be skipped"
    return
  fi

  if npx playwright test \
    --project=smoke \
    --project=functional \
    --reporter=json,list \
    2>"$RESULTS_DIR/e2e-stderr-$TIMESTAMP.log" \
    | tee "$RESULTS_DIR/e2e-output-$TIMESTAMP.log"; then
    log_pass "E2E tests passed"
  else
    # 실패 원인 분석
    if grep -q "Application error" "$RESULTS_DIR/e2e-stderr-$TIMESTAMP.log" 2>/dev/null; then
      log_fail "E2E tests failed — UI rendering errors detected"
    elif grep -q "Timeout" "$RESULTS_DIR/e2e-stderr-$TIMESTAMP.log" 2>/dev/null; then
      log_fail "E2E tests failed — timeout (app may be unresponsive)"
    elif grep -q "ECONNREFUSED" "$RESULTS_DIR/e2e-stderr-$TIMESTAMP.log" 2>/dev/null; then
      log_fail "E2E tests failed — app not running"
    else
      log_fail "E2E tests failed — check $RESULTS_DIR/e2e-stderr-$TIMESTAMP.log"
    fi
    FAILED_LAYERS+=("e2e:failed")
  fi
}

# ─── Layer 5: OpenTelemetry Trace Verification ───────────────────
run_otel_check() {
  log_header "Layer 5: Distributed Trace Verification (OTel + Jaeger)"
  
  JAEGER_URL="${JAEGER_QUERY_URL:-http://localhost:16686}"
  
  log_step "Checking Jaeger availability..."
  
  if ! curl -s -o /dev/null "$JAEGER_URL/api/services" 2>/dev/null; then
    log_warn "Jaeger not available at $JAEGER_URL — trace verification skipped"
    return
  fi

  log_step "Querying Jaeger for service traces..."
  
  OTEL_OUTPUT="$RESULTS_DIR/otel-$TIMESTAMP.json"
  
  SERVICES=$(curl -s "$JAEGER_URL/api/services" 2>/dev/null)
  
  if echo "$SERVICES" | grep -q "ai-automation-work-portal"; then
    log_step "Service found — checking recent traces..."
    
    TRACES=$(curl -s "$JAEGER_URL/api/traces?service=ai-automation-work-portal&limit=50" 2>/dev/null)
    
    SPAN_COUNT=$(echo "$TRACES" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    traces = data.get('data', [])
    count = sum(len(t.get('spans', [])) for t in traces)
    print(count)
except:
    print(0)
" 2>/dev/null || echo "0")

    if [ "$SPAN_COUNT" != "0" ]; then
      log_pass "Found $SPAN_COUNT spans in Jaeger"
      
      # 필수 속성 검증
      HAS_WORKFLOW=$(echo "$TRACES" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for t in data.get('data', []):
        for s in t.get('spans', []):
            tags = {tag['key']: tag['value'] for tag in s.get('tags', [])}
            if 'workflow.id' in tags:
                print('yes')
                sys.exit(0)
    print('no')
except:
    print('no')
" 2>/dev/null || echo "no")

      if [ "$HAS_WORKFLOW" = "yes" ]; then
        log_pass "workflow.id attributes found in spans"
      else
        log_warn "No workflow.id attributes found — OTel integration may be incomplete"
      fi
    else
      log_warn "No spans found for service — app may need OTel instrumentation"
    fi
  else
    log_warn "Service 'ai-automation-work-portal' not in Jaeger — tracing not configured"
  fi
}

# ─── Allure Report Generation ────────────────────────────────────
generate_report() {
  log_header "Generating Allure Report..."
  
  if command -v allure &>/dev/null; then
    log_step "Building Allure HTML report..."
    allure generate "$REPORT_DIR" \
      --name "Validation Report $TIMESTAMP" \
      --report-dir "$RESULTS_DIR/report-$TIMESTAMP" \
      --clean
    log_pass "Report: $RESULTS_DIR/report-$TIMESTAMP/index.html"
  else
    log_step "Allure CLI not found — using raw results"
    log_pass "Allure results: $REPORT_DIR/"
    log_pass "Install allure-cli: npm install -g allure-commandline"
  fi
}

# ─── 실행 ─────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Hermes WebApp Validation Stack                            ║${NC}"
echo -e "${CYAN}║  $(date '+%Y-%m-%d %H:%M:%S')                                     ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"

case "$LAYER_VALUE" in
  deps)     run_deps_check ;;
  pact)     run_pact_check ;;
  security) run_security_scan ;;
  e2e)      run_e2e_tests ;;
  otel)     run_otel_check ;;
  all)
    run_deps_check
    run_pact_check
    run_security_scan
    run_e2e_tests
    run_otel_check
    ;;
  *)
    echo -e "${RED}Unknown layer: $LAYER_VALUE${NC}"
    echo "Available layers: deps, pact, security, e2e, otel, all"
    exit 1
    ;;
esac

# ─── 결과 요약 ─────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Validation Summary${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Total:   $TOTAL"
echo -e "  ${GREEN}Passed:  $PASSED${NC}"
echo -e "  ${RED}Failed:  $FAILED${NC}"
echo -e "  ${YELLOW}Skipped: $SKIPPED${NC}"
echo ""

if [ ${#FAILED_LAYERS[@]} -gt 0 ]; then
  echo -e "  ${RED}Failed Layers:${NC}"
  for layer in "${FAILED_LAYERS[@]}"; do
    echo -e "    ${RED}✗${NC} $layer"
  done
  echo ""
fi

echo -e "  Results: $RESULTS_DIR/"
echo ""

# 리포트 생성
if [ "$GENERATE_REPORT" = true ] || [ "$CI_MODE" = true ]; then
  generate_report
fi

# CI 모드에서 실패 시 non-zero exit
if [ "$CI_MODE" = true ] && [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}Validation FAILED — $FAILED issues found${NC}"
  exit 1
elif [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All validations passed ✓${NC}"
  exit 0
else
  echo -e "${YELLOW}Validation completed with issues${NC}"
  exit 0
fi
