import { prisma } from '@sangfor/db';

export interface VatPeriodSummary {
  year: number;
  half: 1 | 2;
  startDate: Date;
  endDate: Date;
  salesSupply: number;
  salesVat: number;
  salesCount: number;
  purchaseSupply: number;
  purchaseVat: number;
  purchaseCount: number;
  cardSalesSupply: number;
  cardSalesCount: number;
  cardPurchaseSupply: number;
  cardPurchaseCount: number;
  /**
   * 납부세액. 매출세액 - 매입세액. 매입이 매출을 초과하면 음수(환급) 그대로 표현한다.
   * 음수일 때 환급액은 `refundableVat`에 양수로 분리해 노출한다.
   */
  payableVat: number;
  /** 환급세액(매입 > 매출). 환급이 없으면 0. payableVat가 음수일 때 그 절댓값. */
  refundableVat: number;
  filingDeadline: Date;
  matched: number;
  unmatched: number;
}

/**
 * 매입세액 공제 대상 증빙 유형.
 * DB에는 "세금계산서"(비-전자)와 "전자세금계산서"가 혼재한다(실데이터). 둘 다
 * 적격증빙으로 공제 대상이므로 동일하게 인정한다. 데이터는 수정하지 않고
 * 집계 시점에 동치 취급한다.
 */
export const DEDUCTIBLE_PROOF_TYPES = [
  '세금계산서',
  '전자세금계산서',
  '카드전표',
  '현금영수증',
] as const;

export class VatService {
  getPeriodBounds(year: number, half: 1 | 2): { start: Date; end: Date; deadline: Date } {
    const start = new Date(year, half === 1 ? 0 : 6, 1);
    // 반기 종료일은 "다음 달의 0일" = 직전 달 말일로 잡는다. H1은 (year,6,0)=6/30,
    // H2는 (year+1,0,0)=12/31. 과거에 (year,5,31)로 잡았는데 6월은 30일까지뿐이라
    // JS가 7/1로 롤오버되어(라이브 endDate:2026-07-01) 6/30 매출이 H2로 새던 버그가
    // 있었다. "다음 달 0일" 방식은 월별 말일 차이에 안전하다.
    const end =
      half === 1
        ? new Date(year, 6, 0, 23, 59, 59)
        : new Date(year + 1, 0, 0, 23, 59, 59);
    const deadlineYear = half === 1 ? year : year + 1;
    const deadlineMonth = half === 1 ? 6 : 0;
    const deadline = new Date(deadlineYear, deadlineMonth, 25, 23, 59, 59);
    return { start, end, deadline };
  }

