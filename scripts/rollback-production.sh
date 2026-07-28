#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${PRODUCTION_ENV_FILE:-.env.production}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-sangfor-production}"
RECEIPT=""
CONFIRMED=0

while (($#)); do
  case "$1" in
    --env-file) ENV_FILE="${2:?missing path after --env-file}"; shift 2 ;;
    --project-name) PROJECT_NAME="${2:?missing name after --project-name}"; shift 2 ;;
    --receipt) RECEIPT="${2:?missing path after --receipt}"; shift 2 ;;
    --confirm-rollback) CONFIRMED=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 64 ;;
  esac
done

[[ "$CONFIRMED" -eq 1 ]] || { echo "Refusing rollback without --confirm-rollback" >&2; exit 64; }
[[ -n "$RECEIPT" ]] || { echo "--receipt is required" >&2; exit 64; }
for command_name in docker node curl tar; do
  command -v "$command_name" >/dev/null || { echo "Missing required command: $command_name" >&2; exit 69; }
done
VERIFICATION_JSON="$(node scripts/verify-production-deploy.mjs --env-file "$ENV_FILE")"
APP_DOMAIN="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).appDomain))')"
API_IMAGE="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).apiImage))')"
WEB_IMAGE="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).webImage))')"
DEPLOYMENT_DIR="$(cd "$(dirname "$RECEIPT")" && pwd)"
IFS=$'\t' read -r TARGET_SHA API_TAG API_ID WEB_TAG WEB_ID DEPLOYMENT_COMPOSE SOURCE_ARCHIVE < <(node scripts/production-deployment-receipt.mjs verify --receipt "$RECEIPT" --project "$PROJECT_NAME" --api-image "$API_IMAGE" --web-image "$WEB_IMAGE" --deployment-dir "$DEPLOYMENT_DIR")
docker image inspect "$API_ID" "$WEB_ID" >/dev/null
export API_IMAGE_REF="$API_ID"
export WEB_IMAGE_REF="$WEB_ID"
ROLLBACK_SOURCE="$(mktemp -d "${TMPDIR:-/tmp}/sangfor-rollback.XXXXXX")"
trap 'rm -rf "$ROLLBACK_SOURCE"' EXIT
tar -xf "$SOURCE_ARCHIVE" -C "$ROLLBACK_SOURCE"
chmod -R a-w "$ROLLBACK_SOURCE"
COMPOSE=(docker compose --project-name "$PROJECT_NAME" --project-directory "$ROLLBACK_SOURCE" --env-file "$ENV_FILE" -f "$DEPLOYMENT_COMPOSE")
"${COMPOSE[@]}" up -d --no-build --no-deps api web
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --connect-timeout 5 "https://${APP_DOMAIN}/health" >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --connect-timeout 5 "https://${APP_DOMAIN}/login" >/dev/null
echo "Application images rolled back to ${TARGET_SHA}; database remains on additive forward migrations."
