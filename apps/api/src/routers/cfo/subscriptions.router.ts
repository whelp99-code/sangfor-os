import { z } from 'zod';
import { router, financeProcedure } from '../trpc';
import { SubscriptionsService } from '../../services/finance';

const service = new SubscriptionsService();

export const subscriptionsRouter = router({
  list: financeProcedure
    .input(z.object({ isActive: z.boolean().optional() }).optional())
    .query(async ({ input }) => service.list(input ?? {})),
  create: financeProcedure
    .input(z.object({ name: z.string(), vendor: z.string().optional(), amount: z.number(), currency: z.string().optional(), cycle: z.enum(['monthly', 'yearly', 'weekly']), category: z.string().optional(), nextBillingDate: z.string(), paymentMethod: z.string().optional(), notifyDaysBefore: z.number().optional(), memo: z.string().optional() }))
    .mutation(async ({ input }) => service.create({ ...input, nextBillingDate: new Date(input.nextBillingDate) })),
  update: financeProcedure
    .input(z.object({ id: z.string(), name: z.string().optional(), vendor: z.string().optional(), amount: z.number().optional(), currency: z.string().optional(), cycle: z.enum(['monthly', 'yearly', 'weekly']).optional(), category: z.string().optional(), nextBillingDate: z.string().optional(), paymentMethod: z.string().optional(), notifyDaysBefore: z.number().optional(), memo: z.string().optional(), isActive: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return service.update(id, { ...data, nextBillingDate: data.nextBillingDate ? new Date(data.nextBillingDate) : undefined });
    }),
  remove: financeProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => service.remove(input.id)),
  advanceCycle: financeProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => service.advanceCycle(input.id)),
  monthlyTotal: financeProcedure
    .query(async () => service.getTotalMonthlyCost()),
  byCategory: financeProcedure
    .query(async () => service.getCategoryBreakdown()),
  upcoming: financeProcedure
    .input(z.object({ days: z.number().default(7) }).optional())
    .query(async ({ input }) => service.getUpcomingRenewals(input?.days)),
});
