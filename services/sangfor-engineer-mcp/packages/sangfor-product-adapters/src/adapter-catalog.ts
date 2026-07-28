import { requiresApprovalForText } from '@sangfor/approval';
import { normalizeProduct, nowId, type ProductCode, type RiskLevel } from '@sangfor/shared';
import type {
  AutomationProductCode,
  ConfigSource,
  ProductAdapter,
  ProductAutomationInput,
  ProductCapability,
  ProductChangePlan,
  ProductConfigSnapshot,
  RequirementAnalysisInput,
  RequirementTask,
} from './adapter-types.js';

const HCI_SCP_ENDPOINTS = [
  'POST /janus/v2/public-key', 'POST /janus/v2/login', 'GET /janus/20180725/tasks/{task_id}',
  'GET /openstack/compute/v2/servers', 'GET /openstack/image/v2/images',
  'GET /openstack/volume/v2/volumes', 'GET /openstack/network/v2.0/networks',
];
const IAG_WEBUI_ROUTES = [
  'WEBUI GET System > Interfaces', 'WEBUI GET System > Routing',
  'WEBUI GET User Management > Authentication Source', 'WEBUI GET Policy > Access Control',
  'WEBUI GET Policy > URL/Application Control', 'WEBUI GET Logs > Internet Access Logs',
];
const ENDPOINT_SECURE_WEBUI_ROUTES = [
  'WEBUI GET Dashboard (Home) > Agent Status', 'WEBUI GET Defense > Malware Scan',
  'WEBUI GET Policies > App Control',
  'WEBUI GET Policies > General Policies > Endpoint Control > USB Device Control',
  'WEBUI GET Detection and Response > Security Events', 'WEBUI GET Endpoints > Endpoint Inventory',
  'WEBUI GET System > Agent Deployment', 'WEBUI GET System > Data Sync > Syslog Reporting',
];
const NDR_API_ENDPOINTS = [
  'GET /api/v1/event_sources', 'GET /api/v1/sensors', 'GET /api/v1/incidents',
  'GET /api/v1/alerts/rules', 'GET /api/v1/dashboards', 'GET /api/v1/soar/playbooks',
  'POST /api/v1/soar/playbooks/{id}/execute',
];

function capability(
  id: string,
  title: string,
  collectSections: string[],
  planKeywords: string[],
  riskLevel: RiskLevel,
  approvalRequired: boolean,
  menuPath: string[],
  apiEndpointCandidates: string[],
): ProductCapability {
  return { id, title, collectSections, planKeywords, riskLevel, approvalRequired, menuPath, apiEndpointCandidates };
}

