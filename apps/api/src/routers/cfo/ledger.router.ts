import { z } from 'zod';
import { router, financeProcedure } from '../trpc';
import { LedgerService } from '../../services/finance';

const service = new LedgerService();

export const ledgerRouter = router({
  entries: financeProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional(), limit: z.number().optional() }).optional())
    .query(async ({ input }) => service.listEntries(input ? { from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined, limit: input.limit } : {})),
  accounts: financeProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ input }) => service.getAccountBalances(input ? { from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined } : {})),
  trialBalance: financeProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ input }) => service.getTrialBalance(input ? { from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined } : {})),
  pnl: financeProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ input }) => service.getProfitAndLoss(input ? { from: input.from ? new Date(input.from) : undefined, to: input.to ? new Date(input.to) : undefined } : {})),
});
