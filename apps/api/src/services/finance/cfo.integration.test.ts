import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@sangfor/db";
import { CashflowsService } from "./cashflows.service";
import { DashboardService } from "./dashboard.service";

const integration = process.env.CI_INTEGRATION === "1";
const TAG = "__cfo_integ__"; // unique marker for created rows → safe cleanup

async function cleanup() {
  await prisma.cashflow.deleteMany({ where: { memo: TAG } });
  await prisma.invoice.deleteMany({ where: { memo: TAG } });
  await prisma.expense.deleteMany({ where: { memo: TAG } });
  await prisma.financeProject.deleteMany({ where: { name: TAG } });
}

describe.skipIf(!integration)("CFO import + matching (integration)", () => {
  let projectId: string;

  beforeAll(async () => {
    await cleanup();
    const project = await prisma.financeProject.create({ data: { name: TAG } });
    projectId = project.id;
    // invoice gives the buyer→project mapping used by the matcher
    await prisma.invoice.create({
      data: { projectId, buyer: "인테그상사", amount: 1_000_000, vat: 100_000, total: 1_100_000, memo: TAG },
    });
  });

  afterAll(cleanup);

  it("imports, dedupes by balanceAfter, and auto-matches the project", async () => {
    const svc = new CashflowsService();
    const row = {
      date: "2026-05-10",
      counterparty: "인테그상사",
      amount: 1_000_000,
      cashChange: 1_000_000,
      balanceAfter: 9_999,
      memo: TAG,
    };
    const first = await svc.importMany([row, { ...row }]); // same row twice
    expect(first.created).toBe(1);
    expect(first.skipped).toBe(1); // deduped by date+cashChange+balanceAfter
    expect(first.matched).toBe(1); // counterparty → invoice buyer → project

    const saved = await prisma.cashflow.findFirst({ where: { memo: TAG } });
    expect(saved?.projectId).toBe(projectId);
    expect(saved?.balanceAfter).toBe(9_999);

    // re-import is fully idempotent
    const again = await svc.importMany([row]);
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(1);
  });

  it("computes dashboard KPI deltas from a paid invoice and expense", async () => {
    const dash = new DashboardService();
    const base = await dash.getKpi(2026, 9);
    await prisma.invoice.create({
      data: {
        projectId,
        buyer: "인테그상사",
        amount: 2_000_000,
        vat: 200_000,
        total: 2_200_000,
        depositStatus: "완료",
        depositAmount: 2_200_000,
        depositDate: new Date("2026-09-15T00:00:00.000Z"),
        memo: TAG,
      },
    });
    await prisma.expense.create({
      data: { projectId, expenseName: "테스트비용", amount: 500_000, vat: 50_000, total: 550_000, date: new Date("2026-09-10T00:00:00.000Z"), isPaid: true, memo: TAG },
    });
    const after = await dash.getKpi(2026, 9);
    // Round 2 SSOT: both revenue and expense are supply-basis (pre-VAT `amount`),
    // so VAT is excluded from the P&L (it's a separate payable/recoverable item).
    expect(after.totalRevenue - base.totalRevenue).toBe(2_000_000);
    expect(after.totalExpense - base.totalExpense).toBe(500_000);
  });
});
