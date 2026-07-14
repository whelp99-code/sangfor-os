import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@sangfor/db', () => ({
  prisma: { financeSubscription: { findMany } },
}));

import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService.getTotalMonthlyCost', () => {
  beforeEach(() => findMany.mockReset());

  it('returns the UI contract with active count and normalized monthly total', async () => {
    findMany.mockResolvedValue([
      { amount: 10_000, cycle: 'monthly' },
      { amount: 120_000, cycle: 'yearly' },
      { amount: 1_000, cycle: 'weekly' },
    ]);

    await expect(new SubscriptionsService().getTotalMonthlyCost()).resolves.toEqual({
      monthlyTotal: 24_345,
      count: 3,
    });
    expect(findMany).toHaveBeenCalledWith({ where: { isActive: true } });
  });
});
