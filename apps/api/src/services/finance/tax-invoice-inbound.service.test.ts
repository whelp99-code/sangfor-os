import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@sangfor/db';
import {
  SAMPLE_TAXINVOICE_XML,
  buildSecureMailHtmlForTest,
} from './hometax-securemail/__fixtures__/synthetic';
import { ingestSecureMailHtml } from './tax-invoice-inbound.service';

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
});
