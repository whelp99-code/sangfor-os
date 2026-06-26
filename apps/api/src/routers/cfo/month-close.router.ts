import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { MonthCloseService } from '../../services/finance';

const service = new MonthCloseService();

export const monthCloseRouter = router({
  list: protectedProcedure
    .query(async () => service.list()),
  get: protectedProcedure
    .input(z.object({ year: z.number(), month: z.number() }))
    .query(async ({ input }) => service.get(input.year, input.month)),
  checklist: protectedProcedure
    .input(z.object({ year: z.number(), month: z.number() }))
    .query(async ({ input }) => service.runChecklist(input.year, input.month)),
  start: protectedProcedure
    .input(z.object({ year: z.number(), month: z.number(), notes: z.string().optional() }))
    .mutation(async ({ input }) => service.start(input.year, input.month, input.notes)),
  complete: protectedProcedure
    .input(z.object({ year: z.number(), month: z.number() }))
    .mutation(async ({ input }) => service.complete(input.year, input.month)),
});
