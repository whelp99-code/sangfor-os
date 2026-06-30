import Link from "next/link";

import { cfoFetch, formatKrw } from "@/lib/cfo-client";
import { CfoPageHeading } from "@/components/cfo/page-heading";
import { CFO } from "@/lib/cfo-theme";

export const dynamic = "force-dynamic";

// ADR-001 Phase 2b — finance is rolled up by deal (Engagement), not the legacy
// FinanceProject. Rows carry the linked opportunity so each deal's P&L deep-links
// back into the CRM. Un-backfilled finance collapses into the "미배정" bucket.
type DealPnl = {
  engagementId: string | null;
  opportunityId: string | null;
  dealTitle: string;
  customer: string | null;
  revenue: number;
  cost: number;
  deposited: number;
  profit: number;
  invoiceCount: number;
  expenseCount: number;
};

export default async function ProjectsPage() {
  let rows: DealPnl[] = [];
  let error: string | null = null;

  try {
    rows = await cfoFetch<DealPnl[]>("deals-pnl");
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

  const assigned = rows.filter((r) => r.engagementId !== null);
  const unassigned = rows.find((r) => r.engagementId === null);
  const totals = rows.reduce(
    (a, r) => ({ revenue: a.revenue + r.revenue, cost: a.cost + r.cost, profit: a.profit + r.profit, deposited: a.deposited + r.deposited }),
    { revenue: 0, cost: 0, profit: 0, deposited: 0 },
  );

  return (
    <div className="space-y-4">
      <CfoPageHeading
        title="딜별 손익"
        right={
          <span className="text-sm" style={{ color: CFO.muted }}>
            {assigned.length}개 딜{unassigned ? " · 미배정 1" : ""}
          </span>
        }
      />
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-left text-xs text-zinc-500">
              <th className="px-3 py-2 font-medium">딜</th>
              <th className="px-3 py-2 font-medium">고객</th>
              <th className="px-3 py-2 text-right font-medium">건수(청구/비용)</th>
              <th className="px-3 py-2 text-right font-medium">총매출</th>
              <th className="px-3 py-2 text-right font-medium">총원가/비용</th>
              <th className="px-3 py-2 text-right font-medium">영업이익</th>
              <th className="px-3 py-2 text-right font-medium">이익률</th>
              <th className="px-3 py-2 text-right font-medium">총입금(공급가환산)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const margin = r.revenue > 0 ? Math.round((r.profit / r.revenue) * 100) : 0;
              const isUnassigned = r.engagementId === null;
              return (
                <tr key={r.engagementId ?? "__unassigned"} className="border-b last:border-0 hover:bg-zinc-50">
                  <td className="px-3 py-2 font-medium text-zinc-700">
                    {r.opportunityId ? (
                      <Link href={`/deals/${r.opportunityId}`} className="hover:underline" style={{ color: CFO.ink }}>
                        {r.dealTitle}
                      </Link>
                    ) : (
                      <span className={isUnassigned ? "text-zinc-400" : undefined}>{r.dealTitle}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">{r.customer ?? "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{r.invoiceCount}/{r.expenseCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKrw(r.revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKrw(r.cost)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.profit >= 0 ? "text-green-600" : "text-red-600"}`}>{formatKrw(r.profit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{r.revenue > 0 ? `${margin}%` : "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKrw(r.deposited)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-400">데이터가 없습니다</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 bg-zinc-50 font-semibold">
              <td className="px-3 py-2" colSpan={3}>합계</td>
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
