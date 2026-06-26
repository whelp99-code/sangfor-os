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
