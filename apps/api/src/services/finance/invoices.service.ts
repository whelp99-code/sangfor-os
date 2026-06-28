import { prisma } from '@sangfor/db';
import { LedgerService } from './ledger.service';

export class CreateInvoiceDto {
  projectId?: string;
  amount?: number;
  depositAmount?: number;
  depositStatus?: string;
  depositDate?: string;
  issueDate?: string;
  memo?: string;
  buyer?: string;
}

export class UpdateInvoiceDto {
  projectId?: string;
  amount?: number;
  depositAmount?: number;
  depositStatus?: string;
  depositDate?: string;
  issueDate?: string;
  memo?: string;
  buyer?: string;
}

export class InvoicesService {
  private readonly ledger = new LedgerService();

  private calcVat(supply: number) {
    return Math.round(supply * 0.1);
  }

  list(filters: { depositStatus?: string; projectId?: string; limit: number }) {
    const where: any = {};
    if (filters.depositStatus) where.depositStatus = filters.depositStatus;
    if (filters.projectId) where.projectId = filters.projectId;
    return prisma.invoice.findMany({
      where,
      include: { project: true },
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
    });
  }

  async get(id: string) {
    const row = await prisma.invoice.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!row) throw new Error('Invoice not found');
    return row;
  }

  async create(dto: CreateInvoiceDto) {
    const supply = dto.amount ?? 0;
    const vat = this.calcVat(supply);
    const invoice = await prisma.invoice.create({
      data: {
        projectId: dto.projectId || null,
        amount: supply,
        depositAmount: dto.depositAmount,
        depositStatus: dto.depositStatus ?? '미수',
        depositDate: dto.depositDate ? new Date(dto.depositDate) : null,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        memo: dto.memo,
        buyer: dto.buyer,
        vat,
        total: supply + vat,
      },
      include: { project: true },
    });
    if (supply > 0) {
      await this.ledger.postInvoiceIssued(invoice.id).catch(() => null);
    }
    return invoice;
  }

  async update(id: string, dto: UpdateInvoiceDto) {
    const existing = await this.get(id);
    const supply = dto.amount ?? existing.amount ?? 0;
    const vat = this.calcVat(supply);
    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        projectId: dto.projectId || null,
        amount: dto.amount,
        depositAmount: dto.depositAmount,
        depositStatus: dto.depositStatus,
        depositDate: dto.depositDate ? new Date(dto.depositDate) : undefined,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        memo: dto.memo,
        buyer: dto.buyer,
        vat,
        total: supply + vat,
      },
      include: { project: true },
    });
    if (dto.depositStatus === '완료' && existing.depositStatus !== '완료') {
      await this.ledger.postInvoicePaid(id).catch(() => null);
    }
    return updated;
  }

  async delete(id: string) {
    await this.get(id);
    return prisma.invoice.delete({ where: { id } });
  }
}
