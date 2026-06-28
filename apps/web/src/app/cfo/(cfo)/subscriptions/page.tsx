import { cfoFetch, formatKrw } from "@/lib/cfo-client";

type Subscription = {
  id: string;
  name: string;
  vendor: string | null;
  amount: number;
  cycle: string;
  category: string | null;
  nextBillingDate: string;
  isActive: boolean;
};

export default async function SubscriptionsPage() {
  let subs: Subscription[] = [];
  let monthly: { monthlyTotal: number; count: number } | null = null;
  let error: string | null = null;

  try {
    [subs, monthly] = await Promise.all([
      cfoFetch<Subscription[]>("subscriptions"),
      cfoFetch<{ monthlyTotal: number; count: number }>("subscriptions/summary/monthly"),
    ]);
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : "API 오류";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">구독 / 정기비용</h1>
        {monthly && (
          <p className="text-sm text-zinc-500">활성 {monthly.count}건 · 월 환산 {formatKrw(monthly.monthlyTotal)}</p>
        )}
      </div>
      {error && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-left text-xs text-zinc-500">
              <th className="px-3 py-2 font-medium">이름</th>
              <th className="px-3 py-2 font-medium">매입처</th>
              <th className="px-3 py-2 text-right font-medium">금액</th>
              <th className="px-3 py-2 font-medium">주기</th>
              <th className="px-3 py-2 font-medium">다음 결제</th>
              <th className="px-3 py-2 font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {subs.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-400">등록된 구독 없음</td></tr>
            ) : (
              subs.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-zinc-50">
                  <td className="px-3 py-2 font-medium text-zinc-700">{s.name}</td>
                  <td className="px-3 py-2 text-zinc-600">{s.vendor ?? "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKrw(s.amount)}</td>
                  <td className="px-3 py-2">{s.cycle}</td>
                  <td className="px-3 py-2 tabular-nums">{new Date(s.nextBillingDate).toLocaleDateString("ko-KR")}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full px-2 py-0.5 text-xs" style={{ border: `1px solid ${s.isActive ? "#16a34a" : "#a1a1aa"}33`, color: s.isActive ? "#16a34a" : "#a1a1aa" }}>
                      {s.isActive ? "활성" : "중지"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
