/**
 * Check for orphaned engagement_id references on the four finance tables
 * (finance_invoices / finance_expenses / finance_cashflows / finance_tax_invoices).
 *
 * `engagementId` on these models is a bare string column today (no FK
 * constraint) — this is the gate artifact for promoting it to a real Prisma
 * `@relation` (Phase 7-2, 06 문서 Task 3-3): an orphan is a row whose
 * engagement_id is set but does not match any delivery_projects.id.
 *
 * For each table: LEFT JOIN delivery_projects ON engagement_id, then report
 *   total   — all rows
 *   linked  — rows with engagement_id IS NOT NULL
 *   orphans — linked rows where the join found no matching delivery_projects row
 *
 * Exits 1 if any table has orphans (unsafe to add the FK constraint).
 *
 * Usage:
 *   DATABASE_URL=$(grep ^DATABASE_URL packages/db/.env | cut -d= -f2-) \
 *     pnpm --filter @sangfor/db check:engagement-orphans
 */
import { prisma } from "../src/index";

interface TableSpec {
  model: string;
  table: string;
}

const TABLES: TableSpec[] = [
  { model: "Invoice", table: "finance_invoices" },
  { model: "Expense", table: "finance_expenses" },
  { model: "Cashflow", table: "finance_cashflows" },
  { model: "TaxInvoice", table: "finance_tax_invoices" },
];

interface OrphanCounts {
  total: bigint;
  linked: bigint;
  orphans: bigint;
}

async function checkTable(spec: TableSpec): Promise<OrphanCounts> {
  const rows = await prisma.$queryRawUnsafe<
    { total: bigint; linked: bigint; orphans: bigint }[]
  >(`
    SELECT
      COUNT(*) AS total,
      COUNT(t.engagement_id) AS linked,
      COUNT(*) FILTER (WHERE t.engagement_id IS NOT NULL AND dp.id IS NULL) AS orphans
    FROM "${spec.table}" t
    LEFT JOIN "delivery_projects" dp ON t.engagement_id = dp.id
  `);
  return rows[0];
}

async function main() {
  console.log("── engagement_id orphan check (finance tables) ────────────");
  console.log("");

  let anyOrphans = false;

  for (const spec of TABLES) {
    const { total, linked, orphans } = await checkTable(spec);
    const orphanCount = Number(orphans);
    if (orphanCount > 0) anyOrphans = true;

    console.log(`  ${spec.model} (${spec.table}):`);
    console.log(`    total:   ${total}`);
    console.log(`    linked:  ${linked}`);
    console.log(`    orphans: ${orphanCount}${orphanCount > 0 ? "  ⚠️" : ""}`);
    console.log("");
  }

  if (anyOrphans) {
    console.log("✗ Orphaned engagement_id references found — FK promotion is NOT safe yet.");
    process.exitCode = 1;
  } else {
    console.log("✓ 0 orphans across all 4 tables — safe to promote engagementId to a @relation.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
