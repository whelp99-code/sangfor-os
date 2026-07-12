import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@sangfor/db';
import { getProjectHub } from './project-hub';

const integration = process.env.CI_INTEGRATION === '1';
const TAG = '__hub_test__';
let engagementId = '';
let projectId = '';
let oppId = '';

describe.skipIf(!integration)('getProjectHub', () => {
  beforeAll(async () => {
    const project = await prisma.project.findFirstOrThrow({ where: { slug: 'demo-project' } });
    projectId = project.id;
    const customer = await prisma.customer.create({ data: { projectId, name: TAG, status: 'active' } });
    const opp = await prisma.opportunity.create({ data: { projectId, title: TAG, stage: 'WON', customerId: customer.id } });
    oppId = opp.id;
    const eng = await prisma.engagement.create({ data: { opportunityId: opp.id, name: TAG, status: 'planned', customerId: customer.id } });
    engagementId = eng.id;
    // 매입 세금계산서(원가) + 매출 인보이스를 이 engagement에 배정
    await prisma.taxInvoice.create({ data: { direction: 'purchase', status: 'received', supplierCorpNum: '1', supplierName: '넥시아스', buyerCorpNum: '2', buyerName: '베를로', supplyAmount: 520000, vatAmount: 52000, totalAmount: 572000, issueDate: new Date(), engagementId } });
    await prisma.invoice.create({ data: { buyer: TAG, amount: 1000000, vat: 100000, total: 1100000, memo: TAG, engagementId } });
  });
  afterAll(async () => {
    await prisma.taxInvoice.deleteMany({ where: { engagementId } });
    await prisma.invoice.deleteMany({ where: { engagementId } });
    await prisma.engagement.deleteMany({ where: { id: engagementId } });
    await prisma.opportunity.deleteMany({ where: { id: oppId } });
    await prisma.customer.deleteMany({ where: { name: TAG, projectId } });
  });

  it('aggregates lanes + P&L for an engagement (engagementId axis)', async () => {
    const hub = await getProjectHub(engagementId);
    expect(hub).not.toBeNull();
    expect(hub!.pnl.revenue).toBe(1100000);
    expect(hub!.pnl.purchase).toBe(572000);
    expect(hub!.pnl.margin).toBe(528000);
    expect(hub!.lanes.find((l) => l.domain === 'cfo')!.artifacts.length).toBeGreaterThan(0);
  });

  it('returns null for unknown engagement', async () => {
    expect(await getProjectHub('nonexistent')).toBeNull();
  });
});
