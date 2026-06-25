import { Injectable, Inject, Logger } from '@nestjs/common';

export interface VatPeriodSummary {
  year: number;
  half: 1 | 2; // 1기: 1~6월, 2기: 7~12월
  startDate: Date;
  endDate: Date;
  salesSupply: number;       // 매출 공급가액
  salesVat: number;          // 매출 세액
  salesCount: number;
  purchaseSupply: number;    // 매입 공급가액
  purchaseVat: number;       // 매입 세액
  purchaseCount: number;
  cardSalesSupply: number;   // 카드/현금영수증 매출
  cardSalesCount: number;
  cardPurchaseSupply: number;// 카드 매입 (사업용)
  cardPurchaseCount: number;
  payableVat: number;        // 납부할 세액
  filingDeadline: Date;      // 신고 기한
  matched: number;           // 매칭된 매입
  unmatched: number;         // 미매칭 매입
}

@Injectable()
export class VatService {
  private readonly logger = new Logger(VatService.name);

  constructor(@Inject('PRISMA') private readonly prisma: any) {}

  /**
   * 부가세 기간 계산
   * 1기: 1~6월 (신고기한: 7월 25일)
   * 2기: 7~12월 (신고기한: 다음해 1월 25일)
   */
  getPeriodBounds(year: number, half: 1 | 2): { start: Date; end: Date; deadline: Date } {
    const start = new Date(year, half === 1 ? 0 : 6, 1);
    const end = new Date(year, half === 1 ? 5 : 11, 31, 23, 59, 59);
    const deadlineYear = half === 1 ? year : year + 1;
    const deadlineMonth = half === 1 ? 6 : 0; // 7월, 1월 (0-indexed)
    const deadline = new Date(deadlineYear, deadlineMonth, 25, 23, 59, 59);
    return { start, end, deadline };
  }

  /**
   * 부가세 신고 요약 계산
   * 데이터 소스:
   * - 매출: Invoice (depositStatus=완료) 또는 TaxInvoice(sales, transmitted)
   * - 매입: Expense + TaxInvoice(purchase, transmitted)
   * - 카드 매출: 현금영수증/카드 매출 (별도 테이블이 없으므로 합산 가능)
   */
  async calculateVat(year: number, half: 1 | 2): Promise<VatPeriodSummary> {
    const { start, end, deadline } = this.getPeriodBounds(year, half);

    // 1) 매출 세금계산서 합산
    const salesTaxInvoices = await this.prisma.taxInvoice.findMany({
      where: {
        direction: 'sales',
        status: 'transmitted',
        issueDate: { gte: start, lte: end },
      },
    });
    const salesSupply = salesTaxInvoices.reduce((s, t) => s + (t.supplyAmount ?? 0), 0);
    const salesVat = salesTaxInvoices.reduce((s, t) => s + (t.vatAmount ?? 0), 0);

    // 2) 매출 Invoice (입금 완료) - 세금계산서 미발행인 경우
    const paidInvoices = await this.prisma.invoice.findMany({
      where: {
        depositStatus: '완료',
        depositDate: { gte: start, lte: end },
      },
    });
    // 세금계산서 발행된 건은 제외 (방금 위에서 카운트됨)
    const linkedTaxIds = new Set(
      salesTaxInvoices.map((t) => t.invoiceId).filter(Boolean),
    );
    const additionalInvoices = paidInvoices.filter((i) => !linkedTaxIds.has(i.id));
    const additionalSupply = additionalInvoices.reduce(
      (s, i) => s + (i.amount ?? 0),
      0,
    );
    const additionalVat = additionalInvoices.reduce((s, i) => s + (i.vat ?? 0), 0);

    // 3) 매입 세금계산서
    const purchaseTaxInvoices = await this.prisma.taxInvoice.findMany({
      where: {
        direction: 'purchase',
        status: 'transmitted',
        issueDate: { gte: start, lte: end },
      },
    });
    const purchaseSupply = purchaseTaxInvoices.reduce(
      (s, t) => s + (t.supplyAmount ?? 0),
      0,
    );
    const purchaseVat = purchaseTaxInvoices.reduce((s, t) => s + (t.vatAmount ?? 0), 0);

    // 4) 매입 Expense (사업용 카드/현금 영수증 - 증빙 있는 매입)
    const expenses = await this.prisma.expense.findMany({
      where: {
        date: { gte: start, lte: end },
        isPaid: true,
        proofType: { in: ['카드전표', '전자세금계산서', '현금영수증'] },
      },
    });
    const linkedExpenseIds = new Set(
      purchaseTaxInvoices
        .map((t) => t.invoiceId)
        .filter(Boolean),
    );
    const additionalExpenses = expenses.filter(
      (e) => !linkedExpenseIds.has(e.id),
    );
    const additionalPurchaseSupply = additionalExpenses.reduce(
      (s, e) => s + (e.amount ?? 0),
      0,
    );
    const additionalPurchaseVat = additionalExpenses.reduce(
      (s, e) => s + (e.vat ?? 0),
      0,
    );

    // 5) 매칭/미매칭 카운트
    const matched = salesTaxInvoices.length + purchaseTaxInvoices.length;
    const unmatched = paidInvoices.length + expenses.length - matched;

    const totalSalesSupply = salesSupply + additionalSupply;
    const totalSalesVat = salesVat + additionalVat;
    const totalPurchaseSupply = purchaseSupply + additionalPurchaseSupply;
    const totalPurchaseVat = purchaseVat + additionalPurchaseVat;
    const payableVat = Math.max(0, totalSalesVat - totalPurchaseVat);

    return {
      year,
      half,
      startDate: start,
      endDate: end,
      salesSupply: totalSalesSupply,
      salesVat: totalSalesVat,
      salesCount: salesTaxInvoices.length + additionalInvoices.length,
      purchaseSupply: totalPurchaseSupply,
      purchaseVat: totalPurchaseVat,
      purchaseCount: purchaseTaxInvoices.length + additionalExpenses.length,
      cardSalesSupply: 0, // 현금영수증 별도 추적 시 계산
      cardSalesCount: 0,
      cardPurchaseSupply: additionalPurchaseSupply,
      cardPurchaseCount: additionalExpenses.length,
      payableVat,
      filingDeadline: deadline,
      matched,
      unmatched: Math.max(0, unmatched),
    };
  }

  /**
   * 종합소득세 예상 (단순 6단계 세율 기반)
   * 사업소득 = 매출 - 비용
   * 과세표준 = 사업소득 - 기본공제(250만원)
   * 세율 구간 (2026년 기준):
   *  - 1,400만원 이하: 6%
   *  - 5,000만원 이하: 15%
   *  - 8,800만원 이하: 24%
   *  - 1.5억원 이하: 35%
   *  - 3억원 이하: 38%
   *  - 3억원 초과: 45%
   * + 지방소득세 10%
   */
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
    return {
      brackets: breakdown,
      nationalTax,
      localTax,
      total: nationalTax + localTax,
    };
  }
}
