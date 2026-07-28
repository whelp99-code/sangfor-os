export type {
  AdapterStrategy,
  ApprovalPayload,
  AutomationProductCode,
  ConfigSource,
  ExcelBasedChangePlan,
  ExcelImportResult,
  ExcelRequirementRow,
  ExcelWorkPlanItem,
  MappedRequirement,
  ProductAdapter,
  ProductAutomationInput,
  ProductCapability,
  ProductChangePlan,
  ProductConfigSnapshot,
  RequirementAnalysisInput,
  RequirementMappingResult,
  RequirementProductCode,
  RequirementTask,
} from './adapter-types.js';

export {
  analyzeCustomerRequirements,
  collectProductConfig,
  discoverProductConsole,
  generateProductChangePlan,
  getProductAdapter,
  listProductAdapters,
  normalizeAutomationProduct,
} from './adapter-catalog.js';

export {
  generateExcelBasedChangePlan,
  importExcelRequirementList,
  mapRequirementsToProducts,
} from './excel-requirements.js';

export {
  applyApprovedProductChange,
  dryRunProductChange,
  verifyProductChange,
} from './change-execution.js';

export {
  buildComprehensiveOperationsGuideDocx,
  buildComprehensiveSettingGuideDocx,
  buildOperationsGuideDocx,
  buildSettingGuideDocx,
  type DocxBuilderInput,
  type DocxBuilderResult,
} from './docx-builder.js';
