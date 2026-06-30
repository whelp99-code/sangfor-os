import { prisma } from '@sangfor/db';

export class ProjectsService {
  list(filters: { status?: string; limit: number }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    return prisma.financeProject.findMany({
      where,
      include: {
        _count: { select: { invoices: true, expenses: true, cashflows: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
    });
  }

  async get(id: string) {
    const row = await prisma.financeProject.findUnique({
      where: { id },
      include: { invoices: true, expenses: true, cashflows: true },
    });
    if (!row) throw new Error('Project not found');
    return row;
  }

  create(dto: { name: string; status?: string }) {
    return prisma.financeProject.create({
      data: { name: dto.name, status: dto.status ?? 'active' },
    });
  }

  /**
   * Deal-level P&L (ADR-001 Phase 2b) — rolls up invoices/expenses by
   * engagementId (the anchor) instead of the legacy FinanceProject, and joins
   * to Engagement → Opportunity → Customer for labels + a deep link to the deal.
   * Finance rows not yet backfilled (engagementId IS NULL) collapse into a
   * single "미배정" bucket so nothing is hidden. No schema change — aggregation
   * is done with groupBy + a single engagement lookup.
   */
  async listDealPnl() {
    const [invAgg, expAgg] = await Promise.all([
      prisma.invoice.groupBy({ by: ['engagementId'], _sum: { amount: true, depositAmount: true }, _count: true }),
      prisma.expense.groupBy({ by: ['engagementId'], _sum: { amount: true }, _count: true }),
    ]);

    const ids = [...new Set([...invAgg, ...expAgg].map((r) => r.engagementId).filter((x): x is string => !!x))];
    const engagements = ids.length
      ? await prisma.engagement.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, opportunity: { select: { id: true, title: true, customer: { select: { name: true } } } } },
        })
      : [];
    const engById = new Map(engagements.map((e) => [e.id, e]));
    const invByEng = new Map(invAgg.map((r) => [r.engagementId, r]));
    const expByEng = new Map(expAgg.map((r) => [r.engagementId, r]));

    const keys = new Set<string | null>([...invByEng.keys(), ...expByEng.keys()]);
    const rows = [...keys].map((key) => {
      const inv = invByEng.get(key);
      const exp = expByEng.get(key);
      const revenue = inv?._sum.amount ?? 0;
      const cost = exp?._sum.amount ?? 0;
      // revenue(=amount)는 공급가, depositAmount는 VAT 포함 입금액이라 그대로 한 표에
      // 나란히 두면 "총입금 > 총매출" 착시가 난다(실데이터 6개 프로젝트). 입금액을
      // 공급가 기준으로 환산(÷1.1)해 revenue와 동일 기준으로 통일한다. 표준세율 10%
      // 가정이며, 영세/면세 혼재 시 근사값임.
      const depositedGross = inv?._sum.depositAmount ?? 0;
      const deposited = Math.round(depositedGross / 1.1);
      const eng = key ? engById.get(key) : null;
      return {
        engagementId: key,
        opportunityId: eng?.opportunity?.id ?? null,
        dealTitle: eng?.opportunity?.title ?? eng?.name ?? (key ? '(삭제된 딜)' : '미배정'),
        customer: eng?.opportunity?.customer?.name ?? null,
        revenue,
        cost,
        deposited,
        profit: revenue - cost,
        invoiceCount: inv?._count ?? 0,
        expenseCount: exp?._count ?? 0,
      };
    });

    // Assigned deals by revenue desc; the 미배정 bucket always sorts last.
    rows.sort((a, b) => {
      if (a.engagementId === null) return 1;
      if (b.engagementId === null) return -1;
      return b.revenue - a.revenue;
    });
    return rows;
  }
}
