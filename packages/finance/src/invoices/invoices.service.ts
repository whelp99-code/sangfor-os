import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';

export class CreateInvoiceDto {
  projectId?: string;
  amount?: number;
  depositAmount?: number;
  depositStatus?: string;
  depositDate?: string;
  memo?: string;
  buyer?: string;
}

export class UpdateInvoiceDto {
  projectId?: string;
  amount?: number;
  depositAmount?: number;
  depositStatus?: string;
  depositDate?: string;
  memo?: string;
  buyer?: string;
}

@Injectable()
export class InvoicesService {
  constructor(
    @Inject('PRISMA') private readonly prisma: any,
    private readonly ledger: LedgerService,
  ) {}

  private calcVat(supply: number) {
    return Math.round(supply * 0.1);
  }

  list(filters: { depositStatus?: string; projectId?: string; limit: number }) {
    const where: any = {};
    if (filters.depositStatus) where.depositStatus = filters.depositStatus;
    if (filters.projectId) where.projectId = filters.projectId;
    return this.prisma.invoice.findMany({
      where,
      include: { project: true },
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
    });
  }

  async get(id: string) {
    const row = await this.prisma.invoice.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!row) throw new NotFoundException('Invoice not found');
    return row;
  }

  async create(dto: CreateInvoiceDto) {
    const supply = dto.amount ?? 0;
    const vat = this.calcVat(supply);
    const invoice = await this.prisma.invoice.create({
      data: {
        projectId: dto.projectId,
        amount: supply,
        depositAmount: dto.depositAmount,
        depositStatus: dto.depositStatus ?? '미수',
        depositDate: dto.depositDate ? new Date(dto.depositDate) : null,
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
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        projectId: dto.projectId,
        amount: dto.amount,
        depositAmount: dto.depositAmount,
        depositStatus: dto.depositStatus,
        depositDate: dto.depositDate ? new Date(dto.depositDate) : undefined,
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
    return this.prisma.invoice.delete({ where: { id } });
  }
}
