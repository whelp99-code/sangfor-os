import type { Express, Response } from 'express';
import { buildComplianceAnalysis, buildComplianceRecord } from '../services/compliance-helpers.js';
import healthRoutes from './health.routes.js';
import { getOperatorContext, apiKeyAuth, identityConflictGuard, requireOperatorContext } from '../middleware/auth.js';
import { toDeviceProduct, toGuideProduct } from '../bootstrap/mcp-bootstrap.js';
import { parseExcelFile, type WorkflowTemplate } from '@sangfor/workflow-engine';
import {
  MutationDeniedError,
  denyWorkflowMutation,
} from '../../../../packages/shared/src/mutation-policy.js';
import type { OperatorConsoleContext } from '../server-context.js';

const WORKFLOW_PREFIXES = [
  '/api/workflows',
  '/api/templates',
  '/api/compliance',
  '/api/manual',
  '/api/device',
  '/api/guide',
  '/api/vendors',
  '/api/learning',
  '/api/access',
] as const;

function denyMutation(response: Response, action: string): void {
  try {
    denyWorkflowMutation(action);
  } catch (error) {
    if (error instanceof MutationDeniedError) {
      response.status(403).json({ error: 'FORBIDDEN' });
      return;
    }
    throw error;
  }
}

function toTemplateApiResponse(template: WorkflowTemplate) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    tags: template.tags,
  };
}

