/**
 * Backfill engagementId on finance rows (cashflow / invoice / expense / taxInvoice)
 * using a two-pass strategy:
 *
 * PASS 1 — FinanceProject bridge (NEW):
 *   FinanceProject.name ↔ Engagement.name match (exact + customer-prefix).
 *   Rows with projectId → linked FinanceProject → Engagement.
 *   ProjectId presence: cashflows 10/179, invoices 13/15, expenses 15/35.
 *   FinanceProject.client is the reseller/partner, NOT the end customer,
 *   so the existing direct-name pass alone found only 1 row.
 *
 * PASS 2 — Direct name (existing):
 *   finance.counterparty field → normName() → compared to normalized
 *   Customer.name of each Engagement.  Runs only on rows still unlinked
 *   after the bridge pass.
 *
 * DATA FACTS (surveyed 2026-07-07):
 *   finance_cashflows    179 rows /  0 linked (engagement_id NULL)
 *   finance_invoices      15 rows /  2 linked
 *   finance_expenses      35 rows /  2 linked
 *   finance_projects      17 rows
 *   delivery_projects (Engagement) 12 rows, all with customer_id
 *
 * Counterparty column per model (schema.prisma):
 *   Cashflow    → counterparty  (finance_cashflows.counterparty)
 *   Invoice     → buyer         (finance_invoices.buyer)
 *   Expense     → vendor        (finance_expenses.vendor)
 *   TaxInvoice  → buyerName     (finance_tax_invoices.buyer_name)
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


/** One entry in the FP→Engagement mapping table. */
type FpMappingStatus = "matched" | "unmatched" | "ambiguous";

interface FpMappingEntry {
  fpId: string;
  fpName: string;
  fpClient: string | null;
  engagementId: string | null;
  engagementName: string | null;
  status: FpMappingStatus;
  candidates: string[];
}

// ---------------------------------------------------------------------------
// FinanceProject → Engagement bridge
// ---------------------------------------------------------------------------

async function buildFpEngagementMap(): Promise<Map<string, FpMappingEntry>> {
  const [financeProjects, engagements] = await Promise.all([
    prisma.financeProject.findMany({ orderBy: { name: "asc" } }),
    prisma.engagement.findMany({
      where: { customerId: { not: null } },
      select: { id: true, name: true, customerId: true },
    }),
  ]);

  // Resolve customer names
  const customerIds = [...new Set(engagements.map((e) => e.customerId!))];
  const engCustomerMap =
    customerIds.length > 0
      ? new Map(
          (
            await prisma.customer.findMany({
              where: { id: { in: customerIds } },
              select: { id: true, name: true },
            })
          ).map((c) => [c.id, c.name]),
        )
      : new Map<string, string>();

  const enrichedEngagements = engagements
    .map((e) => ({
      ...e,
      customerName: engCustomerMap.get(e.customerId!) ?? "",
    }))
    .filter((e) => e.customerName); // skip engagements without a resolvable customer name

  const map = new Map<string, FpMappingEntry>();

  for (const fp of financeProjects) {
    const fnFp = normName(fp.name);
    if (!fnFp) {
      map.set(fp.id, {
        fpId: fp.id,
        fpName: fp.name,
        fpClient: fp.client,
        engagementId: null,
        engagementName: null,
        status: "unmatched",
        candidates: [],
      });
      continue;
    }

    // 1a. Exact match: normName(fp.name) === normName(engagement.name)
    let candidates = enrichedEngagements.filter(
      (e) => normName(e.name) === fnFp,
    );

    if (candidates.length === 1) {
      map.set(fp.id, {
        fpId: fp.id,
        fpName: fp.name,
        fpClient: fp.client,
        engagementId: candidates[0].id,
        engagementName: candidates[0].name,
        status: "matched",
        candidates: [],
      });
      continue;
    }

    // 1b. Customer-prefix match:
    //     For each engagement, if normName(engagement.customer.name) is a
    //     prefix of normName(fp.name), it is a candidate.
    //     Exactly 1 → matched; >1 → ambiguous; 0 → unmatched.
    candidates = enrichedEngagements.filter((e) => {
      const fnCustomer = normName(e.customerName);
      return fnCustomer.length > 0 && fnFp.startsWith(fnCustomer);
    });

    if (candidates.length === 1) {
      map.set(fp.id, {
        fpId: fp.id,
        fpName: fp.name,
        fpClient: fp.client,
        engagementId: candidates[0].id,
        engagementName: candidates[0].name,
        status: "matched",
        candidates: [],
      });
    } else if (candidates.length > 1) {
      map.set(fp.id, {
        fpId: fp.id,
        fpName: fp.name,
        fpClient: fp.client,
        engagementId: null,
        engagementName: null,
        status: "ambiguous",
        candidates: candidates.map((c) => c.name),
      });
    } else {
      map.set(fp.id, {
        fpId: fp.id,
        fpName: fp.name,
        fpClient: fp.client,
        engagementId: null,
        engagementName: null,
        status: "unmatched",
        candidates: [],
      });
    }
  }

  return map;
}

