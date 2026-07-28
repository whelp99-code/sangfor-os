/** U028 compatibility executor: mutations are canonical-root-only. */
import type { Workflow, WorkflowExecutionResult } from './types.js';
import { denyWorkflowMutation } from '../../shared/src/mutation-policy.js';

export class WorkflowExecutor {
  constructor(_toolRegistry: unknown, _executionLogger: unknown, _errorHandler: unknown) {}
  setApprovalManager(_approvalManager: unknown): void {}
  setBreakGlassPolicy(_policy: unknown): void {}
  async executeWorkflow(workflow: Workflow): Promise<WorkflowExecutionResult> {
    void workflow;
    denyWorkflowMutation('workflow_execution');
    throw new Error('authority_moved: execute via the canonical workflow root');
  }
  pauseWorkflow(workflow: Workflow): void { void workflow; denyWorkflowMutation('workflow_pause'); }
  resumeWorkflow(workflow: Workflow): void { void workflow; denyWorkflowMutation('workflow_resume'); }
  cancelWorkflow(workflow: Workflow): void { void workflow; denyWorkflowMutation('workflow_cancel'); }
}
