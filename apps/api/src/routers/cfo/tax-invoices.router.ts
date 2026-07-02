import { z } from 'zod';
import { router, financeProcedure } from '../trpc';
import { prisma } from '@sangfor/db';
import { ingestSecureMailHtml } from '../../services/finance/tax-invoice-inbound.service';
import { issueSalesTaxInvoice, markTransmitted } from '../../services/finance/tax-invoice-issue.service';

export const taxInvoicesRouter = router({
  list: financeProcedure
    .input(z.object({ direction: z.enum(['sales', 'purchase']).optional() }).optional())
    .query(({ input }) =>
      prisma.taxInvoice.findMany({
        where: input?.direction ? { direction: input.direction } : {},
        orderBy: { issueDate: 'desc' },
        // Match the REST list (routes/cfo.ts): keep the payload lean and
        // don't ship internal columns (decrypted XML, raw upstream API
        // response) to the client (P4 — REST/tRPC exposure parity).
        omit: { rawXml: true, rawResponse: true },
      }),
    ),

  uploadHtml: financeProcedure
    .input(z.object({ html: z.string() }))
    .mutation(({ input }) => ingestSecureMailHtml(input.html)),

  issue: financeProcedure
    .input(
      z.object({
        buyerCorpNum: z.string(),
        buyerName: z.string(),
        buyerCeoName: z.string().optional(),
        items: z
          .array(z.object({ name: z.string(), amount: z.number().int() }))
          .min(1),
      }),
    )
    .mutation(({ input }) => issueSalesTaxInvoice(input)),

  markTransmitted: financeProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => markTransmitted(input.id)),
});
