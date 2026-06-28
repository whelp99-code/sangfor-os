/**
 * Restore CFO finance tables from a snapshot, NON-DESTRUCTIVELY.
 * Upserts every row by its id (create if missing, update if present) in FK-safe
 * order. Never deletes — so it recovers lost rows without harming newer data.
 *
 *   pnpm --filter @sangfor/db cfo:restore
 *
 * Reads packages/db/.cfo-backup/cfo-snapshot.json (see cfo-snapshot.ts).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const IN = process.env.CFO_SNAPSHOT_PATH || join(here, "..", ".cfo-backup", "cfo-snapshot.json");

async function upsertAll<T extends { id: string }>(
  label: string,
  rows: T[],
  upsert: (row: T) => Promise<unknown>,
) {
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const existed = await prisma.$queryRawUnsafe<{ c: number }[]>(
      `SELECT COUNT(*)::int AS c FROM "public"."${tableFor(label)}" WHERE id = $1`,
      row.id,
    );
    await upsert(row);
    if (existed[0]?.c) updated += 1;
    else created += 1;
  }
  console.log(`  ${label}: +${created} created, ${updated} updated`);
}

function tableFor(label: string): string {
  return {
    projects: "finance_projects",
    invoices: "finance_invoices",
    expenses: "finance_expenses",
    cashflows: "finance_cashflows",
  }[label]!;
}

async function main() {
  const snap = JSON.parse(readFileSync(IN, "utf8"));
  console.log(`Restoring from ${IN} (taken ${snap.takenAt})`);

  // FK order: projects first, then rows that reference them.
  await upsertAll("projects", snap.projects, (p: any) =>
    prisma.financeProject.upsert({ where: { id: p.id }, create: p, update: p }),
  );
  await upsertAll("invoices", snap.invoices, (r: any) =>
    prisma.invoice.upsert({ where: { id: r.id }, create: r, update: r }),
  );
  await upsertAll("expenses", snap.expenses, (r: any) =>
    prisma.expense.upsert({ where: { id: r.id }, create: r, update: r }),
  );
  await upsertAll("cashflows", snap.cashflows, (r: any) =>
    prisma.cashflow.upsert({ where: { id: r.id }, create: r, update: r }),
  );

  const counts = {
    projects: await prisma.financeProject.count(),
    invoices: await prisma.invoice.count(),
    expenses: await prisma.expense.count(),
    cashflows: await prisma.cashflow.count(),
  };
  console.log("Restored. Current counts:", JSON.stringify(counts));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
