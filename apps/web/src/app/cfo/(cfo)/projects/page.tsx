import { cfoFetch, formatKrw } from "@/lib/cfo-client";

export const dynamic = "force-dynamic";

type Project = { id: string; name: string; status: string | null };
type Ref = { id: string } | null;
type Invoice = { amount: number; depositAmount: number | null; project: { id: string } | null };
type Expense = { amount: number; project: { id: string } | null };

export default async function ProjectsPage() {
  let projects: Project[] = [];
  let invoices: Invoice[] = [];
  let expenses: Expense[] = [];
  let error: string | null = null;

  try {
    [projects, invoices, expenses] = await Promise.all([
      cfoFetch<Project[]>("projects?limit=500"),
      cfoFetch<Invoice[]>("invoices?limit=500"),
      cfoFetch<Expense[]>("expenses?limit=500"),
    ]);
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : "API 연결 실패";
  }

  if (error) {
    return (
      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#18181b" }} className="rounded-lg p-4 text-sm">
        <p className="font-medium">CFO API에 연결할 수 없습니다</p>
        <p className="mt-1 text-zinc-600">{error}</p>
      </div>
    );
  }

  const byId = (r: Ref) => r?.id ?? "";
  const rollup = projects.map((p) => {
    const revenue = invoices.filter((i) => byId(i.project) === p.id).reduce((s, i) => s + i.amount, 0);
    const cost = expenses.filter((e) => byId(e.project) === p.id).reduce((s, e) => s + e.amount, 0);
    const deposited = invoices.filter((i) => byId(i.project) === p.id).reduce((s, i) => s + (i.depositAmount ?? 0), 0);
    const profit = revenue - cost;
    const margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
    return { ...p, revenue, cost, profit, deposited, margin };
  });

  const totals = rollup.reduce(
    (a, p) => ({ revenue: a.revenue + p.revenue, cost: a.cost + p.cost, profit: a.profit + p.profit, deposited: a.deposited + p.deposited }),
    { revenue: 0, cost: 0, profit: 0, deposited: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">프로젝트</h1>
        <span className="text-sm text-zinc-500">{rollup.length}개 프로젝트</span>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-left text-xs text-zinc-500">
              <th className="px-3 py-2 font-medium">프로젝트명</th>
              <th className="px-3 py-2 font-medium">상태</th>
              <th className="px-3 py-2 text-right font-medium">총매출</th>
              <th className="px-3 py-2 text-right font-medium">총원가/비용</th>
              <th className="px-3 py-2 text-right font-medium">영업이익</th>
              <th className="px-3 py-2 text-right font-medium">이익률</th>
              <th className="px-3 py-2 text-right font-medium">총입금</th>
            </tr>
          </thead>
          <tbody>
            {rollup.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-zinc-50">
                <td className="px-3 py-2 font-medium text-zinc-700">{p.name}</td>
                <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKrw(p.revenue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKrw(p.cost)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${p.profit >= 0 ? "text-green-600" : "text-red-600"}`}>{formatKrw(p.profit)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{p.revenue > 0 ? `${p.margin}%` : "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKrw(p.deposited)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 bg-zinc-50 font-semibold">
              <td className="px-3 py-2" colSpan={2}>합계</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatKrw(totals.revenue)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatKrw(totals.cost)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${totals.profit >= 0 ? "text-green-600" : "text-red-600"}`}>{formatKrw(totals.profit)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{totals.revenue > 0 ? `${Math.round((totals.profit / totals.revenue) * 100)}%` : "-"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatKrw(totals.deposited)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-zinc-400">-</span>;
  const color = status === "완료" ? "#16a34a" : status === "진행" ? "#2563eb" : status === "보류" ? "#a1a1aa" : "#52525b";
  return <span className="rounded-full px-2 py-0.5 text-xs" style={{ border: `1px solid ${color}33`, color }}>{status}</span>;
}
