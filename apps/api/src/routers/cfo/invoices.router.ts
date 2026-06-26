import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { InvoicesService } from '../../services/finance';

const service = new InvoicesService();

export const invoicesRouter = router({
  list: protectedProcedure
    .input(z.object({ depositStatus: z.string().optional(), projectId: z.string().optional(), limit: z.number().default(100) }).optional())
    .query(async ({ input }) => service.list(input ?? { limit: 100 })),
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => service.get(input.id)),
  create: protectedProcedure
    .input(z.object({ projectId: z.string().optional(), amount: z.number().optional(), depositAmount: z.number().optional(), depositStatus: z.string().optional(), depositDate: z.string().optional(), memo: z.string().optional(), buyer: z.string().optional() }))
    .mutation(async ({ input }) => service.create(input)),
  update: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string().optional(), amount: z.number().optional(), depositAmount: z.number().optional(), depositStatus: z.string().optional(), depositDate: z.string().optional(), memo: z.string().optional(), buyer: z.string().optional() }))
    .mutation(async ({ input }) => service.update(input.id, input)),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => service.delete(input.id)),
});
