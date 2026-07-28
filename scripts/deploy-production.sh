#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${PRODUCTION_ENV_FILE:-.env.production}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-sangfor-production}"
FINAL_ACCEPTANCE=""
EXTERNAL_RECEIPT=""
CONFIRMED=0

while (($#)); do
  case "$1" in
    --env-file) ENV_FILE="${2:?missing path after --env-file}"; shift 2 ;;
    --project-name) PROJECT_NAME="${2:?missing name after --project-name}"; shift 2 ;;
    --final-acceptance) FINAL_ACCEPTANCE="${2:?missing path after --final-acceptance}"; shift 2 ;;
    --external-receipt) EXTERNAL_RECEIPT="${2:?missing path after --external-receipt}"; shift 2 ;;
    --confirm-production) CONFIRMED=1; shift ;;
    --check) exec node scripts/verify-production-deploy.mjs --env-file "$ENV_FILE" ;;
    *) echo "Unknown argument: $1" >&2; exit 64 ;;
  esac
done

if [[ "$CONFIRMED" -ne 1 ]]; then
  echo "Refusing deployment without --confirm-production" >&2
  exit 64
fi
for command_name in docker git node curl; do
  command -v "$command_name" >/dev/null || { echo "Missing required command: $command_name" >&2; exit 69; }
done
EXPECTED_SHA="$(git rev-parse HEAD)"
if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "Refusing deployment from a dirty worktree, including untracked files" >&2
  exit 65
fi
if [[ -z "$FINAL_ACCEPTANCE" || -z "$EXTERNAL_RECEIPT" ]]; then
  echo "Refusing deployment without --final-acceptance and --external-receipt" >&2
  exit 64
fi
VERIFICATION_JSON="$(node scripts/verify-production-deploy.mjs --env-file "$ENV_FILE")"
node scripts/verify-production-readiness.mjs --candidate-sha "$EXPECTED_SHA" --final-acceptance "$FINAL_ACCEPTANCE" --external-receipt "$EXTERNAL_RECEIPT" --env-file "$ENV_FILE" --consume-nonce-dir .local-prod/approval-nonces
printf '%s\n' "$VERIFICATION_JSON"
APP_DOMAIN="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).appDomain))')"
BACKUP_DIR="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).backupDir))')"
API_IMAGE="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).apiImage))')"
WEB_IMAGE="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).webImage))')"
COMPOSE=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f docker-compose.production.yml)
export IMAGE_TAG="${EXPECTED_SHA}"
export DEPLOYMENT_ID="${EXPECTED_SHA}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
export API_IMAGE_REF="${API_IMAGE}:${EXPECTED_SHA}"
export WEB_IMAGE_REF="${WEB_IMAGE}:${EXPECTED_SHA}"

echo "Deploying candidate $EXPECTED_SHA as project $PROJECT_NAME"
"${COMPOSE[@]}" build --pull api web
API_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$API_IMAGE_REF")"
WEB_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$WEB_IMAGE_REF")"
[[ "$API_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ && "$WEB_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "Built image IDs are invalid" >&2; exit 70; }
export API_IMAGE_REF="$API_IMAGE_ID"
export WEB_IMAGE_REF="$WEB_IMAGE_ID"
"${COMPOSE[@]}" up -d --wait api web caddy
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --connect-timeout 5 "https://${APP_DOMAIN}/health" >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --connect-timeout 5 "https://${APP_DOMAIN}/login" >/dev/null
"${COMPOSE[@]}" ps
mkdir -p .local-prod/deployments
node -e 'const fs=require("fs"); const [path,candidate,deployment,project,apiTag,apiId,webTag,webId,backup,domain]=process.argv.slice(1); fs.writeFileSync(path, JSON.stringify({schemaVersion:1,candidateSha:candidate,deploymentId:deployment,projectName:project,imageTags:{api:apiTag,web:webTag},imageIds:{api:apiId,web:webId},backup:`${backup}/predeploy-${deployment}.dump`,domain,deployedAt:new Date().toISOString()},null,2)+"\n",{mode:0o600})' \
  ".local-prod/deployments/${DEPLOYMENT_ID}.json" "$EXPECTED_SHA" "$DEPLOYMENT_ID" "$PROJECT_NAME" "${API_IMAGE}:${EXPECTED_SHA}" "$API_IMAGE_ID" "${WEB_IMAGE}:${EXPECTED_SHA}" "$WEB_IMAGE_ID" "$BACKUP_DIR" "$APP_DOMAIN"
echo "Production deployment completed for $EXPECTED_SHA"
echo "Health: https://${APP_DOMAIN}/health"