export function registerWorkflowRoutes(app: Express, context: OperatorConsoleContext): void {
  app.use('/api/devices/health', apiKeyAuth, requireOperatorContext, identityConflictGuard, healthRoutes);
  for (const prefix of WORKFLOW_PREFIXES) {
    app.use(prefix, apiKeyAuth, requireOperatorContext, identityConflictGuard);
  }

  app.get('/api/workflows', (_request, response) => {
    response.json(context.monitoringDashboard.getWorkflowSummaries());
  });
  app.get('/api/workflows/:id', (request, response) => {
    const detail = context.monitoringDashboard.getWorkflowDetail(request.params.id);
    if (!detail) {
      response.status(404).json({ error: 'Workflow not found' });
      return;
    }
    response.json(detail);
  });
  app.post('/api/workflows/generate', async (request, response) => {
    try {
      const { customerName, excelFilePath, requirements, environment, products } = request.body;
      const profile = await context.aiWorkflowGenerator.analyzeInput({
        customerName,
        excelFilePath,
        requirements,
        environment,
        products,
      });
      const workflow = await context.aiWorkflowGenerator.generateWorkflow(profile);
      context.workflows.set(workflow.id, workflow);
      context.monitoringDashboard.registerWorkflow(workflow);
      context.approvalManager.requestApproval(workflow);
      response.json({
        workflowId: workflow.id,
        name: workflow.name,
        steps: workflow.steps.length,
        status: workflow.status,
      });
    } catch (error) {
      response.status(500).json({ error: String(error) });
    }
  });
  app.post('/api/workflows/from-template', (request, response) => {
    const { templateId, customerName, products, excelFilePath } = request.body;
    const workflow = context.templateManager.createWorkflowFromTemplate(templateId, {
      customerName,
      products,
      requirements: [],
      environment: 'customer',
      riskLevel: 'medium',
      similarCases: [],
      metadata: { excelFilePath: excelFilePath ?? './test-data/checklist.xlsx' },
    });
    if (!workflow) {
      response.status(400).json({ error: 'Failed to create workflow from template' });
      return;
    }
    context.workflows.set(workflow.id, workflow);
    context.monitoringDashboard.registerWorkflow(workflow);
    context.approvalManager.requestApproval(workflow);
    response.json({
      workflowId: workflow.id,
      name: workflow.name,
      steps: workflow.steps.length,
      status: workflow.status,
    });
  });
  app.post('/api/workflows/:id/approve', (request, response) => {
    const workflow = context.workflows.get(request.params.id);
    if (!workflow) {
      response.status(404).json({ error: 'Not found' });
      return;
    }
    try {
      if (!context.approvalManager.isPending(workflow.id)) {
        context.approvalManager.requestApproval(workflow);
      }
      const approved = context.approvalManager.approve(
        workflow.id,
        getOperatorContext(response),
      );
      response.json({ ok: true, workflow: approved });
    } catch (error) {
      response.status(400).json({ error: String(error) });
    }
  });
  app.post('/api/workflows/:id/reject', (request, response) => {
    const workflow = context.workflows.get(request.params.id);
    if (!workflow) {
      response.status(404).json({ error: 'Not found' });
      return;
    }
    try {
      if (!context.approvalManager.isPending(workflow.id)) {
        context.approvalManager.requestApproval(workflow);
      }
      const rejected = context.approvalManager.reject(
        workflow.id,
        request.body?.reason ?? 'rejected by operator',
        getOperatorContext(response),
      );
      response.json({ ok: true, workflow: rejected });
    } catch (error) {
      response.status(400).json({ error: String(error) });
    }
  });
  app.post('/api/workflows/:id/execute', (_request, response) => {
    denyMutation(response, 'workflow_execution');
  });
  app.get('/api/workflows/:id/logs', (request, response) => {
    response.json(context.executionLogger.getLogs(request.params.id));
  });
  app.post('/api/workflows/upload-excel', context.upload.single('excel'), (request, response) => {
    if (!request.file) {
      response.status(400).json({ error: 'Excel file required' });
      return;
    }
    response.json({ filePath: request.file.path, originalName: request.file.originalname });
  });
  app.get('/api/templates', (_request, response) => {
    response.json(context.templateManager.list().map(toTemplateApiResponse));
  });
  app.get('/api/templates/search', (request, response) => {
    const query = String(request.query.q ?? '').toLowerCase();
    const items = context.templateManager.list().filter((template) =>
      !query
      || template.name.toLowerCase().includes(query)
      || template.description.toLowerCase().includes(query)
      || template.tags.some((tag) => tag.toLowerCase().includes(query)),
    );
    response.json(items.map(toTemplateApiResponse));
  });

  app.post('/api/compliance/track', context.upload.single('excel'), async (request, response) => {
    try {
      const customer = request.body.customer || 'Unknown';
      const excelPath = request.file?.path;
      if (!excelPath) {
        response.status(400).json({ error: 'Excel file required' });
        return;
      }
      const parseResult = await parseExcelFile(excelPath);
      const analysis = buildComplianceAnalysis(customer, parseResult);
      context.latestComplianceByCustomer.set(customer, analysis);
      context.complianceTracker.saveRecord(buildComplianceRecord(customer, analysis, excelPath));
      response.json({
        complianceRate: analysis.currentCompliance,
        totalItems: analysis.totalItems,
        passedItems: analysis.passedItems,
        missingItems: analysis.items.filter((item) => item.result < 1).map((item) => item.item),
        customer,
        products: parseResult.products,
        trackedAt: analysis.date,
      });
    } catch (error) {
      response.status(500).json({ error: String(error) });
    }
  });
  app.get('/api/compliance/trend', (request, response) => {
    const customer = String(request.query.customer ?? '');
    if (!customer) {
      response.status(400).json({ error: 'customer query parameter required' });
      return;
    }
    const trend = context.complianceTracker.getTrend(customer, 'ALL');
    response.json({
      customer: trend.customer,
      trend: trend.trend === 'improving'
        ? 'increasing'
        : trend.trend === 'declining' ? 'decreasing' : 'stable',
      records: trend.records.map((record) => ({
        date: record.date.slice(0, 7),
        rate: record.compliance,
      })),
      summary: trend.summary,
    });
  });
  app.post('/api/compliance/roadmap', (request, response) => {
    const { customerName, currentCompliance, targetCompliance } = request.body;
    const customer = customerName ?? 'Customer';
    const current = Number(currentCompliance) || 26;
    const analysis = context.latestComplianceByCustomer.get(customer) ?? {
      customer,
      product: 'ALL',
      date: new Date().toISOString(),
      totalItems: 100,
      passedItems: current,
      partiallyPassed: 0,
      failedItems: 100 - current,
      currentCompliance: current,
      potentialCompliance: 100,
      improvementOpportunity: 100 - current,
      items: [],
    };
    const roadmap = context.roadmapGenerator.generateRoadmap(customer, analysis, targetCompliance ?? 87);
    response.json({
      currentCompliance: roadmap.currentCompliance,
      targetCompliance: roadmap.targetCompliance,
      phases: roadmap.phases.map((phase) => ({
        name: `Phase ${phase.phase}: ${phase.title}`,
        duration: phase.timeline,
        items: phase.items,
        estimatedCompliance: phase.expectedCompliance,
      })),
      estimatedCompliance: roadmap.targetCompliance,
      estimatedDuration: roadmap.estimatedDuration,
      estimatedCost: roadmap.estimatedCost,
      summary: roadmap.summary,
    });
  });
  app.post('/api/compliance/proposal', (request, response) => {
    const { customerName, targetCompliance } = request.body;
    if (!customerName) {
      response.status(400).json({ error: 'customerName required' });
      return;
    }
    const analysis = context.latestComplianceByCustomer.get(customerName) ?? {
      customer: customerName,
      product: 'ALL',
      date: new Date().toISOString(),
      totalItems: 31,
      passedItems: 8,
      partiallyPassed: 0,
      failedItems: 23,
      currentCompliance: 26,
      potentialCompliance: 100,
      improvementOpportunity: 74,
      items: [],
    };
    const roadmap = context.roadmapGenerator.generateRoadmap(customerName, analysis, targetCompliance ?? 87);
    const proposal = context.proposalGenerator.generate(customerName, analysis, roadmap);
    response.json({
      title: proposal.title,
      customerName: proposal.customer,
      targetCompliance: roadmap.targetCompliance,
      totalCost: proposal.totalCost,
      timeline: proposal.timeline,
      sections: [
        { title: '현황 분석', content: `현재 Compliance ${proposal.currentStatus.currentCompliance}%` },
        { title: '목표', content: `Compliance ${roadmap.targetCompliance}% 달성` },
        { title: '솔루션', content: proposal.sangforProducts.map((product) => product.product).join(', ') },
        { title: '비용', content: proposal.totalCost },
      ],
      markdown: context.proposalGenerator.generateMarkdown(proposal),
    });
  });

  app.post('/api/manual/ask', async (request, response) => {
    try {
      const { question, product } = request.body;
      const answer = await context.manualQA.askQuestion({ question, product });
      response.json({
        question: answer.question,
        answer: answer.answer,
        source: answer.sources[0]?.document ?? 'Knowledge Base',
        confidence: answer.confidence,
        sources: answer.sources,
      });
    } catch (error) {
      response.status(500).json({ error: String(error) });
    }
  });
  app.post('/api/manual/menu-path', async (request, response) => {
    try {
      const { product, feature } = request.body;
      const deviceProduct = toDeviceProduct(product);
      let segments = await context.manualQA.findMenuPath(product, feature);
      if (segments.length === 0) {
        const reference = context.deviceMenuCapture.getReferenceManualMenus(deviceProduct);
        const match = reference.find((menu) =>
          menu.name.toLowerCase().includes(String(feature).toLowerCase())
          || menu.features?.some((item) => String(feature).toLowerCase().includes(item.toLowerCase())),
        );
        segments = match?.path ?? ['Settings', 'Security', feature];
      }
      response.json({
        product,
        feature,
        path: segments.join(' > '),
        segments,
        version: 'latest',
      });
    } catch (error) {
      response.status(500).json({ error: String(error) });
    }
  });
  app.post('/api/device/capture-menu', (_request, response) => {
    denyMutation(response, 'live_device_capture');
  });
  app.post('/api/device/compare', (_request, response) => {
    denyMutation(response, 'live_device_compare');
  });
  app.post('/api/guide/generate', async (request, response) => {
    try {
      const { customerName, product, requirements } = request.body;
      const guide = await context.settingGuideGenerator.generateGuide({
        customer: customerName,
        product: toGuideProduct(product),
        requirements,
      });
      response.json({
        title: guide.title,
        customerName: guide.customer,
        product: guide.product,
        requirements,
        sections: guide.sections.map((section) => ({
          title: section.title,
          path: section.menuPath.join(' > '),
          steps: section.steps.map((step) => step.description),
        })),
        guide: context.settingGuideGenerator.generateMarkdown(guide),
        estimatedTime: guide.estimatedTime,
      });
    } catch (error) {
      response.status(500).json({ error: String(error) });
    }
  });
  app.post('/api/vendors/compare', (request, response) => {
    try {
      const { category, includeSangfor, requirement } = request.body;
      const comparison = context.vendorComparator.compareByCategory(
        category,
        requirement ?? `${category} security requirements`,
      );
      const allVendors = comparison.recommendations.map((recommendation) => ({
        name: recommendation.vendor,
        product: recommendation.product,
        score: recommendation.fitScore,
        features: recommendation.pros,
        pricing: recommendation.pricing,
        reasons: recommendation.reasons,
      }));
      const vendors = includeSangfor === false
        ? allVendors.filter((vendor) => vendor.name !== 'Sangfor')
        : allVendors;
      response.json({
        category: comparison.category,
        includeSangfor,
        vendors,
        topVendor: vendors[0]?.name ?? null,
        summary: comparison.summary,
      });
    } catch (error) {
      response.status(500).json({ error: String(error) });
    }
  });
  app.post('/api/vendors/report', (request, response) => {
    try {
      const { customerName, category } = request.body;
      if (!customerName || !category) {
        response.status(400).json({ error: 'customerName and category required' });
        return;
      }
      const comparison = context.vendorComparator.compareByCategory(category, `${category} requirements`);
      const input = {
        customerName,
        products: comparison.recommendations.map((recommendation) => recommendation.product),
        requirements: [category],
        comparisonResults: [comparison],
        recommendations: comparison.recommendations,
      };
      const report = context.reportGenerator.generateComparisonReport(input);
      response.json({
        title: report.title,
        customerName: report.customer,
        category,
        generatedAt: report.date,
        report: context.reportGenerator.generateCustomGuide(input),
        executiveSummary: report.executiveSummary,
      });
    } catch (error) {
      response.status(500).json({ error: String(error) });
    }
  });
  app.post('/api/learning/run', (_request, response) => {
    denyMutation(response, 'external_learning_sync');
  });
  app.get('/api/learning/schedules', (_request, response) => {
    response.json(context.learningScheduler.getSchedules());
  });
  app.post('/api/learning/schedules', (request, response) => {
    response.json(context.learningScheduler.registerSchedule(request.body));
  });
  app.post('/api/learning/schedules/:id/run', (_request, response) => {
    denyMutation(response, 'external_learning_schedule');
  });

  app.post('/api/access/request', (request, response) => {
    try {
      const { customerName, projectName, products } = request.body;
      const requestedBy = getOperatorContext(response).principalId;
      const productList = (products ?? []).map((product: string) => String(product).trim()).filter(Boolean);
      const template = {
        customer: customerName,
        projectId: projectName,
        projectName,
        devices: productList.map((product: string) => ({
          product: toDeviceProduct(product),
          purpose: `${projectName} 프로젝트`,
        })),
        requestedBy,
        requestReason: `${projectName} 장비 접근`,
        estimatedDuration: '2 weeks',
      };
      const accessRequest = context.deviceAccessManager.createRequest(
        template,
        getOperatorContext(response),
      );
      response.json({
        requestId: accessRequest.id,
        customerName: accessRequest.customer,
        projectName,
        products: productList,
        status: accessRequest.status,
        createdAt: accessRequest.requestedAt,
        message: context.deviceAccessManager.generateRequestMessage(template),
      });
    } catch (error) {
      response.status(400).json({ error: String(error) });
    }
  });
  app.post('/api/access/submit', (request, response) => {
    try {
      const { requestId, product, ip, port, username, password } = request.body;
      const deviceProduct = toDeviceProduct(product);
      const devices = [{
        product: deviceProduct,
        ip,
        port: Number(port) || 443,
        username,
        password,
        protocol: 'https' as const,
      }];
      const validation = context.deviceAccessManager.validateAccessInfo(devices);
      if (!validation.valid) {
        response.status(400).json({ error: validation.errors.join(', ') });
        return;
      }
      const updated = context.deviceAccessManager.submitAccessInfo(
        requestId,
        devices,
        getOperatorContext(response),
      );
      response.json({ ok: true, requestId: updated.id, product: deviceProduct, status: updated.status });
    } catch (error) {
      response.status(400).json({ error: String(error) });
    }
  });
  app.get('/api/access/requests', (_request, response) => {
    response.json(context.deviceAccessManager.getAllRequests().map((accessRequest) => ({
      requestId: accessRequest.id,
      customerName: accessRequest.customer,
      projectName: accessRequest.projectId,
      products: accessRequest.devices.map((device) => device.product),
      status: accessRequest.status,
      createdAt: accessRequest.requestedAt,
    })));
  });
}
