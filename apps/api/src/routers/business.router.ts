import { z } from 'zod';
import { router, protectedProcedure } from './trpc';
import { prisma } from '@sangfor/db';
import { calculateQuote } from '@sangfor/business';
import { routeColorAgents } from '@sangfor/business';
import { evaluateQuality, releaseGatePassed } from '@sangfor/business';

export const businessRouter = router({

  // Customers
  listCustomers: protectedProcedure
    .input(z.object({ companyId: z.string().optional(), search: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const customers = await prisma.customer.findMany({
        where: {
          ...(input?.companyId ? { projectId: input.companyId } : {}),
          ...(input?.search ? {
            OR: [
              { name: { contains: input.search, mode: 'insensitive' } },
              { contacts: { some: { email: { contains: input.search, mode: 'insensitive' } } } },
            ]
          } : {}),
        },
        include: { contacts: true, opportunities: true },
        orderBy: { createdAt: 'desc' },
      });
      return { customers };
    }),

  createCustomer: protectedProcedure
    .input(z.object({ name: z.string(), email: z.string().optional(), phone: z.string().optional(), companyId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const customer = await prisma.customer.create({
        data: {
          projectId: input.companyId || ctx.userId,
          name: input.name,
          contacts: input.email || input.phone ? {
            create: { name: input.name, email: input.email, phone: input.phone },
          } : undefined,
        },
        include: { contacts: true },
      });
      return customer;
    }),

  // Opportunities
  listOpportunities: protectedProcedure
    .input(z.object({ customerId: z.string().optional(), stage: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const opportunities = await prisma.opportunity.findMany({
        where: {
          ...(input?.customerId ? { customerId: input.customerId } : {}),
          ...(input?.stage ? { stage: input.stage } : {}),
        },
        include: { customer: true },
        orderBy: { createdAt: 'desc' },
      });
      return { opportunities };
    }),

  createOpportunity: protectedProcedure
    .input(z.object({ customerId: z.string(), name: z.string(), stage: z.string().default('lead') }))
    .mutation(async ({ ctx, input }) => {
      const opp = await prisma.opportunity.create({
        data: { projectId: ctx.userId, customerId: input.customerId, title: input.name, stage: input.stage },
      });
      return opp;
    }),

  // Product Catalog
  listProductFamilies: protectedProcedure
    .query(async () => {
      const families = await prisma.productFamily.findMany({
        include: { editions: { include: { skus: true } } },
      });
      return { families };
    }),

  listProductSkus: protectedProcedure
    .input(z.object({ familyId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const where = input?.familyId ? { edition: { familyId: input.familyId } } : {};
      const skus = await prisma.productSku.findMany({ where, include: { edition: { include: { family: true } } } });
      return { skus };
    }),

  // Quotes
  createQuote: protectedProcedure
    .input(z.object({ opportunityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const quote = await prisma.quote.create({
        data: { opportunityId: input.opportunityId, companyId: ctx.userId, createdBy: ctx.userId, totalRevenue: 0, totalCost: 0, marginPct: 0 },
      });
      return quote;
    }),

  calculateQuote: protectedProcedure
    .input(z.object({ lineItems: z.array(z.object({
      skuId: z.string(), quantity: z.number(), unitPrice: z.number(),
      costPrice: z.number(), discountPct: z.number()
    })) }))
    .mutation(async ({ input }) => {
      return calculateQuote(input.lineItems.map(item => ({
        productName: item.skuId, quantity: item.quantity,
        unitPrice: item.unitPrice, costPrice: item.costPrice, discountPct: item.discountPct,
      })));
    }),

  // Vendor Requests
  createVendorRequest: protectedProcedure
    .input(z.object({ opportunityId: z.string(), requestType: z.string(), vendorName: z.string(), details: z.any().optional() }))
    .mutation(async ({ ctx, input }) => {
      const req = await prisma.vendorRequest.create({
        data: {
          opportunityId: input.opportunityId,
          requestType: input.requestType,
          vendorName: input.vendorName,
          detailsJson: input.details ?? {},
          createdBy: ctx.userId,
        },
      });
      return req;
    }),

  // PoC
  listPocProjects: protectedProcedure
    .input(z.object({ opportunityId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const projects = await prisma.pocProject.findMany({ orderBy: { createdAt: 'desc' } });
      return { projects };
    }),

  createPocProject: protectedProcedure
    .input(z.object({ opportunityId: z.string(), name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = await prisma.pocProject.create({
        data: { projectId: ctx.userId, title: input.name, status: 'planning' },
      });
      return project;
    }),

  // Assets & Renewals
  listCustomerAssets: protectedProcedure
    .input(z.object({ customerId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const where = input?.customerId ? { customerId: input.customerId } : {};
      const assets = await prisma.customerAsset.findMany({ where, orderBy: { createdAt: 'desc' } });
      return { assets };
    }),

  createCustomerAsset: protectedProcedure
    .input(z.object({ customerId: z.string(), productName: z.string() }))
    .mutation(async ({ input }) => {
      const asset = await prisma.customerAsset.create({
        data: { customerId: input.customerId, name: input.productName, assetType: 'product' },
      });
      return asset;
    }),

  generateRenewals: protectedProcedure
    .input(z.object({ daysAhead: z.number().default(30) }))
    .mutation(async ({ input }) => {
      const future = new Date();
      future.setDate(future.getDate() + input.daysAhead);
      const renewals = await prisma.renewalOpportunity.findMany({
        where: { expiresAt: { lte: future }, status: 'pending' },
        include: { customer: true },
        orderBy: { expiresAt: 'asc' },
      });
      return { renewals };
    }),

  // Support
  listSupportCases: protectedProcedure
    .input(z.object({ customerId: z.string().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const where = {
        ...(input?.customerId ? { customerId: input.customerId } : {}),
        ...(input?.status ? { status: input.status } : {}),
      };
      const cases = await prisma.supportCase.findMany({ where });
      return { cases };
    }),

  createSupportCase: protectedProcedure
    .input(z.object({ customerId: z.string(), subject: z.string(), severity: z.string().default('medium') }))
    .mutation(async ({ input }) => {
      const supportCase = await prisma.supportCase.create({
        data: { customerId: input.customerId, subject: input.subject, severity: input.severity },
      });
      return supportCase;
    }),

  // AI Quality
  evaluateAiQuality: protectedProcedure
    .input(z.object({ score: z.number(), injectionBlockRate: z.number(), leakageDetected: z.boolean(), sourceCitationRate: z.number(), gaps: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      return evaluateQuality(input);
    }),

  checkReleaseGate: protectedProcedure
    .input(z.array(z.object({ score: z.number(), passed: z.boolean(), details: z.any() })))
    .mutation(async ({ input }) => {
      return releaseGatePassed(input as unknown as Parameters<typeof releaseGatePassed>[0]);
    }),

  // Color Agent
  routeColorAgent: protectedProcedure
    .input(z.object({ artifactType: z.string(), riskLevel: z.enum(['low','medium','high','critical']), isCustomerFacing: z.boolean(), hasRestrictedData: z.boolean(), isCommercial: z.boolean(), affectsUI: z.boolean(), affectsArchitecture: z.boolean() }))
    .mutation(async ({ input }) => {
      return routeColorAgents(input);
    }),
});
