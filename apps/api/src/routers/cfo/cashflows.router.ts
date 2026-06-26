import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { CashflowsService } from '../../services/finance';

const service = new CashflowsService();

export const cashflowsRouter = router({
  list: protectedProcedure
    .input(z.object({ type: z.string().optional(), projectId: z.string().optional(), limit: z.number().default(100) }).optional())
    .query(async ({ input }) => service.list(input ?? { limit: 100 })),
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => service.get(input.id)),
  create: protectedProcedure
    .input(z.object({ projectId: z.string().optional(), counterparty: z.string(), amount: z.number(), type: z.string(), outAccount: z.string().optional(), inAccount: z.string().optional(), date: z.string().optional(), memo: z.string().optional() }))
    .mutation(async ({ input }) => service.create(input as any)),
  update: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string().optional(), counterparty: z.string().optional(), amount: z.number().optional(), type: z.string().optional(), outAccount: z.string().optional(), inAccount: z.string().optional(), date: z.string().optional(), memo: z.string().optional() }))
    .mutation(async ({ input }) => service.update(input.id, input)),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => service.delete(input.id)),
});
