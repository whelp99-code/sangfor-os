import { z } from 'zod';
import { router, protectedProcedure } from './trpc';
import { prisma } from '@sangfor/db';
import { calculateBantScore, calculateQuote, normalizeOpportunityStage, routeColorAgents, submitCommercialApproval, validateOpportunityStageOrder, validateRegistrationGate } from '@sangfor/business';
import { evaluateQuality, releaseGatePassed } from '@sangfor/business';

export const businessRouter = router({

  qualifyOpportunity: protectedProcedure
    .input(z.object({
      opportunityId: z.string(),
      budgetScore: z.number().min(0).max(100),
      authorityScore: z.number().min(0).max(100),
      needScore: z.number().min(0).max(100),
      timelineScore: z.number().min(0).max(100),
    }))
    .mutation(async ({ input }) => {
      const { weightedScore, passed } = calculateBantScore({
        budgetScore: input.budgetScore,
        authorityScore: input.authorityScore,
        needScore: input.needScore,
        timelineScore: input.timelineScore,
      });
      const qualification = await prisma.dealQualification.create({
        data: {
          opportunityId: input.opportunityId,
          budgetScore: input.budgetScore,
          authorityScore: input.authorityScore,
          needScore: input.needScore,
          timelineScore: input.timelineScore,
          weightedScore,
          passed,
        },
      });
      return qualification;
    }),

  submitQuoteForApproval: protectedProcedure
    .input(z.object({ quoteId: z.string(), opportunityId: z.string(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.companyId) throw new Error('Authenticated company scope is required');
      return submitCommercialApproval({ quoteId: input.quoteId, opportunityId: input.opportunityId, companyId: ctx.companyId, reason: input.reason });
    }),

  getDealQualification: protectedProcedure
    .input(z.object({ opportunityId: z.string() }))
    .query(async ({ input }) => {
      const qualification = await prisma.dealQualification.findFirst({
        where: { opportunityId: input.opportunityId },
        orderBy: { qualifiedAt: 'desc' },
      });
      return { qualification };
    }),

  // Customers
  listCustomers: protectedProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const customers = await prisma.customer.findMany({
        where: {
          ...(ctx.companyId ? { projectId: ctx.companyId } : {}),
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
    .input(z.object({ name: z.string(), email: z.string().optional(), phone: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.companyId) throw new Error('Authenticated company scope is required');
      const customer = await prisma.customer.create({
        data: {
          projectId: ctx.companyId,
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
          ...(input?.stage ? { stage: normalizeOpportunityStage(input.stage) } : {}),
        },
        include: { customer: true },
        orderBy: { createdAt: 'desc' },
      });
      return { opportunities };
    }),

  createOpportunity: protectedProcedure
    .input(z.object({ customerId: z.string(), name: z.string(), stage: z.string().default('LEAD') }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.companyId) throw new Error('Authenticated company scope is required');
      const opp = await prisma.opportunity.create({
        data: { projectId: ctx.companyId, customerId: input.customerId, title: input.name, stage: normalizeOpportunityStage(input.stage) },
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
      if (!ctx.companyId || !ctx.userId) throw new Error('Authenticated user and company scope are required');
      const quote = await prisma.quote.create({
        data: { opportunityId: input.opportunityId, companyId: ctx.companyId, createdBy: ctx.userId, totalRevenue: 0, totalCost: 0, marginPct: 0 },
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
      if (!ctx.companyId) throw new Error('Authenticated company scope is required');
      const project = await prisma.pocProject.create({
        data: { projectId: ctx.companyId, title: input.name, status: 'planning' },
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

  completeDelivery: protectedProcedure
    .input(z.object({ deliveryId: z.string(), assetName: z.string(), customerId: z.string() }))
    .mutation(async ({ input }) => {
      const project = await prisma.engagement.update({
        where: { id: input.deliveryId },
        data: { status: "completed", completedAt: new Date() },
      });
      if (project.opportunityId) {
        // Don't blindly force the linked opportunity to WON: validate the
        // stage order and the deal-registration gate first, mirroring the
        // wired advance path. This prevents an illegal stage skip (e.g. a
        // still-LEAD opportunity) or a WON with an unresolved registration
        // from being written silently as a side effect of delivery.
        const opp = await prisma.opportunity.findUnique({
          where: { id: project.opportunityId },
          include: { dealRegistration: { select: { regStatus: true } } },
        });
        if (opp) {
          const order = validateOpportunityStageOrder(opp.stage, "WON");
          if (!order.allowed) {
            throw new Error(`illegal_stage_transition:${order.reason}`);
          }
          const gate = validateRegistrationGate({
            from: opp.stage,
            to: "WON",
            dealType: opp.dealType,
            regStatus: opp.dealRegistration?.regStatus ?? null,
          });
          if (!gate.allowed) {
            throw new Error(`registration_gate:${gate.reason}`);
          }
          await prisma.opportunity.update({
            where: { id: project.opportunityId },
            data: { stage: "WON" },
          });
        }
      }
      const asset = await prisma.customerAsset.create({
        data: { customerId: input.customerId, name: input.assetName, assetType: "product", status: "active" },
      });
      return { project, asset };
    }),

  processRenewals: protectedProcedure
    .input(z.object({ daysAhead: z.number().default(30), companyId: z.string() }))
    .mutation(async ({ input }) => {
      const future = new Date();
      future.setDate(future.getDate() + input.daysAhead);
      const renewals = await prisma.renewalOpportunity.findMany({
        where: { expiresAt: { lte: future }, status: "pending" },
      });
      const notifications = [];
      for (const r of renewals) {
        const n = await prisma.notificationEvent.create({
          data: {
            companyId: input.companyId,
            channel: "internal",
            eventType: "renewal.reminder",
            payloadJson: { renewalId: r.id, customerId: r.customerId, expiresAt: r.expiresAt },
          },
        });
        notifications.push(n);
      }
      return { renewals: renewals.length, notifications: notifications.length };
    }),
});
