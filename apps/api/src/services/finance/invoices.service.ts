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
    // 공급가(amount)가 실제로 바뀌면 기존 원장 분개가 낡는다 → 역분개 후 재기표한다.
    const amountChanged = dto.amount !== undefined && dto.amount !== (existing.amount ?? 0);
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

    // 원장 정합: 금액 변경 시 참조 분개를 역분개한 뒤 새 금액으로 재기표한다.
    // 발행 분개(postInvoiceIssued)는 항상 재기표하고, 입금 분개는 (기존이 완료였거나
    // 이번에 완료가 된) 경우에만 재기표한다. 실패는 인보이스 저장을 되돌리지 않는다
    // (원장은 보조 장부 — best-effort). NOTE(oma-deferred): 원장 P&L 전면 백필은 범위 밖.
    const nowPaid = updated.depositStatus === '완료';
    const wasPaid = existing.depositStatus === '완료';
    if (amountChanged) {
      await this.ledger.reverseInvoiceEntries(id).catch(() => null);
      if (supply > 0) {
        await this.ledger.postInvoiceIssued(id).catch(() => null);
      }
      if (nowPaid) {
        await this.ledger.postInvoicePaid(id).catch(() => null);
      }
    } else if (nowPaid && !wasPaid) {
      // 금액 변경 없이 완료로 전환된 통상 케이스: 입금 분개만 추가.
      await this.ledger.postInvoicePaid(id).catch(() => null);
    }
    return updated;
  }

  async delete(id: string) {
    await this.get(id);
    return prisma.invoice.delete({ where: { id } });
  }
}
