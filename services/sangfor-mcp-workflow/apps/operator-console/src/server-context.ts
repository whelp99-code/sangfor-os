import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { createLogger } from '@sangfor/workflow-shared';
import {
  AIWorkflowGenerator,
  ApprovalManager,
  BreakGlassPolicy,
  ComplianceTracker,
  DeviceAccessManager,
  DeviceMenuCapture,
  ErrorHandler,
  ExecutionLogger,
  IncidentDetector,
  LearningScheduler,
  ManualQASystem,
  MonitoringDashboard,
  OperationOrchestrator,
  PlaybookRegistry,
  ProposalGenerator,
  RAGIndexer,
  RemediationPlanner,
  ReportGenerator,
  RoadmapGenerator,
  SettingGuideGenerator,
  TemplateManager,
  ToolRegistry,
  VendorComparator,
  WebCrawler,
  WorkflowExecutor,
  createDefaultToolDefinitions,
  type CapturedMenu,
  type ComplianceAnalysis,
  type McpStdioClient,
  type Workflow,
} from '@sangfor/workflow-engine';

type MutableRuntimeState = {
  mcpClient: McpStdioClient | null;
  bootstrapTask: Promise<void> | null;
  ready: boolean;
  requestBootstrap: () => void;
};

export interface OperatorConsoleContext {
  readonly rootPath: string;
  readonly upload: ReturnType<typeof multer>;
  readonly runtime: MutableRuntimeState;
  readonly toolRegistry: ToolRegistry;
  readonly executionLogger: ExecutionLogger;
  readonly approvalManager: ApprovalManager;
  readonly templateManager: TemplateManager;
  readonly monitoringDashboard: MonitoringDashboard;
  readonly aiWorkflowGenerator: AIWorkflowGenerator;
  readonly workflowExecutor: WorkflowExecutor;
  readonly breakGlassPolicy: BreakGlassPolicy;
  readonly operationOrchestrator: OperationOrchestrator;
  readonly incidentDetector: IncidentDetector;
  readonly remediationPlanner: RemediationPlanner;
  readonly playbookRegistry: PlaybookRegistry;
  readonly complianceTracker: ComplianceTracker;
  readonly roadmapGenerator: RoadmapGenerator;
  readonly proposalGenerator: ProposalGenerator;
  readonly deviceAccessManager: DeviceAccessManager;
  readonly deviceMenuCapture: DeviceMenuCapture;
  readonly settingGuideGenerator: SettingGuideGenerator;
  readonly vendorComparator: VendorComparator;
  readonly reportGenerator: ReportGenerator;
  readonly webCrawler: WebCrawler;
  readonly ragIndexer: RAGIndexer;
  readonly learningScheduler: LearningScheduler;
  readonly manualQA: ManualQASystem;
  readonly workflows: Map<string, Workflow>;
  readonly latestComplianceByCustomer: Map<string, ComplianceAnalysis>;
  readonly lastDeviceCaptures: Map<string, CapturedMenu>;
  readonly operationPlans: Map<string, Record<string, unknown>>;
  readonly snapshots: Map<string, Record<string, unknown>>;
  readonly approvals: Map<string, Record<string, unknown>>;
  readonly executionResults: Map<string, Record<string, unknown>>;
  readonly remediationPlans: Map<string, Record<string, unknown>>;
  readonly detectedIncidents: Map<string, Record<string, unknown>>;
  readonly dispose: () => Promise<void>;
}

