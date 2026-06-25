import { Inject, Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(@Inject('PRISMA') private readonly prisma: any) {}

  /**
   * 대시보드 KPI 조회
   */
  async getKpi(year: number, month: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    // 매출: 입금 완료된 인보이스
    const paidInvoices = await this.prisma.invoice.aggregate({
      where: { depositStatus: '완료', depositDate: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    });
    const totalRevenue = paidInvoices._sum.amount ?? 0;

    // 비용: 결제 완료된 지출
    const expenses = await this.prisma.expense.aggregate({
      where: { isPaid: true, date: { gte: start, lte: end } },
      _sum: { total: true },
      _count: true,
    });
    const totalExpense = expenses._sum.total ?? 0;

    // 순이익
    const netIncome = totalRevenue - totalExpense;

    // 미수금
    const outstanding = await this.prisma.invoice.aggregate({
      where: { depositStatus: { not: '완료' } },
      _sum: { amount: true },
      _count: true,
    });
    const outstandingAmount = outstanding._sum.amount ?? 0;

    // 구독 월 비용
    const subs = await this.prisma.subscription.findMany({ where: { isActive: true } });
    let monthlySubscription = 0;
    for (const s of subs) {
      if (s.cycle === 'monthly') monthlySubscription += s.amount;
      else if (s.cycle === 'yearly') monthlySubscription += s.amount / 12;
      else if (s.cycle === 'weekly') monthlySubscription += s.amount * 4.345;
    }
    monthlySubscription = Math.round(monthlySubscription);

    // 예상 부가세 (매출 VAT - 매입 VAT)
    const salesVat = 0; // Invoice에는 VAT 필드가 없으므로 0
    const purchaseVat = await this.prisma.expense.aggregate({
      where: { isPaid: true, date: { gte: start, lte: end } },
      _sum: { vat: true },
    });
    const estimatedVat = Math.max(0, salesVat - (purchaseVat._sum.vat ?? 0));

    return {
      year,
      month,
      totalRevenue: Math.round(totalRevenue),
      totalExpense: Math.round(totalExpense),
      netIncome: Math.round(netIncome),
      outstandingAmount: Math.round(outstandingAmount),
      outstandingCount: outstanding._count,
      revenueCount: paidInvoices._count,
      expenseCount: expenses._count,
      monthlySubscription,
      estimatedVat: Math.round(estimatedVat),
      cashRunwayMonths:
        totalExpense > 0
          ? Math.round(((outstandingAmount + 0) / totalExpense) * 10) / 10
          : null,
    };
  }

  /**
   * 90일 현금흐름 예측
   */
  async getCashflowForecast(days = 90) {
    const today = new Date();
    const start30 = new Date();
    start30.setDate(start30.getDate() - 30);

    const recentInvoices = await this.prisma.invoice.findMany({
      where: { depositDate: { gte: start30 } },
    });
    const recentExpenses = await this.prisma.expense.findMany({
      where: { date: { gte: start30 }, isPaid: true },
    });
    const avgMonthlyRevenue =
      recentInvoices.reduce((s, r) => s + (r.amount ?? 0), 0);
    const avgMonthlyExpense =
      recentExpenses.reduce((s, e) => s + (e.total ?? 0), 0);
    const dailyRevenue = avgMonthlyRevenue / 30;
    const dailyExpense = avgMonthlyExpense / 30;

    // 미수금 추정
    const outstanding = await this.prisma.invoice.aggregate({
      where: { depositStatus: { not: '완료' } },
      _sum: { amount: true },
    });
    let currentCash = outstanding._sum.amount ?? 0;

    const forecast: { date: string; balance: number }[] = [];
    for (let d = 0; d <= days; d += 7) {
      const date = new Date(today);
      date.setDate(date.getDate() + d);
      currentCash = (outstanding._sum.amount ?? 0) - dailyExpense * d;
      forecast.push({
        date: date.toISOString().slice(0, 10),
        balance: Math.round(currentCash),
      });
    }
    const finalBalance = forecast[forecast.length - 1]?.balance ?? 0;
    return {
      currentCash: Math.round(outstanding._sum.amount ?? 0),
      dailyRevenue: Math.round(dailyRevenue),
      dailyExpense: Math.round(dailyExpense),
      forecast,
      trend: finalBalance > 0 ? 'positive' : finalBalance > -1_000_000 ? 'warning' : 'negative',
    };
  }

  /**
   * 월별 매출/지출 추이 (최근 N개월)
   */
  async getMonthlyTrend(months = 6) {
    const now = new Date();
    const result: { year: number; month: number; revenue: number; expense: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const paid = await this.prisma.invoice.aggregate({
        where: { depositStatus: '완료', depositDate: { gte: start, lte: end } },
        _sum: { amount: true },
      });
      const exp = await this.prisma.expense.aggregate({
        where: { isPaid: true, date: { gte: start, lte: end } },
        _sum: { total: true },
      });
      result.push({
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        revenue: Math.round(paid._sum.amount ?? 0),
        expense: Math.round(exp._sum.total ?? 0),
      });
    }
    return result;
  }
}
