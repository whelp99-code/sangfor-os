import { Inject, Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class ProjectsService {
  constructor(@Inject('PRISMA') private readonly prisma: any) {}

  list(filters: { status?: string; limit: number }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    return this.prisma.project.findMany({
      where,
      include: {
        _count: { select: { invoices: true, expenses: true, cashflows: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
    });
  }

  async get(id: string) {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: {
        invoices: true,
        expenses: true,
        cashflows: true,
      },
    });
    if (!row) throw new NotFoundException('Project not found');
    return row;
  }
}
