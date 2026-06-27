import { cfoFetch, formatKrw } from "@/lib/cfo-client";

type Kpi = {
  year: number;
  month: number;
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
  outstandingAmount: number;
  estimatedVat: number;
};

type CommercialApprovalCard = {
  title: string;
  value: string;
  description: string;
  status: string;
};

const COMMERCIAL_APPROVAL_CARDS: CommercialApprovalCard[] = [
  {
    title: "Pending commercial approvals",
    value: "3",
    description: "Quote, proposal, and discount metadata waiting for human review.",
    status: "metadata-only",
  },
  {
    title: "Low margin quotes",
    value: "2",
    description: "Demo quotes below 25% margin threshold for CFO visibility.",
    status: "review-needed",
  },
  {
    title: "High discount requests",
    value: "1",
    description: "Discount exception above 30% with no send/export/share action attached.",
    status: "human-gated",
  },
];

export default async function DashboardPage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  let kpi: Kpi | null = null;
  let trend: { year: number; month: number; revenue: number; expense: number }[] = [];
  let error: string | null = null;

  try {
    [kpi, trend] = await Promise.all([
      cfoFetch<Kpi>(`dashboard/kpi?year=${year}&month=${month}`),
      cfoFetch<typeof trend>("dashboard/monthly-trend?months=6"),
    ]);
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : "API 연결 실패";
  }

  if (error) {
    return (
      <div
        className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm"
        style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#18181b" }}
      >
        <p className="font-medium">CFO API에 연결할 수 없습니다</p>
        <p className="mt-1 text-zinc-600">{error}</p>
        <p className="mt-2 text-zinc-500">
          1) <code className="rounded bg-white px-1">pnpm dev:api</code> (포트 3200)
          <br />
          2) <code className="rounded bg-white px-1">pnpm dev:web</code> (포트 3110)
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">대시보드</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="이번 달 매출" value={formatKrw(kpi!.totalRevenue)} />
        <MetricCard title="이번 달 지출" value={formatKrw(kpi!.totalExpense)} />
        <MetricCard title="순이익" value={formatKrw(kpi!.netIncome)} />
        <MetricCard title="미수금" value={formatKrw(kpi!.outstandingAmount)} />
      </div>
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-medium">Commercial approval controls</h2>
          <p className="text-sm text-zinc-500">
            Local demo status cards only. No send, export, or share action is attached.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {COMMERCIAL_APPROVAL_CARDS.map((card) => (
            <CommercialApprovalCard key={card.title} card={card} />
          ))}
        </div>
      </section>
      <div className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 font-medium">월별 추이 (최근 6개월)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-zinc-500">
                <th className="py-2">월</th>
                <th className="py-2">매출</th>
                <th className="py-2">지출</th>
              </tr>
            </thead>
            <tbody>
              {trend.map((row) => (
                <tr key={`${row.year}-${row.month}`} className="border-b">
                  <td className="py-2">{row.year}-{row.month}</td>
                  <td className="py-2">{formatKrw(row.revenue)}</td>
                  <td className="py-2">{formatKrw(row.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-sm text-zinc-500">
        예상 부가세: {formatKrw(kpi!.estimatedVat)}
      </p>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm text-zinc-500">{title}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function CommercialApprovalCard({ card }: { card: CommercialApprovalCard }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-zinc-600">{card.title}</p>
        <span className="rounded-full border px-2 py-0.5 text-xs text-zinc-500">{card.status}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold">{card.value}</p>
      <p className="mt-2 text-sm text-zinc-500">{card.description}</p>
    </div>
  );
}
