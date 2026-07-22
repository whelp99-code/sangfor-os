/**
 * U010 — 150-model scope inventory baseline.
 *
 * This is the ONLY tracked classifier source. `packages/db/scripts/check-scope-inventory.ts`
 * reads live Prisma DMMF and cross-checks it against `MODEL_SCOPE_INVENTORY` below; it never
 * re-derives classification from scratch. If you add/rename/remove a model, update this file
 * in the SAME commit as the schema change (see docs/05_DATA_AI/Data_Governance.md).
 *
 * Category meaning:
 * - TENANT_ROOT: the tenant entity itself (exactly one model: `Tenant`).
 * - COMPANY_ROOT: a model that anchors company-level scope. Either the `Company` entity itself
 *   (mandatory FK to Tenant, but Company — not Tenant — is what a "company" IS), or another
 *   top-level business/governance object that has no mandatory FK chain to any other scoped
 *   model and is conceptually shared across a company's projects (e.g. CFO ledger models,
 *   product/company governance policy, a source-control Repository).
 * - PROJECT_ROOT: a model that anchors project-level scope: the `Project` entity itself, or
 *   another top-level business object (Customer, Opportunity, ...) that has no mandatory FK
 *   chain reaching a scoped root and is conceptually delivered/used within one project's
 *   workspace. Many of these carry a bare `projectId`-shaped column without a formal Prisma
 *   relation (pre-dating this bridge); their own column is the "root basis", not a chain.
 * - GLOBAL_SHARED: no tenant/company/project scope at all — pure platform infra or a global
 *   identity/catalog. At the U010 baseline this also held `RoleChangeRequest` (see point 10 of
 *   the U010 dispatch — a legacy/unscoped shape that unit deliberately did not touch); U012
 *   reclassifies it to CHILD_VIA_FK once `companyId` becomes a mandatory FK (see
 *   `RECLASSIFIED_MODELS` below).
 * - CHILD_VIA_FK: inherits scope ONLY through a mandatory (non-null) Prisma relation chain to
 *   exactly one root (TENANT_ROOT/COMPANY_ROOT/PROJECT_ROOT — never a GLOBAL_SHARED target,
 *   since that would confer no scope). Optional-only chains, ambiguous multi-root chains, and
 *   nullable correlation fields (e.g. `Project.companyId`) are never CHILD_VIA_FK basis.
 *
 * `SCOPE_INVENTORY_BASELINE` is immutable provenance for the model set at `baseSha`. Later
 * additive-migration units register their new models into `MODEL_SCOPE_INVENTORY` in the same
 * commit that adds them and update any current-count fixtures — they never edit
 * `SCOPE_INVENTORY_BASELINE`. The closure unit (U073) re-verifies
 * `baseline150 + registered additions === current Prisma model count`.
 */

export type ScopeCategory =
  | 'GLOBAL_SHARED'
  | 'TENANT_ROOT'
  | 'COMPANY_ROOT'
  | 'PROJECT_ROOT'
  | 'CHILD_VIA_FK';

export const ROOT_CATEGORIES = ['TENANT_ROOT', 'COMPANY_ROOT', 'PROJECT_ROOT'] as const;
export type RootCategory = (typeof ROOT_CATEGORIES)[number];

export interface RootScopeEntry {
  model: string;
  category: RootCategory | 'GLOBAL_SHARED';
}

export interface ChildViaFkEntry {
  model: string;
  category: 'CHILD_VIA_FK';
  /** Immediate parent model this entry inherits scope from (may itself be CHILD_VIA_FK). */
  parentModel: string;
  /** Prisma relation field name on `model` pointing at `parentModel`. */
  relationField: string;
  /** Scalar FK column backing `relationField`. */
  scalarFkField: string;
  /** Always `false` — CHILD_VIA_FK requires a mandatory (non-null) FK. */
  nullable: false;
}

export type ScopeInventoryEntry = RootScopeEntry | ChildViaFkEntry;

/**
 * U033 records the catalog's canonical chain without changing the current inventory classifier.
 * ProductFamily and LicenseMetric remain GLOBAL_SHARED until U040 has the required zero-ambiguity
 * proof; the other catalog models keep their existing inventory tallies while this map makes the
 * exact future family/SKU chain explicit for that reclassification unit.
 */
export const CATALOG_TRANSITIONAL_CANONICAL_SCOPE_PATHS = Object.freeze({
  ProductFamily: Object.freeze({ relationField: 'company', scalarFkField: 'companyId', parentModel: 'Company', deferredTo: 'U040' }),
  ProductEdition: Object.freeze({ relationField: 'family', scalarFkField: 'familyId', parentModel: 'ProductFamily', deferredTo: 'U040' }),
  ProductSku: Object.freeze({ relationField: 'edition', scalarFkField: 'editionId', parentModel: 'ProductEdition', deferredTo: 'U040' }),
  LicenseMetric: Object.freeze({ relationField: 'productFamily', scalarFkField: 'productFamilyId', parentModel: 'ProductFamily', deferredTo: 'U040' }),
  SizingTemplate: Object.freeze({ relationField: 'family', scalarFkField: 'productFamilyId', parentModel: 'ProductFamily', deferredTo: 'U040' }),
  CompatibilityRule: Object.freeze({ relationField: 'sourceSku', scalarFkField: 'sourceSkuId', parentModel: 'ProductSku', additionalRequiredRelationFields: ['targetSku'], deferredTo: 'U040' }),
});

export interface ScopeInventoryBaseline {
  baseSha: string;
  modelCount: number;
  categoryCounts: Record<ScopeCategory, number>;
}

/** Immutable provenance for the U010 baseline. Never edit after this unit lands. */
export const SCOPE_INVENTORY_BASELINE: ScopeInventoryBaseline = Object.freeze({
  baseSha: '448289b355b6395d2744102398dcec967b705de9',
  modelCount: 150,
  categoryCounts: Object.freeze({
    GLOBAL_SHARED: 13,
    TENANT_ROOT: 1,
    COMPANY_ROOT: 32,
    PROJECT_ROOT: 44,
    CHILD_VIA_FK: 60,
  }),
});

export interface RegisteredAddition {
  model: string;
  unit: string;
  category: ScopeCategory;
}