const ADAPTERS: Record<AutomationProductCode, ProductAdapter> = {
  HCI_SCP: {
    product: 'HCI_SCP',
    aliases: ['hci_scp', 'hci/scp', 'scp', 'hci', 'acloud', 'sangfor cloud platform'],
    strategy: 'api-first',
    authMethods: ['SCP OpenAPI token/signature flow', 'WebUI session fallback'],
    apiLikely: true,
    apiCatalogStatus: 'ready',
    menuRoutes: ['Home > Overview', 'Resource Center > Resource Pools', 'Resource Center > Virtual Machines', 'Resource Center > Network > Topology', 'Reliability > HA', 'Reliability > DRS', 'System > Licensing', 'Operations > Alerts', 'Operations > Tasks'],
    capabilities: [
      capability('resource_inventory', 'Resource pool, node, VM, storage, network collection', ['version', 'license', 'resource_pool', 'node', 'vm', 'storage', 'network', 'alert', 'task'], ['resource', 'node', 'vm', 'storage', 'network', 'inventory', 'alert', 'license'], 'low', false, ['Resource Center', 'Resource Pools'], HCI_SCP_ENDPOINTS),
      capability('ha_drs', 'HA/DRS planning', ['ha', 'drs', 'resource_pool', 'task'], ['ha', 'drs', 'availability', 'cluster balance'], 'high', true, ['Reliability', 'HA/DRS'], ['GET /janus/20180725/tasks/{task_id}', 'PUT /openstack/compute/v2/servers/{id}/metadata']),
      capability('vm_resource', 'VM resource and power operation planning', ['vm', 'task'], ['vm', 'cpu', 'memory', 'migrate', 'power', 'delete'], 'critical', true, ['Resource Center', 'Virtual Machines'], ['GET /openstack/compute/v2/servers', 'POST /openstack/compute/v2/servers/{id}/action']),
      capability('license_alert', 'License and alert mismatch validation', ['version', 'license', 'alert'], ['license', 'mismatch', 'alert', 'ntp'], 'medium', false, ['System', 'Licensing'], ['GET /janus/20180725/tasks/{task_id}']),
    ],
  },
  IAG: {
    product: 'IAG',
    aliases: ['iag', 'internet access gateway', 'iam', 'access gateway'],
    strategy: 'webui-first',
    authMethods: ['WebUI session', 'Network/API discovery when enabled'],
    apiLikely: false,
    apiCatalogStatus: 'ready',
    menuRoutes: ['System > Interfaces', 'System > Routing', 'User Management > Authentication Source', 'Policy > Access Control', 'Policy > URL/Application Control', 'Logs > Internet Access Logs'],
    capabilities: [
      capability('auth_source', 'AD/LDAP and authentication policy planning', ['version', 'license', 'interface', 'route', 'user_auth'], ['ad', 'ldap', 'authentication', 'user', 'group', 'sso'], 'high', true, ['User Management', 'Authentication Source'], IAG_WEBUI_ROUTES),
      capability('internet_policy', 'Internet access, URL and application policy planning', ['access_policy', 'url_application_policy', 'logs'], ['internet', 'url', 'application', 'policy', 'exception', 'allow', 'block'], 'high', true, ['Policy', 'Access Control'], IAG_WEBUI_ROUTES),
      capability('log_validation', 'Log and audit validation', ['logs'], ['log', 'audit', 'report', 'verify'], 'low', false, ['Logs', 'Internet Access Logs'], IAG_WEBUI_ROUTES),
    ],
  },
  ENDPOINT_SECURE: {
    product: 'ENDPOINT_SECURE',
    aliases: ['endpoint secure', 'endpoint security', 'edr', 'epp', 'asec'],
    strategy: 'webui-first',
    authMethods: ['WebUI session', 'Operator dry-run route catalog'],
    apiLikely: false,
    apiCatalogStatus: 'ready',
    menuRoutes: ['Dashboard (Home)', 'Detection and Response > Security Events', 'Defense > Malware Scan', 'Endpoints > Endpoint Inventory', 'Policies > App Control', 'Policies > General Policies > Endpoint Control > USB Device Control', 'System > Agent Deployment', 'System > Data Sync > Syslog Reporting'],
    capabilities: [
      capability('endpoint_inventory', 'Endpoint, agent and update status collection', ['license', 'endpoint_agent', 'update_status'], ['endpoint', 'agent', 'online', 'offline', 'update', '에이전트', '설치'], 'low', false, ['Dashboard (Home)'], ENDPOINT_SECURE_WEBUI_ROUTES),
      capability('protection_policy', 'Anti-malware scan and protection policy', ['policy', 'malware_ransomware', 'exception_list'], ['policy', 'malware', 'ransomware', 'scan', 'anti-virus', 'antivirus', 'engine update', '검사', '엔진'], 'high', true, ['Defense', 'Malware Scan'], ENDPOINT_SECURE_WEBUI_ROUTES),
      capability('app_control', 'Software/application control policy', ['policy', 'software_control'], ['software control', 'unauthorized software', 'application', 'app control', '소프트웨어', '통제'], 'high', true, ['Policies', 'App Control'], ENDPOINT_SECURE_WEBUI_ROUTES),
      capability('device_control', 'USB and device control policy', ['policy', 'device_control'], ['device control', 'usb', 'storage media', '저장매체', 'usb device'], 'high', true, ['Policies', 'General Policies', 'Endpoint Control', 'USB Device Control'], ENDPOINT_SECURE_WEBUI_ROUTES),
      capability('security_events', 'Security event logs and audit trail', ['logs', 'security_events', 'audit'], ['log', 'event', 'audit', 'detection', '보안 이벤트', '로그', '감사'], 'low', false, ['Detection and Response', 'Security Events'], ENDPOINT_SECURE_WEBUI_ROUTES),
      capability('agent_deployment', 'Agent deployment planning', ['endpoint_agent', 'policy'], ['deploy', 'deployment', 'install', 'agent', 'agent rollout', '배포'], 'high', true, ['System', 'Agent Deployment'], ENDPOINT_SECURE_WEBUI_ROUTES),
      capability('syslog_export', 'Syslog/SIEM log forwarding', ['logs', 'syslog', 'siem'], ['syslog', 'siem', 'log export', 'data sync', '로그 전송'], 'medium', false, ['System', 'Data Sync', 'Syslog Reporting'], ENDPOINT_SECURE_WEBUI_ROUTES),
    ],
  },
  NDR: {
    product: 'NDR',
    aliases: ['ndr', 'cyber command', 'athena ndr', 'soc'],
    strategy: 'hybrid',
    authMethods: ['WebUI session', 'NDR REST API catalog (third-party integration doc)'],
    apiLikely: true,
    apiCatalogStatus: 'ready',
    menuRoutes: ['Dashboard > Security Operations', 'Assets > Sensors/Connectors', 'Events > Event Sources', 'Incidents > Incident List', 'Alerts > Alert Rules', 'SOAR > Playbooks', 'System > Integrations'],
    capabilities: [
      capability('event_source', 'Event source and sensor integration planning', ['version', 'license', 'event_sources', 'sensors_connectors', 'integration_status'], ['event source', 'sensor', 'connector', 'syslog', 'api source', 'ngaf', 'iag', 'endpoint'], 'medium', false, ['Events', 'Event Sources'], NDR_API_ENDPOINTS),
      capability('incident_alert', 'Incident, alert and dashboard validation', ['incidents', 'alerts'], ['incident', 'alert', 'dashboard', 'report'], 'low', false, ['Incidents', 'Incident List'], NDR_API_ENDPOINTS),
      capability('soar_response', 'SOAR/playbook response action planning', ['soar_playbooks'], ['soar', 'playbook', 'response', 'isolate', 'block', 'quarantine'], 'critical', true, ['SOAR', 'Playbooks'], NDR_API_ENDPOINTS),
    ],
  },
};

