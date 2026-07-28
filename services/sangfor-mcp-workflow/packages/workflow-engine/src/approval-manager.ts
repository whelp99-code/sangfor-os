/**
 * U028 compatibility shell.  Approval authority is exclusively U022/U025 root
 * state; this process must neither retain nor mutate a local approval record.
 */
import type { AuthContext } from '../../shared/src/mutation-policy.js';
import type { ApprovalRequest, ApprovalRequirement, OperationApprovalRequest, OperationPlan, OperationRisk, Workflow } from './types.js';

export class WorkflowAuthorityMovedError extends Error {
  readonly code = 'authority_moved' as const;
  constructor() { super('authority_moved: use the canonical workflow root'); this.name = 'WorkflowAuthorityMovedError'; }
}
const moved = (): never => { throw new WorkflowAuthorityMovedError(); };

export class ApprovalManager {
  requestApproval(_workflow: Workflow): ApprovalRequest { return moved(); }
  approve(_workflowId: string, _actor: AuthContext): Workflow { return moved(); }
  reject(_workflowId: string, _reason: string, _actor: AuthContext): Workflow { return moved(); }
  requestModification(_workflowId: string, _feedback: string): Workflow { return moved(); }
  listPendingApprovals(): Workflow[] { return []; }
  isPending(_workflowId: string): boolean { return false; }
  getApprovalHistory(): never[] { return []; }
  getApprovalHistoryByWorkflow(_workflowId: string): never[] { return []; }
  getStats(): { pending: number; totalApproved: number; totalRejected: number } { return { pending: 0, totalApproved: 0, totalRejected: 0 }; }
  requestOperationApproval(_plan: OperationPlan): OperationApprovalRequest { return moved(); }
  approveOperation(_operationId: string, _actor: AuthContext): void { moved(); }
  rejectOperation(_operationId: string, _reason: string, _actor: AuthContext): void { moved(); }
  getOperationApprovalQueue(): OperationPlan[] { return []; }
  riskBasedApprovalRequirement(risk: OperationRisk): ApprovalRequirement {
    return { required: true, reason: 'authority_moved: canonical root approval required', approverRole: risk.level === 'critical' ? 'security_officer' : 'admin' };
  }
  validateApprovalRequired(_plan: OperationPlan): void { moved(); }
  getOperationApprovalHistory(): never[] { return []; }
  getOperationApprovalHistoryById(_operationId: string): never[] { return []; }
  cleanupRejectedOperations(): number { return 0; }
  isOperationApproved(_operationId: string): boolean { return false; }
  assertOperationExecutionAllowed(_plan: OperationPlan): void { moved(); }
}
