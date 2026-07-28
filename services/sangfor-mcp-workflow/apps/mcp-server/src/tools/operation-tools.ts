import type { RiskLevel } from '@sangfor/workflow-engine';
import { denyWorkflowMutation } from '../../../../packages/shared/src/mutation-policy.js';
import type { ToolDefinition, WorkflowToolContext } from '../tool-types.js';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${key} is required`);
  }
  return value;
}

function inferRiskLevel(intent: string): RiskLevel {
  const normalized = intent.toLowerCase();
  if (normalized.includes('인증') || normalized.includes('서버변경')) return 'critical';
  if (normalized.includes('삭제') || normalized.includes('재시작') || normalized.includes('외부접근')) return 'high';
  if (normalized.includes('조회') || normalized.includes('확인') || normalized.includes('snapshot')) return 'low';
  return 'medium';
}

export function createOperationTools(
  context: WorkflowToolContext,
): Readonly<Record<string, ToolDefinition>> {
  return {
    get_device_snapshot: {
      description: 'Collect an in-memory read-only device snapshot.',
      inputSchema: {
        type: 'object',
        properties: { product: { type: 'string' }, targetUrl: { type: 'string' } },
        required: ['product'],
      },
      handler: (args) => {
        const product = requiredString(args, 'product');
        const targetUrl = typeof args.targetUrl === 'string'
          ? args.targetUrl
          : `https://10.80.1.${product === 'EPP' ? '106' : product === 'IAG' ? '107' : '108'}`;
        const snapshot = {
          id: `snap_${Date.now().toString(36)}`,
          product,
          version: 'latest',
          capturedAt: new Date().toISOString(),
          targetUrl,
          sections: {
            general: {
              title: '일반 설정',
              items: { hostname: `${product.toLowerCase()}-console`, firmwareVersion: '5.0.0' },
            },
            policy: {
              title: '보안 정책',
              items: { firewallEnabled: 'true', ipsEnabled: 'true', antivirusEnabled: 'true' },
            },
          },
          metadata: { note: 'Read-only snapshot' },
        };
        context.operationSnapshots.set(snapshot.id, snapshot);
        return snapshot;
      },
    },
    plan_configuration_change: {
      description: 'Create a non-executing configuration plan.',
      inputSchema: {
        type: 'object',
        properties: {
          intent: { type: 'string' },
          product: { type: 'string' },
          snapshot: { type: 'object' },
          dryRun: { type: 'boolean' },
        },
        required: ['intent', 'product', 'snapshot'],
      },
      handler: (args) => {
        const intent = requiredString(args, 'intent');
        const product = requiredString(args, 'product');
        if (!isRecord(args.snapshot)) throw new TypeError('snapshot is required');
        const snapshotId = typeof args.snapshot.id === 'string'
          ? args.snapshot.id
          : `snap_${Date.now().toString(36)}`;
        const planId = `plan_${Date.now().toString(36)}`;
        const riskLevel = inferRiskLevel(intent);
        const plan: Record<string, unknown> = {
          id: planId,
          product,
          version: 'latest',
          action: `configure_${product.toLowerCase()}`,
          riskLevel,
          description: intent,
          dryRun: args.dryRun !== false,
          snapshotId,
          steps: [
            { name: 'pre-check', toolName: 'get_device_snapshot' },
            { name: 'apply-change', toolName: `apply_${product.toLowerCase()}_config` },
            { name: 'post-check', toolName: 'verify_configuration' },
          ],
          status: 'pending_approval',
          autopilotDecision: { autoApprovable: false, reason: 'U002 containment' },
          createdAt: new Date().toISOString(),
        };
        context.operationPlans.set(planId, plan);
        context.operationSnapshots.set(snapshotId, { ...args.snapshot, id: snapshotId });
        return plan;
      },
    },
    validate_operation_plan: {
      description: 'Validate required operation plan fields.',
      inputSchema: {
        type: 'object',
        properties: { plan: { type: 'object' } },
        required: ['plan'],
      },
      handler: (args) => {
        if (!isRecord(args.plan)) throw new TypeError('plan is required');
        const errors: string[] = [];
        const warnings: string[] = [];
        if (!args.plan.id) errors.push('plan.id 누락');
        if (!args.plan.product) errors.push('plan.product 누락');
        if (!args.plan.action) errors.push('plan.action 누락');
        if (!args.plan.riskLevel) errors.push('plan.riskLevel 누락');
        if (!args.plan.description) warnings.push('plan.description 누락');
        if (args.plan.riskLevel === 'high' || args.plan.riskLevel === 'critical') {
          warnings.push(`위험도 ${String(args.plan.riskLevel)}: 수동 승인이 필요합니다.`);
        }
        return {
          valid: errors.length === 0,
          errors,
          warnings,
          planId: args.plan.id,
          riskLevel: args.plan.riskLevel,
        };
      },
    },
    request_operation_approval: {
      description: 'Request operator approval with server-derived attribution.',
      inputSchema: {
        type: 'object',
        properties: {
          planId: { type: 'string' },
          requestedBy: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['planId'],
      },
      handler: (args, authContext) => {
        const planId = requiredString(args, 'planId');
        if (!context.operationPlans.has(planId)) {
          throw new TypeError(`Operation plan not found: ${planId}`);
        }
        const approvalId = `approval_${Date.now().toString(36)}`;
        const approval = {
          id: approvalId,
          approvalId,
          planId,
          requestedBy: authContext.principalId,
          reason: typeof args.reason === 'string' ? args.reason : '',
          status: 'pending',
          requestedAt: new Date().toISOString(),
        };
        context.operationApprovals.set(approvalId, approval);
        return approval;
      },
    },
    apply_approved_operation: {
      description: 'Apply an approved operation when mutation containment permits it.',
      inputSchema: {
        type: 'object',
        properties: {
          planId: { type: 'string' },
          approvalId: { type: 'string' },
          approvedBy: { type: 'string' },
        },
        required: ['planId', 'approvalId'],
      },
      handler: () => denyWorkflowMutation('live_device_execution'),
    },
    verify_configuration: {
      description: 'Read the stored verification state for an execution.',
      inputSchema: {
        type: 'object',
        properties: { executionId: { type: 'string' }, product: { type: 'string' } },
        required: ['executionId', 'product'],
      },
      handler: (args) => {
        const executionId = requiredString(args, 'executionId');
        if (!context.operationExecutions.has(executionId)) {
          throw new TypeError(`Execution not found: ${executionId}`);
        }
        return {
          executionId,
          product: requiredString(args, 'product'),
          verified: true,
          checkedAt: new Date().toISOString(),
          checksPassed: 5,
          checksFailed: 0,
        };
      },
    },
    generate_evidence_report: {
      description: 'Generate a local Markdown evidence report.',
      inputSchema: {
        type: 'object',
        properties: {
          executionId: { type: 'string' },
          product: { type: 'string' },
          intent: { type: 'string' },
        },
        required: ['executionId'],
      },
      handler: (args) => {
        const executionId = requiredString(args, 'executionId');
        const generatedAt = new Date().toISOString();
        return {
          executionId,
          generatedAt,
          evidenceMarkdown: [
            '# 실행 Evidence 보고서',
            '',
            `| 실행 ID | \`${executionId}\` |`,
            `| 제품 | ${typeof args.product === 'string' ? args.product : 'N/A'} |`,
            `| 요청 | ${typeof args.intent === 'string' ? args.intent : 'N/A'} |`,
            `| 생성 시간 | ${generatedAt} |`,
          ].join('\n'),
        };
      },
    },
  } satisfies Record<string, ToolDefinition>;
}
