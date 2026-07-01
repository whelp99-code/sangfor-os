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
        projectId: dto.projectId || null,
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
    // 공급가(amount)가 실제로 바뀌면 기존 원장 분개가 낡는다 → 역분개 후 재기표한다.
    const amountChanged = dto.amount !== undefined && dto.amount !== (existing.amount ?? 0);
    const updated = await prisma.expense.update({
      where: { id },
      data: {
        projectId: dto.projectId || null,
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

    // 원장 정합(현금주의 지출 분개 기준). 지출 분개는 isPaid=true인 동안만 살아 있어야
    // 한다. 실패는 지출 저장을 되돌리지 않는다(원장은 보조 장부 — best-effort).
    // NOTE(oma-deferred): 원장 P&L 전면 백필은 범위 밖.
    const nowPaid = updated.isPaid === true;
    const wasPaid = existing.isPaid === true;
    if (wasPaid && !nowPaid) {
      // 지급취소(true→false): 기존 지출 분개를 역분개해 유령 지출분개를 제거한다.
      await this.ledger.reverseExpenseEntries(id).catch(() => null);
    } else if (nowPaid && !wasPaid) {
      // 미지급→지급 전환: 지출 분개 기표(금액>0).
      if (supply > 0) await this.ledger.postExpense(id).catch(() => null);
    } else if (nowPaid && wasPaid && amountChanged) {
      // 지급 상태 유지 + 금액 변경: 역분개 후 새 금액으로 재기표.
      await this.ledger.reverseExpenseEntries(id).catch(() => null);
      if (supply > 0) await this.ledger.postExpense(id).catch(() => null);
    }
    return updated;
  }

  async delete(id: string) {
    await this.get(id);
    return prisma.expense.delete({ where: { id } });
  }
}
