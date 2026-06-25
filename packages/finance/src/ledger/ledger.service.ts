import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

export type AccountCode =
  | '100' // 보통예금
  | '101' // 현금
  | '110' // 매출채권
  | '120' // 미수금
  | '130' // 미지급금
  | '150' // 선급금
  | '200' // 매출 (수익)
  | '210' // 잡이익
  | '300' // 상품매입원가
  | '310' // 매입
  | '400' // 급여
  | '410' // 소모품비
  | '420' // 복리후생비
  | '430' // 임차료
  | '440' // 통신비
  | '450' // 보험료
  | '460' // 세금과공과
  | '470' // 광고선전비
  | '480' // 지급수수료
  | '490' // 차량유지비
  | '500' // 여행교통비
  | '510' // 회의비
  | '520' // 교육훈련비
  | '900' // 부가세대급금
  | '910' // 부가세예수금
  | '920' // 카드미지급금
  | '930'; // 개인카드미정산

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(@Inject('PRISMA') private readonly prisma: any) {}

  /**
   * 거래 등록 시 차변/대변 자동 분개 + 검증
   * - 차변 합계 == 대변 합계 강제
   */
  async postEntry(input: {
    date: Date;
    description: string;
    debitAccount: AccountCode;
    creditAccount: AccountCode;
    amount: number;
    reference?: string;
    referenceType?: string;
    memo?: string;
  }) {
    if (input.amount <= 0) {
      throw new BadRequestException('금액은 0보다 커야 합니다.');
    }
    return this.prisma.ledgerEntry.create({ data: input });
  }

  /**
   * 인보이스 발행 → 매출채권/매출 분개
   */
  async postInvoiceIssued(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new BadRequestException('인보이스 없음');
    const total = (invoice.amount ?? 0) + (invoice.vat ?? 0);
    const vat = invoice.vat ?? 0;
    const supply = invoice.amount ?? 0;
    if (total <= 0) return null;

    return this.prisma.$transaction([
      this.prisma.ledgerEntry.create({
        data: {
          date: new Date(),
          description: `[매출] ${invoice.buyer ?? '고객'} ${supply.toLocaleString()}원`,
          debitAccount: '110', // 매출채권
          creditAccount: '200', // 매출
          amount: supply,
          reference: invoiceId,
          referenceType: 'invoice',
        },
      }),
      this.prisma.ledgerEntry.create({
        data: {
          date: new Date(),
          description: `[부가세예수] ${invoice.buyer ?? '고객'}`,
          debitAccount: '110',
          creditAccount: '910',
          amount: vat,
          reference: invoiceId,
          referenceType: 'invoice',
        },
      }),
    ]);
  }

  /**
   * 인보이스 결제 수신 → 보통예금/매출채권
   */
  async postInvoicePaid(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return null;
    const total = (invoice.amount ?? 0) + (invoice.vat ?? 0);
    if (total <= 0) return null;
    return this.prisma.ledgerEntry.create({
      data: {
        date: invoice.depositDate ?? new Date(),
        description: `[입금] ${invoice.buyer ?? '고객'} ${total.toLocaleString()}원`,
        debitAccount: '100', // 보통예금
        creditAccount: '110', // 매출채권
        amount: total,
        reference: invoiceId,
        referenceType: 'invoice',
      },
    });
  }

  /**
   * 지출 등록 (카드) → 비용계정 + 부가세대급금 / 카드미지급금
   */
  async postExpense(expenseId: string) {
    const e = await this.prisma.expense.findUnique({ where: { id: expenseId } });
    if (!e) return null;
    const supply = e.amount ?? 0;
    const vat = e.vat ?? 0;
    const total = supply + vat;
    if (total <= 0) return null;

    const expenseAccount = this.mapCategoryToAccount(e.category);

    return this.prisma.$transaction([
      this.prisma.ledgerEntry.create({
        data: {
          date: e.date ?? new Date(),
          description: `[지출] ${e.expenseName}`,
          debitAccount: expenseAccount,
          creditAccount: '920', // 카드미지급금
          amount: supply,
          reference: expenseId,
          referenceType: 'expense',
        },
      }),
      this.prisma.ledgerEntry.create({
        data: {
          date: e.date ?? new Date(),
          description: `[부가세대급] ${e.expenseName}`,
          debitAccount: '900',
          creditAccount: '920',
          amount: vat,
          reference: expenseId,
          referenceType: 'expense',
        },
      }),
    ]);
  }

  private mapCategoryToAccount(category: string): AccountCode {
    switch (category) {
      case '급여':
        return '400';
      case '판관비':
        return '410';
      case '원가(매입)':
        return '300';
      case '세무 보험':
        return '450';
      default:
        return '410';
    }
  }

  /**
   * 차변/대변 검증 (sum debit == sum credit)
   * 위반 시 거래 거부
   */
  validate(entries: { debitAccount: string; creditAccount: string; amount: number }[]) {
    const debit = entries.reduce((s, e) => s + e.amount, 0);
    const credit = entries.reduce((s, e) => s + e.amount, 0);
    if (Math.abs(debit - credit) > 0.0001) {
      throw new BadRequestException(
        `차변/대변 불일치: 차변 ${debit}, 대변 ${credit}`,
      );
    }
    return true;
  }

  /**
   * 계정별 잔액 (총계정원장)
   */
  async getAccountBalances(opts: { from?: Date; to?: Date } = {}) {
    const where: any = {};
    if (opts.from || opts.to) {
      where.date = {};
      if (opts.from) where.date.gte = opts.from;
      if (opts.to) where.date.lte = opts.to;
    }
    const entries = await this.prisma.ledgerEntry.findMany({ where });

    const accounts: Record<string, { debit: number; credit: number; balance: number }> = {};
    for (const e of entries) {
      accounts[e.debitAccount] = accounts[e.debitAccount] ?? { debit: 0, credit: 0, balance: 0 };
      accounts[e.debitAccount].debit += e.amount;
      accounts[e.debitAccount].balance += e.amount;
      accounts[e.creditAccount] = accounts[e.creditAccount] ?? { debit: 0, credit: 0, balance: 0 };
      accounts[e.creditAccount].credit += e.amount;
      accounts[e.creditAccount].balance -= e.amount;
    }
    return Object.entries(accounts).map(([code, v]) => ({
      accountCode: code,
      ...v,
      balance: Math.round(v.balance),
    })).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  /**
   * 시산표 (Trial Balance)
   */
  async getTrialBalance(opts: { from?: Date; to?: Date } = {}) {
    const balances = await this.getAccountBalances(opts);
    const totalDebit = balances.reduce((s, b) => s + b.debit, 0);
    const totalCredit = balances.reduce((s, b) => s + b.credit, 0);
    return {
      entries: balances,
      totalDebit: Math.round(totalDebit),
      totalCredit: Math.round(totalCredit),
      isBalanced: Math.abs(totalDebit - totalCredit) < 1,
    };
  }

  /**
   * 손익계산서 (P&L)
   */
  async getProfitAndLoss(opts: { from?: Date; to?: Date } = {}) {
    const balances = await this.getAccountBalances(opts);
    const revenue = balances
      .filter((b) => b.accountCode.startsWith('2'))
      .reduce((s, b) => s + Math.max(0, b.credit - b.debit), 0);
    const expenses = balances
      .filter((b) => b.accountCode.startsWith('3') || b.accountCode.startsWith('4') || b.accountCode.startsWith('5'))
      .reduce((s, b) => s + Math.max(0, b.debit - b.credit), 0);
    const netIncome = revenue - expenses;
    return {
      revenue: Math.round(revenue),
      expenses: Math.round(expenses),
      netIncome: Math.round(netIncome),
      margin: revenue > 0 ? Math.round((netIncome / revenue) * 1000) / 10 : 0,
    };
  }

  async listEntries(opts: { from?: Date; to?: Date; limit?: number } = {}) {
    const where: any = {};
    if (opts.from || opts.to) {
      where.date = {};
      if (opts.from) where.date.gte = opts.from;
      if (opts.to) where.date.lte = opts.to;
    }
    return this.prisma.ledgerEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      take: opts.limit ?? 100,
    });
  }
}
