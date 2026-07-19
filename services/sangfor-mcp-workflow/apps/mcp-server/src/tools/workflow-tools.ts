import { normalizeProduct, type ProductCode } from '@sangfor/workflow-shared';
import type { ToolDefinition, WorkflowToolContext } from '../tool-types.js';

function requiredString(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${key} is required`);
  }
  return value;
}

function optionalString(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArray(args: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function productArray(args: Readonly<Record<string, unknown>>, key: string): ProductCode[] {
  return stringArray(args, key).map(normalizeProduct);
}

export function createWorkflowTools(
  context: WorkflowToolContext,
): Readonly<Record<string, ToolDefinition>> {
  return {
    generate_smart_workflow: {
      description: 'Generate a draft workflow from customer requirements.',
      inputSchema: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          excelFilePath: { type: 'string' },
          requirements: { type: 'array', items: { type: 'string' } },
          environment: { type: 'string' },
          products: { type: 'array', items: { type: 'string' } },
        },
        required: ['customerName'],
      },
      handler: async (args) => {
        const environmentValue = optionalString(args, 'environment');
        const environment = environmentValue === 'lab'
          || environmentValue === 'poc'
          || environmentValue === 'production'
          ? environmentValue
          : 'customer';
        const profile = await context.aiWorkflowGenerator.analyzeInput({
          customerName: requiredString(args, 'customerName'),
          excelFilePath: optionalString(args, 'excelFilePath') ?? '',
          requirements: stringArray(args, 'requirements'),
          environment,
          products: productArray(args, 'products'),
        });
        const workflow = await context.aiWorkflowGenerator.generateWorkflow(profile);
        context.workflows.set(workflow.id, workflow);
        context.approvalManager.requestApproval(workflow);
        return {
          workflowId: workflow.id,
          name: workflow.name,
          steps: workflow.steps.map((step) => ({
            name: step.name,
            toolName: step.toolName,
            dependsOn: step.dependsOn,
            optional: step.optional,
          })),
          reasoning: workflow.reasoning,
          estimatedDuration: workflow.estimatedDuration,
          status: workflow.status,
          mcpConnected: context.runtime.ready,
        };
      },
    },
    approve_workflow: {
      description: 'Approve a draft workflow with the authenticated operator identity.',
      inputSchema: {
        type: 'object',
        properties: { workflowId: { type: 'string' }, approvedBy: { type: 'string' } },
        required: ['workflowId'],
      },
      handler: (args, authContext) => {
        const workflowId = requiredString(args, 'workflowId');
        const workflow = context.workflows.get(workflowId);
        if (!workflow) throw new TypeError(`Workflow not found: ${workflowId}`);
        context.approvalManager.approve(workflowId, authContext);
        return {
          workflowId,
          status: workflow.status,
          approvedBy: authContext.principalId,
        };
      },
    },
    reject_workflow: {
      description: 'Reject a draft workflow with the authenticated operator identity.',
      inputSchema: {
        type: 'object',
        properties: { workflowId: { type: 'string' }, reason: { type: 'string' } },
        required: ['workflowId', 'reason'],
      },
      handler: (args, authContext) => {
        const workflowId = requiredString(args, 'workflowId');
        const reason = requiredString(args, 'reason');
        context.approvalManager.reject(workflowId, reason, authContext);
        return { workflowId, status: 'rejected', reason };
      },
    },
    execute_workflow: {
      description: 'Execute an approved workflow when containment permits execution.',
      inputSchema: {
        type: 'object',
        properties: { workflowId: { type: 'string' } },
        required: ['workflowId'],
      },
      handler: async (args) => {
        const workflowId = requiredString(args, 'workflowId');
        const workflow = context.workflows.get(workflowId);
        if (!workflow) throw new TypeError(`Workflow not found: ${workflowId}`);
        return context.workflowExecutor.executeWorkflow(workflow);
      },
    },
    get_workflow_status: {
      description: 'Read the current workflow status.',
      inputSchema: {
        type: 'object',
        properties: { workflowId: { type: 'string' } },
        required: ['workflowId'],
      },
      handler: (args) => {
        const workflowId = requiredString(args, 'workflowId');
        const workflow = context.workflows.get(workflowId);
        if (!workflow) throw new TypeError(`Workflow not found: ${workflowId}`);
        return {
          id: workflow.id,
          name: workflow.name,
          status: workflow.status,
          steps: workflow.steps.map((step) => ({
            name: step.name,
            status: step.status,
            error: step.error,
          })),
          mcpConnected: context.runtime.ready,
        };
      },
    },
    list_workflows: {
      description: 'List current in-memory workflows.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Array.from(context.workflows.values()).map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        status: workflow.status,
        stepsCount: workflow.steps.length,
      })),
    },
    get_execution_logs: {
      description: 'Read workflow execution logs.',
      inputSchema: {
        type: 'object',
        properties: { workflowId: { type: 'string' } },
        required: ['workflowId'],
      },
      handler: (args) => context.executionLogger.getLogs(requiredString(args, 'workflowId')),
    },
  } satisfies Record<string, ToolDefinition>;
}
