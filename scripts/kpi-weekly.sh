#!/usr/bin/env bash
# Purpose: Run the weekly KPI SQL bundle and archive the output.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Error: DATABASE_URL is not set."
  exit 1
fi

OUT_DIR="$ROOT/.agents/results/kpi"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/kpi-$(date +%Y%m%d).txt"

# psql's URI parser rejects Prisma's "?schema=" query param (not a libpq option).
PSQL_URL="${DATABASE_URL%%\?*}"

psql "$PSQL_URL" -f "$ROOT/scripts/kpi-weekly.sql" | tee "$OUT_FILE"
echo ""
echo "Saved: $OUT_FILE"
