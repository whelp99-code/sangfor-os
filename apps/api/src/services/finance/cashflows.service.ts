import { prisma } from '@sangfor/db';

export class CreateCashflowDto {
  projectId?: string;
  counterparty!: string;
  amount!: number;
  type!: string;
  outAccount?: string;
  inAccount?: string;
  date?: string;
  memo?: string;
}

export class UpdateCashflowDto {
  projectId?: string;
  counterparty?: string;
  amount?: number;
  type?: string;
  outAccount?: string;
  inAccount?: string;
  date?: string;
  memo?: string;
}

export class CashflowsService {
  list(filters: { type?: string; projectId?: string; limit: number }) {
    const where: any = {};
    if (filters.type) where.type = filters.type;
    if (filters.projectId) where.projectId = filters.projectId;
    return prisma.cashflow.findMany({
      where,
      include: { project: true },
      orderBy: { date: 'desc' },
      take: filters.limit,
    });
  }

  async get(id: string) {
    const row = await prisma.cashflow.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!row) throw new Error('Cashflow not found');
    return row;
  }

  create(dto: CreateCashflowDto) {
    return prisma.cashflow.create({
      data: {
        projectId: dto.projectId,
        counterparty: dto.counterparty,
        amount: dto.amount,
        type: dto.type,
        outAccount: dto.outAccount,
        inAccount: dto.inAccount,
        date: dto.date ? new Date(dto.date) : new Date(),
        memo: dto.memo,
        cashChange: dto.amount,
      },
      include: { project: true },
    });
  }

  async update(id: string, dto: UpdateCashflowDto) {
    await this.get(id);
    const data: Record<string, unknown> = {};
    if (dto.projectId !== undefined) data.projectId = dto.projectId;
    if (dto.counterparty !== undefined) data.counterparty = dto.counterparty;
    if (dto.amount !== undefined) { data.amount = dto.amount; data.cashChange = dto.amount; }
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.outAccount !== undefined) data.outAccount = dto.outAccount;
    if (dto.inAccount !== undefined) data.inAccount = dto.inAccount;
    if (dto.date !== undefined) data.date = dto.date ? new Date(dto.date) : null;
    if (dto.memo !== undefined) data.memo = dto.memo;
    return prisma.cashflow.update({
      where: { id },
      data: data as any,
      include: { project: true },
    });
  }

  async delete(id: string) {
    await this.get(id);
    return prisma.cashflow.delete({ where: { id } });
  }
}
