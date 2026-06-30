import { cfoFetch } from "@/lib/cfo-client";
import { CFO, krw } from "@/lib/cfo-theme";
import { CashflowForecastChart, MonthlyPnlChart } from "@/components/cfo/dashboard-charts";
import { RunwayGauge } from "@/components/cfo/runway-gauge";

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
// 미수금·프로젝트손익은 서버에서 집계해 결과만 받는다(과거엔 invoices/expenses 500건씩
// 받아 클라에서 돌렸음 — over-fetch 제거).
type Receivables = {
  total: number;
  count: number;
  rows: { buyer: string; status: string; remaining: number }[];
};
type ProjectPnl = { name: string; revenue: number; cost: number; profit: number };

export default async function DashboardPage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  let kpi: Kpi | null = null;
  let trend: TrendPoint[] = [];
  let forecast: Forecast | null = null;
  let receivablesData: Receivables = { total: 0, count: 0, rows: [] };
  let projectPnl: ProjectPnl[] = [];
  let error: string | null = null;

  try {
    [kpi, trend, forecast, receivablesData, projectPnl] = await Promise.all([
      cfoFetch<Kpi>(`dashboard/kpi?year=${year}&month=${month}`),
      cfoFetch<TrendPoint[]>("dashboard/monthly-trend?months=12"),
      cfoFetch<Forecast>("dashboard/cashflow-forecast?days=90"),
      cfoFetch<Receivables>("dashboard/receivables?limit=8"),
      cfoFetch<ProjectPnl[]>("dashboard/project-pnl?limit=8"),
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

  const ytdRevenue = trend.reduce((s, t) => s + t.revenue, 0);
  const ytdExpense = trend.reduce((s, t) => s + t.expense, 0);
  const ytdNet = ytdRevenue - ytdExpense;

  const receivables = receivablesData.rows;
  const receivablesTotal = receivablesData.total;

  // Distinguish "no data yet" from a genuine zero month: if there are no
  // receivables and no project P&L rows at all, the zeros below reflect an
  // empty ledger rather than a real ₩0 result.
  const ledgerEmpty = receivablesData.count === 0 && projectPnl.length === 0;
  const monthAllZero =
    kpi.totalRevenue === 0 &&
    kpi.totalExpense === 0 &&
    kpi.outstandingAmount === 0 &&
    kpi.outstandingCount === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8" style={{ color: CFO.ink }}>
      {/* Masthead — ledger title with a single brass rule */}
      <header>
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">재무 콘솔</h1>
          <span className="font-mono text-xs" style={{ color: CFO.muted }}>{year}.{String(month).padStart(2, "0")} · 최근 12개월</span>
        </div>
        <div className="mt-2 h-px w-full" style={{ background: CFO.hairline }} />
        <div className="h-0.5 w-16" style={{ background: CFO.brass }} />
      </header>

      {/* Empty-ledger notice — only when there is no financial data at all,
          so a genuine ₩0 month is never mislabelled as "no data". */}
      {ledgerEmpty && monthAllZero && (
        <div
          className="rounded-lg p-3 text-sm"
          style={{ background: CFO.paper, border: `1px solid ${CFO.hairline}`, color: CFO.muted }}
        >
          아직 등록된 인보이스·비용 데이터가 없습니다. 아래 수치는 실제 ₩0이 아니라 집계 대상이 없음을 의미합니다.
        </div>
      )}

      {/* Hero — the signature runway gauge */}
      <RunwayGauge months={kpi.cashRunwayMonths} currentCash={forecast.currentCash} />

      {/* Ledger KPI strip — hairline-divided, monospaced figures */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl md:grid-cols-3 lg:grid-cols-6" style={{ background: CFO.hairline }}>
        <LedgerCell label="미수금 잔액" value={krw(kpi.outstandingAmount)} note={`${kpi.outstandingCount}건 미회수`} tone="outflow" />
        <LedgerCell label="누적매출 12M" value={krw(ytdRevenue)} note="입금 기준" tone="inflow" />
        <LedgerCell label="누적순이익 12M" value={krw(ytdNet)} note={`비용 ${krw(ytdExpense)}`} tone={ytdNet >= 0 ? "inflow" : "outflow"} />
        <LedgerCell label="이번 달 매출" value={krw(kpi.totalRevenue)} note={`${month}월`} />
        <LedgerCell label="예상 부가세" value={krw(kpi.estimatedVat)} note="매입 VAT 기준" />
        <LedgerCell label="월 구독비" value={krw(kpi.monthlySubscription)} note="정기 결제" />
      </section>

      {/* Charts */}
      <section className="grid gap-5 lg:grid-cols-3">
        <Panel title="월별 매출 · 비용 · 순이익" className="lg:col-span-2">
          <MonthlyPnlChart data={trend} />
        </Panel>
        <Panel title="자금흐름 예측 (90일)" subtitle={`현재 ${krw(forecast.currentCash)}`}>
          <CashflowForecastChart data={forecast.forecast} />
        </Panel>
      </section>

      {/* Ledgers */}
      <section className="grid gap-5 lg:grid-cols-2">
        <Panel title="미수금 현황" headerRight={<span className="font-mono text-sm" style={{ color: CFO.outflow }}>{krw(receivablesTotal)}</span>}>
          <Ledger
            head={["거래처", "상태", "잔액"]}
            rows={receivables.slice(0, 8).map((r, i) => [
              r.buyer,
              <StatusTag key={i} status={r.status} />,
              <Num key={i} v={r.remaining} tone="outflow" />,
            ])}
            empty="미수금 없음"
          />
        </Panel>
        <Panel title="프로젝트 손익 (Top 8)">
          <Ledger
            head={["프로젝트", "매출", "원가", "이익"]}
            rows={projectPnl.map((p) => [
              p.name,
              <Num key="r" v={p.revenue} />,
              <Num key="c" v={p.cost} />,
              <Num key="p" v={p.profit} tone={p.profit >= 0 ? "inflow" : "outflow"} />,
            ])}
            empty="데이터 없음"
          />
        </Panel>
      </section>
    </div>
  );
}

function LedgerCell({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "inflow" | "outflow" }) {
  const color = tone ? CFO[tone] : CFO.ink;
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[11px] font-medium" style={{ color: CFO.muted }}>{label}</p>
      <p className="mt-1 font-mono tabular-nums text-lg font-semibold" style={{ color }}>{value}</p>
      {note && <p className="mt-0.5 text-[11px]" style={{ color: CFO.muted }}>{note}</p>}
    </div>
  );
}

function Panel({ title, subtitle, headerRight, className, children }: { title: string; subtitle?: string; headerRight?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${className ?? ""}`} style={{ borderColor: CFO.hairline }}>
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: CFO.ink }}>{title}</h2>
          {subtitle && <p className="text-xs" style={{ color: CFO.muted }}>{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      {children}
    </div>
  );
}

function Ledger({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm" style={{ color: CFO.muted }}>{empty}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr style={{ color: CFO.muted }}>
          {head.map((h, i) => (
            <th key={h} className={`pb-2 text-[11px] font-medium uppercase tracking-wide ${i > 0 ? "text-right" : "text-left"}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} style={{ borderTop: `1px solid ${CFO.hairline}` }}>
            {r.map((c, ci) => (
              <td key={ci} className={`py-2 ${ci > 0 ? "text-right" : "font-medium"}`} style={ci === 0 ? { color: CFO.ink } : undefined}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Num({ v, tone }: { v: number; tone?: "inflow" | "outflow" }) {
  return <span className="font-mono tabular-nums" style={{ color: tone ? CFO[tone] : CFO.ink }}>{krw(v)}</span>;
}

function StatusTag({ status }: { status: string }) {
  const c = status === "부분" ? CFO.brass : status === "미수" ? CFO.outflow : CFO.muted;
  return <span className="rounded-sm px-1.5 py-0.5 font-mono text-[11px]" style={{ border: `1px solid ${c}40`, color: c }}>{status}</span>;
}
