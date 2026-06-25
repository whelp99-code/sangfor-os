#!/usr/bin/env bash
# MiMo/OpenAI LLM readiness — request shape per:
# https://platform.xiaomimimo.com/docs/en-US/api/chat/openai-api
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
  # Fallback: bash source can miss vars when other lines have special chars
  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    OPENAI_API_KEY="$(grep -E '^OPENAI_API_KEY=' .env | tail -1 | cut -d= -f2- | sed 's/^"//;s/"$//;s/^'\''//;s/'\''$//')"
    export OPENAI_API_KEY
  fi
fi

MODEL="${OPENAI_MODEL:-gpt-4o-mini}"
KEY="${OPENAI_API_KEY:-}"
EXPLICIT_BASE="${OPENAI_BASE_URL:-}"

echo "=== LLM Readiness Check ==="

if [[ -z "$KEY" ]]; then
  echo "OPENAI_API_KEY: UNSET (Phase13 will use template mock)"
  exit 0
fi

# Resolve base URL (mirrors packages/automation/src/openai-config.ts)
BASE="${EXPLICIT_BASE:-https://api.openai.com/v1}"
BASE="${BASE%/}"
if [[ "$KEY" == sk-* ]]; then
  if [[ "$BASE" == *token-plan* ]]; then
    BASE="https://api.xiaomimimo.com/v1"
    echo "NOTE: sk- key -> pay-as-you-go base $BASE (official OpenAI-compatible endpoint)"
  elif [[ "$BASE" != *xiaomimimo.com* ]]; then
    BASE="https://api.xiaomimimo.com/v1"
  fi
elif [[ "$KEY" == tp-* ]]; then
  if [[ "$BASE" != *token-plan* ]]; then
    BASE="https://token-plan-sgp.xiaomimimo.com/v1"
  fi
fi

echo "OPENAI_BASE_URL (resolved): $BASE"
echo "OPENAI_MODEL: $MODEL"
echo "OPENAI_API_KEY: SET (value hidden)"

if [[ "$KEY" == tp-* && "$EXPLICIT_BASE" == *api.xiaomimimo.com* ]]; then
  echo "FAIL: Token Plan key (tp-) cannot use api.xiaomimimo.com base URL"
  exit 1
fi

if [[ "$BASE" == *xiaomimimo.com* ]]; then
  PAYLOAD=$(printf '{"model":"%s","messages":[{"role":"user","content":"Reply with ok"}],"max_completion_tokens":16,"temperature":1.0,"top_p":0.95,"stream":false,"thinking":{"type":"disabled"}}' "$MODEL")
  AUTH_HEADER=(-H "api-key: $KEY")
else
  PAYLOAD=$(printf '{"model":"%s","messages":[{"role":"user","content":"Reply with ok"}],"max_tokens":16}' "$MODEL")
  AUTH_HEADER=(-H "Authorization: Bearer $KEY")
fi

HTTP=$(curl -sS -o /tmp/llm-readiness.json -w '%{http_code}' \
  "$BASE/chat/completions" \
  "${AUTH_HEADER[@]}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" || echo "000")

if [[ "$HTTP" == "200" ]]; then
  echo "Live chat/completions: PASS (HTTP 200)"
  exit 0
fi

echo "Live chat/completions: FAIL (HTTP $HTTP)"
head -c 400 /tmp/llm-readiness.json 2>/dev/null || true
echo ""
exit 1
