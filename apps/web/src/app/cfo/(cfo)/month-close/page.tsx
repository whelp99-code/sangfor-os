import { cfoFetch } from "@/lib/cfo-client";
import { formatKRW } from "@sangfor/shared";
import { MonthCloseActions } from "@/components/cfo/month-close-actions";

type Checklist = {
  year: number;
  month: number;
  ready: boolean;
  checklist: { key: string; label: string; pass: boolean; current: number }[];
  summary: { totalRevenue: number; totalExpense: number; netIncome: number };
};

type MonthCloseRecord = { status: string } | null;

export default async function MonthClosePage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  let data: Checklist | null = null;
  let close: MonthCloseRecord = null;
  let error: string | null = null;

  try {
    [data, close] = await Promise.all([
      cfoFetch<Checklist>(`month-close/checklist?year=${year}&month=${month}`),
      cfoFetch<MonthCloseRecord>(`month-close/${year}/${month}`),
    ]);
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : "API 오류";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">월 마감 — {year}년 {month}월</h1>
        {data && <MonthCloseActions year={year} month={month} ready={data.ready} status={close?.status ?? null} />}
      </div>
      {error && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
      {data && (
        <>
          {/* Cash-basis advisory: the 매출 figure aggregates only deposited
              (입금완료) invoices, so an as-yet-uncollected month can read ₩0.
              This is a labelling clarification only — the calculation is
              unchanged — to avoid confusion with accrual-basis revenue. */}
          <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
            현금주의(입금 기준) 집계입니다. 매출은 <strong>입금완료</strong>된 금액만 반영하므로,
            아직 미수금이 회수되지 않은 달은 ₩0으로 보일 수 있습니다(발생주의 매출과 다름).
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-zinc-500">매출 <span className="font-normal text-zinc-400">(입금 기준)</span></p>
              <p className="mt-1 text-xl font-semibold text-blue-600">{formatKRW(data.summary.totalRevenue)}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-zinc-500">지출</p>
              <p className="mt-1 text-xl font-semibold text-orange-600">{formatKRW(data.summary.totalExpense)}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-zinc-500">순이익</p>
              <p className={`mt-1 text-xl font-semibold ${data.summary.netIncome >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatKRW(data.summary.netIncome)}
              </p>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-700">마감 체크리스트</h2>
            <ul className="space-y-2 text-sm">
              {data.checklist.map((item) => (
                <li key={item.key} className="flex items-center justify-between border-b py-1.5 last:border-0">
                  <span className="text-zinc-700">{item.label}</span>
                  <span className={item.pass ? "text-green-600" : "text-amber-600"}>
                    {item.pass ? "✓ 완료" : `미처리 ${item.current}건`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
