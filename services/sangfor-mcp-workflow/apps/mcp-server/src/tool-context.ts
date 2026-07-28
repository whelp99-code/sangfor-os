import { readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIWorkflowGenerator,
  ApprovalManager,
  BreakGlassPolicy,
  createDomainSeparatedEngineerMcpClient,
  ErrorHandler,
  ExecutionLogger,
  OperationOrchestrator,
  ReportGenerator,
  ToolRegistry,
  VendorComparator,
  WorkflowExecutor,
  type McpStdioClient,
  type McpSpawnOptions,
} from '@sangfor/workflow-engine';
import type { WorkflowEnvironment } from '../../../packages/shared/src/mutation-policy.js';
import type { WorkflowToolContext } from './tool-types.js';

type WorkflowToolContextOptions = Readonly<{
  environment?: WorkflowEnvironment;
  createMcpClient?: (
    serverPath: string,
    spawnOptions: McpSpawnOptions,
  ) => McpStdioClient;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseVendorDatabase(value: unknown): WorkflowToolContext['vendorDatabase'] {
  if (!isRecord(value) || !Array.isArray(value.categories)) {
    throw new TypeError('Invalid vendor database');
  }
  const categories = value.categories.map((category) => {
    if (!isRecord(category) || typeof category.id !== 'string' || typeof category.name !== 'string') {
      throw new TypeError('Invalid vendor category');
    }
    return {
      id: category.id,
      name: category.name,
      vendors: Array.isArray(category.vendors) ? category.vendors : [],
      marketSize: typeof category.marketSize === 'string' ? category.marketSize : undefined,
      growthRate: typeof category.growthRate === 'string' ? category.growthRate : undefined,
    };
  });
  return { categories };
}

function createPathValidator(allowedFileDirs: readonly string[]) {
  return (filePath: string): string => {
    if (!filePath || filePath.includes('\0') || filePath.split(/[\\/]/).includes('..')) {
      throw new TypeError('Invalid file path');
    }
    const resolvedPath = isAbsolute(filePath) ? resolve(filePath) : resolve(process.cwd(), filePath);
    const allowed = allowedFileDirs.some((directory) => {
      const pathFromDirectory = relative(resolve(directory), resolvedPath);
      return pathFromDirectory === ''
        || (!pathFromDirectory.startsWith('..') && !isAbsolute(pathFromDirectory));
    });
    if (!allowed) throw new TypeError('File path is outside allowed directories');
    if (!['.xlsx', '.xls', '.csv'].includes(extname(resolvedPath).toLowerCase())) {
      throw new TypeError('Unsupported spreadsheet file type');
    }
    return resolvedPath;
  };
}

export function createWorkflowToolContext(
  options: WorkflowToolContextOptions = {},
): WorkflowToolContext {
  const rootPath = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  const environment = options.environment ?? process.env;
  const configuredDirectories = environment.ALLOWED_FILE_DIRS
    ?.split(',')
    .map((directory) => directory.trim())
    .filter(Boolean);
  const allowedFileDirs = configuredDirectories && configuredDirectories.length > 0
    ? configuredDirectories
    : [rootPath, join(environment.HOME ?? rootPath, 'Documents')];
  const toolRegistry = new ToolRegistry();
  const executionLogger = new ExecutionLogger();
  const approvalManager = new ApprovalManager();
  const breakGlassPolicy = new BreakGlassPolicy();
  const workflowExecutor = new WorkflowExecutor(toolRegistry, executionLogger, new ErrorHandler());
  workflowExecutor.setApprovalManager(approvalManager);
  workflowExecutor.setBreakGlassPolicy(breakGlassPolicy);
  const engineerRoot = environment.SANGFOR_MCP_CWD ?? join(rootPath, '../sangfor-engineer-mcp');
  const mcpClient = createDomainSeparatedEngineerMcpClient({
    workflowRoot: rootPath,
    engineerRoot,
    environment,
  }, options.createMcpClient);
  const runtime = { mcpClient, ready: false };
  mcpClient.setDisconnectHandler(() => {
    runtime.ready = false;
  });
  const parsedVendorDatabase: unknown = JSON.parse(
    readFileSync(join(rootPath, 'data/vendors/vendor-database.json'), 'utf8'),
  );
  const vendorDatabase = parseVendorDatabase(parsedVendorDatabase);

  return {
    rootPath,
    allowedFileDirs,
    validateFilePath: createPathValidator(allowedFileDirs),
    toolRegistry,
    executionLogger,
    approvalManager,
    workflowExecutor,
    breakGlassPolicy,
    operationOrchestrator: new OperationOrchestrator(),
    aiWorkflowGenerator: new AIWorkflowGenerator(toolRegistry, { baseUrl: 'http://localhost:1234/v1' }),
    vendorComparator: new VendorComparator(vendorDatabase),
    reportGenerator: new ReportGenerator(),
    vendorDatabase,
    runtime,
    workflows: new Map(),
    operationPlans: new Map(),
    operationApprovals: new Map(),
    operationExecutions: new Map(),
    operationSnapshots: new Map(),
  };
}

export async function initializeWorkflowToolContext(context: WorkflowToolContext): Promise<void> {
  try {
    await context.runtime.mcpClient.start();
    context.toolRegistry.setMcpClient(context.runtime.mcpClient);
    await context.toolRegistry.registerFromMcpServer();
    if (!context.runtime.mcpClient.isConnected() || context.toolRegistry.listTools().length === 0) {
      throw new Error('Engineer MCP initialization incomplete');
    }
    context.runtime.ready = true;
  } catch (error) {
    await context.runtime.mcpClient.stop();
    context.runtime.ready = false;
    throw error;
  }
}
