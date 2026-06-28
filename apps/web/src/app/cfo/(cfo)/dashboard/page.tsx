import { cfoFetch, formatKrw } from "@/lib/cfo-client";
import { CashflowForecastChart, MonthlyPnlChart } from "@/components/cfo/dashboard-charts";

export const dynamic = "force-dynamic";

type Kpi = {
  year: number;
  month: number;
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
  outstandingAmount: number;
  outstandingCount: number;
  estimatedVat: number;
  monthlySubscription: number;
  cashRunwayMonths: number | null;
};
type TrendPoint = { year: number; month: number; revenue: number; expense: number };
type Forecast = { currentCash: number; forecast: { date: string; balance: number }[] };
type ProjectRef = { id: string; name: string } | null;
type Invoice = {
  buyer: string | null;
  total: number;
  depositAmount: number | null;
  depositStatus: string | null;
  amount: number;
  project: ProjectRef;
};
type Expense = { total: number; amount: number; project: ProjectRef };

export default async function DashboardPage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  let kpi: Kpi | null = null;
  let trend: TrendPoint[] = [];
  let forecast: Forecast | null = null;
  let invoices: Invoice[] = [];
  let expenses: Expense[] = [];
  let error: string | null = null;

  try {
    [kpi, trend, forecast, invoices, expenses] = await Promise.all([
      cfoFetch<Kpi>(`dashboard/kpi?year=${year}&month=${month}`),
      cfoFetch<TrendPoint[]>("dashboard/monthly-trend?months=12"),
      cfoFetch<Forecast>("dashboard/cashflow-forecast?days=90"),
      cfoFetch<Invoice[]>("invoices?limit=500"),
      cfoFetch<Expense[]>("expenses?limit=500"),
    ]);
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : "API 연결 실패";
  }

  if (error || !kpi || !forecast) {
    return (
      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#18181b" }} className="rounded-lg p-4 text-sm">
        <p className="font-medium">CFO API에 연결할 수 없습니다</p>
        <p className="mt-1 text-zinc-600">{error}</p>
      </div>
    );
  }

  // Year-to-date aggregates from the 12-month trend.
  const ytdRevenue = trend.reduce((s, t) => s + t.revenue, 0);
  const ytdExpense = trend.reduce((s, t) => s + t.expense, 0);
  const ytdNet = ytdRevenue - ytdExpense;

  // Receivables: unpaid / partially-paid invoices, by remaining balance.
  const receivables = invoices
    .map((i) => ({
      buyer: i.buyer ?? i.project?.name ?? "—",
      status: i.depositStatus ?? "미수",
      remaining: i.total - (i.depositAmount ?? 0),
    }))
    .filter((r) => r.status !== "완료" && r.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);
  const receivablesTotal = receivables.reduce((s, r) => s + r.remaining, 0);

  // Project P&L: revenue (invoice supply) vs cost (expense supply).
  const pnl = new Map<string, { name: string; revenue: number; cost: number }>();
  for (const i of invoices) {
    const name = i.project?.name ?? "미배정";
    const e = pnl.get(name) ?? { name, revenue: 0, cost: 0 };
    e.revenue += i.amount;
    pnl.set(name, e);
  }
  for (const x of expenses) {
    const name = x.project?.name ?? "미배정";
    const e = pnl.get(name) ?? { name, revenue: 0, cost: 0 };
    e.cost += x.amount;
    pnl.set(name, e);
  }
  const projectPnl = [...pnl.values()]
    .map((p) => ({ ...p, profit: p.revenue - p.cost }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">CFO 대시보드</h1>
        <p className="text-sm text-zinc-500">최근 12개월 기준 · {year}년 {month}월</p>
      </div>

      {/* Hero KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="미수금 잔액" value={formatKrw(kpi.outstandingAmount)} sub={`${kpi.outstandingCount}건 미회수`} accent="amber" />
        <Metric title="현금 런웨이" value={kpi.cashRunwayMonths != null ? `${kpi.cashRunwayMonths}개월` : "—"} sub="미수금 ÷ 월 지출" accent="indigo" />
        <Metric title="누적 매출 (12M)" value={formatKrw(ytdRevenue)} sub="입금 기준" accent="blue" />
        <Metric title="누적 순이익 (12M)" value={formatKrw(ytdNet)} sub={`비용 ${formatKrw(ytdExpense)}`} accent={ytdNet >= 0 ? "green" : "red"} />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-white p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">월별 매출 · 비용 · 순이익</h2>
          <MonthlyPnlChart data={trend} />
        </div>
        <div className="rounded-xl border bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-700">자금흐름 예측 (90일)</h2>
          <p className="mb-2 text-xs text-zinc-400">현재 현금 {formatKrw(forecast.currentCash)}</p>
          <CashflowForecastChart data={forecast.forecast} />
        </div>
      </div>

      {/* Receivables + Project P&L */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">미수금 현황</h2>
            <span className="text-sm font-medium text-amber-600">{formatKrw(receivablesTotal)}</span>
          </div>
          <Table
            head={["거래처", "상태", "잔액"]}
            rows={receivables.slice(0, 8).map((r, i) => [r.buyer, <Badge key={i} status={r.status} />, formatKrw(r.remaining)])}
            empty="미수금 없음"
          />
        </div>
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">프로젝트 손익 (Top 8)</h2>
          <Table
            head={["프로젝트", "매출", "원가", "이익"]}
            rows={projectPnl.map((p) => [
              p.name,
              formatKrw(p.revenue),
              formatKrw(p.cost),
              <span key={p.name} className={p.profit >= 0 ? "text-green-600" : "text-red-600"}>{formatKrw(p.profit)}</span>,
            ])}
            empty="데이터 없음"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric title="이번 달 매출" value={formatKrw(kpi.totalRevenue)} sub={`${month}월`} accent="blue" small />
        <Metric title="예상 부가세" value={formatKrw(kpi.estimatedVat)} sub="매입 VAT 기준" accent="zinc" small />
        <Metric title="월 구독비" value={formatKrw(kpi.monthlySubscription)} sub="정기 결제" accent="zinc" small />
      </div>
    </div>
  );
}

const ACCENTS: Record<string, string> = {
  amber: "#d97706",
  indigo: "#4f46e5",
  blue: "#2563eb",
  green: "#16a34a",
  red: "#dc2626",
  zinc: "#52525b",
};

function Metric({ title, value, sub, accent = "zinc", small }: { title: string; value: string; sub?: string; accent?: string; small?: boolean }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs font-medium text-zinc-500">{title}</p>
      <p className={`mt-1 font-semibold ${small ? "text-lg" : "text-2xl"}`} style={{ color: ACCENTS[accent] }}>{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const color = status === "부분" ? "#d97706" : status === "미수" ? "#dc2626" : "#52525b";
  return <span className="rounded-full px-2 py-0.5 text-xs" style={{ border: `1px solid ${color}33`, color }}>{status}</span>;
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-zinc-400">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-zinc-400">
            {head.map((h, i) => (
              <th key={h} className={`py-2 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b last:border-0">
              {r.map((c, ci) => (
                <td key={ci} className={`py-2 ${ci > 0 ? "text-right tabular-nums" : "font-medium text-zinc-700"}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
