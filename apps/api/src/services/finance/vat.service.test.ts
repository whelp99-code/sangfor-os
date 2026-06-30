import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@sangfor/db';
import { VatService, DEDUCTIBLE_PROOF_TYPES } from './vat.service';
import { requireHalf, requireYear, BadRequestError } from '../../routes/cfo';

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

describe('VatService.getPeriodBounds — half-year boundaries', () => {
  // H1 종료가 6/30이어야 하고 7/1로 새면 안 된다 (라이브 endDate:2026-07-01 버그).
  it('ends H1 on June 30 (not July 1 rollover)', () => {
    const { start, end } = service.getPeriodBounds(2026, 1);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(0); // January
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(5); // June (0-indexed) — NOT July
    expect(end.getDate()).toBe(30);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('includes 6/30 23:59:59 and excludes 7/1 00:00:00 for H1', () => {
    const { end } = service.getPeriodBounds(2026, 1);
    const jun30 = new Date(2026, 5, 30, 23, 59, 59);
    const jul1 = new Date(2026, 6, 1, 0, 0, 0);
    expect(jun30.getTime()).toBeLessThanOrEqual(end.getTime()); // included
    expect(jul1.getTime()).toBeGreaterThan(end.getTime()); // excluded
  });

  it('ends H2 on December 31', () => {
    const { start, end } = service.getPeriodBounds(2026, 2);
    expect(start.getMonth()).toBe(6); // July
    expect(start.getDate()).toBe(1);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(11); // December
    expect(end.getDate()).toBe(31);
  });

  it('sets filing deadlines (H1 → 7/25 same year, H2 → 1/25 next year)', () => {
    const h1 = service.getPeriodBounds(2026, 1).deadline;
    expect(h1.getFullYear()).toBe(2026);
    expect(h1.getMonth()).toBe(6); // July
    expect(h1.getDate()).toBe(25);

    const h2 = service.getPeriodBounds(2026, 2).deadline;
    expect(h2.getFullYear()).toBe(2027);
    expect(h2.getMonth()).toBe(0); // January
    expect(h2.getDate()).toBe(25);
  });
});

describe('cfo route input validation — half / year', () => {
  it('accepts half 1 and 2 (string or number)', () => {
    expect(requireHalf('1')).toBe(1);
    expect(requireHalf('2')).toBe(2);
    expect(requireHalf(1)).toBe(1);
    expect(requireHalf(2)).toBe(2);
  });

  it('rejects half=3 and other out-of-range values with BadRequestError', () => {
    // half=3 previously returned 200 with garbage period; now must throw → 400.
    expect(() => requireHalf('3')).toThrow(BadRequestError);
    expect(() => requireHalf('0')).toThrow(BadRequestError);
    expect(() => requireHalf('abc')).toThrow(BadRequestError);
    expect(() => requireHalf(undefined)).toThrow(BadRequestError);
  });

  it('accepts a valid year', () => {
    expect(requireYear('2026')).toBe(2026);
    expect(requireYear(2026)).toBe(2026);
  });

  it('rejects non-numeric year (year=abc) with a generic message, no stack leak', () => {
    // Previously year=abc → NaN → Prisma threw a stack-bearing error exposed as 400 body.
    expect(() => requireYear('abc')).toThrow(BadRequestError);
    expect(() => requireYear('abc')).toThrow(/연도/);
    expect(() => requireYear(undefined)).toThrow(BadRequestError);
    expect(() => requireYear('2026.5')).toThrow(BadRequestError);
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
