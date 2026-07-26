import { cfoFetch } from "@/lib/cfo-client";
import { formatKRW } from "@sangfor/shared";
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

export default async function VatPage({ searchParams }: { searchParams: Promise<{ year?: string; half?: string }> }) {
  const now = new Date();
  const defaults = resolveDefaultPeriod(now);
  const query = await searchParams;
  const requestedYear = Number(query.year);
  const requestedHalf = Number(query.half);
  const customPeriod = Number.isInteger(requestedYear) && requestedYear >= 2000 && (requestedHalf === 1 || requestedHalf === 2);
  const year = customPeriod ? requestedYear : defaults.year;
  const half = (customPeriod ? requestedHalf : defaults.half) as 1 | 2;
  const priorPending = !customPeriod && defaults.priorPending;
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
      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4" method="get">
        <label className="grid gap-1 text-sm">
          <span className="text-zinc-500">연도</span>
          <input className="h-9 rounded-md border px-3" name="year" type="number" min="2000" max="9999" defaultValue={year} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-zinc-500">기수</span>
          <select className="h-9 rounded-md border px-3" name="half" defaultValue={half}>
            <option value="1">1기</option>
            <option value="2">2기</option>
          </select>
        </label>
        <button className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white" type="submit">조회</button>
      </form>
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
              {formatKRW(vat.payableVat)}
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              신고기한 {new Date(vat.filingDeadline).toLocaleDateString("ko-KR")}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-zinc-500">매출세액</p>
              <p className="mt-1 text-xl font-semibold text-blue-600">{formatKRW(vat.salesVat)}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-medium text-zinc-500">매입세액</p>
              <p className="mt-1 text-xl font-semibold text-orange-800">{formatKRW(vat.purchaseVat)}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
