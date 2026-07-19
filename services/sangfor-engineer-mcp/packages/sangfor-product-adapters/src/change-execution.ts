import { requiresApprovalForText } from '@sangfor/approval';
import { executeLiveConsoleAction, readLiveConsoleState } from '@sangfor/operator';
import { nowId } from '@sangfor/shared';
import { denyContainedMutation } from '../../shared/src/mutation-policy.js';
import type {
  ApprovalPayload,
  ExcelBasedChangePlan,
  MappedRequirement,
  ProductChangePlan,
  RequirementTask,
} from './adapter-types.js';

export async function dryRunProductChange(input: {
  plan: ProductChangePlan | ExcelBasedChangePlan;
  targetUrl?: string;
  sessionId?: string;
}) {
  const excelPlan = isExcelBasedChangePlan(input.plan) ? input.plan : undefined;
  const operatorState = input.sessionId ? await readLiveConsoleState({ sessionId: input.sessionId }) : undefined;
  return {
    id: nowId('dryrun'),
    product: input.plan.product,
    ok: true,
    mutationPerformed: false,
    stoppedBefore: excelPlan ? excelPlan.stoppedBefore : ['Save', 'Apply', 'Delete', 'Commit', 'Response Action'],
    webuiRoutePreview: input.plan.tasks
      .filter(task => !('mappedProduct' in task) || task.mappedProduct !== 'external_or_manual')
      .map(task => ({
        taskId: 'id' in task ? task.id : task.rowId,
        excelRowId: 'rowId' in task ? task.rowId : task.excelRowId,
        menuPath: task.menuPath,
        checks: excelPlan
          ? ['Navigate to mapped product menu', 'Confirm current configuration or evidence gap', 'Capture screenshot evidence', 'Stop before mutation button']
          : ['Navigate to menu', 'Confirm current values', 'Populate draft values if safe', 'Stop before mutation button'],
      })),
    apiRequestPreview: input.plan.tasks.flatMap(task => task.apiEndpointCandidates.map(endpoint => ({
      taskId: 'id' in task ? task.id : task.rowId,
      endpoint,
      method: endpoint.split(' ')[0] ?? 'UNKNOWN',
      execute: false,
    }))),
    approvalRequiredTasks: input.plan.tasks.filter(task => task.approvalRequired).map(taskIdentifier),
    manualReviewRows: excelPlan ? excelPlan.manualReviewRows : [],
    sessionRequired: Boolean(excelPlan),
    sessionAttached: Boolean(input.sessionId),
    dryRunFailures: excelPlan && !input.sessionId ? ['sessionId is required to execute Excel-based Playwright dry-run.'] : [],
    operatorState,
  };
}

export async function applyApprovedProductChange(input: {
  plan: ProductChangePlan;
  approval?: ApprovalPayload;
  environment?: 'lab' | 'poc' | 'customer' | 'production';
  sessionId?: string;
}) {
  const containment = denyContainedMutation('product_change');
  if (!containment.allowed) {
    return {
      id: nowId('apply'),
      ok: false,
      approvalRequired: true,
      mutationPerformed: false,
      reason: containment.code,
    };
  }

  const highRiskTasks = input.plan.tasks.filter(task => task.approvalRequired || requiresApprovalForText(`${task.requirement} ${task.capabilityId}`).required);
  if (highRiskTasks.length > 0 && !hasCompleteApproval(input.approval)) {
    return {
      id: nowId('apply'),
      ok: false,
      approvalRequired: true,
      mutationPerformed: false,
      reason: `Missing approval payload fields: ${missingApprovalFields(input.approval).join(', ')}`,
    };
  }
  if (process.env.SANGFOR_ALLOW_REAL_EXECUTION !== 'true') {
    return { id: nowId('apply'), ok: false, approvalRequired: highRiskTasks.length > 0, mutationPerformed: false, reason: 'SANGFOR_ALLOW_REAL_EXECUTION=true is required for real changes.' };
  }
  if (input.environment === 'production' && process.env.SANGFOR_ALLOW_PRODUCTION_EXECUTION !== 'true') {
    return { id: nowId('apply'), ok: false, approvalRequired: true, mutationPerformed: false, reason: 'SANGFOR_ALLOW_PRODUCTION_EXECUTION=true is required for production changes.' };
  }
  const operatorEvidence = input.sessionId && hasCompleteApproval(input.approval)
    ? await executeLiveConsoleAction({
      sessionId: input.sessionId,
      action: { type: 'screenshot', target: 'product-change-plan', dryRun: true },
      approval: input.approval,
    })
    : undefined;
  return {
    id: nowId('apply'), ok: true, approvalRequired: highRiskTasks.length > 0, mutationPerformed: false,
    reason: 'Execution gate passed. Real executor is not attached in this package yet; no mutation was performed.',
    approvedBy: input.approval?.approvedBy,
    changeTicketId: input.approval?.changeTicketId,
    operatorEvidence,
  };
}

export function verifyProductChange(input: { plan: ProductChangePlan; observed?: Record<string, unknown> }) {
  return {
    id: nowId('verify'),
    product: input.plan.product,
    ok: true,
    readOnly: true,
    checks: input.plan.tasks.map(task => ({
      taskId: task.id,
      requirement: task.requirement,
      menuPath: task.menuPath,
      expectedEvidence: ['post-change config snapshot', 'task/audit log', 'alert/log verification', 'before-after comparison'],
      observed: input.observed?.[task.id] ?? null,
    })),
    evidenceStatus: input.observed ? 'observed_values_attached' : 'pending_observed_values',
  };
}

function isExcelBasedChangePlan(plan: ProductChangePlan | ExcelBasedChangePlan): plan is ExcelBasedChangePlan {
  return 'source' in plan && plan.source === 'excel';
}

function taskIdentifier(task: RequirementTask | MappedRequirement): string {
  return 'id' in task ? task.id : task.rowId;
}

function hasCompleteApproval(approval: ApprovalPayload | undefined): approval is Required<ApprovalPayload> {
  return Boolean(approval?.approvedBy && approval.approvalToken && approval.changeTicketId && approval.rollbackPlanId);
}

function missingApprovalFields(approval?: ApprovalPayload): string[] {
  const fields: Array<keyof ApprovalPayload> = ['approvedBy', 'approvalToken', 'changeTicketId', 'rollbackPlanId'];
  return fields.filter(field => !approval?.[field]);
}
