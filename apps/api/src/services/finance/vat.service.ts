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
  payableVat: number;
  filingDeadline: Date;
  matched: number;
  unmatched: number;
}

export class VatService {
  getPeriodBounds(year: number, half: 1 | 2): { start: Date; end: Date; deadline: Date } {
    const start = new Date(year, half === 1 ? 0 : 6, 1);
    const end = new Date(year, half === 1 ? 5 : 11, 31, 23, 59, 59);
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
      where: { date: { gte: start, lte: end }, isPaid: true, proofType: { in: ['카드전표', '전자세금계산서', '현금영수증'] } },
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
    const payableVat = Math.max(0, totalSalesVat - totalPurchaseVat);

    return {
      year, half, startDate: start, endDate: end,
      salesSupply: totalSalesSupply, salesVat: totalSalesVat,
      salesCount: salesTaxInvoices.length + additionalInvoices.length,
      purchaseSupply: totalPurchaseSupply, purchaseVat: totalPurchaseVat,
      purchaseCount: purchaseTaxInvoices.length + additionalExpenses.length,
      cardSalesSupply: 0, cardSalesCount: 0,
      cardPurchaseSupply: additionalPurchaseSupply, cardPurchaseCount: additionalExpenses.length,
      payableVat, filingDeadline: deadline, matched, unmatched: Math.max(0, unmatched),
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
