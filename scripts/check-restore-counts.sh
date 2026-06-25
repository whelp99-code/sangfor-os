#!/usr/bin/env bash
# Purpose: Rehearsal counts validator.
# Queries DB table counts to verify database restore. Does not modify data.
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

# Hard safety gate: only allow rehearsal checks on local/staging-like targets.
if [[ "${DATABASE_URL}" == *"prod"* || "${DATABASE_URL}" == *"production"* ]]; then
  echo "Refusing to run against a production-looking DATABASE_URL."
  exit 1
fi

echo "=== DB Restore Counts Check ==="
pnpm --filter @ai-portal/db exec node <<'EOF'
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const tables = [
    "command_runs",
    "customers",
    "work_tasks",
    "skill_runs",
    "work_breakdown_items",
    "improvement_candidates",
  ];

  try {
    for (const table of tables) {
      const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM ${table}`);
      const count = Array.isArray(rows) && rows[0] ? rows[0].count : 0;
      console.log(`${table} count: ${count}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Error: Failed to query the database. Ensure Postgres is running and DATABASE_URL is correct.");
  console.error(`Cause: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
EOF

echo "==============================="
exit 0
