import { prisma } from '@sangfor/db';
import { LedgerService } from './ledger.service';

export class CreateExpenseDto {
  projectId?: string;
  expenseName!: string;
  amount?: number;
  category?: string;
  vendor?: string;
  date?: string;
  proofType?: string;
  paymentMethod?: string;
  isPaid?: boolean;
}

export class UpdateExpenseDto {
  projectId?: string;
  expenseName?: string;
  amount?: number;
  category?: string;
  vendor?: string;
  date?: string;
  proofType?: string;
  paymentMethod?: string;
  isPaid?: boolean;
}

export class ExpensesService {
  private readonly ledger = new LedgerService();

  private calcVat(supply: number) {
    return Math.round(supply * 0.1);
  }

  list(filters: { category?: string; isPaid?: boolean; projectId?: string; limit: number }) {
    const where: any = {};
    if (filters.category) where.category = filters.category;
    if (filters.isPaid !== undefined) where.isPaid = filters.isPaid;
    if (filters.projectId) where.projectId = filters.projectId;
    return prisma.expense.findMany({
      where,
      include: { project: true },
      orderBy: { date: 'desc' },
      take: filters.limit,
    });
  }

  async get(id: string) {
    const row = await prisma.expense.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!row) throw new Error('Expense not found');
    return row;
  }

  async create(dto: CreateExpenseDto) {
    const supply = dto.amount ?? 0;
    const vat = this.calcVat(supply);
    const expense = await prisma.expense.create({
      data: {
        projectId: dto.projectId,
        expenseName: dto.expenseName,
        amount: supply,
        category: dto.category ?? '기타',
        vendor: dto.vendor,
        date: dto.date ? new Date(dto.date) : new Date(),
        proofType: dto.proofType,
        paymentMethod: dto.paymentMethod,
        isPaid: dto.isPaid ?? false,
        vat,
        total: supply + vat,
      },
      include: { project: true },
    });
    if (dto.isPaid && supply > 0) {
      await this.ledger.postExpense(expense.id).catch(() => null);
    }
    return expense;
  }

  async update(id: string, dto: UpdateExpenseDto) {
    const existing = await this.get(id);
    const supply = dto.amount ?? existing.amount ?? 0;
    const vat = this.calcVat(supply);
    const updated = await prisma.expense.update({
      where: { id },
      data: {
        projectId: dto.projectId,
        expenseName: dto.expenseName,
        amount: dto.amount,
        category: dto.category,
        vendor: dto.vendor,
        date: dto.date ? new Date(dto.date) : undefined,
        proofType: dto.proofType,
        paymentMethod: dto.paymentMethod,
        isPaid: dto.isPaid,
        vat,
        total: supply + vat,
      },
      include: { project: true },
    });
    if (dto.isPaid === true && !existing.isPaid) {
      await this.ledger.postExpense(id).catch(() => null);
    }
    return updated;
  }

  async delete(id: string) {
    await this.get(id);
    return prisma.expense.delete({ where: { id } });
  }
}