  async calculateVat(year: number, half: 1 | 2): Promise<VatPeriodSummary> {
    const { start, end, deadline } = this.getPeriodBounds(year, half);

    const salesTaxInvoices = await prisma.taxInvoice.findMany({
      where: { direction: 'sales', status: 'transmitted', issueDate: { gte: start, lte: end } },
    });
    const salesSupply = salesTaxInvoices.reduce((s, t) => s + (t.supplyAmount ?? 0), 0);
    const salesVat = salesTaxInvoices.reduce((s, t) => s + (t.vatAmount ?? 0), 0);

    const paidInvoices = await prisma.invoice.findMany({
      where: { depositStatus: '완료', depositDate: { gte: start, lte: end } },
    });
    const linkedTaxIds = new Set(salesTaxInvoices.map((t) => t.invoiceId).filter(Boolean));
    const additionalInvoices = paidInvoices.filter((i) => !linkedTaxIds.has(i.id));
    const additionalSupply = additionalInvoices.reduce((s, i) => s + (i.amount ?? 0), 0);
    const additionalVat = additionalInvoices.reduce((s, i) => s + (i.vat ?? 0), 0);

    const purchaseTaxInvoices = await prisma.taxInvoice.findMany({
      where: { direction: 'purchase', status: 'transmitted', issueDate: { gte: start, lte: end } },
    });
    const purchaseSupply = purchaseTaxInvoices.reduce((s, t) => s + (t.supplyAmount ?? 0), 0);
    const purchaseVat = purchaseTaxInvoices.reduce((s, t) => s + (t.vatAmount ?? 0), 0);

    const expenses = await prisma.expense.findMany({
      where: { date: { gte: start, lte: end }, isPaid: true, proofType: { in: [...DEDUCTIBLE_PROOF_TYPES] } },
    });
    const linkedExpenseIds = new Set(purchaseTaxInvoices.map((t) => t.invoiceId).filter(Boolean));
    const additionalExpenses = expenses.filter((e) => !linkedExpenseIds.has(e.id));
    const additionalPurchaseSupply = additionalExpenses.reduce((s, e) => s + (e.amount ?? 0), 0);
    const additionalPurchaseVat = additionalExpenses.reduce((s, e) => s + (e.vat ?? 0), 0);

    const matched = salesTaxInvoices.length + purchaseTaxInvoices.length;
    const unmatched = paidInvoices.length + expenses.length - matched;

    const totalSalesSupply = salesSupply + additionalSupply;
    const totalSalesVat = salesVat + additionalVat;
    const totalPurchaseSupply = purchaseSupply + additionalPurchaseSupply;
    const totalPurchaseVat = purchaseVat + additionalPurchaseVat;
    // 매입이 매출을 초과하면 환급(음수). 0으로 깔아뭉개지 말고 음수 그대로 보존하고,
    // 환급액은 refundableVat에 양수로 분리해 소비자가 환급 상황을 인지할 수 있게 한다.
    const payableVat = totalSalesVat - totalPurchaseVat;
    const refundableVat = payableVat < 0 ? -payableVat : 0;

    return {
      year, half, startDate: start, endDate: end,
      salesSupply: totalSalesSupply, salesVat: totalSalesVat,
      salesCount: salesTaxInvoices.length + additionalInvoices.length,
      purchaseSupply: totalPurchaseSupply, purchaseVat: totalPurchaseVat,
      purchaseCount: purchaseTaxInvoices.length + additionalExpenses.length,
      // 카드매출 미지원: finance_invoices에 결제수단(payment_method) 컬럼이 없어
      // 카드 분 매출을 식별할 데이터가 없다. 거짓 0(실제 카드매출이 0이라는 의미)이
      // 아니라 "집계 불가"라는 뜻이므로, 스키마에 결제수단이 추가되면 실집계로 교체할 것.
      // TODO(oma-deferred): finance_invoices.payment_method 추가 시 카드매출 실집계.
      cardSalesSupply: 0, cardSalesCount: 0,
      cardPurchaseSupply: additionalPurchaseSupply, cardPurchaseCount: additionalExpenses.length,
      payableVat, refundableVat, filingDeadline: deadline, matched, unmatched: Math.max(0, unmatched),
    };
  }

  calculateIncomeTax(taxableBase: number): {
    brackets: { range: string; rate: number; amount: number }[];
    nationalTax: number;
    localTax: number;
    total: number;
  } {
    const base = Math.max(0, taxableBase);
    const brackets = [
      { limit: 14_000_000, rate: 0.06, name: '~1,400만원' },
      { limit: 50_000_000, rate: 0.15, name: '~5,000만원' },
      { limit: 88_000_000, rate: 0.24, name: '~8,800만원' },
      { limit: 150_000_000, rate: 0.35, name: '~1.5억원' },
      { limit: 300_000_000, rate: 0.38, name: '~3억원' },
      { limit: Infinity, rate: 0.45, name: '3억원 초과' },
    ];
    const breakdown: { range: string; rate: number; amount: number }[] = [];
    let remaining = base;
    let prevLimit = 0;
    let nationalTax = 0;
    for (const b of brackets) {
      const seg = Math.min(remaining, b.limit - prevLimit);
      if (seg <= 0) break;
      const amount = seg * b.rate;
      breakdown.push({ range: b.name, rate: b.rate, amount: Math.round(amount) });
      nationalTax += amount;
      remaining -= seg;
      prevLimit = b.limit;
    }
    nationalTax = Math.round(nationalTax);
    const localTax = Math.round(nationalTax * 0.1);
    return { brackets: breakdown, nationalTax, localTax, total: nationalTax + localTax };
  }
}
