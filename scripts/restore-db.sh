#!/usr/bin/env bash
# Purpose: Phase 11 PostgreSQL restore from backup file.
# Usage: ./scripts/restore-db.sh backups/phase11_beta_YYYYMMDD_HHMMSS.sql
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "Usage: $0 <backup.sql>"
  exit 1
fi

if command -v psql >/dev/null 2>&1 && [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "Restoring via local psql from ${BACKUP_FILE}"
    psql "$DATABASE_URL" < "$BACKUP_FILE"
    echo "Restore complete"
    exit 0
  fi
fi

echo "Restoring via docker compose from ${BACKUP_FILE}"
docker compose exec -T postgres psql -U ai_portal -d ai_automation_portal < "$BACKUP_FILE"
echo "Restore complete"
