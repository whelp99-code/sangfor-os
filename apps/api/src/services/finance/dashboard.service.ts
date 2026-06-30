import { prisma } from '@sangfor/db';

import {
  cashBalanceFromCashflows,
  cashRunwayMonths,
  estimatedVat as computeEstimatedVat,
  outstandingAmount as computeOutstanding,
} from './finance-amounts';

export class DashboardService {
  async getKpi(year: number, month: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    // 매출 기준 = 공급가(amount). P&L 비용도 공급가 기준이라 일관.
    const paidInvoices = await prisma.invoice.aggregate({
      where: { depositStatus: '완료', depositDate: { gte: start, lte: end } },
      _sum: { amount: true, vat: true },
      _count: true,
    });
    const totalRevenue = paidInvoices._sum.amount ?? 0;
    const salesVat = paidInvoices._sum.vat ?? 0;

    const expenses = await prisma.expense.aggregate({
      where: { isPaid: true, date: { gte: start, lte: end } },
      _sum: { amount: true, total: true, vat: true },
      _count: true,
    });
    // 비용도 공급가(amount) 기준으로 통일.
    const totalExpense = expenses._sum.amount ?? 0;
    const purchaseVat = expenses._sum.vat ?? 0;

    const netIncome = totalRevenue - totalExpense;

    // 미수금 SSOT: Σ(total - depositAmount) for 미완료. 부분입금 차감.
    const outstandingInvoices = await prisma.invoice.findMany({
      where: { depositStatus: { not: '완료' } },
      select: { total: true, depositAmount: true, depositStatus: true },
    });
    const outstandingAmount = computeOutstanding(outstandingInvoices);

    const subs = await prisma.financeSubscription.findMany({ where: { isActive: true } });
    let monthlySubscription = 0;
    for (const s of subs) {
      if (s.cycle === 'monthly') monthlySubscription += s.amount;
      else if (s.cycle === 'yearly') monthlySubscription += s.amount / 12;
      else if (s.cycle === 'weekly') monthlySubscription += s.amount * 4.345;
    }
    monthlySubscription = Math.round(monthlySubscription);

    // 예상 부가세 = 매출세액 - 매입세액 (환급 음수 보존).
    const estimatedVat = computeEstimatedVat(salesVat, purchaseVat);

    // 현재 현금 = cashflow 기반 (미수금이 아니라). 런웨이도 현금 기준.
    const cashflows = await prisma.cashflow.findMany({
      select: { cashChange: true, balanceAfter: true, date: true },
    });
    const currentCash = cashBalanceFromCashflows(cashflows);

    return {
      year, month,
      totalRevenue: Math.round(totalRevenue),
      totalExpense: Math.round(totalExpense),
      netIncome: Math.round(netIncome),
      outstandingAmount,
      outstandingCount: outstandingInvoices.length,
      revenueCount: paidInvoices._count,
      expenseCount: expenses._count,
      monthlySubscription,
      estimatedVat,
      cashRunwayMonths: cashRunwayMonths(currentCash, totalExpense),
    };
  }

  async getCashflowForecast(days = 90) {
    const today = new Date();
    const start30 = new Date();
    start30.setDate(start30.getDate() - 30);

    const recentInvoices = await prisma.invoice.findMany({
      where: { depositDate: { gte: start30 } },
    });
    const recentExpenses = await prisma.expense.findMany({
      where: { date: { gte: start30 }, isPaid: true },
    });
    // 비용도 공급가(amount) 기준으로 통일.
    const avgMonthlyRevenue = recentInvoices.reduce((s, r) => s + (r.amount ?? 0), 0);
    const avgMonthlyExpense = recentExpenses.reduce((s, e) => s + (e.amount ?? 0), 0);
    const dailyRevenue = avgMonthlyRevenue / 30;
    const dailyExpense = avgMonthlyExpense / 30;

    // 현재 현금 = cashflow 기반 (미수금이 아니라). 데이터 없으면 null(미산출).
    const cashflows = await prisma.cashflow.findMany({
      select: { cashChange: true, balanceAfter: true, date: true },
    });
    const currentCash = cashBalanceFromCashflows(cashflows);

    const forecast: { date: string; balance: number | null }[] = [];
    for (let d = 0; d <= days; d += 7) {
      const date = new Date(today);
      date.setDate(date.getDate() + d);
      // 현금 미산출이면 잔액 예측도 정직하게 null.
      const projected =
        currentCash == null ? null : Math.round(currentCash + (dailyRevenue - dailyExpense) * d);
      forecast.push({
        date: date.toISOString().slice(0, 10),
        balance: projected,
      });
    }
    const finalBalance = forecast[forecast.length - 1]?.balance ?? null;
    return {
      currentCash: currentCash == null ? null : Math.round(currentCash),
      dailyRevenue: Math.round(dailyRevenue),
      dailyExpense: Math.round(dailyExpense),
      forecast,
      trend:
        finalBalance == null
          ? 'unknown'
          : finalBalance > 0
            ? 'positive'
            : finalBalance > -1_000_000
              ? 'warning'
              : 'negative',
    };
  }

  async getMonthlyTrend(months = 6) {
    const now = new Date();
    const result: { year: number; month: number; revenue: number; expense: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const paid = await prisma.invoice.aggregate({
        where: { depositStatus: '완료', depositDate: { gte: start, lte: end } },
        _sum: { amount: true },
      });
      const exp = await prisma.expense.aggregate({
        where: { isPaid: true, date: { gte: start, lte: end } },
        _sum: { amount: true },
      });
      // 매출·비용 모두 공급가(amount) 기준으로 통일.
      result.push({
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        revenue: Math.round(paid._sum.amount ?? 0),
        expense: Math.round(exp._sum.amount ?? 0),
      });
    }
    return result;
  }
}
