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
  /**
   * 적격증빙(세금계산서/전자세금계산서/카드전표/현금영수증) 확보 매입 건수.
   * 과거 필드명은 `matched`였으나 "인보이스↔세금계산서 매칭 건수"로 오독되었다.
   * 실제로는 공제 대상 증빙이 붙은 매입(=transmitted 세금계산서 + 공제 expense) 수를
   * 뜻하므로 의미를 명확히 한다. 하위호환을 위해 `matched`는 동일 값의 별칭으로 유지.
   */
  proofBackedPurchaseCount: number;
  /** @deprecated `proofBackedPurchaseCount` 사용. 동일 값 별칭(하위호환). */
  matched: number;
  /**
   * 기간 내 지급 건 중 적격증빙이 확인되지 않은 건수(인보이스+expense 총건 - 증빙확보 건).
   * 과거 필드명 `unmatched`. 의미를 명확히 하되 별칭으로 유지.
   */
  proofMissingCount: number;
  /** @deprecated `proofMissingCount` 사용. 동일 값 별칭(하위호환). */
  unmatched: number;
}

/** 카드매입으로 집계할 증빙 유형. 실제 카드전표만 카드로 분류한다. */
const CARD_PROOF_TYPE = '카드전표';

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
    // 매입 direction의 세금계산서-지출 연결 FK는 expenseId다(invoiceId는 매출 인보이스
    // 연결용이라 purchase에서는 항상 null). 과거 t.invoiceId로 dedup해 매입은 전부
    // null → Set이 비어 dedup이 무효화됐고, 세금계산서에 연결된 지출이
    // additionalExpenses로도 다시 잡혀 매입세액에 이중 계상될 수 있었다.
    const linkedExpenseIds = new Set(purchaseTaxInvoices.map((t) => t.expenseId).filter(Boolean));
    const additionalExpenses = expenses.filter((e) => !linkedExpenseIds.has(e.id));

    // proofType별 분류 보정 (Round 10 MED):
    // tax_invoices 테이블이 비어 세금계산서/전자세금계산서/현금영수증 지출이 모두
    // additionalExpenses로 흘러든다. 과거에는 이 전부를 cardPurchaseSupply로 집계해
    // 실제 카드전표가 아닌데 "카드매입"으로 오라벨했다. 이제 proofType==='카드전표'인
    // 건만 카드매입으로, 나머지 적격증빙(세금계산서·전자세금계산서·현금영수증)은 일반
    // 매입으로 집계한다. 공제 매입세액 총액(additionalPurchaseVat)은 분류와 무관하게
    // 동일하다 — 어느 버킷에 담기든 매입세액 공제 대상이기 때문.
    const cardExpenses = additionalExpenses.filter((e) => e.proofType === CARD_PROOF_TYPE);
    const nonCardExpenses = additionalExpenses.filter((e) => e.proofType !== CARD_PROOF_TYPE);

    const cardPurchaseSupply = cardExpenses.reduce((s, e) => s + (e.amount ?? 0), 0);
    const cardPurchaseVat = cardExpenses.reduce((s, e) => s + (e.vat ?? 0), 0);
    const nonCardPurchaseSupply = nonCardExpenses.reduce((s, e) => s + (e.amount ?? 0), 0);
    const nonCardPurchaseVat = nonCardExpenses.reduce((s, e) => s + (e.vat ?? 0), 0);

    // 세금계산서(purchaseTaxInvoices) + expense 증빙(카드/비카드 전부)이 공제 매입세액.
    const additionalPurchaseSupply = cardPurchaseSupply + nonCardPurchaseSupply;
    const additionalPurchaseVat = cardPurchaseVat + nonCardPurchaseVat;

    // 적격증빙이 확보된 매입 건수(=transmitted 세금계산서 + 공제 대상 expense).
    const proofBackedPurchaseCount = purchaseTaxInvoices.length + additionalExpenses.length;
    // 기간 내 지급 건 총계 - 증빙확보 매입 건. 매출 인보이스도 지급 건에 포함되므로
    // 증빙(세금계산서) 없이 입금 완료된 매출/지급을 잔여로 노출한다.
    const proofMissingCount = Math.max(
      0,
      paidInvoices.length + expenses.length - proofBackedPurchaseCount,
    );

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
      // 카드매출 미지원(stub, 항상 0): 매출은 finance_invoices / finance_tax_invoices에서
      // 나오는데 두 테이블 모두 결제수단(payment_method) 컬럼이 없어 카드 분 매출을 식별할
      // 데이터가 없다. finance_expenses에는 paymentMethod가 있으나 그것은 매입(비용)이라
      // 매출 집계와 무관하다. 이 0은 거짓 0(실제 카드매출이 0)이 아니라 "집계 불가"라는
      // 뜻이므로, 매출 소스에 결제수단이 추가되면 실집계로 교체할 것.
      // TODO(oma-deferred): finance_invoices/finance_tax_invoices에 payment_method 추가 시 카드매출 실집계.
      cardSalesSupply: 0, cardSalesCount: 0,
      // 실제 카드전표(proofType==='카드전표')만 카드매입으로 집계. 세금계산서·현금영수증
      // 지출은 일반 매입(purchaseSupply)에 이미 포함되어 여기서 제외된다.
      cardPurchaseSupply, cardPurchaseCount: cardExpenses.length,
      payableVat, refundableVat, filingDeadline: deadline,
      proofBackedPurchaseCount, matched: proofBackedPurchaseCount,
      proofMissingCount, unmatched: proofMissingCount,
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
