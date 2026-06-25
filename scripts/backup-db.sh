#!/usr/bin/env bash
# Purpose: Phase 11 PostgreSQL backup for Beta operations.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p backups
STAMP=$(date +%Y%m%d_%H%M%S)
OUT="backups/phase11_beta_${STAMP}.sql"

if command -v pg_dump >/dev/null 2>&1 && [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "Backing up via local pg_dump to ${OUT}"
    pg_dump --clean --if-exists "$DATABASE_URL" > "$OUT"
    echo "Backup complete: ${OUT} ($(wc -c < "$OUT") bytes)"
    exit 0
  fi
fi

echo "Backing up via docker compose to ${OUT}"
docker compose exec -T postgres pg_dump -U ai_portal -d ai_automation_portal --clean --if-exists > "$OUT"
echo "Backup complete: ${OUT} ($(wc -c < "$OUT") bytes)"
