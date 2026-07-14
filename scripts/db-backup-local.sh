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

# Dump to a temp file and verify before publishing: a failed dump (container
# down, bad creds) still creates the redirect target, so writing straight to
# $OUT leaves a 20-byte empty gzip that the rotation then counts as a backup
# and uses to evict a real one. 2026-07-12's backup was lost exactly this way.
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT

docker exec "$CONTAINER" pg_dump "$DUMP_URL" | gzip > "$TMP"

gzip -t "$TMP"
SIZE=$(wc -c < "$TMP" | tr -d ' ')
if [ "$SIZE" -lt "${MIN_BACKUP_BYTES:-100000}" ]; then
  echo "backup FAILED: $TMP is only ${SIZE}B — keeping previous backups untouched" >&2
  exit 1
fi
# grep -c, not -q: -q exits on the first match and SIGPIPEs gzip, which
# pipefail then reports as a failed pipeline.
TABLES=$(gzip -dc "$TMP" | grep -c "^CREATE TABLE" || true)
if [ "$TABLES" -lt 1 ]; then
  echo "backup FAILED: dump carries no CREATE TABLE — keeping previous backups untouched" >&2
  exit 1
fi

mv "$TMP" "$OUT"
trap - EXIT
echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"

# Rotate: keep newest 14
ls -1t "$DEST"/sangfor_os-*.sql.gz 2>/dev/null | tail -n +15 | xargs rm -f 2>/dev/null || true
