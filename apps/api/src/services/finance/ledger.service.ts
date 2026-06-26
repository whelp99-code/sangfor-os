import { prisma } from '@sangfor/db';

export type AccountCode =
  | '100' | '101' | '110' | '120' | '130' | '150'
  | '200' | '210'
  | '300' | '310'
  | '400' | '410' | '420' | '430' | '440' | '450' | '460' | '470' | '480' | '490'
  | '500' | '510' | '520'
  | '900' | '910' | '920' | '930';

export class LedgerService {
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
      throw new Error('금액은 0보다 커야 합니다.');
    }
    return prisma.ledgerEntry.create({ data: input });
  }

  async postInvoiceIssued(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new Error('인보이스 없음');
    const total = (invoice.amount ?? 0) + (invoice.vat ?? 0);
    const vat = invoice.vat ?? 0;
    const supply = invoice.amount ?? 0;
    if (total <= 0) return null;

    return prisma.$transaction([
      prisma.ledgerEntry.create({
        data: {
          date: new Date(),
          description: `[매출] ${invoice.buyer ?? '고객'} ${supply.toLocaleString()}원`,
          debitAccount: '110',
          creditAccount: '200',
          amount: supply,
          reference: invoiceId,
          referenceType: 'invoice',
        },
      }),
      prisma.ledgerEntry.create({
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

  async postInvoicePaid(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return null;
    const total = (invoice.amount ?? 0) + (invoice.vat ?? 0);
    if (total <= 0) return null;
    return prisma.ledgerEntry.create({
      data: {
        date: invoice.depositDate ?? new Date(),
        description: `[입금] ${invoice.buyer ?? '고객'} ${total.toLocaleString()}원`,
        debitAccount: '100',
        creditAccount: '110',
        amount: total,
        reference: invoiceId,
        referenceType: 'invoice',
      },
    });
  }

  async postExpense(expenseId: string) {
    const e = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!e) return null;
    const supply = e.amount ?? 0;
    const vat = e.vat ?? 0;
    const total = supply + vat;
    if (total <= 0) return null;

    const expenseAccount = this.mapCategoryToAccount(e.category ?? undefined) ?? undefined;

    return prisma.$transaction([
      prisma.ledgerEntry.create({
        data: {
          date: e.date ?? new Date(),
          description: `[지출] ${e.expenseName}`,
          debitAccount: expenseAccount,
          creditAccount: '920',
          amount: supply,
          reference: expenseId,
          referenceType: 'expense',
        },
      }),
      prisma.ledgerEntry.create({
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

  private mapCategoryToAccount(category?: string): AccountCode {
    switch (category) {
      case '급여': return '400';
      case '판관비': return '410';
      case '원가(매입)': return '300';
      case '세무 보험': return '450';
      default: return '410';
    }
  }

  validate(entries: { debitAccount: string; creditAccount: string; amount: number }[]) {
    const debit = entries.reduce((s, e) => s + e.amount, 0);
    const credit = entries.reduce((s, e) => s + e.amount, 0);
    if (Math.abs(debit - credit) > 0.0001) {
      throw new Error(`차변/대변 불일치: 차변 ${debit}, 대변 ${credit}`);
    }
    return true;
  }

  async getAccountBalances(opts: { from?: Date; to?: Date } = {}) {
    const where: any = {};
    if (opts.from || opts.to) {
      where.date = {};
      if (opts.from) where.date.gte = opts.from;
      if (opts.to) where.date.lte = opts.to;
    }
    const entries = await prisma.ledgerEntry.findMany({ where });

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
      accountCode: code, ...v, balance: Math.round(v.balance),
    })).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

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
    return prisma.ledgerEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      take: opts.limit ?? 100,
    });
  }
}
