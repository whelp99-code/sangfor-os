import { createIntegrationTools } from './tools/integration-tools.js';
import { createOperationTools } from './tools/operation-tools.js';
import { createWorkflowTools } from './tools/workflow-tools.js';
import type { ToolDefinition, WorkflowToolContext } from './tool-types.js';

const WORKFLOW_KEYS = [
  'generate_smart_workflow',
  'approve_workflow',
  'reject_workflow',
  'execute_workflow',
  'get_workflow_status',
  'list_workflows',
  'get_execution_logs',
] as const;

const INTEGRATION_KEYS = [
  'get_mcp_status',
  'list_mcp_tools',
  'run_health_check',
  'run_auto_wiki_pipeline',
  'search_obsidian_notes',
  'parse_excel',
  'compare_vendors',
  'compare_sangfor_vs_competitors',
  'generate_comparison_report',
  'generate_recommendation_doc',
  'generate_custom_guide',
  'list_vendor_categories',
] as const;

const OPERATION_KEYS = [
  'get_device_snapshot',
  'plan_configuration_change',
  'validate_operation_plan',
  'request_operation_approval',
  'apply_approved_operation',
  'verify_configuration',
  'generate_evidence_report',
] as const;

class ToolCatalogError extends Error {
  readonly name = 'ToolCatalogError';
}

function assertExactKeys(
  label: string,
  tools: Readonly<Record<string, ToolDefinition>>,
  expected: readonly string[],
): void {
  const actualKeys = Object.keys(tools).sort();
  const expectedKeys = [...expected].sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new ToolCatalogError(`${label} tool set mismatch`);
  }
}

export function createWorkflowToolCatalog(
  context: WorkflowToolContext,
): ReadonlyMap<string, ToolDefinition> {
  const workflowTools = createWorkflowTools(context);
  const integrationTools = createIntegrationTools(context);
  const operationTools = createOperationTools(context);
  assertExactKeys('workflow', workflowTools, WORKFLOW_KEYS);
  assertExactKeys('integration', integrationTools, INTEGRATION_KEYS);
  assertExactKeys('operation', operationTools, OPERATION_KEYS);

  const catalog = new Map<string, ToolDefinition>();
  for (const tools of [workflowTools, integrationTools, operationTools]) {
    for (const [key, definition] of Object.entries(tools)) {
      const name = `sangfor_workflow.${key}`;
      if (catalog.has(name)) throw new ToolCatalogError(`Duplicate tool: ${name}`);
      catalog.set(name, definition);
    }
  }
  if (catalog.size !== 26) throw new ToolCatalogError('Workflow catalog must contain 26 tools');
  return catalog;
}

export function listWorkflowTools(catalog: ReadonlyMap<string, ToolDefinition>) {
  return Array.from(catalog, ([name, definition]) => ({
    name,
    description: definition.description,
    inputSchema: definition.inputSchema,
  }));
}
