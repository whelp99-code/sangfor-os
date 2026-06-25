import { cfoFetch } from "@/lib/cfo-client";

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
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">월 마감 — {year}년 {month}월</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && (
        <>
          <p className={`text-sm font-medium ${data.ready ? "text-green-700" : "text-amber-700"}`}>
            {data.ready ? "마감 가능" : "마감 전 확인 필요"}
          </p>
          <ul className="space-y-2 rounded-lg border bg-white p-4 text-sm">
            {data.checklist.map((item) => (
              <li key={item.key} className="flex justify-between">
                <span>{item.label}</span>
                <span>{item.pass ? "✓" : `현재 ${item.current}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
