import { z } from 'zod';
import { router, protectedProcedure } from './trpc';

export const businessRouter = router({
  // Customers
  listCustomers: protectedProcedure
    .input(z.object({ companyId: z.string().optional(), search: z.string().optional() }))
    .query(async () => ({ customers: [] })),

  createCustomer: protectedProcedure
    .input(z.object({ name: z.string(), email: z.string().optional(), phone: z.string().optional() }))
    .mutation(async ({ input }) => ({ id: 'new-customer-id', ...input })),

  // Opportunities
  listOpportunities: protectedProcedure
    .input(z.object({ customerId: z.string().optional(), stage: z.string().optional() }))
    .query(async () => ({ opportunities: [] })),

  createOpportunity: protectedProcedure
    .input(z.object({ customerId: z.string(), name: z.string(), stage: z.string() }))
    .mutation(async ({ input }) => ({ id: 'new-opp', ...input })),

  // Product Catalog
  listProductFamilies: protectedProcedure
    .query(async () => ({ families: [] })),

  listProductSkus: protectedProcedure
    .input(z.object({ familyId: z.string().optional() }))
    .query(async () => ({ skus: [] })),

  // Quotes
  createQuote: protectedProcedure
    .input(z.object({ opportunityId: z.string() }))
    .mutation(async () => ({ id: 'new-quote' })),

  calculateQuote: protectedProcedure
    .input(z.object({ lineItems: z.array(z.object({
      skuId: z.string(), quantity: z.number(), unitPrice: z.number(),
      costPrice: z.number(), discountPct: z.number()
    })) }))
    .mutation(async ({ input }) => {
      const { calculateQuote } = await import('@sangfor/business');
      const lineItems = input.lineItems.map(item => ({
        productName: item.skuId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        costPrice: item.costPrice,
        discountPct: item.discountPct,
      }));
      return calculateQuote(lineItems);
    }),

  // Vendor Requests
  createVendorRequest: protectedProcedure
    .input(z.object({ opportunityId: z.string(), requestType: z.string(), vendorName: z.string() }))
    .mutation(async () => ({ id: 'new-vendor-request' })),

  // PoC
  listPocProjects: protectedProcedure
    .query(async () => ({ projects: [] })),

  createPocProject: protectedProcedure
    .input(z.object({ opportunityId: z.string(), name: z.string() }))
    .mutation(async () => ({ id: 'new-poc' })),

  // Assets
  listCustomerAssets: protectedProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async () => ({ assets: [] })),

  createCustomerAsset: protectedProcedure
    .input(z.object({ customerId: z.string(), productName: z.string() }))
    .mutation(async () => ({ id: 'new-asset' })),

  // Renewals
  generateRenewals: protectedProcedure
    .input(z.object({ daysAhead: z.number().default(30) }))
    .mutation(async () => ({ renewals: [] })),

  // Support
  listSupportCases: protectedProcedure
    .query(async () => ({ cases: [] })),

  createSupportCase: protectedProcedure
    .input(z.object({ customerId: z.string(), subject: z.string(), severity: z.string() }))
    .mutation(async () => ({ id: 'new-case' })),

  // AI Quality
  evaluateAiQuality: protectedProcedure
    .input(z.object({
      score: z.number(),
      injectionBlockRate: z.number(),
      leakageDetected: z.boolean(),
      sourceCitationRate: z.number(),
      gaps: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      const { evaluateQuality } = await import('@sangfor/business');
      return evaluateQuality(input);
    }),

  checkReleaseGate: protectedProcedure
    .input(z.array(z.object({
      score: z.number(), passed: z.boolean(),
      details: z.object({
        injectionBlockRate: z.number(),
        leakageDetected: z.boolean(),
        sourceCitationRate: z.number(),
        gaps: z.array(z.string()),
      }),
    })))
    .mutation(async ({ input }) => {
      const { releaseGatePassed } = await import('@sangfor/business');
      return releaseGatePassed(input);
    }),

  // Color Agent
  routeColorAgent: protectedProcedure
    .input(z.object({
      artifactType: z.string(),
      riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
      isCustomerFacing: z.boolean(),
      hasRestrictedData: z.boolean(),
      isCommercial: z.boolean(),
      affectsUI: z.boolean(),
      affectsArchitecture: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const { routeColorAgents } = await import('@sangfor/business');
      return routeColorAgents(input);
    }),
});
