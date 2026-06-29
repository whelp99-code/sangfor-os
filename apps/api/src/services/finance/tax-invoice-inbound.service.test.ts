import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@sangfor/db';
import {
  SAMPLE_TAXINVOICE_XML,
  buildSecureMailHtmlForTest,
} from './hometax-securemail/__fixtures__/synthetic';
import { ingestSecureMailHtml } from './tax-invoice-inbound.service';
import { LedgerService } from './ledger.service';

const integration = process.env.CI_INTEGRATION === '1';
const BIZ = '4208702727';
const ISSUE_ID = '202605291026052950358925';
const TAG = `__taxinv_integ_${ISSUE_ID}__`;

const html = buildSecureMailHtmlForTest(SAMPLE_TAXINVOICE_XML, BIZ);

async function cleanup() {
  // Clean up only rows this test created — never deleteMany({}) on shared tables.
  const ti = await prisma.taxInvoice.findUnique({ where: { issueId: ISSUE_ID } });
  if (ti?.expenseId) {
    await prisma.ledgerEntry.deleteMany({ where: { reference: ti.expenseId } });
    await prisma.expense.delete({ where: { id: ti.expenseId } }).catch(() => null);
  }
  await prisma.taxInvoice.deleteMany({ where: { issueId: ISSUE_ID } });
  // 'skipped_not_ours' case — buyer ID replaced, so no TaxInvoice is created; nothing extra to clean.
}

describe.skipIf(!integration)('ingestSecureMailHtml (integration)', () => {
  beforeAll(async () => {
    await cleanup();
    // Ensure CompanySettings singleton exists with our biz number.
    await prisma.companySettings.upsert({
      where: { id: 'default' },
      update: { businessNumber: BIZ },
      create: { id: 'default', businessNumber: BIZ },
    });
  });

  afterAll(async () => {
    await cleanup();
    // Restore CompanySettings to empty state (singleton, test-owned when set here).
    await prisma.companySettings.delete({ where: { id: 'default' } }).catch(() => null);
  });

  it('creates a purchase tax invoice + expense + ledger entries', async () => {
    const r = await ingestSecureMailHtml(html, 'msg-1');
    expect(r.status).toBe('created');
    expect(r.taxInvoiceId).toBeTruthy();

    const ti = await prisma.taxInvoice.findUnique({ where: { issueId: ISSUE_ID } });
    expect(ti?.direction).toBe('purchase');
    expect(ti?.totalAmount).toBe(572000);
    expect(ti?.expenseId).toBeTruthy();

    // LedgerService.postExpense posts 2 entries with reference = expenseId.
    const ledger = await prisma.ledgerEntry.findMany({ where: { reference: ti!.expenseId! } });
    expect(ledger.length).toBe(2);
  });

  it('is idempotent on duplicate approval number', async () => {
    // First call already ran in previous test; call again.
    const r2 = await ingestSecureMailHtml(html, 'msg-1');
    expect(r2.status).toBe('duplicate');
    expect(r2.taxInvoiceId).toBeTruthy();
    // Only one TaxInvoice with this issueId should exist.
    const count = await prisma.taxInvoice.count({ where: { issueId: ISSUE_ID } });
    expect(count).toBe(1);
  });

  it('skips invoices addressed to a different business number', async () => {
    // Replace buyer corp num in XML so it doesn't match our biz number.
    const otherXml = SAMPLE_TAXINVOICE_XML.replace('<ID>4208702727</ID>', '<ID>9999999999</ID>');
    // Still encrypt with our biz key so decryption succeeds.
    const otherHtml = buildSecureMailHtmlForTest(otherXml, BIZ);
    const r = await ingestSecureMailHtml(otherHtml, 'msg-2');
    expect(r.status).toBe('skipped_not_ours');
  });

  it('isolates a corrupt mail as failed without throwing', async () => {
    const r = await ingestSecureMailHtml('<html>broken</html>', 'msg-3');
    expect(r.status).toBe('failed');
  });

  it('marks ledger_failed when postExpense throws, still returns created', async () => {
    // Use a distinct issueId so this test is independent of the first test's row.
    const LEDGER_FAIL_ISSUE_ID = '202605291026052950358926';
    const ledgerFailXml = SAMPLE_TAXINVOICE_XML.replace(
      `<IssueID>${ISSUE_ID}</IssueID>`,
      `<IssueID>${LEDGER_FAIL_ISSUE_ID}</IssueID>`,
    );
    const ledgerFailHtml = buildSecureMailHtmlForTest(ledgerFailXml, BIZ);

    // Clean up before and after.
    async function cleanupLedgerFail() {
      const ti = await prisma.taxInvoice.findUnique({ where: { issueId: LEDGER_FAIL_ISSUE_ID } });
      if (ti?.expenseId) {
        await prisma.ledgerEntry.deleteMany({ where: { reference: ti.expenseId } });
        await prisma.expense.delete({ where: { id: ti.expenseId } }).catch(() => null);
      }
      await prisma.taxInvoice.deleteMany({ where: { issueId: LEDGER_FAIL_ISSUE_ID } });
    }

    await cleanupLedgerFail();

    const spy = vi.spyOn(LedgerService.prototype, 'postExpense').mockRejectedValueOnce(new Error('boom'));
    try {
      const r = await ingestSecureMailHtml(ledgerFailHtml, 'msg-ledger-fail');
      expect(r.status).toBe('created');
      expect(r.taxInvoiceId).toBeTruthy();

      const ti = await prisma.taxInvoice.findUnique({ where: { issueId: LEDGER_FAIL_ISSUE_ID } });
      expect(ti?.status).toBe('ledger_failed');
    } finally {
      spy.mockRestore();
      await cleanupLedgerFail();
    }
  });
});
