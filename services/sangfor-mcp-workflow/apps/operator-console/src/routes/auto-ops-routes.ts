import type { Express, Response } from 'express';
import type { RiskLevel } from '@sangfor/workflow-engine';
import {
  MutationDeniedError,
  denyWorkflowMutation,
} from '../../../../packages/shared/src/mutation-policy.js';
import { apiKeyAuth, getOperatorContext, identityConflictGuard, requireOperatorContext } from '../middleware/auth.js';
import type { OperatorConsoleContext } from '../server-context.js';

const AUTO_OPS_PREFIXES = [
  '/api/snapshots',
  '/api/plan',
  '/api/approvals',
  '/api/execute',
  '/api/evidence',
  '/api/breakglass',
  '/api/incidents',
  '/api/remediation',
  '/api/events',
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

function inferRiskLevel(intent: string): RiskLevel {
  const normalized = intent.toLowerCase();
  if (normalized.includes('인증') || normalized.includes('서버변경')) return 'critical';
  if (normalized.includes('삭제') || normalized.includes('재시작')) return 'high';
  if (normalized.includes('조회') || normalized.includes('확인')) return 'low';
  return 'medium';
}

export function registerAutoOpsRoutes(app: Express, context: OperatorConsoleContext): void {
  for (const prefix of AUTO_OPS_PREFIXES) {
    app.use(prefix, apiKeyAuth, requireOperatorContext, identityConflictGuard);
  }

  app.get('/api/snapshots/:product', (request, response) => {
    const { product } = request.params;
    const snapshot = {
      id: `snap_${Date.now().toString(36)}`,
      product,
      version: 'latest',
      capturedAt: new Date().toISOString(),
      targetUrl: `https://10.80.1.${product === 'EPP' ? '106' : product === 'IAG' ? '107' : '108'}`,
      sections: {
        general: {
          title: '일반 설정',
          items: {
            hostname: `${product.toLowerCase()}-console`,
            firmwareVersion: '5.0.0',
            uptime: '45 days',
          },
        },
        policy: {
          title: '보안 정책',
          items: {
            firewallEnabled: 'true',
            ipsEnabled: 'true',
            antivirusEnabled: 'true',
          },
        },
      },
    };
    context.snapshots.set(snapshot.id, snapshot);
    response.json(snapshot);
  });
  app.post('/api/plan', (request, response) => {
    const { intent, product, dryRun, snapshotId, snapshot } = request.body;
    if (!intent || !product) {
      response.status(400).json({ error: 'intent와 product는 필수입니다.' });
      return;
    }
    const resolvedSnapshot = snapshot
      ?? (typeof snapshotId === 'string' ? context.snapshots.get(snapshotId) : undefined);
    if (!resolvedSnapshot || typeof resolvedSnapshot !== 'object') {
      response.status(400).json({ error: 'snapshot 또는 snapshotId가 필요합니다.' });
      return;
    }
    const planId = `plan_${Date.now().toString(36)}`;
    const approvalId = `approval_${Date.now().toString(36)}`;
    const riskLevel = inferRiskLevel(String(intent));
    const plan: Record<string, unknown> = {
      id: planId,
      product,
      version: 'latest',
      action: `configure_${String(product).toLowerCase()}`,
      riskLevel,
      description: intent,
      dryRun: dryRun ?? true,
      snapshotId,
      steps: [
        { name: 'pre-check', toolName: 'get_device_snapshot' },
        { name: 'apply-change', toolName: `apply_${String(product).toLowerCase()}_config` },
        { name: 'post-check', toolName: 'verify_configuration' },
      ],
      approvalId,
      status: 'pending_approval',
      createdAt: new Date().toISOString(),
      autopilotDecision: { autoApprovable: false, reason: 'U002 containment' },
    };
    context.operationPlans.set(planId, plan);
    context.approvals.set(approvalId, {
      id: approvalId,
      planId,
      status: 'pending',
      requestedBy: getOperatorContext(response).principalId,
      requestedAt: new Date().toISOString(),
    });
    response.json(plan);
  });
  app.get('/api/approvals', (_request, response) => {
    response.json(Array.from(context.approvals.values()).filter((approval) => approval.status === 'pending'));
  });
  app.post('/api/approvals/:id/approve', (request, response) => {
    const approval = context.approvals.get(request.params.id);
    if (!approval) {
      response.status(404).json({ error: '승인 요청을 찾을 수 없습니다.' });
      return;
    }
    approval.status = 'approved';
    approval.approvedBy = getOperatorContext(response).principalId;
    approval.approvedAt = new Date().toISOString();
    const planId = approval.planId;
    if (typeof planId === 'string') {
      const plan = context.operationPlans.get(planId);
      if (plan) {
        plan.status = 'approved';
        plan.approvalId = approval.id;
      }
    }
    response.json({ ok: true, approval });
  });
  app.post('/api/approvals/:id/reject', (request, response) => {
    const approval = context.approvals.get(request.params.id);
    if (!approval) {
      response.status(404).json({ error: '승인 요청을 찾을 수 없습니다.' });
      return;
    }
    approval.status = 'rejected';
    approval.rejectedBy = getOperatorContext(response).principalId;
    approval.rejectedAt = new Date().toISOString();
    approval.rejectionReason = request.body.reason ?? '';
    response.json({ ok: true, approval });
  });
  app.post('/api/execute/:planId', (_request, response) => {
    denyMutation(response, 'live_device_execution');
  });
  app.get('/api/evidence/:executionId', (request, response) => {
    const generatedAt = new Date().toISOString();
    response.json({
      executionId: request.params.executionId,
      generatedAt,
      evidenceMarkdown: [
        '# 실행 Evidence 보고서',
        '',
        '## 기본 정보',
        '',
        '| 항목 | 값 |',
        '|------|-----|',
        `| 실행 ID | \`${request.params.executionId}\` |`,
        `| 생성 시간 | ${generatedAt} |`,
        '',
        '---',
        `*자동 생성 (${generatedAt})*`,
      ].join('\n'),
    });
  });
  app.post('/api/breakglass/request', (_request, response) => {
    denyMutation(response, 'breakglass_request');
  });
  app.post('/api/breakglass/:id/approve', (_request, response) => {
    denyMutation(response, 'breakglass_approval');
  });
  app.get('/api/breakglass/active', (_request, response) => {
    response.json({ active: false, sessions: [] });
  });
  app.post('/api/incidents/detect', (request, response) => {
    try {
      const incidents = context.incidentDetector.detectIncidents(request.body);
      for (const incident of incidents) {
        context.detectedIncidents.set(incident.id, { ...incident });
      }
      response.json({ incidents });
    } catch (error) {
      response.status(400).json({ error: String(error) });
    }
  });
  app.post('/api/incidents/:id/remediation', (_request, response) => {
    denyMutation(response, 'remediation_planning');
  });
  app.post('/api/remediation/:id/execute', (_request, response) => {
    denyMutation(response, 'remediation_execution');
  });
  app.get('/api/events', (request, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    const interval = setInterval(() => {
      response.write(`data: ${JSON.stringify({
        type: 'heartbeat',
        timestamp: new Date().toISOString(),
      })}\n\n`);
    }, 30_000);
    request.on('close', () => clearInterval(interval));
  });
}
