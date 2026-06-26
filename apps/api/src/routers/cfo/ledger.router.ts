import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { LedgerService } from '../../services/finance';

const service = new LedgerService();

export const ledgerRouter = router({
  entries: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional(), limit: z.number().optional() }).optional())
    .query(async ({ input }) => service.listEntries(input ? { from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined, limit: input.limit } : {})),
  accounts: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ input }) => service.getAccountBalances(input ? { from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined } : {})),
  trialBalance: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ input }) => service.getTrialBalance(input ? { from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined } : {})),
  pnl: protectedProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ input }) => service.getProfitAndLoss(input ? { from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined } : {})),
});