/**
 * Every model a later additive migration registered on top of `SCOPE_INVENTORY_BASELINE`, one
 * entry per unit per model, in landing order. `SCOPE_INVENTORY_BASELINE` itself never changes;
 * this list is how `expectedCurrentModelCount`/`expectedCategoryCounts` derive the CURRENT
 * expected totals (baseline + registered additions) that `buildScopeInventoryReport` validates
 * against once the live schema reaches that count.
 */
export const REGISTERED_ADDITIONS: RegisteredAddition[] = [
  { model: 'ScopeBackfillQuarantine', unit: 'U011', category: 'GLOBAL_SHARED' },
  // U014/SEC-01: AuthSession carries mandatory tenantId/companyId/projectId simultaneously (three
  // trusted scope roots at once), which would be an AMBIGUOUS_ROOT chain if declared CHILD_VIA_FK
  // (see deriveStructuralMismatches). Declaring it PROJECT_ROOT is the correct, structurally-valid
  // category for a model that is itself a scope-carrying root, not a child of one.
  { model: 'AuthSession', unit: 'U014', category: 'PROJECT_ROOT' },
  // U017/ART-01a: Artifact carries mandatory tenantId/companyId/projectId simultaneously, same
  // AMBIGUOUS_ROOT reasoning as AuthSession above — declared PROJECT_ROOT, not CHILD_VIA_FK.
  { model: 'Artifact', unit: 'U017', category: 'PROJECT_ROOT' },
  // ArtifactVersion's only mandatory FK is artifactId -> Artifact (a single unambiguous root
  // chain), which is exactly the CHILD_VIA_FK definition (see its full structural basis in
  // MODEL_SCOPE_INVENTORY below). ownerAssignmentId/createdByAssignmentId are authority/
  // attribution edges, never an alternate scope basis.
  { model: 'ArtifactVersion', unit: 'U017', category: 'CHILD_VIA_FK' },
  // U018/APR-01a: both new models' only mandatory FK is approvalRequestId -> ApprovalRequest (a
  // single unambiguous root chain, since ApprovalRequest itself stays PROJECT_ROOT — unchanged by
  // this unit). ownerAssignmentId/requestedByAssignmentId/actorAssignmentId are authority/
  // attribution edges, never an alternate scope basis.
  { model: 'ApprovalDecision', unit: 'U018', category: 'CHILD_VIA_FK' },
  { model: 'ApprovalCurrentValidity', unit: 'U018', category: 'CHILD_VIA_FK' },
  // U019/WF-01a: WorkflowDefinition and WorkflowRun each carry mandatory tenantId/companyId/
  // projectId simultaneously (same AMBIGUOUS_ROOT reasoning as Artifact/AuthSession above) —
  // declared PROJECT_ROOT, not CHILD_VIA_FK, even though WorkflowRun also carries a mandatory
  // workflowDefinitionId FK to another PROJECT_ROOT (a second root path, which is exactly why a
  // structural CHILD_VIA_FK classification would be ambiguous here).
  { model: 'WorkflowDefinition', unit: 'U019', category: 'PROJECT_ROOT' },
  { model: 'WorkflowRun', unit: 'U019', category: 'PROJECT_ROOT' },
  // Each of the following three models' only mandatory FK is workflowRunId -> WorkflowRun (a
  // single unambiguous root chain, since WorkflowRun itself is PROJECT_ROOT per above).
  // artifactVersionId/createdByAssignmentId/actorAssignmentId are content/attribution edges, never
  // an alternate scope basis.
  { model: 'WorkflowRunStep', unit: 'U019', category: 'CHILD_VIA_FK' },
  { model: 'WorkflowRunArtifact', unit: 'U019', category: 'CHILD_VIA_FK' },
  { model: 'WorkflowRunEvent', unit: 'U019', category: 'CHILD_VIA_FK' },
  // U035: one immutable commercial calculation snapshot inherits its quote's scope through the
  // mandatory quoteId FK. It deliberately carries no redundant project/company scope column.
  { model: 'QuoteCommercialSnapshot', unit: 'U035', category: 'CHILD_VIA_FK' },
  // U036: DemoLicense has a required customerId -> Customer -> Project scope chain. Its
  // vendorRequestId is deliberately not the scope basis because VendorRequest.customerId stays
  // nullable during the expand phase; do not classify through that optional chain.
  { model: 'DemoLicense', unit: 'U036', category: 'CHILD_VIA_FK' },
];

export interface ReclassifiedModel {
  model: string;
  unit: string;
  fromCategory: ScopeCategory;
  toCategory: ScopeCategory;
}

/**
 * Every EXISTING (already-counted-in-`SCOPE_INVENTORY_BASELINE`) model whose category a later
 * unit legitimately changed, without adding or removing a model (so `expectedCurrentModelCount`
 * is unaffected — only the category tally shifts). U012 reclassifies `RoleChangeRequest` from its
 * U010-baseline `GLOBAL_SHARED` (a deliberate "this unit does not touch it" placeholder — see the
 * U010 dispatch point 10 and the category doc comment above) to `CHILD_VIA_FK` once its
 * `companyId` FK to `Company` becomes mandatory: the model now has a real, DB-enforced mandatory
 * FK chain to a scope root, which is exactly the CHILD_VIA_FK definition. `SCOPE_INVENTORY_BASELINE`
 * itself is never edited — it stays the immutable historical record of what the model set looked
 * like at U010's `baseSha`.
 */
export const RECLASSIFIED_MODELS: ReclassifiedModel[] = [
  { model: 'RoleChangeRequest', unit: 'U012', fromCategory: 'GLOBAL_SHARED', toCategory: 'CHILD_VIA_FK' },
  // U021/AUD-01b: AuditLog's tenantId becomes mandatory (every row is now scope-bound) while
  // companyId/projectId only narrow the chain under the enforced scope-level matrix — exactly the
  // CHILD_VIA_FK-vs-root reasoning above, but for TENANT_ROOT: a model carrying a real, always-set
  // tenant identity is a root, not a child. Reclassified exactly once from its U010-baseline
  // COMPANY_ROOT; no Prisma model is added or removed by this unit.
  { model: 'AuditLog', unit: 'U021', fromCategory: 'COMPANY_ROOT', toCategory: 'TENANT_ROOT' },
];

export function expectedCurrentModelCount(
  baseline: ScopeInventoryBaseline = SCOPE_INVENTORY_BASELINE,
  additions: RegisteredAddition[] = REGISTERED_ADDITIONS,
): number {
  return baseline.modelCount + additions.length;
}

