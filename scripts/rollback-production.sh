#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${PRODUCTION_ENV_FILE:-.env.production}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-sangfor-production}"
TARGET_SHA=""
CONFIRMED=0

while (($#)); do
  case "$1" in
    --env-file) ENV_FILE="${2:?missing path after --env-file}"; shift 2 ;;
    --project-name) PROJECT_NAME="${2:?missing name after --project-name}"; shift 2 ;;
    --to-sha) TARGET_SHA="${2:?missing SHA after --to-sha}"; shift 2 ;;
    --confirm-rollback) CONFIRMED=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 64 ;;
  esac
done

[[ "$CONFIRMED" -eq 1 ]] || { echo "Refusing rollback without --confirm-rollback" >&2; exit 64; }
[[ "$TARGET_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "--to-sha must be lowercase 40-hex" >&2; exit 64; }
VERIFICATION_JSON="$(node scripts/verify-production-deploy.mjs --env-file "$ENV_FILE")"
APP_DOMAIN="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).appDomain))')"
API_IMAGE="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).apiImage))')"
WEB_IMAGE="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).webImage))')"
docker image inspect "${API_IMAGE}:${TARGET_SHA}" "${WEB_IMAGE}:${TARGET_SHA}" >/dev/null
export IMAGE_TAG="$TARGET_SHA"
COMPOSE=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f docker-compose.production.yml)
"${COMPOSE[@]}" up -d --no-build --no-deps api web
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --connect-timeout 5 "https://${APP_DOMAIN}/health" >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --connect-timeout 5 "https://${APP_DOMAIN}/login" >/dev/null
echo "Application images rolled back to ${TARGET_SHA}; database remains on additive forward migrations."
