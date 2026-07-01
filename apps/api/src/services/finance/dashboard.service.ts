import { prisma } from '@sangfor/db';

import {
  cashBalanceFromCashflows,
  cashRunwayMonths,
  estimatedVat as computeEstimatedVat,
  isOutstanding,
  outstandingAmount as computeOutstanding,
  outstandingCount as computeOutstandingCount,
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

    // 미수금 SSOT: isOutstanding(total>0 && 잔액>0 && ≠완료) 술어로 금액·건수 동시 산출.
    // where는 완료만 배제하고(넓게), 0원·잔액0 유령 인보이스는 isOutstanding에서 제외해
    // 건수(outstandingCount)와 금액(outstandingAmount)이 동일 모집단에서 나오게 한다.
    const outstandingInvoices = await prisma.invoice.findMany({
      where: { depositStatus: { not: '완료' } },
      select: { total: true, depositAmount: true, depositStatus: true },
    });
    const outstandingAmount = computeOutstanding(outstandingInvoices);
    const outstandingCount = computeOutstandingCount(outstandingInvoices);

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
      outstandingCount,
      revenueCount: paidInvoices._count,
      expenseCount: expenses._count,
      monthlySubscription,
      estimatedVat,
      cashRunwayMonths: cashRunwayMonths(currentCash, totalExpense),
    };
  }

  /**
   * 미수금 현황 패널 SSOT (서버 집계).
   *
   * 대시보드가 invoices?limit=500을 받아 클라에서 돌리던 집계를 그대로 서버로 옮긴 것.
   * 모든 인보이스를 대상으로 status≠완료 && 잔액>0 인 건만 잔액 내림차순 정렬한다.
   * remaining = total - COALESCE(depositAmount, 0). 패널은 상위 N건만 쓰므로 limit로 자른다.
   */
  async getReceivables(limit = 8) {
    const invoices = await prisma.invoice.findMany({
      select: { buyer: true, total: true, depositAmount: true, depositStatus: true, project: { select: { name: true } } },
    });
    const rows = invoices
      // 미수 판정은 isOutstanding SSOT로 통일 (KPI outstandingCount와 동일 모집단).
      // 0원 유령 인보이스·잔액0·완료분 모두 여기서 배제되어 rows.length == outstandingCount.
      .filter((i) => isOutstanding(i))
      .map((i) => ({
        buyer: i.buyer ?? i.project?.name ?? '—',
        status: i.depositStatus ?? '미수',
        remaining: (i.total ?? 0) - (i.depositAmount ?? 0),
      }))
      .sort((a, b) => b.remaining - a.remaining);
    const total = rows.reduce((s, r) => s + r.remaining, 0);
    return { total: Math.round(total), count: rows.length, rows: rows.slice(0, limit) };
  }

  /**
   * 프로젝트 손익 패널 SSOT (서버 집계).
   *
   * 대시보드가 invoices+expenses 500건씩 받아 클라에서 그룹핑하던 집계를 서버로 이전.
   * 프로젝트명(없으면 '미배정')으로 묶어 매출=Σ(invoice.amount), 원가=Σ(expense.amount).
   * 매출 내림차순 정렬 후 상위 N개. (납입/입금 상태와 무관하게 전체 합산 — 기존 동작 유지.)
   */
  async getProjectPnl(limit = 8) {
    const [invoices, expenses] = await Promise.all([
      prisma.invoice.findMany({ select: { amount: true, project: { select: { name: true } } } }),
      prisma.expense.findMany({ select: { amount: true, project: { select: { name: true } } } }),
    ]);
    const pnl = new Map<string, { name: string; revenue: number; cost: number }>();
    for (const i of invoices) {
      const name = i.project?.name ?? '미배정';
      const e = pnl.get(name) ?? { name, revenue: 0, cost: 0 };
      e.revenue += i.amount ?? 0;
      pnl.set(name, e);
    }
    for (const x of expenses) {
      const name = x.project?.name ?? '미배정';
      const e = pnl.get(name) ?? { name, revenue: 0, cost: 0 };
      e.cost += x.amount ?? 0;
      pnl.set(name, e);
    }
    return [...pnl.values()]
      .map((p) => ({ name: p.name, revenue: Math.round(p.revenue), cost: Math.round(p.cost), profit: Math.round(p.revenue - p.cost) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }

  async getCashflowForecast(days = 90) {
    const today = new Date();
    const WINDOW_DAYS = 30;

    // 예측 근거(일평균 매출/비용)는 최근 30일 트레일링으로 잡되, 기준을 오늘로 고정하면
    // 실데이터 최신일(입금 4/30, 지출 5/29)과 오늘(7/1) 사이 공백 때문에 윈도우가 텅 비어
    // dailyRevenue/Expense=0 → 90일 전구간 평선이 된다. 그래서 "데이터 최신일" 기준
    // 상대 윈도우로 잡는다: max(depositDate)/max(date)에서 30일을 되짚는다.
    const [latestInvoice, latestExpense] = await Promise.all([
      prisma.invoice.findFirst({
        where: { depositDate: { not: null } },
        orderBy: { depositDate: 'desc' },
        select: { depositDate: true },
      }),
      prisma.expense.findFirst({
        where: { isPaid: true },
        orderBy: { date: 'desc' },
        select: { date: true },
      }),
    ]);

    // 매출·비용 윈도우 앵커를 각자의 최신 데이터일로 잡는다(둘의 최신일이 달라도 각자 최근
    // 30일을 본다). 데이터가 아예 없으면 앵커 없음 → 근거 부족 플래그.
    const revenueAnchor = latestInvoice?.depositDate ?? null;
    const expenseAnchor = latestExpense?.date ?? null;

    const windowFrom = (anchor: Date | null): Date | null => {
      if (!anchor) return null;
      const from = new Date(anchor);
      from.setDate(from.getDate() - WINDOW_DAYS);
      return from;
    };

    const [recentInvoices, recentExpenses] = await Promise.all([
      revenueAnchor
        ? prisma.invoice.findMany({
            where: { depositDate: { gte: windowFrom(revenueAnchor)!, lte: revenueAnchor } },
          })
        : Promise.resolve([]),
      expenseAnchor
        ? prisma.expense.findMany({
            where: { isPaid: true, date: { gte: windowFrom(expenseAnchor)!, lte: expenseAnchor } },
          })
        : Promise.resolve([]),
    ]);

    // 비용도 공급가(amount) 기준으로 통일.
    const avgMonthlyRevenue = recentInvoices.reduce((s, r) => s + (r.amount ?? 0), 0);
    const avgMonthlyExpense = recentExpenses.reduce((s, e) => s + (e.amount ?? 0), 0);
    const dailyRevenue = avgMonthlyRevenue / WINDOW_DAYS;
    const dailyExpense = avgMonthlyExpense / WINDOW_DAYS;

    // 예측 근거 부족 판정: 최근 30일 윈도우에 매출·비용 표본이 하나도 없으면 run-rate가
    // 0이라 예측이 무의미하다. 이때는 forecast를 currentCash 평선으로 두되 플래그로 알린다.
    const insufficientData = recentInvoices.length === 0 && recentExpenses.length === 0;

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
      // 예측 run-rate 산출에 실제로 사용한 데이터 윈도우(관측 최신일 기준). null이면 표본 없음.
      revenueWindow: revenueAnchor
        ? { from: windowFrom(revenueAnchor)!.toISOString().slice(0, 10), to: revenueAnchor.toISOString().slice(0, 10), samples: recentInvoices.length }
        : null,
      expenseWindow: expenseAnchor
        ? { from: windowFrom(expenseAnchor)!.toISOString().slice(0, 10), to: expenseAnchor.toISOString().slice(0, 10), samples: recentExpenses.length }
        : null,
      // true면 최근 30일 무데이터 → 위 forecast는 run-rate 0(현금 평선), 예측 근거 부족.
      insufficientData,
      forecast,
      trend: insufficientData
        ? 'unknown'
        : finalBalance == null
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