export function expectedCategoryCounts(
  baseline: ScopeInventoryBaseline = SCOPE_INVENTORY_BASELINE,
  additions: RegisteredAddition[] = REGISTERED_ADDITIONS,
  reclassifications: ReclassifiedModel[] = RECLASSIFIED_MODELS,
): Record<ScopeCategory, number> {
  const counts = { ...baseline.categoryCounts };
  for (const addition of additions) {
    counts[addition.category] += 1;
  }
  for (const reclass of reclassifications) {
    counts[reclass.fromCategory] -= 1;
    counts[reclass.toCategory] += 1;
  }
  return counts;
}

/**
 * Every model present in the schema at `SCOPE_INVENTORY_BASELINE.baseSha`, classified exactly
 * once. See the module doc comment above for category semantics and the U010 dispatch for the
 * derivation method (Prisma DMMF relation nullability, not text regex).
 */
export const MODEL_SCOPE_INVENTORY: Record<string, ScopeInventoryEntry> = {
  AgentAssignment: { model: 'AgentAssignment', category: 'CHILD_VIA_FK', parentModel: 'WorkflowStep', relationField: 'workflowStep', scalarFkField: 'workflowStepId', nullable: false },
  AgentAssignmentRule: { model: 'AgentAssignmentRule', category: 'COMPANY_ROOT' },
  AgentDecisionLog: { model: 'AgentDecisionLog', category: 'CHILD_VIA_FK', parentModel: 'AgentAssignment', relationField: 'agentAssignment', scalarFkField: 'agentAssignmentId', nullable: false },
  AgentMessage: { model: 'AgentMessage', category: 'CHILD_VIA_FK', parentModel: 'AgentAssignment', relationField: 'agentAssignment', scalarFkField: 'agentAssignmentId', nullable: false },
  AgentPlaybook: { model: 'AgentPlaybook', category: 'COMPANY_ROOT' },
  AiEvaluationDataset: { model: 'AiEvaluationDataset', category: 'COMPANY_ROOT' },
  AiGoldenAnswer: { model: 'AiGoldenAnswer', category: 'GLOBAL_SHARED' },
  AiModel: { model: 'AiModel', category: 'COMPANY_ROOT' },
  AiPromptRun: { model: 'AiPromptRun', category: 'PROJECT_ROOT' },
  AiPromptTemplate: { model: 'AiPromptTemplate', category: 'GLOBAL_SHARED' },
  AiQualityResult: { model: 'AiQualityResult', category: 'PROJECT_ROOT' },
  ApprovalCurrentValidity: { model: 'ApprovalCurrentValidity', category: 'CHILD_VIA_FK', parentModel: 'ApprovalRequest', relationField: 'approvalRequest', scalarFkField: 'approvalRequestId', nullable: false },
  ApprovalDecision: { model: 'ApprovalDecision', category: 'CHILD_VIA_FK', parentModel: 'ApprovalRequest', relationField: 'approvalRequest', scalarFkField: 'approvalRequestId', nullable: false },
  ApprovalRequest: { model: 'ApprovalRequest', category: 'PROJECT_ROOT' },
  Artifact: { model: 'Artifact', category: 'PROJECT_ROOT' },
  ArtifactAccessEvent: { model: 'ArtifactAccessEvent', category: 'COMPANY_ROOT' },
  ArtifactVersion: { model: 'ArtifactVersion', category: 'CHILD_VIA_FK', parentModel: 'Artifact', relationField: 'artifact', scalarFkField: 'artifactId', nullable: false },
  AssetLicense: { model: 'AssetLicense', category: 'CHILD_VIA_FK', parentModel: 'CustomerAsset', relationField: 'asset', scalarFkField: 'assetId', nullable: false },
  // U021/AUD-01b: reclassified from COMPANY_ROOT to TENANT_ROOT (tenantId always mandatory) — see
  // RECLASSIFIED_MODELS below; the RECLASSIFIED_MODELS entry is what documents the change, this is
  // simply the model's one current entry (never counted under both categories).
  AuditLog: { model: 'AuditLog', category: 'TENANT_ROOT' },
  AuthSession: { model: 'AuthSession', category: 'PROJECT_ROOT' },
  AutonomyPolicy: { model: 'AutonomyPolicy', category: 'COMPANY_ROOT' },
  BlockRegistry: { model: 'BlockRegistry', category: 'PROJECT_ROOT' },
  Branch: { model: 'Branch', category: 'CHILD_VIA_FK', parentModel: 'Repository', relationField: 'repository', scalarFkField: 'repositoryId', nullable: false },
  BuildRun: { model: 'BuildRun', category: 'PROJECT_ROOT' },
  Canvas: { model: 'Canvas', category: 'PROJECT_ROOT' },
  Cashflow: { model: 'Cashflow', category: 'COMPANY_ROOT' },
  ChangedFile: { model: 'ChangedFile', category: 'CHILD_VIA_FK', parentModel: 'CodeChange', relationField: 'codeChange', scalarFkField: 'codeChangeId', nullable: false },
  ChatMessage: { model: 'ChatMessage', category: 'CHILD_VIA_FK', parentModel: 'ChatSession', relationField: 'session', scalarFkField: 'sessionId', nullable: false },
  ChatSession: { model: 'ChatSession', category: 'COMPANY_ROOT' },
  CodeChange: { model: 'CodeChange', category: 'PROJECT_ROOT' },
  CodexTask: { model: 'CodexTask', category: 'PROJECT_ROOT' },
  CodexTaskLog: { model: 'CodexTaskLog', category: 'CHILD_VIA_FK', parentModel: 'CodexTask', relationField: 'codexTask', scalarFkField: 'codexTaskId', nullable: false },
  ColorAgentDecision: { model: 'ColorAgentDecision', category: 'CHILD_VIA_FK', parentModel: 'KanbanHandoffCard', relationField: 'handoffCard', scalarFkField: 'handoffCardId', nullable: false },
  ColorAgentProfile: { model: 'ColorAgentProfile', category: 'GLOBAL_SHARED' },
  ColorReviewRequirement: { model: 'ColorReviewRequirement', category: 'CHILD_VIA_FK', parentModel: 'KanbanHandoffCard', relationField: 'handoffCard', scalarFkField: 'handoffCardId', nullable: false },
  Command: { model: 'Command', category: 'GLOBAL_SHARED' },
  CommandNotificationEvent: { model: 'CommandNotificationEvent', category: 'PROJECT_ROOT' },
  CommandRun: { model: 'CommandRun', category: 'CHILD_VIA_FK', parentModel: 'Project', relationField: 'project', scalarFkField: 'projectId', nullable: false },
  Company: { model: 'Company', category: 'COMPANY_ROOT' },
  CompanySettings: { model: 'CompanySettings', category: 'COMPANY_ROOT' },
  CompatibilityRule: { model: 'CompatibilityRule', category: 'GLOBAL_SHARED' },
  ConfigProfile: { model: 'ConfigProfile', category: 'GLOBAL_SHARED' },
  ConfigValue: { model: 'ConfigValue', category: 'PROJECT_ROOT' },
  ConnectorRegistry: { model: 'ConnectorRegistry', category: 'COMPANY_ROOT' },
  Contact: { model: 'Contact', category: 'PROJECT_ROOT' },
  CostEvent: { model: 'CostEvent', category: 'PROJECT_ROOT' },
  CursorSession: { model: 'CursorSession', category: 'PROJECT_ROOT' },
  Customer: { model: 'Customer', category: 'PROJECT_ROOT' },
  CustomerActivityLog: { model: 'CustomerActivityLog', category: 'CHILD_VIA_FK', parentModel: 'Customer', relationField: 'customer', scalarFkField: 'customerId', nullable: false },
  CustomerAsset: { model: 'CustomerAsset', category: 'CHILD_VIA_FK', parentModel: 'Customer', relationField: 'customer', scalarFkField: 'customerId', nullable: false },
  CustomerPartnerLink: { model: 'CustomerPartnerLink', category: 'CHILD_VIA_FK', parentModel: 'Customer', relationField: 'customer', scalarFkField: 'customerId', nullable: false },
  DataExportRequest: { model: 'DataExportRequest', category: 'COMPANY_ROOT' },
  DealQualification: { model: 'DealQualification', category: 'CHILD_VIA_FK', parentModel: 'Opportunity', relationField: 'opportunity', scalarFkField: 'opportunityId', nullable: false },
  DealRegistration: { model: 'DealRegistration', category: 'CHILD_VIA_FK', parentModel: 'Opportunity', relationField: 'opportunity', scalarFkField: 'opportunityId', nullable: false },
  DeliveryChecklistItem: { model: 'DeliveryChecklistItem', category: 'CHILD_VIA_FK', parentModel: 'Engagement', relationField: 'delivery', scalarFkField: 'deliveryId', nullable: false },
  DiscountRequest: { model: 'DiscountRequest', category: 'CHILD_VIA_FK', parentModel: 'Quote', relationField: 'quote', scalarFkField: 'quoteId', nullable: false },
  DemoLicense: { model: 'DemoLicense', category: 'CHILD_VIA_FK', parentModel: 'Customer', relationField: 'customer', scalarFkField: 'customerId', nullable: false },
  DocumentTemplate: { model: 'DocumentTemplate', category: 'PROJECT_ROOT' },
  DocumentVersion: { model: 'DocumentVersion', category: 'CHILD_VIA_FK', parentModel: 'GeneratedDocument', relationField: 'generatedDocument', scalarFkField: 'generatedDocumentId', nullable: false },
  DomainDecisionLog: { model: 'DomainDecisionLog', category: 'CHILD_VIA_FK', parentModel: 'Project', relationField: 'project', scalarFkField: 'projectId', nullable: false },
  DomainMemory: { model: 'DomainMemory', category: 'CHILD_VIA_FK', parentModel: 'Project', relationField: 'project', scalarFkField: 'projectId', nullable: false },
  Engagement: { model: 'Engagement', category: 'CHILD_VIA_FK', parentModel: 'Opportunity', relationField: 'opportunity', scalarFkField: 'opportunityId', nullable: false },
  EngineerCertification: { model: 'EngineerCertification', category: 'COMPANY_ROOT' },
  ErrorEvent: { model: 'ErrorEvent', category: 'COMPANY_ROOT' },
  ExecutionPolicy: { model: 'ExecutionPolicy', category: 'COMPANY_ROOT' },
  Expense: { model: 'Expense', category: 'COMPANY_ROOT' },
  FinanceAccount: { model: 'FinanceAccount', category: 'COMPANY_ROOT' },
  FinanceProject: { model: 'FinanceProject', category: 'COMPANY_ROOT' },
  FinanceSubscription: { model: 'FinanceSubscription', category: 'COMPANY_ROOT' },
  GeneratedDocument: { model: 'GeneratedDocument', category: 'CHILD_VIA_FK', parentModel: 'DocumentTemplate', relationField: 'template', scalarFkField: 'templateId', nullable: false },
  GitHubIssue: { model: 'GitHubIssue', category: 'PROJECT_ROOT' },
  HandoffEvent: { model: 'HandoffEvent', category: 'CHILD_VIA_FK', parentModel: 'KanbanHandoffCard', relationField: 'card', scalarFkField: 'cardId', nullable: false },
  ImprovementCandidate: { model: 'ImprovementCandidate', category: 'PROJECT_ROOT' },
  IntentAnalysis: { model: 'IntentAnalysis', category: 'CHILD_VIA_FK', parentModel: 'CommandRun', relationField: 'commandRun', scalarFkField: 'commandRunId', nullable: false },
  Invoice: { model: 'Invoice', category: 'COMPANY_ROOT' },
  KanbanHandoffCard: { model: 'KanbanHandoffCard', category: 'PROJECT_ROOT' },
  KnowledgeChunk: { model: 'KnowledgeChunk', category: 'CHILD_VIA_FK', parentModel: 'KnowledgeDocument', relationField: 'document', scalarFkField: 'documentId', nullable: false },
  KnowledgeDocument: { model: 'KnowledgeDocument', category: 'PROJECT_ROOT' },
  LayoutSlot: { model: 'LayoutSlot', category: 'PROJECT_ROOT' },
  LedgerEntry: { model: 'LedgerEntry', category: 'COMPANY_ROOT' },
  LicenseMetric: { model: 'LicenseMetric', category: 'GLOBAL_SHARED' },
  LlmCall: { model: 'LlmCall', category: 'PROJECT_ROOT' },
  MailAccount: { model: 'MailAccount', category: 'PROJECT_ROOT' },
  MailDerivedCandidate: { model: 'MailDerivedCandidate', category: 'PROJECT_ROOT' },
  MailEvidenceLink: { model: 'MailEvidenceLink', category: 'CHILD_VIA_FK', parentModel: 'MailDerivedCandidate', relationField: 'candidate', scalarFkField: 'mailDerivedCandidateId', nullable: false },
  MailInsightThread: { model: 'MailInsightThread', category: 'CHILD_VIA_FK', parentModel: 'Project', relationField: 'project', scalarFkField: 'projectId', nullable: false },
  MailMessage: { model: 'MailMessage', category: 'CHILD_VIA_FK', parentModel: 'MailAccount', relationField: 'account', scalarFkField: 'accountId', nullable: false },
  MaintenanceContract: { model: 'MaintenanceContract', category: 'CHILD_VIA_FK', parentModel: 'CustomerAsset', relationField: 'asset', scalarFkField: 'assetId', nullable: false },
  MeetingNote: { model: 'MeetingNote', category: 'PROJECT_ROOT' },
  MemoryItem: { model: 'MemoryItem', category: 'COMPANY_ROOT' },
  ModuleRegistry: { model: 'ModuleRegistry', category: 'GLOBAL_SHARED' },
  MonthClose: { model: 'MonthClose', category: 'COMPANY_ROOT' },
  NodeRegistry: { model: 'NodeRegistry', category: 'PROJECT_ROOT' },
  NotificationEvent: { model: 'NotificationEvent', category: 'COMPANY_ROOT' },
  Opportunity: { model: 'Opportunity', category: 'PROJECT_ROOT' },
  OpportunityLink: { model: 'OpportunityLink', category: 'CHILD_VIA_FK', parentModel: 'Opportunity', relationField: 'opportunity', scalarFkField: 'opportunityId', nullable: false },
  OpportunityStageEvent: { model: 'OpportunityStageEvent', category: 'CHILD_VIA_FK', parentModel: 'Opportunity', relationField: 'opportunity', scalarFkField: 'opportunityId', nullable: false },
  OutboxEvent: { model: 'OutboxEvent', category: 'PROJECT_ROOT' },
  Partner: { model: 'Partner', category: 'PROJECT_ROOT' },
  Persona: { model: 'Persona', category: 'CHILD_VIA_FK', parentModel: 'Company', relationField: 'company', scalarFkField: 'companyId', nullable: false },
  PocChecklistItem: { model: 'PocChecklistItem', category: 'CHILD_VIA_FK', parentModel: 'PocProject', relationField: 'pocProject', scalarFkField: 'pocProjectId', nullable: false },
  PocEvent: { model: 'PocEvent', category: 'CHILD_VIA_FK', parentModel: 'PocProject', relationField: 'pocProject', scalarFkField: 'pocProjectId', nullable: false },
  PocIssue: { model: 'PocIssue', category: 'CHILD_VIA_FK', parentModel: 'PocProject', relationField: 'pocProject', scalarFkField: 'pocProjectId', nullable: false },
  PocProject: { model: 'PocProject', category: 'PROJECT_ROOT' },
  PocRequirement: { model: 'PocRequirement', category: 'CHILD_VIA_FK', parentModel: 'PocProject', relationField: 'pocProject', scalarFkField: 'pocProjectId', nullable: false },
  PocResultReport: { model: 'PocResultReport', category: 'CHILD_VIA_FK', parentModel: 'PocProject', relationField: 'pocProject', scalarFkField: 'pocProjectId', nullable: false },
  PolicyDecisionLog: { model: 'PolicyDecisionLog', category: 'CHILD_VIA_FK', parentModel: 'Project', relationField: 'project', scalarFkField: 'projectId', nullable: false },
  PolicyMemory: { model: 'PolicyMemory', category: 'CHILD_VIA_FK', parentModel: 'Project', relationField: 'project', scalarFkField: 'projectId', nullable: false },
  PortalTask: { model: 'PortalTask', category: 'PROJECT_ROOT' },
  ProductEdition: { model: 'ProductEdition', category: 'GLOBAL_SHARED' },
  ProductFamily: { model: 'ProductFamily', category: 'GLOBAL_SHARED' },
  ProductSku: { model: 'ProductSku', category: 'GLOBAL_SHARED' },
  Project: { model: 'Project', category: 'PROJECT_ROOT' },
  ProjectColorAgent: { model: 'ProjectColorAgent', category: 'PROJECT_ROOT' },
  ProjectMember: { model: 'ProjectMember', category: 'CHILD_VIA_FK', parentModel: 'Project', relationField: 'project', scalarFkField: 'projectId', nullable: false },
  PullRequest: { model: 'PullRequest', category: 'CHILD_VIA_FK', parentModel: 'Repository', relationField: 'repository', scalarFkField: 'repositoryId', nullable: false },
  QualityGate: { model: 'QualityGate', category: 'COMPANY_ROOT' },
  QueryRegistry: { model: 'QueryRegistry', category: 'PROJECT_ROOT' },
  Quote: { model: 'Quote', category: 'CHILD_VIA_FK', parentModel: 'Opportunity', relationField: 'opportunity', scalarFkField: 'opportunityId', nullable: false },
  QuoteCommercialSnapshot: { model: 'QuoteCommercialSnapshot', category: 'CHILD_VIA_FK', parentModel: 'Quote', relationField: 'quote', scalarFkField: 'quoteId', nullable: false },
  QuoteLineItem: { model: 'QuoteLineItem', category: 'CHILD_VIA_FK', parentModel: 'Quote', relationField: 'quote', scalarFkField: 'quoteId', nullable: false },
  QuoteServiceLineItem: { model: 'QuoteServiceLineItem', category: 'CHILD_VIA_FK', parentModel: 'Opportunity', relationField: 'opportunity', scalarFkField: 'opportunityId', nullable: false },
  RenewalOpportunity: { model: 'RenewalOpportunity', category: 'CHILD_VIA_FK', parentModel: 'Customer', relationField: 'customer', scalarFkField: 'customerId', nullable: false },
  Report: { model: 'Report', category: 'CHILD_VIA_FK', parentModel: 'ValidationResult', relationField: 'validationResult', scalarFkField: 'validationResultId', nullable: false },
  Repository: { model: 'Repository', category: 'COMPANY_ROOT' },
  ReviewThread: { model: 'ReviewThread', category: 'PROJECT_ROOT' },
  RiskAnalysis: { model: 'RiskAnalysis', category: 'CHILD_VIA_FK', parentModel: 'CommandRun', relationField: 'commandRun', scalarFkField: 'commandRunId', nullable: false },
  RoleChangeRequest: { model: 'RoleChangeRequest', category: 'CHILD_VIA_FK', parentModel: 'Company', relationField: 'company', scalarFkField: 'companyId', nullable: false },
  RunTimelineItem: { model: 'RunTimelineItem', category: 'PROJECT_ROOT' },
  RuntimePolicy: { model: 'RuntimePolicy', category: 'COMPANY_ROOT' },
  ScopeBackfillQuarantine: { model: 'ScopeBackfillQuarantine', category: 'GLOBAL_SHARED' },
  SizingTemplate: { model: 'SizingTemplate', category: 'COMPANY_ROOT' },
  SkillCatalogItem: { model: 'SkillCatalogItem', category: 'COMPANY_ROOT' },
  SkillRun: { model: 'SkillRun', category: 'PROJECT_ROOT' },
  StateTransitionLog: { model: 'StateTransitionLog', category: 'PROJECT_ROOT' },
  Subscription: { model: 'Subscription', category: 'CHILD_VIA_FK', parentModel: 'CustomerAsset', relationField: 'asset', scalarFkField: 'assetId', nullable: false },
  SupportCase: { model: 'SupportCase', category: 'CHILD_VIA_FK', parentModel: 'Customer', relationField: 'customer', scalarFkField: 'customerId', nullable: false },
  SupportSlaPolicy: { model: 'SupportSlaPolicy', category: 'COMPANY_ROOT' },
  TaskLink: { model: 'TaskLink', category: 'CHILD_VIA_FK', parentModel: 'WorkTask', relationField: 'workTask', scalarFkField: 'workTaskId', nullable: false },
  TaskStatusEvent: { model: 'TaskStatusEvent', category: 'CHILD_VIA_FK', parentModel: 'WorkTask', relationField: 'workTask', scalarFkField: 'workTaskId', nullable: false },
  TaxInvoice: { model: 'TaxInvoice', category: 'COMPANY_ROOT' },
  Tenant: { model: 'Tenant', category: 'TENANT_ROOT' },
  TestRun: { model: 'TestRun', category: 'PROJECT_ROOT' },
  ToolCall: { model: 'ToolCall', category: 'CHILD_VIA_FK', parentModel: 'AgentAssignment', relationField: 'agentAssignment', scalarFkField: 'agentAssignmentId', nullable: false },
  User: { model: 'User', category: 'GLOBAL_SHARED' },
  UserCompanyRole: { model: 'UserCompanyRole', category: 'CHILD_VIA_FK', parentModel: 'Company', relationField: 'company', scalarFkField: 'companyId', nullable: false },
  ValidationCheck: { model: 'ValidationCheck', category: 'CHILD_VIA_FK', parentModel: 'ValidationPlan', relationField: 'plan', scalarFkField: 'planId', nullable: false },
  ValidationPlan: { model: 'ValidationPlan', category: 'PROJECT_ROOT' },
  ValidationResult: { model: 'ValidationResult', category: 'CHILD_VIA_FK', parentModel: 'WorkflowStep', relationField: 'workflowStep', scalarFkField: 'workflowStepId', nullable: false },
  VendorEscalation: { model: 'VendorEscalation', category: 'CHILD_VIA_FK', parentModel: 'SupportCase', relationField: 'supportCase', scalarFkField: 'caseId', nullable: false },
  VendorRequest: { model: 'VendorRequest', category: 'PROJECT_ROOT' },
  VendorRequestEvent: { model: 'VendorRequestEvent', category: 'CHILD_VIA_FK', parentModel: 'VendorRequest', relationField: 'request', scalarFkField: 'requestId', nullable: false },
  WorkBreakdownItem: { model: 'WorkBreakdownItem', category: 'PROJECT_ROOT' },
  Workflow: { model: 'Workflow', category: 'CHILD_VIA_FK', parentModel: 'CommandRun', relationField: 'commandRun', scalarFkField: 'commandRunId', nullable: false },
  // U019/WF-01a: WorkflowDefinition and WorkflowRun each carry mandatory tenantId/companyId/
  // projectId simultaneously (same AMBIGUOUS_ROOT reasoning as Artifact/AuthSession above) —
  // declared PROJECT_ROOT, not CHILD_VIA_FK, even though WorkflowRun also carries a mandatory
  // workflowDefinitionId FK to another PROJECT_ROOT (a second root path, which is exactly why a
  // structural CHILD_VIA_FK classification would be ambiguous here).
  WorkflowDefinition: { model: 'WorkflowDefinition', category: 'PROJECT_ROOT' },
  WorkflowRun: { model: 'WorkflowRun', category: 'PROJECT_ROOT' },
  // Each of the following three models' only mandatory FK is workflowRunId -> WorkflowRun (a
  // single unambiguous root chain, since WorkflowRun itself is PROJECT_ROOT per above).
  // artifactVersionId/createdByAssignmentId/actorAssignmentId are content/attribution edges, never
  // an alternate scope basis.
  WorkflowRunArtifact: { model: 'WorkflowRunArtifact', category: 'CHILD_VIA_FK', parentModel: 'WorkflowRun', relationField: 'run', scalarFkField: 'workflowRunId', nullable: false },
  WorkflowRunEvent: { model: 'WorkflowRunEvent', category: 'CHILD_VIA_FK', parentModel: 'WorkflowRun', relationField: 'run', scalarFkField: 'workflowRunId', nullable: false },
  WorkflowRunStep: { model: 'WorkflowRunStep', category: 'CHILD_VIA_FK', parentModel: 'WorkflowRun', relationField: 'run', scalarFkField: 'workflowRunId', nullable: false },
  WorkflowStep: { model: 'WorkflowStep', category: 'CHILD_VIA_FK', parentModel: 'Workflow', relationField: 'workflow', scalarFkField: 'workflowId', nullable: false },
  WorkflowTemplate: { model: 'WorkflowTemplate', category: 'PROJECT_ROOT' },
  Workspace: { model: 'Workspace', category: 'PROJECT_ROOT' },
  WorkTask: { model: 'WorkTask', category: 'PROJECT_ROOT' },
};