export function normalizeAutomationProduct(input?: string): AutomationProductCode {
  const raw = (input ?? '').trim();
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return 'HCI_SCP';
  for (const adapter of Object.values(ADAPTERS)) {
    if (adapter.product.toLowerCase() === normalized) return adapter.product;
    if (adapter.aliases.some(alias => normalized === alias.toLowerCase().replace(/[\s-]+/g, '_'))) return adapter.product;
  }
  const sharedProduct: ProductCode = normalizeProduct(input);
  if (sharedProduct === 'HCI' || sharedProduct === 'HCI_SCP') return 'HCI_SCP';
  if (sharedProduct === 'CYBER_COMMAND' || sharedProduct === 'NDR') return 'NDR';
  if (sharedProduct === 'IAG' || sharedProduct === 'ENDPOINT_SECURE') return sharedProduct;
  return 'HCI_SCP';
}

export function getProductAdapter(product?: string): ProductAdapter {
  return ADAPTERS[normalizeAutomationProduct(product)];
}

export function listProductAdapters(): ProductAdapter[] {
  return Object.values(ADAPTERS);
}

export function discoverProductConsole(input: ProductAutomationInput) {
  const adapter = getProductAdapter(input.product);
  return {
    id: nowId('discover'), product: adapter.product, targetUrl: input.targetUrl, version: input.version,
    strategy: adapter.strategy, apiLikely: adapter.apiLikely, apiCatalogStatus: adapter.apiCatalogStatus,
    authMethods: adapter.authMethods, menuRoutes: adapter.menuRoutes, capabilities: adapter.capabilities,
    nextStep: adapter.apiCatalogStatus === 'ready'
      ? 'Use API catalog first, then verify with WebUI evidence.'
      : 'Run read-only WebUI traversal and capture network/API discovery evidence.',
  };
}

