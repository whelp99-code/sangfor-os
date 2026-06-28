/**
 * Import Notion CSV exports (CFO databases) into the @sangfor/db (public)
 * schema that the web CFO dashboard (apps/api /api/cfo) reads, then verify
 * the imported rows match the source CSVs field-by-field.
 *
 * Usage:
 *   NOTION_CSV_DIR="/path/to/개인 페이지 & 공유된 페이지" \
 *     pnpm --filter @sangfor/db import:finance-csv
 *
 * Source databases (Notion `_all.csv` exports):
 *   - 프로젝트            -> FinanceProject
 *   - 미수금 입금관리      -> Invoice
 *   - 매입 비용 DB        -> Expense
 *   - 자금흐름 DB         -> Cashflow
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "../src/index";


const CSV_DIR =
  process.env.NOTION_CSV_DIR ||
  "/Users/jmpark/Downloads/개인 페이지 & 공유된 페이지";

// ---------- CSV parsing (RFC4180) ----------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((v) => v !== "")) rows.push(row);
  }
  return rows;
}

function toRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => (rec[h] = (r[idx] ?? "").trim()));
    return rec;
  });
}

// ---------- value parsers ----------
function won(v: string | undefined): number {
  if (!v) return 0;
  const neg = v.includes("-");
  const digits = v.replace(/[^0-9]/g, "");
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return neg ? -n : n;
}

function kdate(v: string | undefined): Date | null {
  if (!v) return null;
  const m = v.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!m) return null;
  // Use UTC midnight so the stored instant round-trips to the exact calendar
  // date regardless of the host timezone (local midnight would shift a day).
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function projName(v: string | undefined): string | null {
  if (!v) return null;
  const idx = v.indexOf(" (");
  const name = (idx >= 0 ? v.slice(0, idx) : v).trim();
  return name || null;
}

function findCsv(patterns: RegExp[]): string {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
    );
  const files = walk(CSV_DIR).filter((f) => f.endsWith(".csv"));
  for (const p of patterns) {
    const hit = files.find((f) => p.test(f));
    if (hit) return hit;
  }
  throw new Error(`CSV not found for patterns: ${patterns.map(String).join(", ")}`);
}

// ---------- load source records ----------
// Match by ASCII Notion page-id suffix (Korean filenames vary by NFC/NFD).
const projectsCsv = findCsv([/4b9941d525c36448fa_all\.csv$/, /219409cd1311c7f993\.csv$/]);
const invoicesCsv = findCsv([/41896edcd7eab0556b_all\.csv$/]);
const expensesCsv = findCsv([/98cf696d7cb9402_all\.csv$/]);
const cashflowsCsv = findCsv([/f98ebdc6bf8b647f9b_all\.csv$/]);

type ProjIn = { name: string; status: string | null };
type InvIn = {
  project: string | null;
  buyer: string | null;
  amount: number;
  vat: number;
  total: number;
  depositStatus: string | null;
  depositAmount: number | null;
  depositDate: Date | null;
  memo: string | null;
};
type ExpIn = {
  project: string | null;
  expenseName: string;
  vendor: string | null;
  category: string | null;
  paymentMethod: string | null;
  proofType: string | null;
  amount: number;
  vat: number;
  total: number;
  date: Date | null;
  isPaid: boolean;
};
type CashIn = {
  project: string | null;
  counterparty: string;
  amount: number;
  cashChange: number;
  type: string;
  inAccount: string | null;
  outAccount: string | null;
  date: Date | null;
  memo: string | null;
};

function loadProjects(): ProjIn[] {
  return toRecords(readFileSync(projectsCsv, "utf8"))
    .map((r) => ({
      name: (r["프로젝트명(Title)"] || "").trim(),
      status: (r["상태"] || "").trim() || null,
    }))
    .filter((p) => p.name);
}

function loadInvoices(): InvIn[] {
  return toRecords(readFileSync(invoicesCsv, "utf8"))
    .map((r) => ({
      project: projName(r["프로젝트"]),
      buyer: (r["거래처"] || "").trim() || null,
      amount: won(r["공급가액"]),
      vat: won(r["VAT"]),
      total: won(r["합계"]),
      depositStatus: (r["입금상태"] || "").trim() || null,
      depositAmount: r["입금액"] ? won(r["입금액"]) : null,
      depositDate: kdate(r["입금일"]),
      memo: [r["속성"], r["메모"], r["일자"] ? `일자:${r["일자"]}` : ""]
        .filter(Boolean)
        .join(" | ") || null,
    }))
    .filter((i) => i.buyer || i.project || i.amount);
}

function loadExpenses(): ExpIn[] {
  return toRecords(readFileSync(expensesCsv, "utf8"))
    .map((r) => ({
      project: projName(r["프로젝트"]),
      expenseName: (r["지출명"] || "").trim(),
      vendor: (r["매입처"] || "").trim() || null,
      category: (r["구분"] || "").trim() || null,
      paymentMethod: (r["결재수단"] || "").trim() || null,
      proofType: (r["증빙"] || "").trim() || null,
      amount: won(r["공급가액"]),
      vat: won(r["VAT"]),
      total: won(r["합계"]),
      date: kdate(r["일자"]),
      isPaid: (r["납입여부"] || "").trim().toLowerCase() === "yes",
    }))
    .filter((e) => e.expenseName || e.vendor || e.amount);
}

function loadCashflows(): CashIn[] {
  return toRecords(readFileSync(cashflowsCsv, "utf8"))
    .map((r) => ({
      project: projName(r["프로젝트"]),
      counterparty: (r["거래처"] || "").trim(),
      amount: won(r["금액"]),
      cashChange: won(r["현금변동"]),
      type: (r["유형"] || "").trim(),
      inAccount: (r["입금계좌"] || "").trim() || null,
      outAccount: (r["출금계좌"] || "").trim() || null,
      date: kdate(r["일자"]),
      memo: (r["메모"] || "").trim() || null,
    }))
    .filter((c) => c.amount || c.counterparty || c.project);
}

// ---------- import ----------
async function main() {
  const projects = loadProjects();
  const invoices = loadInvoices();
  const expenses = loadExpenses();
  const cashflows = loadCashflows();

  console.log(
    `Source: projects=${projects.length} invoices=${invoices.length} expenses=${expenses.length} cashflows=${cashflows.length}`,
  );

  // Clean slate (idempotent, exact-match import)
  await prisma.cashflow.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.taxInvoice.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.financeProject.deleteMany();

  const idByName = new Map<string, string>();
  for (const p of projects) {
    const created = await prisma.financeProject.create({
      data: { name: p.name, status: p.status },
    });
    idByName.set(p.name, created.id);
  }
  const resolve = (name: string | null) => (name ? idByName.get(name) ?? null : null);

  for (const i of invoices) {
    await prisma.invoice.create({
      data: {
        projectId: resolve(i.project),
        buyer: i.buyer,
        amount: i.amount,
        vat: i.vat,
        total: i.total,
        depositStatus: i.depositStatus ?? undefined,
        depositAmount: i.depositAmount ?? undefined,
        depositDate: i.depositDate ?? undefined,
        memo: i.memo,
      },
    });
  }
  for (const e of expenses) {
    await prisma.expense.create({
      data: {
        projectId: resolve(e.project),
        expenseName: e.expenseName,
        vendor: e.vendor,
        category: e.category ?? undefined,
        paymentMethod: e.paymentMethod,
        proofType: e.proofType,
        amount: e.amount,
        vat: e.vat,
        total: e.total,
        date: e.date ?? undefined,
        isPaid: e.isPaid,
      },
    });
  }
  for (const c of cashflows) {
    await prisma.cashflow.create({
      data: {
        projectId: resolve(c.project),
        counterparty: c.counterparty,
        amount: c.amount,
        cashChange: c.cashChange,
        type: c.type,
        inAccount: c.inAccount,
        outAccount: c.outAccount,
        date: c.date ?? undefined,
        memo: c.memo,
      },
    });
  }

  console.log("Imported. Verifying against source CSVs...");

  // ---------- verification ----------
  const diffs: string[] = [];
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  const dbProjects = await prisma.financeProject.count();
  if (dbProjects !== projects.length)
    diffs.push(`project count: db=${dbProjects} csv=${projects.length}`);

  const dbInv = await prisma.invoice.findMany();
  if (dbInv.length !== invoices.length)
    diffs.push(`invoice count: db=${dbInv.length} csv=${invoices.length}`);
  const invChecks: Array<[string, number, number]> = [
    ["invoice.amount", sum(dbInv.map((r) => r.amount)), sum(invoices.map((r) => r.amount))],
    ["invoice.vat", sum(dbInv.map((r) => r.vat)), sum(invoices.map((r) => r.vat))],
    ["invoice.total", sum(dbInv.map((r) => r.total)), sum(invoices.map((r) => r.total))],
    [
      "invoice.depositAmount",
      sum(dbInv.map((r) => r.depositAmount ?? 0)),
      sum(invoices.map((r) => r.depositAmount ?? 0)),
    ],
  ];

  const dbExp = await prisma.expense.findMany();
  if (dbExp.length !== expenses.length)
    diffs.push(`expense count: db=${dbExp.length} csv=${expenses.length}`);
  const expChecks: Array<[string, number, number]> = [
    ["expense.amount", sum(dbExp.map((r) => r.amount)), sum(expenses.map((r) => r.amount))],
    ["expense.vat", sum(dbExp.map((r) => r.vat)), sum(expenses.map((r) => r.vat))],
    ["expense.total", sum(dbExp.map((r) => r.total)), sum(expenses.map((r) => r.total))],
    [
      "expense.paidCount",
      dbExp.filter((r) => r.isPaid).length,
      expenses.filter((r) => r.isPaid).length,
    ],
  ];

  const dbCash = await prisma.cashflow.findMany();
  if (dbCash.length !== cashflows.length)
    diffs.push(`cashflow count: db=${dbCash.length} csv=${cashflows.length}`);
  const cashChecks: Array<[string, number, number]> = [
    ["cashflow.amount", sum(dbCash.map((r) => r.amount)), sum(cashflows.map((r) => r.amount))],
    [
      "cashflow.cashChange",
      sum(dbCash.map((r) => r.cashChange)),
      sum(cashflows.map((r) => r.cashChange)),
    ],
  ];

  for (const [label, db, csv] of [...invChecks, ...expChecks, ...cashChecks]) {
    if (db !== csv) diffs.push(`${label}: db=${db} csv=${csv}`);
  }

  // Row-level: every CSV row must match a DB row on all mapped fields incl. dates.
  const dstr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const invKey = (r: {
    buyer: string | null;
    amount: number;
    total: number;
    depositStatus: string | null;
    depositAmount: number | null;
    depositDate: Date | null;
  }) =>
    `${r.buyer}|${r.amount}|${r.total}|${r.depositStatus}|${r.depositAmount ?? ""}|${dstr(r.depositDate)}`;
  const dbInvKeys = new Set(dbInv.map((r) => invKey(r)));
  for (const i of invoices) {
    if (!dbInvKeys.has(invKey(i))) diffs.push(`invoice missing in db: ${invKey(i)}`);
  }
  const expKey = (r: {
    expenseName: string;
    vendor: string | null;
    amount: number;
    total: number;
    date: Date | null;
    isPaid: boolean;
  }) => `${r.expenseName}|${r.vendor}|${r.amount}|${r.total}|${dstr(r.date)}|${r.isPaid}`;
  const dbExpKeys = new Set(dbExp.map((r) => expKey(r)));
  for (const e of expenses) {
    if (!dbExpKeys.has(expKey(e))) diffs.push(`expense missing in db: ${expKey(e)}`);
  }
  const cashKey = (r: {
    counterparty: string;
    amount: number;
    cashChange: number;
    type: string;
    date: Date | null;
  }) => `${r.counterparty}|${r.amount}|${r.cashChange}|${r.type}|${dstr(r.date)}`;
  const dbCashKeys = new Set(dbCash.map((r) => cashKey(r)));
  for (const c of cashflows) {
    if (!dbCashKeys.has(cashKey(c))) diffs.push(`cashflow missing in db: ${cashKey(c)}`);
  }

  console.log("\n=== Totals ===");
  for (const [label, db, csv] of [...invChecks, ...expChecks, ...cashChecks]) {
    console.log(`  ${label}: db=${db} csv=${csv} ${db === csv ? "OK" : "DIFF"}`);
  }

  if (diffs.length === 0) {
    console.log(
      `\n✅ VERIFIED: DB matches source CSVs exactly (projects=${dbProjects}, invoices=${dbInv.length}, expenses=${dbExp.length}, cashflows=${dbCash.length}).`,
    );
  } else {
    console.log(`\n❌ ${diffs.length} DIFFERENCES:`);
    for (const d of diffs) console.log("  - " + d);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
