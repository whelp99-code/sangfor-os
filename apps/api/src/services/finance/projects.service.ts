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
}
