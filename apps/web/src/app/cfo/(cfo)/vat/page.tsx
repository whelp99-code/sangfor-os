import { cfoFetch, formatKrw } from "@/lib/cfo-client";
import { CfoPageHeading } from "@/components/cfo/page-heading";
import { CFO } from "@/lib/cfo-theme";

type VatSummary = {
  year: number;
  half: 1 | 2;
  payableVat: number;
  salesVat: number;
  purchaseVat: number;
  filingDeadline: string;
};

/**
 * 조회 기본 반기 결정.
 *
 * 단순히 `month < 6 ? H1 : H2`로 잡으면 반기가 바뀐 직후(예: 7/1) 아직 실적이 없는
 * 새 반기(H2)가 기본 조회되어, 신고기한이 임박한 직전 반기(H1, 신고기한 7/25)를 빈
 * 화면으로 은폐한다. 그래서 "직전 반기의 신고기한이 아직 지나지 않았으면" 직전 반기를
 * 기본으로 잡는다.
 *
 * 반기 신고기한: H1 → 그 해 7/25, H2 → 다음 해 1/25.
 */
function resolveDefaultPeriod(now: Date): { year: number; half: 1 | 2; priorPending: boolean } {
  const y = now.getFullYear();
  const currentHalf: 1 | 2 = now.getMonth() < 6 ? 1 : 2;

  // 직전 반기와 그 신고기한.
  const prior =
    currentHalf === 1
      ? { year: y - 1, half: 2 as const, deadline: new Date(y, 0, 25, 23, 59, 59) } // H2 → 1/25
      : { year: y, half: 1 as const, deadline: new Date(y, 6, 25, 23, 59, 59) }; // H1 → 7/25

  // 직전 반기 신고기한이 아직 안 지났으면(신고 임박) 직전 반기를 기본 표시.
  if (now <= prior.deadline) {
    return { year: prior.year, half: prior.half, priorPending: true };
  }
  return { year: y, half: currentHalf, priorPending: false };
}

export default async function VatPage() {
  const now = new Date();
  const { year, half, priorPending } = resolveDefaultPeriod(now);
  let vat: VatSummary | null = null;
  let error: string | null = null;

  try {
    vat = await cfoFetch<VatSummary>(`vat/calculate?year=${year}&half=${half}`);
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : "API 오류";
  }

  return (
    <div className="space-y-6">
      <CfoPageHeading
        title="부가세"
        right={<span className="text-sm" style={{ color: CFO.muted }}>{year}년 {half}기 {priorPending ? "확정신고" : "예정"}</span>}
      />
      {priorPending && (
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
          {year}년 {half}기 부가세 신고기한이 임박했습니다. 직전 반기 확정 실적을 표시합니다.
        </p>
      )}
      {error && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
      {vat && (
        <>
          <div className="rounded-xl border bg-white p-5">
            <p className="text-xs font-medium text-zinc-500">{vat.year}년 {vat.half}기 납부 예상</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums" style={{ color: vat.payableVat >= 0 ? CFO.outflow : CFO.inflow }}>
              {formatKrw(vat.payableVat)}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              신고기한 {new Date(vat.filingDeadline).toLocaleDateString("ko-KR")}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-zinc-500">매출세액</p>
              <p className="mt-1 text-xl font-semibold text-blue-600">{formatKrw(vat.salesVat)}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-zinc-500">매입세액</p>
              <p className="mt-1 text-xl font-semibold text-orange-600">{formatKrw(vat.purchaseVat)}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
