/**
 * Backfill engagementId on finance rows (cashflow / invoice / expense / taxInvoice)
 * by matching normalized counterparty name ↦ normalized Customer.name of each
 * Engagement.
 *
 * DATA FACTS (surveyed 2026-07-07):
 *   finance_cashflows  179 rows /  0 linked (engagement_id NULL)
 *   finance_invoices    15 rows /  2 linked
 *   finance_expenses    35 rows /  2 linked
 *   delivery_projects (Engagement) 12 rows, all with customer_id
 *
 * Matching rule:
 *   finance.counterparty field → normName() → compared to Customer.name
 *   (via Engagement → customerId) normalised the same way.
 *   Exactly one engagement with a matching customer → matched.
 *   No match → unmatched.  More than one match → ambiguous.
 *
 * Counterparty column per model (schema.prisma):
 *   Cashflow  → counterparty  (finance_cashflows.counterparty)
 *   Invoice   → buyer         (finance_invoices.buyer)
 *   Expense   → vendor        (finance_expenses.vendor)
 *   TaxInvoice → buyerName    (finance_tax_invoices.buyer_name)
 *
 * DRY-RUN by default (prints per-table report + ambiguous list).  Pass env
 * APPLY=1 to update ONLY matched rows.  NEVER touches unmatched or ambiguous.
 *
 * Idempotent: skips rows whose engagementId is already set.
 *
 * Usage:
 *   DATABASE_URL=$(grep ^DATABASE_URL packages/db/.env | cut -d= -f2-) \
 *     pnpm --filter @sangfor/db backfill:finance-engagement
 *   DATABASE_URL=… APPLY=1 pnpm --filter @sangfor/db backfill:finance-engagement
 */
import { prisma } from "../src/index";

const APPLY = process.env.APPLY === "1";