function printFpMappingTable(fpMap: Map<string, FpMappingEntry>): void {
  console.log("── FinanceProject → Engagement mapping ────────────────────");
  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;

  for (const entry of fpMap.values()) {
    switch (entry.status) {
      case "matched":
        console.log(
          `  ✓ "${entry.fpName}"  →  "${entry.engagementName}"  [${entry.fpId}]`,
        );
        matched++;
        break;
      case "unmatched":
        console.log(
          `  ✗ "${entry.fpName}"  →  UNMATCHED  [client=${entry.fpClient ?? "-"}]`,
        );
        unmatched++;
        break;
      case "ambiguous":
        console.log(
          `  ? "${entry.fpName}"  →  AMBIGUOUS(${entry.candidates.join(", ")})  [client=${entry.fpClient ?? "-"}]`,
        );
        ambiguous++;
        break;
    }
  }

  console.log("");
  console.log(`  ${matched} matched, ${unmatched} unmatched, ${ambiguous} ambiguous`);
  console.log("");
}

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
// Initial-state counters (before any write)
// ---------------------------------------------------------------------------

async function countInitialLinked(): Promise<
  Map<string, { total: number; alreadyLinked: number }>
> {
  const counts = new Map<
    string,
    { total: number; alreadyLinked: number }
  >();

  const models: Record<string, {
    count: (where?: any) => Promise<number>;
  }> = {
    Cashflow: prisma.cashflow,
    Invoice: prisma.invoice,
    Expense: prisma.expense,
    TaxInvoice: prisma.taxInvoice,
  };

  for (const [name, model] of Object.entries(models)) {
    const [total, alreadyLinked] = await Promise.all([
      model.count(),
      model.count({ where: { engagementId: { not: null } } }),
    ]);
    counts.set(name, { total, alreadyLinked });
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);
  console.log("");

  // ── Table definitions (unchanged) ─────────────────────────────────────
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
        prisma.cashflow
          .updateMany({
            where: { id: { in: ids }, engagementId: null },
            data: { engagementId },
          })
          .then((r) => r.count),
    },
    {
      name: "Invoice",
      fetch: (where) =>
        prisma.invoice
          .findMany({
            where,
            select: { id: true, buyer: true, engagementId: true },
            orderBy: { id: "asc" },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              counterparty: r.buyer ?? "",
              engagementId: r.engagementId,
            })),
          ),
      update: (ids, engagementId) =>
        prisma.invoice
          .updateMany({
            where: { id: { in: ids }, engagementId: null },
            data: { engagementId },
          })
          .then((r) => r.count),
    },
    {
      name: "Expense",
      fetch: (where) =>
        prisma.expense
          .findMany({
            where,
            select: { id: true, vendor: true, engagementId: true },
            orderBy: { id: "asc" },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              counterparty: r.vendor ?? "",
              engagementId: r.engagementId,
            })),
          ),
      update: (ids, engagementId) =>
        prisma.expense
          .updateMany({
            where: { id: { in: ids }, engagementId: null },
            data: { engagementId },
          })
          .then((r) => r.count),
    },
    {
      name: "TaxInvoice",
      fetch: (where) =>
        prisma.taxInvoice
          .findMany({
            where,
            select: { id: true, buyerName: true, engagementId: true },
            orderBy: { id: "asc" },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              counterparty: r.buyerName ?? "",
              engagementId: r.engagementId,
            })),
          ),
      update: (ids, engagementId) =>
        prisma.taxInvoice
          .updateMany({
            where: { id: { in: ids }, engagementId: null },
            data: { engagementId },
          })
          .then((r) => r.count),
    },
  ];

  // ── Initial state ─────────────────────────────────────────────────────
  const initialCounts = await countInitialLinked();
  console.log("── Initial finance-row link state ────────────────────────");
  for (const [name, c] of initialCounts) {
    console.log(
      `  ${name}: ${c.total} total, ${c.alreadyLinked} already linked, ${c.total - c.alreadyLinked} NULL`,
    );
  }
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════
  // PASS 1 — FinanceProject bridge
  // ═══════════════════════════════════════════════════════════════════════

  console.log("══ PASS 1: FinanceProject bridge ════════════════════════════");
  const fpMap = await buildFpEngagementMap();
  printFpMappingTable(fpMap);

  const matchedFpEntries = [...fpMap.values()].filter(
    (e) => e.status === "matched",
  );
  const matchedFpIds = new Set(matchedFpEntries.map((e) => e.fpId));
  const fpIdToEngId = new Map(
    matchedFpEntries.map((e) => [e.fpId, e.engagementId!]),
  );

  // Compute bridge-linked counts and optionally apply
  let bridgeLinkedByTable = new Map<string, number>();

  if (matchedFpIds.size > 0) {
    const bridgeTables: Array<{
      name: string;
      model: any;
    }> = [
      { name: "Cashflow", model: prisma.cashflow },
      { name: "Invoice", model: prisma.invoice },
      { name: "Expense", model: prisma.expense },
    ];

    for (const bt of bridgeTables) {
      const candidateRows = (await bt.model.findMany({
        where: {
          projectId: { in: [...matchedFpIds] },
          engagementId: null,
        },
        select: { id: true, projectId: true },
      })) as { id: string; projectId: string | null }[];

      const rowsByFp = new Map<string, string[]>();
      for (const row of candidateRows) {
        if (!row.projectId) continue;
        const arr = rowsByFp.get(row.projectId);
        if (arr) arr.push(row.id);
        else rowsByFp.set(row.projectId, [row.id]);
      }

      if (candidateRows.length > 0) {
        console.log(
          `  ${bt.name}: ${candidateRows.length} bridge-candidate rows with projectId → matched FP`,
        );

        // Show breakdown by FP
        for (const [fpId, ids] of rowsByFp) {
          const entry = fpMap.get(fpId)!;
          console.log(
            `    → FP "${entry.fpName}" → Engagement "${entry.engagementName}" (${ids.length} rows)`,
          );
        }

        if (APPLY) {
          let updated = 0;
          for (const [fpId, fpEngId] of fpIdToEngId) {
            const ids = rowsByFp.get(fpId);
            if (!ids || ids.length === 0) continue;
            const r = await bt.model.updateMany({
              where: { id: { in: ids }, engagementId: null },
              data: { engagementId: fpEngId },
            });
            updated += r.count;
          }
          bridgeLinkedByTable.set(bt.name, updated);
          console.log(`    ✅ Updated: ${updated} rows → engagementId set`);
        } else {
          bridgeLinkedByTable.set(bt.name, candidateRows.length);
        }
      } else {
        console.log(`  ${bt.name}: 0 bridge-candidate rows`);
        bridgeLinkedByTable.set(bt.name, 0);
      }
      console.log("");
    }
  } else {
    console.log("  No matched FinanceProject entries — bridge pass skipped.");
    console.log("");
    for (const name of ["Cashflow", "Invoice", "Expense"]) {
      bridgeLinkedByTable.set(name, 0);
    }
  }

  // Collect IDs linked by bridge pass (for exclusion from direct pass in dry-run)
  const bridgeLinkedIds = new Map<string, Set<string>>();
  if (!APPLY) {
    // In dry-run, compute which rows WOULD be linked
    for (const btName of ["Cashflow", "Invoice", "Expense"]) {
      const model =
        btName === "Cashflow"
          ? prisma.cashflow
          : btName === "Invoice"
            ? prisma.invoice
            : prisma.expense;
      const rows = (await model.findMany({
        where: {
          projectId: { in: [...matchedFpIds] },
          engagementId: null,
        },
        select: { id: true },
      })) as { id: string }[];
      bridgeLinkedIds.set(
        btName,
        new Set(rows.map((r) => r.id)),
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PASS 2 — Direct name match (existing logic, only on still-unlinked rows)
  // ═══════════════════════════════════════════════════════════════════════

  console.log("══ PASS 2: Direct name match ═════════════════════════════════");

  const lookup = await buildEngagementCustomerMap();
  console.log(
    `  Engagement→customer entries (normName → list): ${lookup.size}`,
  );
  console.log("");

  let directTotalMatched = 0;
  let directTotalUnmatched = 0;
  let directTotalAmbiguous = 0;
  let directTotalCandidates = 0;
  const directMatchedByTable = new Map<string, number>();

  for (const table of tables) {
    const tableRows = await table.fetch({ engagementId: null });

    // In dry-run, exclude rows already counted by the bridge pass
    const excludeIds = bridgeLinkedIds.get(table.name);
    const filtered =
      excludeIds && excludeIds.size > 0
        ? tableRows.filter((r) => !excludeIds.has(r.id))
        : tableRows;

    if (filtered.length === 0 && tableRows.length === 0) {
      console.log(`  ── ${table.name} ──────────────────────────────────────`);
      console.log(`    matched:   0`);
      console.log(`    unmatched: 0`);
      console.log(`    ambiguous: 0`);
      console.log(`    total:     0`);
      console.log("");
      continue;
    }

    // For APPLY mode, use tableRows (bridge-pass rows already excluded by DB state)
    const scanRows = APPLY ? tableRows : filtered;

    const matched: CounterpartiedRow[] = [];
    const unmatched: CounterpartiedRow[] = [];
    const ambiguous: Array<
      CounterpartiedRow & {
        matchedNames: string[];
        matchedEngagementIds: string[];
      }
    > = [];

    for (const row of scanRows) {
      const { cls, engagementIds, matchedNames } = classify(
        row.counterparty,
        lookup,
      );
      if (cls === "matched") {
        matched.push(row);
      } else if (cls === "unmatched") {
        unmatched.push(row);
      } else {
        ambiguous.push({
          ...row,
          matchedNames,
          matchedEngagementIds: engagementIds,
        });
      }
    }

    directTotalMatched += matched.length;
    directTotalUnmatched += unmatched.length;
    directTotalAmbiguous += ambiguous.length;
    directTotalCandidates += scanRows.length;
    directMatchedByTable.set(table.name, matched.length);

    const excludedCount = tableRows.length - scanRows.length;

    console.log(`  ── ${table.name} ──────────────────────────────────────`);
    console.log(`    matched:     ${matched.length}`);
    console.log(`    unmatched:   ${unmatched.length}`);
    console.log(`    ambiguous:   ${ambiguous.length}`);
    console.log(`    total:       ${scanRows.length}`);
    if (excludedCount > 0) {
      console.log(
        `    (excluded ${excludedCount} bridge-linked rows from dry-run pass)`,
      );
    }
    console.log("");

    if (ambiguous.length > 0) {
      console.log(`    ⚠️  Ambiguous rows (${ambiguous.length}):`);
      for (const a of ambiguous) {
        console.log(`      • id=${a.id}`);
        console.log(`        counterparty="${a.counterparty}"`);
        console.log(
          `        matches engagements: ${a.matchedEngagementIds.join(", ")}`,
        );
        console.log(`        customer names: ${a.matchedNames.join(", ")}`);
      }
      console.log("");
    }

    if (APPLY && matched.length > 0) {
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
      console.log(`    ✅ Updated: ${updated} rows → engagementId set`);
      console.log("");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Combined summary
  // ═══════════════════════════════════════════════════════════════════════

  console.log("══ Combined summary ═══════════════════════════════════════════");

  let grandTotal = 0;
  let grandAlreadyLinked = 0;
  let grandBridgeLinked = 0;
  let grandDirectMatched = 0;
  let grandStillNull = 0;

  for (const table of tables) {
    const c = initialCounts.get(table.name)!;
    const bridgeLinked = bridgeLinkedByTable.get(table.name) ?? 0;
    const directMatched = directMatchedByTable.get(table.name) ?? 0;

    // In DRY-RUN, the DB still has bridge-candidate rows at engagementId=NULL.
    // Compute what "still NULL" would be after applying both passes.
    const stillNullAfterBoth = APPLY
      ? (await table.fetch({ engagementId: null })).length
      : c.total - c.alreadyLinked - bridgeLinked - directMatched;

    grandTotal += c.total;
    grandAlreadyLinked += c.alreadyLinked;
    grandBridgeLinked += bridgeLinked;
    grandDirectMatched += directMatched;
    grandStillNull += stillNullAfterBoth;

    console.log(`  ${table.name}:`);
    console.log(`    total rows:          ${c.total}`);
    console.log(`    already linked:      ${c.alreadyLinked}`);
    console.log(`    PASS 1 (bridge):     ${bridgeLinked}`);
    console.log(`    PASS 2 (direct):     ${directMatched}`);
    console.log(`    still NULL:          ${stillNullAfterBoth}`);
    const linked = c.alreadyLinked + bridgeLinked + directMatched;
    const pct = ((linked / Math.max(c.total, 1)) * 100).toFixed(1);
    console.log(`    → linked:            ${linked} / ${c.total} (${pct}%)`);
    console.log("");
  }

  console.log("  ──────────────────────────────────────────────────");
  const combinedLinked = grandAlreadyLinked + grandBridgeLinked + grandDirectMatched;
  const grandPct = ((combinedLinked / Math.max(grandTotal, 1)) * 100).toFixed(1);
  console.log(`    combined linked:  ${combinedLinked} / ${grandTotal} (${grandPct}%)`);
  console.log(`    still NULL:       ${grandStillNull} / ${grandTotal}`);
  console.log("");

  if (!APPLY) {
    // Print unmatched list for PASS 2 after excluding bridge-linked rows
    console.log("── Unmatched rows (PASS 2, excluding bridge-linked) ─────");
    for (const table of tables) {
      const tableRows = await table.fetch({ engagementId: null });
      const excludeIds = bridgeLinkedIds.get(table.name);
      const filtered =
        excludeIds && excludeIds.size > 0
          ? tableRows.filter((r) => !excludeIds.has(r.id))
          : tableRows;

      const unmatched: CounterpartiedRow[] = [];
      for (const row of filtered) {
        const { cls } = classify(row.counterparty, lookup);
        if (cls === "unmatched") unmatched.push(row);
      }

      if (unmatched.length > 0) {
        console.log(`\n  ${table.name} (${unmatched.length}):`);
        for (const u of unmatched) {
          console.log(`    • id=${u.id}  counterparty="${u.counterparty}"`);
        }
      }
    }

    console.log(`\n→ Re-run with APPLY=1 to set engagementId on matched rows.`);
  } else {
    console.log("── Remaining NULL engagementId ────────────────────────");
    for (const table of tables) {
      const remaining = await table.fetch({ engagementId: null });
      console.log(`  ${table.name}: ${remaining.length} rows still NULL`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
