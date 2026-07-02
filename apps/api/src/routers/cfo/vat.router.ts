import { z } from 'zod';
import { router, financeProcedure } from '../trpc';
import { VatService } from '../../services/finance';

const service = new VatService();

export const vatRouter = router({
  calculate: financeProcedure
    .input(z.object({ year: z.number(), half: z.union([z.literal(1), z.literal(2)]) }))
    .query(async ({ input }) => service.calculateVat(input.year, input.half)),
  incomeTax: financeProcedure
    .input(z.object({ taxableBase: z.number() }))
    .mutation(async ({ input }) => service.calculateIncomeTax(input.taxableBase)),
  periods: financeProcedure
    .input(z.object({ year: z.number(), half: z.union([z.literal(1), z.literal(2)]) }))
    .query(async ({ input }) => service.getPeriodBounds(input.year, input.half)),
});
