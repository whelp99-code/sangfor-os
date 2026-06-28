import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { ExpensesService } from '../../services/finance';

const service = new ExpensesService();

export const expensesRouter = router({
  list: protectedProcedure
    .input(z.object({ category: z.string().optional(), isPaid: z.boolean().optional(), projectId: z.string().optional(), limit: z.number().default(100) }).optional())
    .query(async ({ input }) => service.list(input ?? { limit: 100 })),
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => service.get(input.id)),
  create: protectedProcedure
    .input(z.object({ projectId: z.string().optional(), expenseName: z.string(), amount: z.number().optional(), category: z.string().optional(), vendor: z.string().optional(), date: z.string().optional(), proofType: z.string().optional(), paymentMethod: z.string().optional(), isPaid: z.boolean().optional() }))
    .mutation(async ({ input }) => service.create(input as any)),
  update: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string().optional(), expenseName: z.string().optional(), amount: z.number().optional(), category: z.string().optional(), vendor: z.string().optional(), date: z.string().optional(), proofType: z.string().optional(), paymentMethod: z.string().optional(), isPaid: z.boolean().optional() }))
    .mutation(async ({ input }) => service.update(input.id, input)),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => service.delete(input.id)),
});
