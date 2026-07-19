import type {
  AIWorkflowGenerator,
  ApprovalManager,
  BreakGlassPolicy,
  ExecutionLogger,
  McpStdioClient,
  OperationOrchestrator,
  ReportGenerator,
  ToolRegistry,
  VendorComparator,
  Workflow,
  WorkflowExecutor,
} from '@sangfor/workflow-engine';
import type { AuthContext } from '../../../packages/shared/src/mutation-policy.js';

export type JsonRpcRequest = {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: unknown;
};

export type ToolHandler = (
  args: Readonly<Record<string, unknown>>,
  authContext: AuthContext,
) => unknown | Promise<unknown>;

export type ToolDefinition = {
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly handler: ToolHandler;
};

export type WorkflowToolContext = {
  readonly rootPath: string;
  readonly allowedFileDirs: readonly string[];
  readonly validateFilePath: (filePath: string) => string;
  readonly toolRegistry: ToolRegistry;
  readonly executionLogger: ExecutionLogger;
  readonly approvalManager: ApprovalManager;
  readonly workflowExecutor: WorkflowExecutor;
  readonly breakGlassPolicy: BreakGlassPolicy;
  readonly operationOrchestrator: OperationOrchestrator;
  readonly aiWorkflowGenerator: AIWorkflowGenerator;
  readonly vendorComparator: VendorComparator;
  readonly reportGenerator: ReportGenerator;
  readonly vendorDatabase: {
    readonly categories: readonly {
      readonly id: string;
      readonly name: string;
      readonly vendors: readonly unknown[];
      readonly marketSize?: string;
      readonly growthRate?: string;
    }[];
  };
  readonly runtime: {
    mcpClient: McpStdioClient;
    ready: boolean;
  };
  readonly workflows: Map<string, Workflow>;
  readonly operationPlans: Map<string, Record<string, unknown>>;
  readonly operationApprovals: Map<string, Record<string, unknown>>;
  readonly operationExecutions: Map<string, Record<string, unknown>>;
  readonly operationSnapshots: Map<string, Record<string, unknown>>;
};
