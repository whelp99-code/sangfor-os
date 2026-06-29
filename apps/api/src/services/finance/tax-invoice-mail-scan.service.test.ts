import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@sangfor/db';
import {
  SAMPLE_TAXINVOICE_XML,
  buildSecureMailHtmlForTest,
} from './hometax-securemail/__fixtures__/synthetic';
import { isHometaxMail, scanAndIngestHometaxMails } from './tax-invoice-mail-scan.service';

// ----------------------------------------------------------------------------
// Unit tests — no DB needed
// ----------------------------------------------------------------------------
describe('isHometaxMail', () => {
  it('matches NTS sender', () => {
    expect(isHometaxMail({ fromEmail: 'hometaxadmin@hometax.go.kr', subject: '(주)베를로 (..)' })).toBe(true);
  });

  it('ignores other senders', () => {
    expect(isHometaxMail({ fromEmail: 'someone@gmail.com', subject: 'hi' })).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// Integration tests — require a live DB (CI_INTEGRATION=1)
// ----------------------------------------------------------------------------
const integration = process.env.CI_INTEGRATION === '1';
const BIZ = '4208702727';
const ISSUE_ID = '202605291026052950358925';

const TAG = '__scan_integ__';

let mailAccountId: string;
let hometaxMsgId: string;
let hometaxExternalId: string;
let otherMsgId: string;

async function cleanup() {
  // TaxInvoice → Expense → LedgerEntry (cascade via service logic)
  const ti = await prisma.taxInvoice.findUnique({ where: { issueId: ISSUE_ID } });
  if (ti?.expenseId) {
    await prisma.ledgerEntry.deleteMany({ where: { reference: ti.expenseId } });
    await prisma.expense.delete({ where: { id: ti.expenseId } }).catch(() => null);
  }
  await prisma.taxInvoice.deleteMany({ where: { issueId: ISSUE_ID } });

  // MailMessages and MailAccount created by this test
  if (hometaxMsgId) await prisma.mailMessage.delete({ where: { id: hometaxMsgId } }).catch(() => null);
  if (otherMsgId) await prisma.mailMessage.delete({ where: { id: otherMsgId } }).catch(() => null);
  if (mailAccountId) await prisma.mailAccount.delete({ where: { id: mailAccountId } }).catch(() => null);

  // CompanySettings singleton
  await prisma.companySettings.delete({ where: { id: 'default' } }).catch(() => null);
}

describe.skipIf(!integration)('scanAndIngestHometaxMails (integration)', () => {
  beforeAll(async () => {
    await cleanup();

    // CompanySettings singleton — required by ingestSecureMailHtml
    await prisma.companySettings.upsert({
      where: { id: 'default' },
      update: { businessNumber: BIZ },
      create: { id: 'default', businessNumber: BIZ },
    });

    // A MailAccount (projectId is a free-form string in the schema)
    const acct = await prisma.mailAccount.create({
      data: { projectId: TAG, provider: 'outlook', email: 'test@blro.example', status: 'mock' },
    });
    mailAccountId = acct.id;

    hometaxExternalId = `ext-hometax-${Date.now()}`;

    // Hometax message — has externalId so it will be scanned
    const hometaxMsg = await prisma.mailMessage.create({
      data: {
        accountId: mailAccountId,
        subject: '국세청 전자세금계산서',
        fromEmail: 'hometaxadmin@hometax.go.kr',
        externalId: hometaxExternalId,
        direction: 'inbound',
      },
    });
    hometaxMsgId = hometaxMsg.id;

    // Non-hometax message — should be ignored
    const otherMsg = await prisma.mailMessage.create({
      data: {
        accountId: mailAccountId,
        subject: '일반 이메일',
        fromEmail: 'partner@gmail.com',
        externalId: `ext-other-${Date.now()}`,
        direction: 'inbound',
      },
    });
    otherMsgId = otherMsg.id;
  });

  afterAll(cleanup);

  it('scans only hometax messages and creates a purchase TaxInvoice', async () => {
    const html = buildSecureMailHtmlForTest(SAMPLE_TAXINVOICE_XML, BIZ);

    const fetcher = async (externalId: string): Promise<string | null> => {
      if (externalId === hometaxExternalId) return html;
      return null;
    };

    const stats = await scanAndIngestHometaxMails(mailAccountId, fetcher);

    // Only the hometax message is counted (non-hometax sender is excluded at DB query level)
    expect(stats.scanned).toBe(1);
    expect(stats.created).toBe(1);
    expect(stats.duplicate).toBe(0);
    expect(stats.failed).toBe(0);

    // A purchase TaxInvoice should now exist
    const ti = await prisma.taxInvoice.findUnique({ where: { issueId: ISSUE_ID } });
    expect(ti).not.toBeNull();
    expect(ti?.direction).toBe('purchase');
  });

  it('is idempotent — second scan returns duplicate', async () => {
    const html = buildSecureMailHtmlForTest(SAMPLE_TAXINVOICE_XML, BIZ);
    const fetcher = async (_externalId: string) => html;

    const stats = await scanAndIngestHometaxMails(mailAccountId, fetcher);
    expect(stats.scanned).toBe(1);
    expect(stats.duplicate).toBe(1);
    expect(stats.created).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('counts failed when fetcher returns null', async () => {
    // Reset the TaxInvoice so 'null fetcher' test has a clean hometax message to process
    const ti = await prisma.taxInvoice.findUnique({ where: { issueId: ISSUE_ID } });
    if (ti?.expenseId) {
      await prisma.ledgerEntry.deleteMany({ where: { reference: ti.expenseId } });
      await prisma.expense.delete({ where: { id: ti.expenseId } }).catch(() => null);
    }
    await prisma.taxInvoice.deleteMany({ where: { issueId: ISSUE_ID } });

    const nullFetcher = async (_externalId: string): Promise<string | null> => null;

    const stats = await scanAndIngestHometaxMails(mailAccountId, nullFetcher);
    expect(stats.scanned).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.created).toBe(0);
  });
});