export function createOperatorConsoleContext(): OperatorConsoleContext {
  const log = createLogger('operator-console-context');
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const rootPath = join(moduleDirectory, '../../..');
  const runtime: MutableRuntimeState = {
    mcpClient: null,
    bootstrapTask: null,
    ready: false,
    requestBootstrap: () => undefined,
  };
  const toolRegistry = new ToolRegistry();
  toolRegistry.registerAll(createDefaultToolDefinitions());
  const executionLogger = new ExecutionLogger();
  const approvalManager = new ApprovalManager();
  const errorHandler = new ErrorHandler();
  const templateManager = new TemplateManager();
  const monitoringDashboard = new MonitoringDashboard();
  const workflowExecutor = new WorkflowExecutor(toolRegistry, executionLogger, errorHandler);
  const breakGlassPolicy = new BreakGlassPolicy();
  workflowExecutor.setApprovalManager(approvalManager);
  workflowExecutor.setBreakGlassPolicy(breakGlassPolicy);
  const ragIndexer = new RAGIndexer();
  const deviceMenuCapture = new DeviceMenuCapture();
  const manualQA = new ManualQASystem(async (query, product) => {
    if (runtime.mcpClient?.isConnected()) {
      try {
        const mcpResult = await runtime.mcpClient.callTool('sangfor.search_manuals', { query, product });
        if (Array.isArray(mcpResult?.results)) {
          return mcpResult.results.map((item: { content?: string; score?: number; metadata?: Record<string, string> }) => ({
            content: item.content ?? String(item),
            score: item.score ?? 0.7,
            metadata: item.metadata ?? {},
          }));
        }
      } catch (error) {
        log.warn(`MCP manual search fallback: ${String(error)}`);
      }
    }
    const results = await ragIndexer.search(query, { product, limit: 5 });
    const selected = results.length === 0 && product
      ? await ragIndexer.search(query, { limit: 5 })
      : results;
    return selected.map((result) => ({
      content: result.chunk.content,
      score: result.score,
      metadata: { source: result.document.title, section: result.document.product },
    }));
  });
  const learningScheduler = new LearningScheduler();
  if (learningScheduler.getSchedules().length === 0) {
    learningScheduler.registerSchedule({
      name: 'Daily Crawl',
      frequency: 'daily',
      vendors: ['CrowdStrike', 'Microsoft'],
      enabled: true,
    });
    learningScheduler.registerSchedule({
      name: 'Weekly Index',
      frequency: 'weekly',
      vendors: ['SentinelOne', 'Palo Alto Networks', 'Fortinet'],
      enabled: true,
    });
  }

  const context: OperatorConsoleContext = {
    rootPath,
    upload: multer({ dest: 'uploads/' }),
    runtime,
    toolRegistry,
    executionLogger,
    approvalManager,
    templateManager,
    monitoringDashboard,
    aiWorkflowGenerator: new AIWorkflowGenerator(toolRegistry, { baseUrl: 'http://localhost:1234/v1' }),
    workflowExecutor,
    breakGlassPolicy,
    operationOrchestrator: new OperationOrchestrator(),
    incidentDetector: new IncidentDetector(),
    remediationPlanner: new RemediationPlanner(),
    playbookRegistry: new PlaybookRegistry(),
    complianceTracker: new ComplianceTracker(),
    roadmapGenerator: new RoadmapGenerator(),
    proposalGenerator: new ProposalGenerator(),
    deviceAccessManager: new DeviceAccessManager(),
    deviceMenuCapture,
    settingGuideGenerator: new SettingGuideGenerator(),
    vendorComparator: new VendorComparator(JSON.parse(
      readFileSync(join(rootPath, 'data/vendors/vendor-database.json'), 'utf8'),
    )),
    reportGenerator: new ReportGenerator(),
    webCrawler: new WebCrawler(),
    ragIndexer,
    learningScheduler,
    manualQA,
    workflows: new Map(),
    latestComplianceByCustomer: new Map(),
    lastDeviceCaptures: new Map(),
    operationPlans: new Map(),
    snapshots: new Map(),
    approvals: new Map(),
    executionResults: new Map(),
    remediationPlans: new Map(),
    detectedIncidents: new Map(),
    dispose: async () => {
      breakGlassPolicy.dispose();
      runtime.requestBootstrap = () => undefined;
      await runtime.bootstrapTask;
      const mcpClient = runtime.mcpClient;
      runtime.mcpClient = null;
      await mcpClient?.stop();
      runtime.ready = false;
    },
  };
  return context;
}
