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
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">구독 / 정기비용</h1>
      {monthly && (
        <p className="text-sm text-zinc-600">
          활성 {monthly.count}건 · 월 환산 {formatKrw(monthly.monthlyTotal)}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-left">
              <th className="p-3">이름</th>
              <th className="p-3">금액</th>
              <th className="p-3">주기</th>
              <th className="p-3">다음 결제</th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.id} className="border-b">
                <td className="p-3">{s.name}</td>
                <td className="p-3">{formatKrw(s.amount)}</td>
                <td className="p-3">{s.cycle}</td>
                <td className="p-3">{new Date(s.nextBillingDate).toLocaleDateString("ko-KR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
