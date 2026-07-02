import { z } from 'zod';
import { router, financeProcedure } from '../trpc';
import { CashflowsService } from '../../services/finance';

const service = new CashflowsService();

export const cashflowsRouter = router({
  list: financeProcedure
    .input(z.object({ type: z.string().optional(), projectId: z.string().optional(), limit: z.number().default(100) }).optional())
    .query(async ({ input }) => service.list(input ?? { limit: 100 })),
  get: financeProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => service.get(input.id)),
  create: financeProcedure
    .input(z.object({ projectId: z.string().optional(), counterparty: z.string(), amount: z.number(), type: z.string(), outAccount: z.string().optional(), inAccount: z.string().optional(), date: z.string().optional(), memo: z.string().optional() }))
    .mutation(async ({ input }) => service.create(input as any)),
  update: financeProcedure
    .input(z.object({ id: z.string(), projectId: z.string().optional(), counterparty: z.string().optional(), amount: z.number().optional(), type: z.string().optional(), outAccount: z.string().optional(), inAccount: z.string().optional(), date: z.string().optional(), memo: z.string().optional() }))
    .mutation(async ({ input }) => service.update(input.id, input)),
  delete: financeProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => service.delete(input.id)),
});