/** Look up a single model's classification. Returns `undefined` for an unknown model. */
export function classifyModel(name: string): ScopeInventoryEntry | undefined {
  return MODEL_SCOPE_INVENTORY[name];
}

export interface ScopeInventoryError {
  code:
    | 'MISSING_MODEL'
    | 'UNKNOWN_MODEL'
    | 'DUPLICATE_MODEL'
    | 'COUNT_DRIFT'
    | 'TALLY_MISMATCH'
    | 'AMBIGUOUS_ROOT'
    | 'DEAD_END_CHAIN'
    | 'NULLABLE_CHAIN'
    | 'STALE_PARENT'
    | 'SEMANTIC_MISMATCH';
  message: string;
  model?: string;
}

export interface ScopeInventoryReport {
  ok: boolean;
  baseSha: string;
  currentModelCount: number;
  inventoryModelCount: number;
  tallies: Record<ScopeCategory, number>;
  baselineTallies: Record<ScopeCategory, number>;
  missingModels: string[];
  unknownModels: string[];
  duplicateModels: string[];
  errors: ScopeInventoryError[];
}

const EMPTY_TALLIES = (): Record<ScopeCategory, number> => ({
  GLOBAL_SHARED: 0,
  TENANT_ROOT: 0,
  COMPANY_ROOT: 0,
  PROJECT_ROOT: 0,
  CHILD_VIA_FK: 0,
});

