import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MonthCloseService {
  private readonly logger = new Logger(MonthCloseService.name);

  constructor(@Inject('PRISMA') private readonly prisma: any) {}

  /**
   * 마감 가능 여부 체크
   * - 미분류 Expense가 0건이어야 함
   * - 모든 Invoice에 입금 상태가 설정되어야 함
   * - 미수금이 0원이어야 함 (선택)
   */
  async runChecklist(year: number, month: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    const uncategorizedExpenses = await this.prisma.expense.count({
      where: { date: { gte: start, lte: end }, category: { in: [null, '', '기타'] } },
    });

    const pendingInvoices = await this.prisma.invoice.count({
      where: { depositStatus: { notIn: ['완료', '취소'] } },
    });

    const outstanding = await this.prisma.invoice.aggregate({
      where: { depositStatus: { not: '완료' } },
      _sum: { amount: true, vat: true },
    });

    const totalRevenue = await this.prisma.invoice.aggregate({
      where: { depositDate: { gte: start, lte: end }, depositStatus: '완료' },
      _sum: { amount: true, vat: true },
    });

    const totalExpense = await this.prisma.expense.aggregate({
      where: { date: { gte: start, lte: end }, isPaid: true },
      _sum: { amount: true, vat: true },
    });

    const revenue = (totalRevenue._sum.amount ?? 0) + (totalRevenue._sum.vat ?? 0);
    const expense = (totalExpense._sum.amount ?? 0) + (totalExpense._sum.vat ?? 0);
    const netIncome = revenue - expense;

    const items = [
      {
        key: 'uncategorized',
        label: '미분류 거래 0건',
        pass: uncategorizedExpenses === 0,
        current: uncategorizedExpenses,
      },
      {
        key: 'pending_invoices',
        label: '입금 미확인 인보이스 0건',
        pass: pendingInvoices === 0,
        current: pendingInvoices,
      },
    ];

    const allPass = items.every((i) => i.pass);

    return {
      year,
      month,
      ready: allPass,
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
    const existing = await this.prisma.monthClose.findUnique({
      where: { year_month: { year, month } },
    });
    if (existing?.status === 'completed') {
      throw new BadRequestException(`${year}-${month} 이미 마감 완료됨`);
    }
    return this.prisma.monthClose.upsert({
      where: { year_month: { year, month } },
      create: { year, month, status: 'in_progress', startedAt: new Date(), notes },
      update: { status: 'in_progress', startedAt: new Date(), notes },
    });
  }

  async complete(year: number, month: number) {
    const check = await this.runChecklist(year, month);
    if (!check.ready) {
      throw new BadRequestException('마감 체크리스트 미통과: ' + check.checklist.filter((i) => !i.pass).map((i) => i.label).join(', '));
    }
    return this.prisma.monthClose.upsert({
      where: { year_month: { year, month } },
      create: {
        year,
        month,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        totalRevenue: check.summary.totalRevenue,
        totalExpense: check.summary.totalExpense,
        netIncome: check.summary.netIncome,
        uncategorizedCount: check.summary.uncategorizedCount,
      },
      update: {
        status: 'completed',
        completedAt: new Date(),
        totalRevenue: check.summary.totalRevenue,
        totalExpense: check.summary.totalExpense,
        netIncome: check.summary.netIncome,
        uncategorizedCount: check.summary.uncategorizedCount,
      },
    });
  }

  async list() {
    return this.prisma.monthClose.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  }

  async get(year: number, month: number) {
    return this.prisma.monthClose.findUnique({ where: { year_month: { year, month } } });
  }
}
