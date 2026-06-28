/**
 * Snapshot all CFO finance tables (with ids + relations) to a local JSON file.
 * Pair with cfo-restore.ts for one-command, non-destructive recovery after the
 * local DB loses data.
 *
 *   pnpm --filter @sangfor/db cfo:snapshot
 *
 * Output: packages/db/.cfo-backup/cfo-snapshot.json (gitignored — contains
 * private financial data; do NOT commit).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.CFO_SNAPSHOT_PATH || join(here, "..", ".cfo-backup", "cfo-snapshot.json");

async function main() {
  const [projects, invoices, expenses, cashflows] = await Promise.all([
    prisma.financeProject.findMany(),
    prisma.invoice.findMany(),
    prisma.expense.findMany(),
    prisma.cashflow.findMany(),
  ]);
  const snapshot = {
    takenAt: new Date().toISOString(),
    counts: {
      projects: projects.length,
      invoices: invoices.length,
      expenses: expenses.length,
      cashflows: cashflows.length,
    },
    projects,
    invoices,
    expenses,
    cashflows,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2));
  console.log(`Snapshot written: ${OUT}`);
  console.log(JSON.stringify(snapshot.counts));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