/**
 * Cross-check current schema model names against a set of inventory entries (defaults to the
 * real `MODEL_SCOPE_INVENTORY`, as an array so duplicate-model fixtures are representable).
 * Catches: missing models, unknown/new models, duplicate model entries, model-count drift, and
 * (when the current model set matches the immutable baseline count exactly) category tally
 * drift from `SCOPE_INVENTORY_BASELINE`.
 */
export function buildScopeInventoryReport(
  currentModelNames: string[],
  entries: ScopeInventoryEntry[] = Object.values(MODEL_SCOPE_INVENTORY),
): ScopeInventoryReport {
  const errors: ScopeInventoryError[] = [];

  const seen = new Map<string, number>();
  for (const entry of entries) {
    seen.set(entry.model, (seen.get(entry.model) ?? 0) + 1);
  }
  const duplicateModels = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([model]) => model)
    .sort();
  for (const model of duplicateModels) {
    errors.push({
      code: 'DUPLICATE_MODEL',
      message: `model "${model}" is classified more than once (ambiguous category)`,
      model,
    });
  }

  const inventoryModelSet = new Set(entries.map((e) => e.model));
  const currentModelSet = new Set(currentModelNames);

  const missingModels = [...currentModelSet]
    .filter((m) => !inventoryModelSet.has(m))
    .sort();
  for (const model of missingModels) {
    errors.push({
      code: 'MISSING_MODEL',
      message: `model "${model}" exists in the current schema but has no inventory entry`,
      model,
    });
  }

  const unknownModels = [...inventoryModelSet]
    .filter((m) => !currentModelSet.has(m))
    .sort();
  for (const model of unknownModels) {
    errors.push({
      code: 'UNKNOWN_MODEL',
      message: `inventory entry "${model}" does not correspond to any current schema model`,
      model,
    });
  }

  const tallies = EMPTY_TALLIES();
  for (const entry of entries) {
    if ((seen.get(entry.model) ?? 0) > 1) continue;
    tallies[entry.category] += 1;
  }

  const baseline = SCOPE_INVENTORY_BASELINE;
  if (
    currentModelNames.length !== entries.length &&
    missingModels.length === 0 &&
    unknownModels.length === 0 &&
    duplicateModels.length === 0
  ) {
    errors.push({
      code: 'COUNT_DRIFT',
      message: `current model count ${currentModelNames.length} does not match inventory entry count ${entries.length}`,
    });
  }

  const expectedCount = expectedCurrentModelCount(baseline);
  const expectedTallies = expectedCategoryCounts(baseline);
  if (currentModelNames.length === expectedCount && duplicateModels.length === 0) {
    for (const category of Object.keys(expectedTallies) as ScopeCategory[]) {
      if (tallies[category] !== expectedTallies[category]) {
        errors.push({
          code: 'TALLY_MISMATCH',
          message: `category ${category} tally ${tallies[category]} does not match expected ${expectedTallies[category]} (baseline ${baseline.categoryCounts[category]} + registered additions)`,
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    baseSha: baseline.baseSha,
    currentModelCount: currentModelNames.length,
    inventoryModelCount: entries.length,
    tallies,
    baselineTallies: { ...baseline.categoryCounts },
    missingModels,
    unknownModels,
    duplicateModels,
    errors,
  };
}

/**
 * Minimal shape of a Prisma DMMF relation field, enough to validate a CHILD_VIA_FK entry's
 * recorded basis (parent model, relation field, scalar FK field, nullability, onDelete)
 * against the live schema. Callers derive this from `Prisma.dmmf.datamodel.models` (see
 * `packages/db/scripts/check-scope-inventory.ts`) or from a hand-built fixture in tests.
 */
export interface DmmfRelationField {
  model: string;
  relationField: string;
  targetModel: string;
  scalarFkFields: string[];
  /** true if ALL backing scalar FK columns are required (non-null). */
  mandatory: boolean;
  onDelete: string | null;
}

/**
 * Validate every CHILD_VIA_FK entry's recorded parent/relationField/scalarFkField/nullable
 * against the live DMMF relation set. Catches: relation missing/renamed (stale parent),
 * optional-only chains (nullable FK claimed as CHILD_VIA_FK basis — this is exactly how a
 * nullable correlation field such as `Project.companyId` is rejected if someone tries to use
 * it as scope authority), and parent-model drift.
 */
export function validateChildViaFkEntries(
  entries: ScopeInventoryEntry[],
  dmmfRelations: DmmfRelationField[],
): ScopeInventoryError[] {
  const errors: ScopeInventoryError[] = [];
  const byModelAndField = new Map<string, DmmfRelationField>();
  for (const rel of dmmfRelations) {
    byModelAndField.set(`${rel.model}::${rel.relationField}`, rel);
  }

  for (const entry of entries) {
    if (entry.category !== 'CHILD_VIA_FK') continue;
    if (entry.nullable !== false) {
      errors.push({
        code: 'NULLABLE_CHAIN',
        message: `CHILD_VIA_FK entry for "${entry.model}" must declare nullable:false`,
        model: entry.model,
      });
      continue;
    }
    const key = `${entry.model}::${entry.relationField}`;
    const live = byModelAndField.get(key);
    if (!live) {
      errors.push({
        code: 'STALE_PARENT',
        message: `"${entry.model}.${entry.relationField}" no longer exists in the live schema (stale CHILD_VIA_FK basis)`,
        model: entry.model,
      });
      continue;
    }
    if (live.targetModel !== entry.parentModel) {
      errors.push({
        code: 'STALE_PARENT',
        message: `"${entry.model}.${entry.relationField}" now targets "${live.targetModel}", not recorded parent "${entry.parentModel}"`,
        model: entry.model,
      });
    }
    if (!live.scalarFkFields.includes(entry.scalarFkField)) {
      errors.push({
        code: 'STALE_PARENT',
        message: `"${entry.model}.${entry.relationField}" scalar FK fields [${live.scalarFkFields.join(', ')}] do not include recorded "${entry.scalarFkField}"`,
        model: entry.model,
      });
    }
    if (!live.mandatory) {
      errors.push({
        code: 'DEAD_END_CHAIN',
        message: `"${entry.model}.${entry.relationField}" is optional in the live schema; CHILD_VIA_FK requires a mandatory (non-null) chain (optional-only chain)`,
        model: entry.model,
      });
    }
  }

  return errors;
}

/**
 * Structural cross-check: given the ROOT-category declarations (TENANT_ROOT/COMPANY_ROOT/
 * PROJECT_ROOT/GLOBAL_SHARED entries) and the live mandatory-FK relation graph, derive which
 * models a fully mechanical closure would classify as CHILD_VIA_FK (chaining only through
 * mandatory FKs to exactly one scoped root), and flag any declared entry whose category
 * disagrees with that closure. This catches "miscategorized to force a count" — e.g. declaring
 * a model with a real mandatory FK chain to a root as GLOBAL_SHARED/ROOT instead of
 * CHILD_VIA_FK, or the reverse (ambiguous chain to two roots declared as an unambiguous
 * CHILD_VIA_FK).
 */
export function deriveStructuralMismatches(
  entries: ScopeInventoryEntry[],
  dmmfRelations: DmmfRelationField[],
): ScopeInventoryError[] {
  const errors: ScopeInventoryError[] = [];
  const declared = new Map(entries.map((e) => [e.model, e]));
  const relationsByModel = new Map<string, DmmfRelationField[]>();
  for (const rel of dmmfRelations) {
    const list = relationsByModel.get(rel.model) ?? [];
    list.push(rel);
    relationsByModel.set(rel.model, list);
  }

  const declaredRootCategory = new Map<string, RootCategory>();
  for (const entry of entries) {
    if (entry.category !== 'CHILD_VIA_FK' && entry.category !== 'GLOBAL_SHARED') {
      declaredRootCategory.set(entry.model, entry.category);
    }
  }

  const resolved = new Map<string, RootCategory | 'GLOBAL_SHARED' | 'AMBIGUOUS' | 'DEAD_END'>();
  const resolving = new Set<string>();

  function resolve(model: string): RootCategory | 'GLOBAL_SHARED' | 'AMBIGUOUS' | 'DEAD_END' {
    if (resolved.has(model)) return resolved.get(model)!;
    if (declaredRootCategory.has(model)) {
      const cat = declaredRootCategory.get(model)!;
      resolved.set(model, cat);
      return cat;
    }
    const entry = declared.get(model);
    if (entry && entry.category === 'GLOBAL_SHARED') {
      resolved.set(model, 'GLOBAL_SHARED');
      return 'GLOBAL_SHARED';
    }
    if (resolving.has(model)) {
      resolved.set(model, 'DEAD_END');
      return 'DEAD_END';
    }
    resolving.add(model);
    const mandatoryEdges = (relationsByModel.get(model) ?? []).filter((r) => r.mandatory);
    const roots = new Set<RootCategory>();
    let sawGlobalOnly = mandatoryEdges.length === 0;
    for (const edge of mandatoryEdges) {
      const targetResolved = resolve(edge.targetModel);
      if (targetResolved === 'GLOBAL_SHARED') {
        sawGlobalOnly = true;
        continue;
      }
      if (targetResolved === 'AMBIGUOUS' || targetResolved === 'DEAD_END') continue;
      roots.add(targetResolved);
    }
    resolving.delete(model);
    let outcome: RootCategory | 'GLOBAL_SHARED' | 'AMBIGUOUS' | 'DEAD_END';
    if (roots.size === 1) {
      outcome = [...roots][0];
    } else if (roots.size > 1) {
      outcome = 'AMBIGUOUS';
    } else {
      outcome = sawGlobalOnly ? 'GLOBAL_SHARED' : 'DEAD_END';
    }
    resolved.set(model, outcome);
    return outcome;
  }

  for (const entry of entries) {
    if (entry.category !== 'CHILD_VIA_FK') continue;
    const structural = resolve(entry.model);
    if (structural === 'AMBIGUOUS') {
      errors.push({
        code: 'AMBIGUOUS_ROOT',
        message: `"${entry.model}" has mandatory FK chains reaching more than one scope root; cannot be CHILD_VIA_FK`,
        model: entry.model,
      });
    } else if (structural === 'DEAD_END' || structural === 'GLOBAL_SHARED') {
      errors.push({
        code: 'DEAD_END_CHAIN',
        message: `"${entry.model}" has no mandatory FK chain reaching a scoped root; declared CHILD_VIA_FK is unsupported`,
        model: entry.model,
      });
    }
  }

  return errors;
}

/** Scans migration SQL (or a Prisma schema diff) text for a forbidden `role_change_requests`
 * scope expansion. At the U010 baseline, `role_change_requests` must receive EXACTLY zero
 * column/FK/index/update changes — see dispatch point 10. */
export function assertNoRoleChangeRequestScopeExpansion(sqlOrDiffText: string): {
  ok: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  const lines = sqlOrDiffText.split('\n');
  for (const line of lines) {
    if (/role_change_requests/i.test(line)) {
      violations.push(line.trim());
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * The `Project.company` relation (point 6 of the U010 dispatch) must be exactly
 * `onDelete: Restrict`. `SetNull`/`Cascade` would let RLS-relevant scope correlation silently
 * change or cascade-delete a Project when its Company is removed; an omitted action falls back
 * to Prisma's default (`Restrict` for optional relations is NOT guaranteed across versions), so
 * this must be declared explicitly.
 */
export function assertScopeBridgeOnDelete(onDelete: string | null | undefined): {
  ok: boolean;
  reason?: string;
} {
  if (onDelete === 'Restrict') return { ok: true };
  return {
    ok: false,
    reason: `Project.company onDelete must be exactly "Restrict", got ${JSON.stringify(onDelete ?? null)}`,
  };
}
