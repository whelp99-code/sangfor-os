import { prisma } from '@sangfor/db';

// Normalize a company name for fuzzy counterparty↔project matching.
export function normName(s: string | null | undefined): string {
  return (s ?? '').replace(/\(주\)|주식회사|㈜|\s|\.|,|-/g, '').toLowerCase();
}

type ProjEntry = { projectId: string; amount: number };

/**
 * Build name→project lookup maps from invoice buyers (for inflows) and expense
 * vendors (for outflows). Used to auto-attribute bank cashflows to projects.
 */
async function buildProjectMatchMaps() {
  const [invoices, expenses] = await Promise.all([
    prisma.invoice.findMany({ where: { projectId: { not: null } }, select: { buyer: true, amount: true, projectId: true } }),
    prisma.expense.findMany({ where: { projectId: { not: null } }, select: { vendor: true, amount: true, projectId: true } }),
  ]);
  const buyer = new Map<string, ProjEntry[]>();
  for (const i of invoices) if (i.buyer) (buyer.get(normName(i.buyer)) ?? buyer.set(normName(i.buyer), []).get(normName(i.buyer))!).push({ projectId: i.projectId!, amount: i.amount });
  const vendor = new Map<string, ProjEntry[]>();
  for (const e of expenses) if (e.vendor) (vendor.get(normName(e.vendor)) ?? vendor.set(normName(e.vendor), []).get(normName(e.vendor))!).push({ projectId: e.projectId!, amount: e.amount });
  return { buyer, vendor };
}

export function matchProjectId(
  maps: { buyer: Map<string, ProjEntry[]>; vendor: Map<string, ProjEntry[]> },
  counterparty: string,
  amount: number,
  inflow: boolean,
): string | null {
  const cands = (inflow ? maps.buyer : maps.vendor).get(normName(counterparty));
  if (!cands || cands.length === 0) return null;
  const projects = new Set(cands.map((c) => c.projectId));
  if (projects.size === 1) return cands[0].projectId;
  // Disambiguate a multi-project counterparty by exact amount.
  const byAmount = cands.filter((c) => c.amount === amount);
  const amtProjects = new Set(byAmount.map((c) => c.projectId));
  return amtProjects.size === 1 ? byAmount[0].projectId : null;
}

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
        projectId: dto.projectId || null,
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
    if (dto.projectId !== undefined) data.projectId = dto.projectId || null;
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

  /**
   * Bulk-import bank-statement rows into cashflows, skipping duplicates.
   * Uniqueness: when a post-transaction balance (거래후잔액) is present it is the
   * surest discriminator (it differs even for same-day same-amount rows); we use
   * date + cashChange + balanceAfter then. Otherwise fall back to date +
   * cashChange + counterparty + memo. Dates are UTC calendar dates (no TZ drift).
   */
  async importMany(
    rows: Array<{
      date?: string;
      counterparty?: string;
      amount: number;
      cashChange: number;
      type?: string;
      inAccount?: string;
      outAccount?: string;
      balanceAfter?: number | null;
      memo?: string;
    }>,
  ) {
    let created = 0;
    let skipped = 0;
    let matched = 0;
    const maps = await buildProjectMatchMaps();
    for (const r of rows) {
      const amount = Math.round(Number(r.amount) || 0);
      const cashChange = Math.round(Number(r.cashChange) || 0);
      if (!amount && !cashChange) {
        skipped += 1;
        continue;
      }
      const date = r.date ? new Date(`${r.date.slice(0, 10)}T00:00:00.000Z`) : new Date();
      const counterparty = (r.counterparty ?? '').trim();
      const memo = (r.memo ?? '').trim() || null;
      const balanceAfter =
        r.balanceAfter != null && Number.isFinite(Number(r.balanceAfter)) ? Math.round(Number(r.balanceAfter)) : null;
      const dup = await prisma.cashflow.findFirst({
        where:
          balanceAfter != null
            ? { date, cashChange, balanceAfter }
            : { date, cashChange, counterparty, memo },
      });
      if (dup) {
        skipped += 1;
        continue;
      }
      const projectId = matchProjectId(maps, counterparty, amount, cashChange >= 0);
      if (projectId) matched += 1;
      await prisma.cashflow.create({
        data: {
          counterparty,
          amount,
          cashChange,
          type: (r.type ?? '').trim() || (cashChange >= 0 ? '입금' : '출금'),
          inAccount: r.inAccount?.trim() || null,
          outAccount: r.outAccount?.trim() || null,
          date,
          balanceAfter,
          memo,
          projectId,
        },
      });
      created += 1;
    }
    return { created, skipped, matched, total: rows.length };
  }

  /**
   * Re-attribute existing cashflows to projects by counterparty.
   * Only fills rows that are not yet linked (does not overwrite manual edits).
   */
  async rematchAll() {
    const maps = await buildProjectMatchMaps();
    const rows = await prisma.cashflow.findMany({ where: { projectId: null } });
    let matched = 0;
    for (const c of rows) {
      const projectId = matchProjectId(maps, c.counterparty, c.amount, c.cashChange >= 0);
      if (projectId) {
        await prisma.cashflow.update({ where: { id: c.id }, data: { projectId } });
        matched += 1;
      }
    }
    return { scanned: rows.length, matched };
  }
}
