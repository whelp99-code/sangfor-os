import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@sangfor/db';
import { LedgerService } from './ledger.service';

const integration = process.env.CI_INTEGRATION === '1';
const service = new LedgerService();

describe('LedgerService.validate', () => {
  it('accepts balanced entries', () => {
    expect(
      service.validate([{ debitAccount: '100', creditAccount: '200', amount: 100 }]),
    ).toBe(true);
  });
});

// Integration: exercises backfillLedger against a live DB using rows isolated in
// a far-future period (2099) so they never collide with seeded/live data. Each
// document's ledger footprint is asserted before/after and the run is repeated
// to prove idempotency (no double-posting on re-run).
describe.skipIf(!integration)('LedgerService.backfillLedger (integration)', () => {
  const createdInvoiceIds: string[] = [];
  const createdExpenseIds: string[] = [];
  let paidInvoiceId = '';
  let unpaidInvoiceId = '';
  let paidExpenseId = '';
  let unpaidExpenseId = '';

  beforeAll(async () => {
    const paidInvoice = await prisma.invoice.create({
      data: {
        amount: 10_000_000,
        vat: 1_000_000,
        total: 11_000_000,
        depositStatus: '완료',
        depositAmount: 11_000_000,
        depositDate: new Date(2099, 2, 20),
        issueDate: new Date(2099, 2, 15),
        buyer: 'ledger-test-완료',
      },
    });
    paidInvoiceId = paidInvoice.id;
    createdInvoiceIds.push(paidInvoice.id);

    const unpaidInvoice = await prisma.invoice.create({
      data: {
        amount: 5_000_000,
        vat: 500_000,
        total: 5_500_000,
        depositStatus: '미수',
        issueDate: new Date(2099, 2, 15),
        buyer: 'ledger-test-미수',
      },
    });
    unpaidInvoiceId = unpaidInvoice.id;
    createdInvoiceIds.push(unpaidInvoice.id);

    const paidExpense = await prisma.expense.create({
      data: {
        expenseName: 'ledger-test-지급',
        amount: 2_000_000,
        vat: 200_000,
        total: 2_200_000,
        category: '판관비',
        isPaid: true,
        date: new Date(2099, 2, 10),
      },
    });
    paidExpenseId = paidExpense.id;
    createdExpenseIds.push(paidExpense.id);

    const unpaidExpense = await prisma.expense.create({
      data: {
        expenseName: 'ledger-test-미지급',
        amount: 3_000_000,
        vat: 300_000,
        total: 3_300_000,
        category: '판관비',
        isPaid: false,
        date: new Date(2099, 2, 10),
      },
    });
    unpaidExpenseId = unpaidExpense.id;
    createdExpenseIds.push(unpaidExpense.id);
  });

  afterAll(async () => {
    const refs = [...createdInvoiceIds, ...createdExpenseIds];
    if (refs.length) {
      await prisma.ledgerEntry.deleteMany({ where: { reference: { in: refs } } });
    }
    if (createdInvoiceIds.length) {
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdExpenseIds.length) {
      await prisma.expense.deleteMany({ where: { id: { in: createdExpenseIds } } });
    }
  });

  const countEntries = (ref: string) =>
    prisma.ledgerEntry.count({ where: { reference: ref } });

  it('posts issued + paid + expense entries for un-posted documents', async () => {
    const result = await service.backfillLedger();

    // Our 4 test docs contribute: 2 invoices posted, 1 expense posted.
    expect(result.invoicesPosted).toBeGreaterThanOrEqual(2);
    expect(result.expensesPosted).toBeGreaterThanOrEqual(1);

    // 완료 invoice → issued(매출+부가세) + paid(현금) = 3 entries.
    expect(await countEntries(paidInvoiceId)).toBe(3);
    // 미수 invoice → issued only = 2 entries.
    expect(await countEntries(unpaidInvoiceId)).toBe(2);
    // isPaid expense → 지출 + 부가세대급 = 2 entries.
    expect(await countEntries(paidExpenseId)).toBe(2);
    // 미지급 expense → not posted.
    expect(await countEntries(unpaidExpenseId)).toBe(0);

    // 완료 cash receipt is booked to account 100 for the real deposit amount.
    const cash = await prisma.ledgerEntry.findFirst({
      where: { reference: paidInvoiceId, debitAccount: '100' },
    });
    expect(cash?.amount).toBe(11_000_000);
  });

  it('is idempotent — re-run posts nothing and creates no duplicates', async () => {
    const before = {
      paidInv: await countEntries(paidInvoiceId),
      unpaidInv: await countEntries(unpaidInvoiceId),
      paidExp: await countEntries(paidExpenseId),
    };

    const result = await service.backfillLedger();

    // None of our already-posted docs are re-posted.
    expect(await countEntries(paidInvoiceId)).toBe(before.paidInv);
    expect(await countEntries(unpaidInvoiceId)).toBe(before.unpaidInv);
    expect(await countEntries(paidExpenseId)).toBe(before.paidExp);
    // Our test docs land in skipped, never re-posted.
    expect(result.skipped).toBeGreaterThanOrEqual(4);
  });
});
