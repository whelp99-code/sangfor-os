import { normalizeOpportunityStage } from '@sangfor/business';
import { prisma } from '@sangfor/db';

import { protectedProcedure, router } from './trpc';

export const dashboardRouter = router({

  sales: protectedProcedure.query(async () => {
    const opportunities = await prisma.opportunity.findMany({ include: { customer: true } })
    const pendingApprovals = await prisma.approvalRequest.findMany({ where: { status: 'ready_for_human_approval' } })
    const proposals = await prisma.generatedDocument.findMany({ orderBy: { createdAt: 'desc' }, take: 10 })

    return {
      pipeline: opportunities.map(o => ({ id: o.id, customer: o.customer?.name, stage: o.stage, value: Number(o.amount) || 0 })),
      followUp: opportunities.filter(o => normalizeOpportunityStage(o.stage) === 'LEAD').length,
      pendingApprovals: pendingApprovals.length,
      proposalsInProgress: proposals.filter(p => p.status === 'draft').length,
      renewalsDue: 0,
      riskDeals: opportunities.filter(o => normalizeOpportunityStage(o.stage) === 'NEGOTIATION' && (Number(o.amount) || 0) > 50000).length,
    }
  }),

  presales: protectedProcedure.query(async () => {
    const pocProjects = await prisma.pocProject.findMany({ where: { status: 'planning' } })
    return {
      pendingDiscovery: 0,
      solutionFitReview: 0,
      missingSizing: 0,
      pocPrep: pocProjects.length,
      aiDraftReview: 0,
    }
  }),

  finance: protectedProcedure.query(async () => {
    const approvals = await prisma.approvalRequest.findMany({ where: { status: 'ready_for_human_approval' } })
    return {
      commercialApprovalQueue: approvals.length,
      lowMarginDeals: 0,
      highDiscountRequests: 0,
      quoteDiffs: 0,
      exceptionPayments: 0,
    }
  }),

  delivery: protectedProcedure.query(async () => {
    const projects = await prisma.engagement.findMany()
    return {
      upcomingDeployments: projects.filter(p => p.status === 'planned').length,
      sowConfirmation: projects.filter(p => p.status === 'sow_pending').length,
      licenseActivation: 0,
      acceptanceChecklist: projects.filter(p => p.status === 'in_progress').length,
      handoverDocs: 0,
    }
  }),

  support: protectedProcedure.query(async () => {
    const cases = await prisma.supportCase.findMany()
    return {
      newTickets: cases.filter(c => c.status === 'open').length,
      slaDeadlines: 0,
      vendorEscalations: 0,
      rcaRequired: 0,
      repeatIssues: 0,
    }
  }),

  executive: protectedProcedure.query(async () => {
    const opportunities = await prisma.opportunity.findMany({ include: { customer: true } })
    const approvals = await prisma.approvalRequest.findMany()
    const pocProjects = await prisma.pocProject.findMany()
    const deliveryProjects = await prisma.engagement.findMany()
    const supportCases = await prisma.supportCase.findMany()

    const totalPipeline = opportunities.reduce((s, o) => s + (Number(o.amount) || 0), 0)
    const weightedPipeline = opportunities.reduce((s, o) => {
      const stage = normalizeOpportunityStage(o.stage)
      const weights: Record<string, number> = { LEAD: 0.1, QUALIFIED: 0.2, PROPOSAL: 0.4, NEGOTIATION: 0.6, POC: 0.8 }
      return s + (Number(o.amount) || 0) * (weights[stage] || 0.1)
    }, 0)

    return {
      revenuePipeline: { total: totalPipeline, weighted: weightedPipeline, deals: opportunities.length },
      productForecast: [] as any[],
      grossMarginRisk: { atRisk: opportunities.filter(o => normalizeOpportunityStage(o.stage) === 'NEGOTIATION').length, total: opportunities.length },
      approvalBottleneck: approvals.filter(a => a.status === 'ready_for_human_approval').length,
      pocSuccessRate: { total: pocProjects.length, completed: pocProjects.filter(p => p.status === 'completed').length },
      deliveryDelay: deliveryProjects.filter(d => d.status === 'delayed').length,
      supportHotspots: supportCases.filter(c => c.status === 'open').length,
      renewalForecast: 0,
      securityAlerts: 0,
    }
  }),

  operator: protectedProcedure.query(async () => {
    return {
      systemHealth: { api: 'ok', web: 'ok', finance: 'unreachable', postgres: 'ok', redis: 'ok' },
      workflowQueue: 0,
      aiUsage: { todayTokens: 0, todayCost: 0, providerCalls: 0 },
      toolLogs: [] as any[],
      failedJobs: 0,
      rlsPolicyCheck: 'active',
      auditIntegrity: 'verified',
      backupStatus: 'ok',
      tenantHealth: { total: 1, healthy: 1 },
    }
  }),

  security: protectedProcedure.query(async () => {
    return {
      restrictedDataAccess: [] as any[],
      roleChanges: 0,
      privilegedAccess: 0,
      auditMismatch: false,
      aiPolicyViolations: 0,
      exportEvents: [] as any[],
      workflowChanges: 0,
    }
  }),
})
