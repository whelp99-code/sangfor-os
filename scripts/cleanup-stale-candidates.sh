#!/usr/bin/env bash
# Purpose: Clean up stale rules-only mail candidates.
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

echo "=== Stale Mail Candidates Ingestion Cleanup ==="
pnpm --filter @ai-portal/db exec node <<'EOF'
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await prisma.mailDerivedCandidate.updateMany({
      where: {
        mailInsightThreadId: null,
        status: "proposed",
      },
      data: {
        status: "knowledge_only",
      },
    });
    console.log(`SUCCESS: Marked ${result.count} stale rules-only candidates as 'knowledge_only'.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("FAIL: Ingestion cleanup execution error:", error);
  process.exit(1);
});
EOF

echo "================================================="
exit 0
