import { prisma } from '@sangfor/db';
import { getEngagementDetail } from './engagement-center';
import { computePnl, type Pnl } from './domain-pnl';
import { buildLanes, type DomainLane, type LaneArtifact } from './artifact-domain-map';

export interface ProjectHub {
  engagement: Awaited<ReturnType<typeof getEngagementDetail>>;
  lanes: DomainLane[];
  pnl: Pnl;
}

export async function getProjectHub(engagementId: string): Promise<ProjectHub | null> {
  const engagement = await getEngagementDetail(engagementId);
  if (!engagement) return null;

  const [invoices, expenses, taxInvoices] = await Promise.all([
    prisma.invoice.findMany({ where: { engagementId } }),
    prisma.expense.findMany({ where: { engagementId } }),
    prisma.taxInvoice.findMany({ where: { engagementId } }),
  ]);

  const pnl = computePnl({ invoices, expenses, taxInvoices });

  const artifacts: LaneArtifact[] = [
    ...engagement.meetingNotes.map((m) => ({ kind: 'meetingNote' as const, id: m.id, label: m.title ?? '미팅', status: m.status })),
    ...engagement.generatedDocuments.map((d) => ({ kind: 'proposal' as const, id: d.id, label: d.title ?? '제안서', status: d.status })),
    ...engagement.pocProjects.map((p) => ({ kind: 'poc' as const, id: p.id, label: p.title ?? 'POC', status: p.status })),
    ...engagement.checklistItems.map((c) => ({ kind: 'checklist' as const, id: c.id, label: c.itemKey ?? '체크', status: c.status })),
    ...taxInvoices.map((t) => ({ kind: 'taxInvoice' as const, id: t.id, label: `${t.direction === 'purchase' ? '매입' : '매출'} ${t.supplierName}`, status: t.status })),
    ...invoices.map((i) => ({ kind: 'invoice' as const, id: i.id, label: `매출 ${i.buyer ?? ''}`, status: i.depositStatus ?? undefined })),
    ...expenses.map((e) => ({ kind: 'expense' as const, id: e.id, label: e.expenseName, status: undefined })),
  ];

  return { engagement, lanes: buildLanes(artifacts), pnl };
}
