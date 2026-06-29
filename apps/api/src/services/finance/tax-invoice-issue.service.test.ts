import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@sangfor/db';
import { issueSalesTaxInvoice, markTransmitted } from './tax-invoice-issue.service';

const integration = process.env.CI_INTEGRATION === '1';
const createdIds: string[] = [];

describe.skipIf(!integration)('tax-invoice-issue.service (integration)', () => {
  beforeAll(async () => {
    await prisma.companySettings.upsert({
      where: { id: 'default' },
      update: { businessNumber: '4208702727', companyName: '(주)베를로' },
      create: { id: 'default', businessNumber: '4208702727', companyName: '(주)베를로' },
    });
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await prisma.taxInvoice.deleteMany({ where: { id: { in: createdIds } } });
    }
    await prisma.companySettings.delete({ where: { id: 'default' } }).catch(() => {});
  });

  it('computes VAT, creates a sales invoice pending manual transmission', async () => {
    const r = await issueSalesTaxInvoice({
      buyerCorpNum: '1234567890', buyerName: '바이어',
      items: [{ name: '컨설팅', amount: 1000000 }],
    });
    createdIds.push(r.id);
    const ti = await prisma.taxInvoice.findUnique({ where: { id: r.id } });
    expect(ti?.direction).toBe('sales');
    expect(ti?.supplyAmount).toBe(1000000);
    expect(ti?.vatAmount).toBe(100000);
    expect(ti?.totalAmount).toBe(1100000);
    expect(ti?.status).toBe('pending_manual');
  });

  it('marks transmitted', async () => {
    const r = await issueSalesTaxInvoice({
      buyerCorpNum: '1234567890', buyerName: '바이어',
      items: [{ name: 'x', amount: 100 }],
    });
    createdIds.push(r.id);
    await markTransmitted(r.id);
    const ti = await prisma.taxInvoice.findUnique({ where: { id: r.id } });
    expect(ti?.status).toBe('transmitted');
  });
});
