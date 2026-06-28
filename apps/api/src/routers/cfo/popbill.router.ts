import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { PopbillService } from '../../services/finance';

const popbill = new PopbillService();

export const popbillRouter = router({
  status: protectedProcedure
    .query(async () => popbill.checkStatus()),
  issue: protectedProcedure
    .input(z.object({
      invoiceId: z.string().optional(), projectId: z.string().optional(),
      direction: z.enum(['sales', 'purchase']),
      supplierCorpNum: z.string(), supplierName: z.string(),
      supplierCEOName: z.string().optional(), supplierAddr: z.string().optional(),
      supplierBizType: z.string().optional(), supplierBizClass: z.string().optional(),
      buyerCorpNum: z.string(), buyerName: z.string(),
      buyerCEOName: z.string().optional(), buyerAddr: z.string().optional(),
      buyerBizType: z.string().optional(), buyerBizClass: z.string().optional(),
      buyerEmail: z.string().optional(),
      supplyAmount: z.number(), vatAmount: z.number(), totalAmount: z.number(),
      issueDate: z.string(), memo: z.string().optional(), mgtKey: z.string().optional(),
      items: z.array(z.object({ name: z.string(), qty: z.number(), unitPrice: z.number(), amount: z.number() })),
    }))
    .mutation(async ({ input }) => popbill.issue({ ...input, issueDate: new Date(input.issueDate) })),
  collectPurchase: protectedProcedure
    .input(z.object({ year: z.number(), month: z.number() }))
    .mutation(async ({ input }) => popbill.collectPurchaseTaxInvoices(input.year, input.month)),
  checkBizInfo: protectedProcedure
    .input(z.object({ corpNum: z.string() }))
    .query(async ({ input }) => popbill.checkBizInfo(input.corpNum)),
  history: protectedProcedure
    .input(z.object({ direction: z.string().optional(), status: z.string().optional(), limit: z.number().default(50) }).optional())
    .query(async ({ input }) => popbill.listHistory(input)),
});
