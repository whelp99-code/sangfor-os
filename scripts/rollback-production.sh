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
VERIFICATION_JSON="$(node scripts/verify-production-deploy.mjs --env-file "$ENV_FILE")"
APP_DOMAIN="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).appDomain))')"
API_IMAGE="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).apiImage))')"
WEB_IMAGE="$(printf '%s' "$VERIFICATION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).webImage))')"
IFS=$'\t' read -r TARGET_SHA API_TAG API_ID WEB_TAG WEB_ID < <(node -e 'const fs=require("fs"); const [path,project,api,web]=process.argv.slice(1); const mode=fs.statSync(path).mode&0o777; if((mode&0o077)!==0) throw new Error("receipt must be owner-only"); const r=JSON.parse(fs.readFileSync(path,"utf8")); const sha=/^[a-f0-9]{40}$/; const id=/^sha256:[a-f0-9]{64}$/; if(r.schemaVersion!==1||!sha.test(r.candidateSha)||r.projectName!==project||r.imageTags?.api!==`${api}:${r.candidateSha}`||r.imageTags?.web!==`${web}:${r.candidateSha}`||!id.test(r.imageIds?.api)||!id.test(r.imageIds?.web)) throw new Error("invalid deployment receipt"); process.stdout.write([r.candidateSha,r.imageTags.api,r.imageIds.api,r.imageTags.web,r.imageIds.web].join("\t"))' "$RECEIPT" "$PROJECT_NAME" "$API_IMAGE" "$WEB_IMAGE")
docker image inspect "$API_ID" "$WEB_ID" >/dev/null
export API_IMAGE_REF="$API_ID"
export WEB_IMAGE_REF="$WEB_ID"
COMPOSE=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f docker-compose.production.yml)
"${COMPOSE[@]}" up -d --no-build --no-deps api web
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --connect-timeout 5 "https://${APP_DOMAIN}/health" >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --connect-timeout 5 "https://${APP_DOMAIN}/login" >/dev/null
echo "Application images rolled back to ${TARGET_SHA}; database remains on additive forward migrations."
