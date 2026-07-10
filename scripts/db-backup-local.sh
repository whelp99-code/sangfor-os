#!/usr/bin/env bash
# Daily local backup of the sangfor_os Postgres database.
# Keeps the most recent 14 dumps under ~/Backups/sangfor-os/.
# Intended to run from cron:  0 21 * * *  <repo>/scripts/db-backup-local.sh
set -euo pipefail

# cron runs with a minimal PATH that lacks Docker Desktop's symlink dir —
# without this, `docker` resolves to nothing and the dump is a 20-byte empty gzip.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HOME/Backups/sangfor-os"
mkdir -p "$DEST"

# DATABASE_URL from packages/db/.env (postgresql://user:pass@host:port/db)
set -a
# shellcheck disable=SC1091
source "$ROOT/packages/db/.env"
set +a

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/sangfor_os-$STAMP.sql.gz"

# Use pg_dump inside the postgres container: the host Homebrew pg_dump (v14)
# refuses the v16 server, and the container's binary is always version-matched.
CONTAINER="${PG_CONTAINER:-sangfor-postgres}"
# pg_dump rejects Prisma-style query params (?schema=public) — strip them,
# and rewrite host:port to the in-container listener.
DUMP_URL="$(echo "${DATABASE_URL%%\?*}" | sed 's|@[^/]*/|@localhost:5432/|')"

docker exec "$CONTAINER" pg_dump "$DUMP_URL" | gzip > "$OUT"
echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"

# Rotate: keep newest 14
ls -1t "$DEST"/sangfor_os-*.sql.gz 2>/dev/null | tail -n +15 | xargs rm -f 2>/dev/null || true
