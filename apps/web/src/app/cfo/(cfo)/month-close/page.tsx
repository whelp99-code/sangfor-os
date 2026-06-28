import { cfoFetch, formatKrw } from "@/lib/cfo-client";

type Checklist = {
  year: number;
  month: number;
  ready: boolean;
  checklist: { key: string; label: string; pass: boolean; current: number }[];
  summary: { totalRevenue: number; totalExpense: number; netIncome: number };
};

export default async function MonthClosePage() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  let data: Checklist | null = null;
  let error: string | null = null;

  try {
    data = await cfoFetch<Checklist>(`month-close/checklist?year=${year}&month=${month}`);
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : "API 오류";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">월 마감 — {year}년 {month}월</h1>
        {data && (
          <span
            className="rounded-full px-3 py-1 text-sm font-medium"
            style={{
              background: data.ready ? "#dcfce7" : "#fef3c7",
              color: data.ready ? "#15803d" : "#b45309",
            }}
          >
            {data.ready ? "마감 가능" : "마감 전 확인 필요"}
          </span>
        )}
      </div>
      {error && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-zinc-500">매출</p>
              <p className="mt-1 text-xl font-semibold text-blue-600">{formatKrw(data.summary.totalRevenue)}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-zinc-500">지출</p>
              <p className="mt-1 text-xl font-semibold text-orange-600">{formatKrw(data.summary.totalExpense)}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-zinc-500">순이익</p>
              <p className={`mt-1 text-xl font-semibold ${data.summary.netIncome >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatKrw(data.summary.netIncome)}
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
