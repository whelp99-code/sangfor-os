import { Inject, Injectable, NotFoundException } from '@nestjs/common';

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

@Injectable()
export class CashflowsService {
  constructor(@Inject('PRISMA') private readonly prisma: any) {}

  list(filters: { type?: string; projectId?: string; limit: number }) {
    const where: any = {};
    if (filters.type) where.type = filters.type;
    if (filters.projectId) where.projectId = filters.projectId;
    return this.prisma.cashflow.findMany({
      where,
      include: { project: true },
      orderBy: { date: 'desc' },
      take: filters.limit,
    });
  }

  async get(id: string) {
    const row = await this.prisma.cashflow.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!row) throw new NotFoundException('Cashflow not found');
    return row;
  }

  create(dto: CreateCashflowDto) {
    return this.prisma.cashflow.create({
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
    return this.prisma.cashflow.update({
      where: { id },
      data: {
        ...(dto.projectId !== undefined && { projectId: dto.projectId }),
        ...(dto.counterparty !== undefined && { counterparty: dto.counterparty }),
        ...(dto.amount !== undefined && { amount: dto.amount, cashChange: dto.amount }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.outAccount !== undefined && { outAccount: dto.outAccount }),
        ...(dto.inAccount !== undefined && { inAccount: dto.inAccount }),
        ...(dto.date !== undefined && { date: dto.date ? new Date(dto.date) : null }),
        ...(dto.memo !== undefined && { memo: dto.memo }),
      },
      include: { project: true },
    });
  }

  async delete(id: string) {
    await this.get(id);
    return this.prisma.cashflow.delete({ where: { id } });
  }
}
