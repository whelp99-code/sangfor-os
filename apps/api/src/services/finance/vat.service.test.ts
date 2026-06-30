import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@sangfor/db';
import { VatService, DEDUCTIBLE_PROOF_TYPES } from './vat.service';

const integration = process.env.CI_INTEGRATION === '1';
const service = new VatService();

// Isolated test period far from real data (2099 H1) so seeded rows don't
// collide with the live dataset.
const YEAR = 2099;
const HALF = 1 as const;
const inPeriod = new Date(2099, 2, 15); // March 2099, within H1 bounds

const createdExpenseIds: string[] = [];
const createdTaxInvoiceIds: string[] = [];

describe('VatService — unit (no DB)', () => {
  it('treats 세금계산서 and 전자세금계산서 both as deductible proof types', () => {
    expect(DEDUCTIBLE_PROOF_TYPES).toContain('세금계산서');
    expect(DEDUCTIBLE_PROOF_TYPES).toContain('전자세금계산서');
    expect(DEDUCTIBLE_PROOF_TYPES).toContain('카드전표');
    expect(DEDUCTIBLE_PROOF_TYPES).toContain('현금영수증');
  });
});

describe.skipIf(!integration)('VatService.calculateVat (integration)', () => {
  beforeAll(async () => {
    // Sales tax invoice: 10,000 supply / 1,000 VAT (small, so purchase can exceed it).
    const sales = await prisma.taxInvoice.create({
      data: {
        direction: 'sales',
        status: 'transmitted',
        supplierCorpNum: '0000000000',
        supplierName: 'seller',
        buyerCorpNum: '1111111111',
        buyerName: 'buyer',
        supplyAmount: 10_000,
        vatAmount: 1_000,
        totalAmount: 11_000,
        issueDate: inPeriod,
      },
    });
    createdTaxInvoiceIds.push(sales.id);

    // Paid expense with proofType "세금계산서" (non-electronic) — the previously
    // dropped case. supply 100,000 / VAT 10,000.
    const taxInvoiceProof = await prisma.expense.create({
      data: {
        expenseName: 'tax-invoice-proof',
        amount: 100_000,
        vat: 10_000,
        total: 110_000,
        date: inPeriod,
        isPaid: true,
        proofType: '세금계산서',
      },
    });
    createdExpenseIds.push(taxInvoiceProof.id);

    // Paid expense with proofType "전자세금계산서" — always counted. supply 50,000 / VAT 5,000.
    const eTaxInvoiceProof = await prisma.expense.create({
      data: {
        expenseName: 'e-tax-invoice-proof',
        amount: 50_000,
        vat: 5_000,
        total: 55_000,
        date: inPeriod,
        isPaid: true,
        proofType: '전자세금계산서',
      },
    });
    createdExpenseIds.push(eTaxInvoiceProof.id);
  });

  afterAll(async () => {
    if (createdExpenseIds.length > 0) {
      await prisma.expense.deleteMany({ where: { id: { in: createdExpenseIds } } });
    }
    if (createdTaxInvoiceIds.length > 0) {
      await prisma.taxInvoice.deleteMany({ where: { id: { in: createdTaxInvoiceIds } } });
    }
  });

  it('includes "세금계산서" proof expenses in purchase VAT deduction (B3 fix)', async () => {
    const r = await service.calculateVat(YEAR, HALF);
    // 세금계산서 (10,000) + 전자세금계산서 (5,000) both counted.
    expect(r.purchaseVat).toBe(15_000);
    expect(r.purchaseCount).toBe(2);
  });

  it('represents refund (purchase > sales) instead of clamping to 0', async () => {
    const r = await service.calculateVat(YEAR, HALF);
    // sales VAT 1,000 - purchase VAT 15,000 = -14,000 payable (refund).
    expect(r.salesVat).toBe(1_000);
    expect(r.payableVat).toBe(-14_000);
    expect(r.refundableVat).toBe(14_000);
  });
});
