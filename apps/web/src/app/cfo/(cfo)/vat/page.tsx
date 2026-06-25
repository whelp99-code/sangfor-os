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
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">부가세</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {vat && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border bg-white p-4">
            <p className="text-sm text-zinc-500">{vat.year}년 {vat.half}기 납부 예상</p>
            <p className="mt-2 text-2xl font-semibold">{formatKrw(vat.payableVat)}</p>
          </div>
          <div className="rounded-lg border bg-white p-4 text-sm space-y-2">
            <p>매출세액: {formatKrw(vat.salesVat)}</p>
            <p>매입세액: {formatKrw(vat.purchaseVat)}</p>
            <p>신고기한: {new Date(vat.filingDeadline).toLocaleDateString("ko-KR")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
