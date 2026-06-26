import { prisma } from '@sangfor/db';

export class MonthCloseService {
  async runChecklist(year: number, month: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    const uncategorizedExpenses = await prisma.expense.count({
      where: { date: { gte: start, lte: end }, category: { in: ['', '기타'] } },
    });

    const pendingInvoices = await prisma.invoice.count({
      where: { depositStatus: { notIn: ['완료', '취소'] } },
    });

    const outstanding = await prisma.invoice.aggregate({
      where: { depositStatus: { not: '완료' } },
      _sum: { amount: true, vat: true },
    });

    const totalRevenue = await prisma.invoice.aggregate({
      where: { depositDate: { gte: start, lte: end }, depositStatus: '완료' },
      _sum: { amount: true, vat: true },
    });

    const totalExpense = await prisma.expense.aggregate({
      where: { date: { gte: start, lte: end }, isPaid: true },
      _sum: { amount: true, vat: true },
    });

    const revenue = (totalRevenue._sum.amount ?? 0) + (totalRevenue._sum.vat ?? 0);
    const expense = (totalExpense._sum.amount ?? 0) + (totalExpense._sum.vat ?? 0);
    const netIncome = revenue - expense;

    const items = [
      { key: 'uncategorized', label: '미분류 거래 0건', pass: uncategorizedExpenses === 0, current: uncategorizedExpenses },
      { key: 'pending_invoices', label: '입금 미확인 인보이스 0건', pass: pendingInvoices === 0, current: pendingInvoices },
    ];

    const allPass = items.every((i) => i.pass);

    return {
      year, month, ready: allPass,
      checklist: items,
      summary: {
        totalRevenue: Math.round(revenue),
        totalExpense: Math.round(expense),
        netIncome: Math.round(netIncome),
        uncategorizedCount: uncategorizedExpenses,
        outstandingAmount: Math.round((outstanding._sum.amount ?? 0) + (outstanding._sum.vat ?? 0)),
      },
    };
  }

  async start(year: number, month: number, notes?: string) {
    const existing = await prisma.monthClose.findUnique({
      where: { year_month: { year, month } },
    });
    if (existing?.status === 'completed') {
      throw new Error(`${year}-${month} 이미 마감 완료됨`);
    }
    return prisma.monthClose.upsert({
      where: { year_month: { year, month } },
      create: { year, month, status: 'in_progress', startedAt: new Date(), notes },
      update: { status: 'in_progress', startedAt: new Date(), notes },
    });
  }

  async complete(year: number, month: number) {
    const check = await this.runChecklist(year, month);
    if (!check.ready) {
      throw new Error('마감 체크리스트 미통과: ' + check.checklist.filter((i) => !i.pass).map((i) => i.label).join(', '));
    }
    return prisma.monthClose.upsert({
      where: { year_month: { year, month } },
      create: {
        year, month, status: 'completed', startedAt: new Date(), completedAt: new Date(),
        totalRevenue: check.summary.totalRevenue,
        totalExpense: check.summary.totalExpense,
        netIncome: check.summary.netIncome,
        uncategorizedCount: check.summary.uncategorizedCount,
      },
      update: {
        status: 'completed', completedAt: new Date(),
        totalRevenue: check.summary.totalRevenue,
        totalExpense: check.summary.totalExpense,
        netIncome: check.summary.netIncome,
        uncategorizedCount: check.summary.uncategorizedCount,
      },
    });
  }

  async list() {
    return prisma.monthClose.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  }

  async get(year: number, month: number) {
    return prisma.monthClose.findUnique({ where: { year_month: { year, month } } });
  }
}
