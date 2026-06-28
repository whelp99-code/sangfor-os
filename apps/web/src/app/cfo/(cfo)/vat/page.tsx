import { cfoFetch, formatKrw } from "@/lib/cfo-client";

type VatSummary = {
  year: number;
  half: 1 | 2;
  payableVat: number;
  salesVat: number;
  purchaseVat: number;
  filingDeadline: string;
};

export default async function VatPage() {
  const year = new Date().getFullYear();
  const half = new Date().getMonth() < 6 ? 1 : 2;
  let vat: VatSummary | null = null;
  let error: string | null = null;

  try {
    vat = await cfoFetch<VatSummary>(`vat/calculate?year=${year}&half=${half}`);
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : "API 오류";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">부가세</h1>
        <p className="text-sm text-zinc-500">{year}년 {half}기 예정</p>
      </div>
      {error && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
      {vat && (
        <>
          <div className="rounded-xl border bg-white p-5">
            <p className="text-xs font-medium text-zinc-500">{vat.year}년 {vat.half}기 납부 예상</p>
            <p className="mt-1 text-3xl font-semibold" style={{ color: vat.payableVat >= 0 ? "#dc2626" : "#16a34a" }}>
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
