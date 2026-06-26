import { prisma } from '@sangfor/db';

export interface CreateSubscriptionDto {
  name: string;
  vendor?: string;
  amount: number;
  currency?: string;
  cycle: 'monthly' | 'yearly' | 'weekly';
  category?: string;
  nextBillingDate: Date;
  paymentMethod?: string;
  notifyDaysBefore?: number;
  memo?: string;
}

export class SubscriptionsService {
  async list(opts: { isActive?: boolean } = {}) {
    return prisma.financeSubscription.findMany({
      where: opts.isActive !== undefined ? { isActive: opts.isActive } : undefined,
      orderBy: { nextBillingDate: 'asc' },
    });
  }

  async create(input: CreateSubscriptionDto) {
    if (!input.name || input.amount <= 0) {
      throw new Error('name과 amount(>0)는 필수입니다.');
    }
    if (!['monthly', 'yearly', 'weekly'].includes(input.cycle)) {
      throw new Error('cycle은 monthly|yearly|weekly 만 허용됩니다.');
    }
    return prisma.financeSubscription.create({
      data: {
        name: input.name,
        vendor: input.vendor,
        amount: input.amount,
        currency: input.currency ?? 'KRW',
        cycle: input.cycle,
        category: input.category,
        nextBillingDate: new Date(input.nextBillingDate),
        paymentMethod: input.paymentMethod,
        notifyDaysBefore: input.notifyDaysBefore ?? 7,
        memo: input.memo,
      },
    });
  }

  async update(id: string, input: Partial<CreateSubscriptionDto> & { isActive?: boolean }) {
    return prisma.financeSubscription.update({
      where: { id },
      data: {
        ...input,
        nextBillingDate: input.nextBillingDate ? new Date(input.nextBillingDate) : undefined,
      },
    });
  }

  async remove(id: string) {
    return prisma.financeSubscription.delete({ where: { id } });
  }

  async advanceCycle(id: string) {
    const sub = await prisma.financeSubscription.findUnique({ where: { id } });
    if (!sub) return null;
    const next = new Date(sub.nextBillingDate);
    switch (sub.cycle) {
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'yearly':
        next.setFullYear(next.getFullYear() + 1);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
    }
    return prisma.financeSubscription.update({
      where: { id },
      data: { nextBillingDate: next },
    });
  }

  async getTotalMonthlyCost() {
    const subs = await prisma.financeSubscription.findMany({ where: { isActive: true } });
    let total = 0;
    for (const s of subs) {
      switch (s.cycle) {
        case 'monthly':
          total += s.amount;
          break;
        case 'yearly':
          total += s.amount / 12;
          break;
        case 'weekly':
          total += s.amount * 4.345;
          break;
      }
    }
    return Math.round(total);
  }

  async getUpcomingRenewals(days = 7) {
    const now = new Date();
    const limit = new Date();
    limit.setDate(limit.getDate() + days);
    return prisma.financeSubscription.findMany({
      where: {
        isActive: true,
        nextBillingDate: { gte: now, lte: limit },
      },
      orderBy: { nextBillingDate: 'asc' },
    });
  }

  async getCategoryBreakdown() {
    const subs = await prisma.financeSubscription.findMany({ where: { isActive: true } });
    const map: Record<string, { count: number; amount: number }> = {};
    for (const s of subs) {
      const cat = s.category ?? '기타';
      map[cat] = map[cat] ?? { count: 0, amount: 0 };
      map[cat].count += 1;
      const monthly = s.cycle === 'yearly' ? s.amount / 12 : s.cycle === 'weekly' ? s.amount * 4.345 : s.amount;
      map[cat].amount += monthly;
    }
    return Object.entries(map)
      .map(([category, v]) => ({ category, ...v, amount: Math.round(v.amount) }))
      .sort((a, b) => b.amount - a.amount);
  }
}