export function collectProductConfig(input: ProductAutomationInput): ProductConfigSnapshot {
  const adapter = getProductAdapter(input.product);
  const source = chooseSource(adapter, input.preferApi);
  const sectionIds = unique(adapter.capabilities.flatMap(item => item.collectSections));
  return {
    id: nowId('snapshot'), product: adapter.product, strategy: adapter.strategy, source,
    targetUrl: input.targetUrl, version: input.version, collectedAt: new Date().toISOString(),
    sections: sectionIds.map(id => ({
      id, source,
      status: adapter.apiCatalogStatus === 'document_required' && source !== 'webui' ? 'needs_discovery' : 'collectable',
      evidence: buildEvidenceHints(adapter, id, source),
    })),
    safety: { readOnly: true, mutationBlocked: true },
  };
}

export function analyzeCustomerRequirements(input: RequirementAnalysisInput) {
  const adapter = getProductAdapter(input.product);
  const tasks = input.requirements.map((requirement, index) => taskFromRequirement(adapter, requirement, index));
  return {
    id: nowId('analysis'), product: adapter.product, strategy: adapter.strategy, requirements: input.requirements, tasks,
    notes: [
      'Read-only collection can run without approval.',
      'Save/Apply/Delete and security or service-impacting changes remain approval-gated.',
      adapter.apiCatalogStatus === 'ready'
        ? `${adapter.product} route catalog is ready for dry-run previews (API and/or WEBUI).`
        : 'API discovery evidence is needed before API execution is promoted.',
    ],
  };
}

export function generateProductChangePlan(input: RequirementAnalysisInput): ProductChangePlan {
  const adapter = getProductAdapter(input.product);
  const analysis = analyzeCustomerRequirements(input);
  return {
    id: nowId('product_plan'), product: adapter.product, strategy: adapter.strategy,
    summary: `${adapter.product} ${adapter.strategy} plan for ${analysis.tasks.length} customer requirement(s).`,
    tasks: analysis.tasks,
    rollbackPlan: ['Export or capture current configuration before any mutation.', 'Keep original policy/routing/resource settings available for restore.', 'Use product-native task history, audit log, and screenshots as rollback evidence.'],
    validationPlan: ['Re-collect the same sections after change.', 'Compare current value, target value, alarms, task status, and logs.', 'Generate evidence with menu path/API preview, before/after values, and operator approval metadata.'],
    executionGates: ['Default mode is read-only/dry-run.', 'Real execution requires SANGFOR_ALLOW_REAL_EXECUTION=true.', 'Production execution also requires SANGFOR_ALLOW_PRODUCTION_EXECUTION=true.', 'Approval payload must include approvedBy, approvalToken, changeTicketId, and rollbackPlanId.'],
  };
}

export function selectBestCapability(adapter: ProductAdapter, value: string): ProductCapability {
  const direct = directCapability(adapter, value);
  if (direct) return direct;
  const scored = adapter.capabilities.map((cap, index) => ({ cap, index, score: cap.planKeywords.reduce((sum, keyword) => sum + (value.includes(keyword) ? keyword.length : 0), 0) }));
  scored.sort((left, right) => right.score - left.score || right.cap.riskLevel.localeCompare(left.cap.riskLevel) || left.index - right.index);
  return scored[0]?.score > 0 ? scored[0].cap : adapter.capabilities[0];
}

export function maxRiskLevel(left: RiskLevel, right: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
  return order[Math.max(order.indexOf(left), order.indexOf(right))];
}

function chooseSource(adapter: ProductAdapter, preferApi?: boolean): ConfigSource {
  if (adapter.strategy === 'api-first' && preferApi !== false) return 'api';
  if (adapter.strategy === 'hybrid') return preferApi === false ? 'webui' : 'hybrid';
  return adapter.apiCatalogStatus === 'ready' ? 'webui' : 'api-discovery';
}

