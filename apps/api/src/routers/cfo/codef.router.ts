import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { CodefService } from '../../services/finance';

const codef = new CodefService();

export const codefRouter = router({
  status: protectedProcedure
    .query(async () => ({ enabled: codef.isEnabled() })),
  accounts: protectedProcedure
    .input(z.object({ type: z.enum(['bank', 'card']).optional() }).optional())
    .query(async ({ input }) => codef.listAccounts(input?.type)),
  connectAccount: protectedProcedure
    .input(z.object({ type: z.enum(['bank', 'card']), organization: z.string(), accountName: z.string(), accountNum: z.string().optional(), memo: z.string().optional() }))
    .mutation(async ({ input }) => codef.connectAccount(input)),
  syncTransactions: protectedProcedure
    .input(z.object({ accountId: z.string(), fromDate: z.string(), toDate: z.string() }))
    .mutation(async ({ input }) => codef.syncTransactions(input.accountId, new Date(input.fromDate), new Date(input.toDate))),
  expiring: protectedProcedure
    .input(z.object({ days: z.number().default(7) }).optional())
    .query(async ({ input }) => codef.getExpiringSoon(input?.days)),
});