// ---------------------------------------------------------------------------
// Counterparty-name normaliser
// ---------------------------------------------------------------------------
// Replicates the exact logic from
// sangfor-os/apps/api/src/services/finance/cashflows.service.ts:normName
// so the two stay consistent.  The db package cannot depend on apps/api.
function normName(s: string | null | undefined): string {
  return (s ?? "").replace(/\(주\)|주식회사|㈜|\s|\.|,|-/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CounterpartiedRow {
  id: string;
  counterparty: string;
  engagementId: string | null;
}

type TableDef = {
  name: string;
  fetch: (where: { engagementId: null }) => Promise<CounterpartiedRow[]>;
  update: (ids: string[], engagementId: string) => Promise<number>;
};

// ---------------------------------------------------------------------------
// Build engagement↔customer lookup
// ---------------------------------------------------------------------------

async function buildEngagementCustomerMap(): Promise<
  Map<string, Array<{ engagementId: string; customerId: string; customerName: string }>>
> {
  const engagements = await prisma.engagement.findMany({
    where: { customerId: { not: null } },
    select: { id: true, customerId: true },
  });

  if (engagements.length === 0) {
    return new Map();
  }

  const customerIds = [...new Set(engagements.map((e) => e.customerId!))];
  const customers = await prisma.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, name: true },
  });

  const customerMap = new Map(customers.map((c) => [c.id, c.name]));

  const map = new Map<string, Array<{ engagementId: string; customerId: string; customerName: string }>>();

  for (const eng of engagements) {
    const customerName = customerMap.get(eng.customerId!);
    if (!customerName) continue;

    const key = normName(customerName);
    const entry = { engagementId: eng.id, customerId: eng.customerId!, customerName };

    const existing = map.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(key, [entry]);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Classify helpers
// ---------------------------------------------------------------------------

type RowClass = "matched" | "unmatched" | "ambiguous";

function classify(
  counterparty: string,
  lookup: Map<string, Array<{ engagementId: string; customerId: string; customerName: string }>>,
): { cls: RowClass; engagementIds: string[]; matchedNames: string[] } {
  const key = normName(counterparty);
  if (!key) return { cls: "unmatched", engagementIds: [], matchedNames: [] };

  const matches = lookup.get(key);
  if (!matches || matches.length === 0) return { cls: "unmatched", engagementIds: [], matchedNames: [] };

  // Deduplicate by engagementId (same customer name may appear under multiple engagements)
  const unique = new Map<string, string>();
  for (const m of matches) {
    unique.set(m.engagementId, m.customerName);
  }

  const engagementIds = [...unique.keys()];
  const matchedNames = [...unique.values()];

  if (engagementIds.length === 1) {
    return { cls: "matched", engagementIds, matchedNames };
  }
  return { cls: "ambiguous", engagementIds, matchedNames };
}

// ---------------------------------------------------------------------------
// Per-table scanner
// ---------------------------------------------------------------------------

async function scanTable(
  table: TableDef,
  lookup: Map<string, Array<{ engagementId: string; customerId: string; customerName: string }>>,
): Promise<{
  matched: CounterpartiedRow[];
  unmatched: CounterpartiedRow[];
  ambiguous: Array<CounterpartiedRow & { matchedNames: string[]; matchedEngagementIds: string[] }>;
}> {
  const rows = await table.fetch({ engagementId: null });

  const matched: CounterpartiedRow[] = [];
  const unmatched: CounterpartiedRow[] = [];
  const ambiguous: Array<CounterpartiedRow & { matchedNames: string[]; matchedEngagementIds: string[] }> = [];

  for (const row of rows) {
    const { cls, engagementIds, matchedNames } = classify(row.counterparty, lookup);

    if (cls === "matched") {
      matched.push(row);
    } else if (cls === "unmatched") {
      unmatched.push(row);
    } else {
      ambiguous.push({ ...row, matchedNames, matchedEngagementIds: engagementIds });
    }
  }

  return { matched, unmatched, ambiguous };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const lookup = await buildEngagementCustomerMap();
  console.log(`mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);
  console.log(`engagement→customer entries (normalised name → engagement list): ${lookup.size}`);
  console.log("");

  // ── Table definitions ──────────────────────────────────────────────────
  const tables: TableDef[] = [
    {
      name: "Cashflow",
      fetch: (where) =>
        prisma.cashflow.findMany({
          where,
          select: { id: true, counterparty: true, engagementId: true },
          orderBy: { id: "asc" },
        }) as Promise<CounterpartiedRow[]>,
      update: (ids, engagementId) =>
        prisma.cashflow.updateMany({
          where: { id: { in: ids }, engagementId: null },
          data: { engagementId },
        }).then((r) => r.count),
    },
    {
      name: "Invoice",
      fetch: (where) =>
        prisma.invoice.findMany({
          where,
          select: { id: true, buyer: true, engagementId: true },
          orderBy: { id: "asc" },
        }).then((rows) =>
          rows.map((r) => ({ id: r.id, counterparty: r.buyer ?? "", engagementId: r.engagementId })),
        ),
      update: (ids, engagementId) =>
        prisma.invoice.updateMany({
          where: { id: { in: ids }, engagementId: null },
          data: { engagementId },
        }).then((r) => r.count),
    },
    {
      name: "Expense",
      fetch: (where) =>
        prisma.expense.findMany({
          where,
          select: { id: true, vendor: true, engagementId: true },
          orderBy: { id: "asc" },
        }).then((rows) =>
          rows.map((r) => ({ id: r.id, counterparty: r.vendor ?? "", engagementId: r.engagementId })),
        ),
      update: (ids, engagementId) =>
        prisma.expense.updateMany({
          where: { id: { in: ids }, engagementId: null },
          data: { engagementId },
        }).then((r) => r.count),
    },
    {
      name: "TaxInvoice",
      fetch: (where) =>
        prisma.taxInvoice.findMany({
          where,
          select: { id: true, buyerName: true, engagementId: true },
          orderBy: { id: "asc" },
        }).then((rows) =>
          rows.map((r) => ({ id: r.id, counterparty: r.buyerName ?? "", engagementId: r.engagementId })),
        ),
      update: (ids, engagementId) =>
        prisma.taxInvoice.updateMany({
          where: { id: { in: ids }, engagementId: null },
          data: { engagementId },
        }).then((r) => r.count),
    },
  ];

  // ── Scan ───────────────────────────────────────────────────────────────
  let totalMatched = 0;
  let totalUnmatched = 0;
  let totalAmbiguous = 0;
  let totalRows = 0;

  for (const table of tables) {
    const { matched, unmatched, ambiguous } = await scanTable(table, lookup);
    totalMatched += matched.length;
    totalUnmatched += unmatched.length;
    totalAmbiguous += ambiguous.length;
    totalRows += matched.length + unmatched.length + ambiguous.length;

    console.log(`── ${table.name} ──────────────────────────────────────`);
    console.log(`  matched:     ${matched.length}`);
    console.log(`  unmatched:   ${unmatched.length}`);
    console.log(`  ambiguous:   ${ambiguous.length}`);
    console.log(`  total:       ${matched.length + unmatched.length + ambiguous.length}`);
    console.log("");

    // Print ambiguous details for this table
    if (ambiguous.length > 0) {
      console.log(`  ⚠️  Ambiguous rows (${ambiguous.length}):`);
      for (const a of ambiguous) {
        console.log(`    • id=${a.id}`);
        console.log(`      counterparty="${a.counterparty}"`);
        console.log(`      matches engagements: ${a.matchedEngagementIds.join(", ")}`);
        console.log(`      customer names: ${a.matchedNames.join(", ")}`);
      }
      console.log("");
    }

    // Apply matched rows
    if (APPLY && matched.length > 0) {
      // Group matched rows by engagementId for bulk update
      const byEngagement = new Map<string, string[]>();
      for (const row of matched) {
        const { engagementIds } = classify(row.counterparty, lookup);
        const eid = engagementIds[0];
        if (!eid) continue;
        const arr = byEngagement.get(eid);
        if (arr) {
          arr.push(row.id);
        } else {
          byEngagement.set(eid, [row.id]);
        }
      }

      let updated = 0;
      for (const [engagementId, ids] of byEngagement) {
        updated += await table.update(ids, engagementId);
      }
      console.log(`  ✅ Updated: ${updated} rows → engagementId set`);
    }
    console.log("");
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════");
  console.log(`  total rows scanned:  ${totalRows}`);
  console.log(`  total matched:       ${totalMatched}`);
  console.log(`  total unmatched:     ${totalUnmatched}`);
  console.log(`  total ambiguous:     ${totalAmbiguous}`);
  console.log("═══════════════════════════════════════════════");

  if (!APPLY) {
    console.log(`\n→ Re-run with APPLY=1 to set engagementId on matched rows.`);
  } else {
    // Verify — recount remaining NULLs per table
    console.log("\n── Remaining NULL engagementId ────────────────");
    for (const table of tables) {
      const remaining = await table.fetch({ engagementId: null });
      console.log(`  ${table.name}: ${remaining.length} rows still NULL`);
    }
  }

  // Print full unmatched list at the end (compact)
  console.log("\n── All unmatched rows ──────────────────────────");
  for (const table of tables) {
    const { unmatched } = await scanTable(table, lookup);
    if (unmatched.length > 0) {
      console.log(`\n  ${table.name} (${unmatched.length}):`);
      for (const u of unmatched) {
        console.log(`    • id=${u.id}  counterparty="${u.counterparty}"`);
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