function buildEvidenceHints(adapter: ProductAdapter, section: string, source: ConfigSource): string[] {
  const menu = adapter.capabilities.find(item => item.collectSections.includes(section))?.menuPath.join(' > ');
  const hints = [`section=${section}`, `source=${source}`];
  if (menu) hints.push(`menu=${menu}`);
  if (adapter.apiCatalogStatus !== 'ready') hints.push('capture=webui_screenshot_and_network_discovery');
  else switch (adapter.product) {
    case 'HCI_SCP': hints.push('api_catalog=scp_openapi_v6.10/v6.1'); break;
    case 'IAG': hints.push('webui_catalog=iag_v1'); break;
    case 'ENDPOINT_SECURE': hints.push('webui_catalog=endpoint_secure_v1'); break;
    case 'NDR': hints.push('api_catalog=ndr_third_party_rest_v1'); break;
    default: assertNever(adapter.product);
  }
  return hints;
}

function taskFromRequirement(adapter: ProductAdapter, requirement: string, index: number): RequirementTask {
  const matched = selectBestCapability(adapter, requirement.toLowerCase());
  const explicitApproval = requiresApprovalForText(requirement);
  const riskLevel = maxRiskLevel(matched.riskLevel, explicitApproval.riskLevel);
  return {
    id: `task_${index + 1}`, product: adapter.product, requirement, capabilityId: matched.id,
    menuPath: matched.menuPath, apiEndpointCandidates: matched.apiEndpointCandidates, riskLevel,
    approvalRequired: matched.approvalRequired || explicitApproval.required || riskLevel === 'high' || riskLevel === 'critical',
    rationale: `${matched.title}; strategy=${adapter.strategy}; apiCatalog=${adapter.apiCatalogStatus}`,
  };
}

function directCapability(adapter: ProductAdapter, value: string): ProductCapability | undefined {
  const hasAny = (terms: string[]) => terms.some(term => value.includes(term));
  switch (adapter.product) {
    case 'HCI_SCP': return hasAny(['drs', 'ha/drs', 'high availability', 'resource pool']) ? adapter.capabilities.find(item => item.id === 'ha_drs') : undefined;
    case 'ENDPOINT_SECURE':
      if (hasAny(['deploy', 'deployment', 'install', 'rollout', '배포'])) return adapter.capabilities.find(item => item.id === 'agent_deployment');
      if (hasAny(['device control', 'usb', 'storage media', '저장매체'])) return adapter.capabilities.find(item => item.id === 'device_control');
      if (hasAny(['software control', 'unauthorized software', 'application control', 'app control', '소프트웨어'])) return adapter.capabilities.find(item => item.id === 'app_control');
      if (hasAny(['anti-virus', 'antivirus', 'malware', 'ransomware', 'engine update', 'scan', '검사', '엔진', '바이러스'])) return adapter.capabilities.find(item => item.id === 'protection_policy');
      return hasAny(['log', 'event', 'audit', '보안 이벤트', '로그', '감사']) ? adapter.capabilities.find(item => item.id === 'security_events') : undefined;
    case 'NDR': return hasAny(['soar', 'playbook', 'response action', 'isolate', 'quarantine']) ? adapter.capabilities.find(item => item.id === 'soar_response') : undefined;
    case 'IAG':
      if (hasAny(['ad ', 'ldap', 'authentication', 'auth source', 'sso'])) return adapter.capabilities.find(item => item.id === 'auth_source');
      if (hasAny(['incident analysis and response', 'log retention', 'retained at least 1 year', 'retained for less than 1 year', 'audit log', 'event log'])) return adapter.capabilities.find(item => item.id === 'log_validation');
      return hasAny(['network access contro', 'network access control', 'nac', 'unauthorized external access', 'unauthorized device', 'network access', 'access control']) ? adapter.capabilities.find(item => item.id === 'internet_policy') : undefined;
    default: return assertNever(adapter.product);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function assertNever(value: never): never {
  throw new Error(`Unexpected product: ${String(value)}`);
}
