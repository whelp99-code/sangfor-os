#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "WARNING: This removes the postgres_data Docker volume."
read -r -p "Continue? [y/N] " confirm
if [[ "${confirm:-}" != "y" && "${confirm:-}" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

docker compose down -v
docker compose up -d
echo "Database volume reset. Phase 1 migrations will repopulate schema."
