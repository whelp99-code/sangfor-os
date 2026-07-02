import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@sangfor/db';
import {
  SAMPLE_TAXINVOICE_XML,
  buildSecureMailHtmlForTest,
} from '../../services/finance/hometax-securemail/__fixtures__/synthetic';
import { cfoRouter } from './index';

const integration = process.env.CI_INTEGRATION === '1';

// financeProcedure (routers/trpc.ts) now requires a FINANCE_ROLES role —
// 'user' would be FORBIDDEN post-fix, so the integration caller needs a role
// that's actually allowed to touch CFO data.
const caller = cfoRouter.createCaller({ userId: 'test-user', userRole: 'finance_manager' } as any);

const TEST_BIZ = '4208702727';
const TEST_ISSUE_ID = '202605291026052950358925'; // from SAMPLE_TAXINVOICE_XML

async function cleanup() {
  // Find the tax invoice by issueId so we can clean linked rows precisely
  const ti = await prisma.taxInvoice.findUnique({ where: { issueId: TEST_ISSUE_ID } });
  if (ti) {
    // Clean linked ledger entries via reference (expenseId stored as reference field)
    if (ti.expenseId) {
      await prisma.ledgerEntry.deleteMany({
        where: { reference: ti.expenseId, referenceType: 'expense' },
      });
      await prisma.expense.deleteMany({ where: { id: ti.expenseId } });
    }
    await prisma.taxInvoice.deleteMany({ where: { issueId: TEST_ISSUE_ID } });
  }
  await prisma.companySettings.deleteMany({ where: { id: 'default' } });
}

describe.skipIf(!integration)('taxInvoices + companySettings router (integration)', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.companySettings.upsert({
      where: { id: 'default' },
      update: { businessNumber: TEST_BIZ },
      create: { id: 'default', businessNumber: TEST_BIZ },
    });
  });

  afterAll(cleanup);

  it('uploadHtml ingests a secure-mail HTML and returns status=created', async () => {
    const html = buildSecureMailHtmlForTest(SAMPLE_TAXINVOICE_XML, TEST_BIZ);
    const result = await caller.taxInvoices.uploadHtml({ html });
    expect(result.status).toBe('created');
  });

  it('list returns the ingested invoice with direction=purchase', async () => {
    const list = await caller.taxInvoices.list({ direction: 'purchase' });
    expect(list.length).toBeGreaterThanOrEqual(1);
    const found = list.find((ti) => ti.issueId === TEST_ISSUE_ID);
    expect(found).toBeDefined();
  });

  it('companySettings.get returns the configured businessNumber', async () => {
    const settings = await caller.companySettings.get();
    expect(settings.businessNumber).toBe(TEST_BIZ);
  });
});

// ── Role-gate regression (no DB required — always runs) ────────────────────
//
// P3 fix: routers/cfo/* now require a FINANCE_ROLES role (financeProcedure),
// not just any logged-in user. The middleware rejects before the resolver
// ever touches Prisma, so this doesn't need CI_INTEGRATION or a live DB.
describe('cfoRouter — finance role gate', () => {
  it('rejects a non-finance role with FORBIDDEN', async () => {
    const nonFinanceCaller = cfoRouter.createCaller({
      userId: 'test-user',
      userRole: 'account_manager',
    } as any);
    await expect(nonFinanceCaller.taxInvoices.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects an unauthenticated caller with UNAUTHORIZED', async () => {
    const anonCaller = cfoRouter.createCaller({ userId: null, userRole: null } as any);
    await expect(anonCaller.taxInvoices.list()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
