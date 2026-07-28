import { execFileSync } from 'node:child_process';
import { nowId, type RiskLevel } from '@sangfor/shared';
import type { ExcelBasedChangePlan, ExcelImportResult, ExcelRequirementRow, ExcelWorkPlanItem, MappedRequirement, RequirementMappingResult, RequirementProductCode } from './adapter-types.js';
import { getProductAdapter, maxRiskLevel, selectBestCapability } from './adapter-catalog.js';

const DEFAULT_EVIDENCE_NEEDS = ['current setting screenshot', 'audit/checklist row reference', 'before/after comparison candidate'];

interface ParsedSheet { name: string; rows: Map<number, Record<string, string>>; }
interface ParsedWorkbook { sheets: ParsedSheet[]; }

interface ExcelRowNormalizeInput {
  rowNumber: number;
  no?: string;
  category?: string;
  solution?: string;
  item?: string;
  specificDetails?: string;
  inspectionResult: Record<string, string>;
  resultScore?: number;
  resultRaw?: string;
  reason?: string;
  assessmentCriteria?: string;
  remark?: string;
}

export function importExcelRequirementList(input: { filePath: string; sheetName?: string; prioritizeOnly?: boolean }): ExcelImportResult {
  const workbook = readXlsxWorkbook(input.filePath);
  const sheet = input.sheetName ? workbook.sheets.find(item => item.name === input.sheetName) : workbook.sheets[0];
  if (!sheet) throw new Error(`Excel sheet not found: ${input.sheetName ?? '<first sheet>'}`);
  const headerRow = findChecklistHeaderRow(sheet.rows);
  if (!headerRow) throw new Error('Checklist header row not found. Expected columns such as No, Category, Soultion/Solution, Item, Specific details.');
  const header = mergeHeaderRows(sheet.rows.get(headerRow - 1) ?? {}, sheet.rows.get(headerRow) ?? {});
  const rows: ExcelRequirementRow[] = [];
  for (const [rowNumber, cells] of [...sheet.rows.entries()].sort(([left], [right]) => left - right)) {
    if (rowNumber <= headerRow) continue;
    const no = cellByHeader(cells, header, ['No']);
    const category = cellByHeader(cells, header, ['Category']);
    const solution = cellByHeader(cells, header, ['Soultion', 'Solution']);
    const item = cellByHeader(cells, header, ['Item']);
    const specificDetails = cellByHeader(cells, header, ['Specific details', 'Specific detail']);
    const reason = cellByHeader(cells, header, ['Reason for Inspection Results', 'Reason']);
    const assessmentCriteria = cellByHeader(cells, header, ['Assessment Criteria']) ?? cells.N;
    const remark = cellByHeader(cells, header, ['Remark']) ?? cells.O;
    const resultRaw = cellByHeader(cells, header, ['Results']);
    if (![no, category, solution, item, specificDetails, reason, assessmentCriteria, remark].some(Boolean)) continue;
    const row = normalizeExcelRow({
      rowNumber, no, category, solution, item, specificDetails,
      inspectionResult: inspectionResultsFromRow(cells, header),
      resultScore: parseOptionalNumber(resultRaw), resultRaw, reason, assessmentCriteria, remark,
    });
    if (!input.prioritizeOnly || row.priority !== 'low') rows.push(row);
  }
  return {
    id: nowId('excel_import'), filePath: input.filePath, sheetName: sheet.name, headerRow, rows,
    summary: {
      totalRows: rows.length,
      prioritizedRows: rows.filter(row => row.priority !== 'low').length,
      highPriorityRows: rows.filter(row => row.priority === 'high').length,
    },
  };
}

export function mapRequirementsToProducts(input: { rows: ExcelRequirementRow[] }): RequirementMappingResult {
  const rows = input.rows.map(mapExcelRequirement);
  const summary = rows.reduce<Record<RequirementProductCode, number>>((counts, row) => {
    counts[row.mappedProduct] = (counts[row.mappedProduct] ?? 0) + 1;
    return counts;
  }, { HCI_SCP: 0, IAG: 0, ENDPOINT_SECURE: 0, NDR: 0, external_or_manual: 0 });
  return { id: nowId('requirement_map'), rows, summary };
}

export function generateExcelBasedChangePlan(input: { filePath?: string; rows?: ExcelRequirementRow[]; sheetName?: string; prioritizeOnly?: boolean }): ExcelBasedChangePlan {
  const imported = input.rows
    ? { rows: input.rows }
    : importExcelRequirementList({ filePath: requiredFilePath(input.filePath), sheetName: input.sheetName, prioritizeOnly: input.prioritizeOnly ?? true });
  const mapped = mapRequirementsToProducts({ rows: imported.rows });
  const executableRows = mapped.rows.filter(row => row.mappedProduct !== 'external_or_manual');
  return {
    id: nowId('excel_plan'), source: 'excel', product: 'MULTI_PRODUCT', strategy: 'excel-driven-dry-run',
    summary: `Generated Excel-driven dry-run plan for ${mapped.rows.length} checklist row(s); ${executableRows.length} mapped to Sangfor product consoles.`,
    workPlan: mapped.rows.map(toExcelWorkPlanItem), tasks: mapped.rows, dryRunRequired: true, mutationPerformed: false,
    stoppedBefore: ['Save', 'Apply', 'Delete', 'Commit', 'Policy Enable', 'Agent Deployment', 'SOAR Response Action'],
    executionGates: [
      'sessionId is required for Playwright console dry-run.',
      'Local Chrome must expose a CDP endpoint for existing-browser operation.',
      'Dry-run may navigate and collect screenshots, but must not click Save/Apply/Delete or execute response actions.',
      'Rows mapped to external_or_manual are reported for manual/non-Sangfor handling.',
    ],
    manualReviewRows: mapped.rows.filter(row => row.mappedProduct === 'external_or_manual').map(row => row.rowId),
  };
}

function readXlsxWorkbook(filePath: string): ParsedWorkbook {
  if (!filePath.toLowerCase().endsWith('.xlsx')) throw new Error(`Expected .xlsx file: ${filePath}`);
  const entries = unzipList(filePath);
  const sharedStrings = entries.includes('xl/sharedStrings.xml') ? parseSharedStrings(unzipText(filePath, 'xl/sharedStrings.xml')) : [];
  const relationships = parseWorkbookRelationships(unzipText(filePath, 'xl/_rels/workbook.xml.rels'));
  const sheets = parseWorkbookSheets(unzipText(filePath, 'xl/workbook.xml'), relationships).map(sheet => ({
    name: sheet.name,
    rows: parseWorksheetRows(unzipText(filePath, sheet.path), sharedStrings),
  }));
  return { sheets };
}

function unzipList(filePath: string): string[] {
  return execFileSync('unzip', ['-Z1', filePath], { encoding: 'utf8' }).split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function unzipText(filePath: string, entry: string): string {
  return execFileSync('unzip', ['-p', filePath, entry], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => xmlText(match[1]));
}

function parseWorkbookRelationships(xml: string): Record<string, string> {
  const relationships: Record<string, string> = {};
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = attr(match[1], 'Id');
    const target = attr(match[1], 'Target');
    if (id && target) relationships[id] = target.startsWith('xl/') ? target : `xl/${target.replace(/^\//, '')}`;
  }
  return relationships;
}

function parseWorkbookSheets(xml: string, relationships: Record<string, string>): Array<{ name: string; path: string }> {
  return [...xml.matchAll(/<sheet\b([^>]*)\/>/g)].map(match => {
    const name = attr(match[1], 'name') ?? 'Sheet';
    const relationshipId = attr(match[1], 'r:id');
    const path = relationshipId ? relationships[relationshipId] : undefined;
    if (!path) throw new Error(`Workbook sheet relationship not found: ${name}`);
    return { name, path };
  });
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): Map<number, Record<string, string>> {
  const rows = new Map<number, Record<string, string>>();
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(attr(rowMatch[1], 'r'));
    if (!Number.isFinite(rowNumber)) continue;
    const row: Record<string, string> = {};
    for (const cellMatch of parseCells(rowMatch[2])) {
      const ref = attr(cellMatch.attrs, 'r');
      const column = ref?.match(/[A-Z]+/)?.[0];
      if (!column) continue;
      const type = attr(cellMatch.attrs, 't');
      const valueMatch = cellMatch.body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      let value = valueMatch ? decodeXml(valueMatch[1]) : xmlText(cellMatch.body);
      if (type === 's' && value !== '') value = sharedStrings[Number(value)] ?? value;
      row[column] = normalizeWhitespace(value);
    }
    rows.set(rowNumber, row);
  }
  return rows;
}

function parseCells(rowXml: string): Array<{ attrs: string; body: string }> {
  return [...rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(match => ({ attrs: match[1], body: match[2] ?? '' }));
}

function findChecklistHeaderRow(rows: Map<number, Record<string, string>>): number | undefined {
  for (const [rowNumber, row] of rows) {
    const values = Object.values(row).map(normalizeHeader);
    if (values.includes('no') && values.includes('category') && values.includes('item') && values.includes('specificdetails')) return rowNumber;
  }
  return undefined;
}

function mergeHeaderRows(parent: Record<string, string>, header: Record<string, string>): Record<string, string> {
  return Object.fromEntries(unique([...Object.keys(parent), ...Object.keys(header)]).map(column => [column, header[column] || parent[column] || '']));
}

function cellByHeader(cells: Record<string, string>, header: Record<string, string>, names: string[]): string | undefined {
  const wanted = names.map(normalizeHeader);
  const column = Object.entries(header).find(([, value]) => wanted.includes(normalizeHeader(value)))?.[0];
  return (column ? cells[column] : undefined) || undefined;
}

function inspectionResultsFromRow(cells: Record<string, string>, header: Record<string, string>): Record<string, string> {
  const ignored = new Set(['no', 'category', 'soultion', 'solution', 'item', 'specificdetails', 'results', 'reasonforinspectionresults', 'assessmentcriteria', 'remark']);
  const result: Record<string, string> = {};
  for (const [column, headerValue] of Object.entries(header)) {
    const value = cells[column];
    if (headerValue && !ignored.has(normalizeHeader(headerValue)) && value) result[headerValue] = value;
  }
  return result;
}

function normalizeExcelRow(input: ExcelRowNormalizeInput): ExcelRequirementRow {
  const inspectionValues = Object.values(input.inspectionResult);
  const partial = inspectionValues.some(value => value.includes('△'));
  const lowScore = typeof input.resultScore === 'number' && input.resultScore < 1;
  const priority: ExcelRequirementRow['priority'] = partial || lowScore ? 'high' : input.reason?.trim() ? 'medium' : 'low';
  const requirement = [input.solution, input.item, input.specificDetails].filter(Boolean).join(' | ');
  const currentGap = input.reason || (partial ? `Inspection result includes partial status: ${inspectionValues.join(', ')}` : '');
  const targetControl = input.assessmentCriteria || input.specificDetails || requirement;
  return {
    rowNumber: input.rowNumber, rowId: `excel_row_${input.rowNumber}`, no: input.no, category: input.category,
    solution: input.solution, item: input.item, specificDetails: input.specificDetails,
    inspectionResult: input.inspectionResult, resultScore: input.resultScore, resultRaw: input.resultRaw,
    reason: input.reason, assessmentCriteria: input.assessmentCriteria, remark: input.remark,
    requirement, evidenceNeed: evidenceNeedsForText(`${requirement} ${targetControl}`), targetControl, currentGap, priority,
  };
}

function mapExcelRequirement(row: ExcelRequirementRow): MappedRequirement {
  const text = `${row.category ?? ''} ${row.solution ?? ''} ${row.item ?? ''} ${row.specificDetails ?? ''} ${row.reason ?? ''}`.toLowerCase();
  const mappedProduct = classifyRequirementProduct(text);
  if (mappedProduct === 'external_or_manual') {
    return { ...row, mappedProduct, mappingReason: 'No direct Sangfor target product mapping found or the control references a non-Sangfor solution.', menuPath: [], apiEndpointCandidates: [], riskLevel: row.priority === 'high' ? 'medium' : 'low', approvalRequired: false, actualApplySupported: false };
  }
  const capability = selectBestCapability(getProductAdapter(mappedProduct), text);
  const riskLevel: RiskLevel = maxRiskLevel(capability.riskLevel, row.priority === 'high' ? 'medium' : 'low');
  return { ...row, mappedProduct, mappingReason: `${mappedProduct} matched from checklist keywords; capability=${capability.id}`, capabilityId: capability.id, menuPath: capability.menuPath, apiEndpointCandidates: capability.apiEndpointCandidates, riskLevel, approvalRequired: capability.approvalRequired || riskLevel === 'high' || riskLevel === 'critical', actualApplySupported: false };
}

function toExcelWorkPlanItem(row: MappedRequirement): ExcelWorkPlanItem {
  const manual = row.mappedProduct === 'external_or_manual';
  const menu = manual ? 'Manual / External evidence' : row.menuPath.join(' > ');
  const setting = row.capabilityId ? settingLabel(row.capabilityId) : row.solution || row.item || row.requirement;
  return {
    requestId: row.no ? `REQ-${row.no}` : row.rowId, excelRowId: row.rowId, no: row.no, product: row.mappedProduct,
    menu, setting, description: row.requirement,
    currentGap: row.currentGap || 'No explicit gap text; verify checklist result and current console state.',
    target: row.targetControl, evidence: row.evidenceNeed,
    dryRunAction: manual ? 'Do not access Sangfor console. Collect external/manual evidence and attach to review.' : `Open ${row.mappedProduct} console, navigate to ${menu}, capture current configuration evidence, stop before Save/Apply.`,
    status: manual ? 'manual_review_required' : 'dry_run_ready', approvalRequired: row.approvalRequired, actualApplySupported: false,
  };
}

function classifyRequirementProduct(text: string): RequirementProductCode {
  if (hasAny(text, ['crowdstrike', 'alyac', 'anti-spam', 'spamout', 'webmail', 'data loss prevention', 'dlp', 'backup management', 'backup data', 'backup objective', 'backup objectives', 'recovery test', 'disaster recovery', 'firewall config'])) return 'external_or_manual';
  if (hasAny(text, ['hci/scp', 'hci', 'scp', 'vm ', 'virtual machine', 'resource pool', 'ha/drs', 'drs', 'storage network', 'ntp', 'license mismatch', 'node'])) return 'HCI_SCP';
  if (hasAny(text, ['software control', 'device control', 'unauthorized software', 'storage media', 'anti-virus', 'antivirus', 'edr', 'epp', 'malware', 'ransomware', 'agent', 'endpoint', 'engine update', 'virus'])) return 'ENDPOINT_SECURE';
  if (hasAny(text, ['log retention', 'retained at least 1 year', 'retained for less than 1 year', 'network access contro', 'network access control', 'nac', 'internet access', 'vpn', 'f/w', 'firewall', 'dmz', 'auth', 'ldap', 'ad ', 'url', 'application policy', 'access policy'])) return 'IAG';
  if (hasAny(text, ['log management', 'security monitoring', 'siem', 'security system logs', 'event source', 'incident', 'alert', 'soar', 'sensor', 'dashboard', 'response', 'playbook'])) return 'NDR';
  return 'external_or_manual';
}

function settingLabel(capabilityId: string): string {
  const labels: Record<string, string> = {
    resource_inventory: 'Resource/alert/license inventory check', ha_drs: 'HA/DRS/availability configuration check', vm_resource: 'VM resource and power-state check', license_alert: 'License/NTP/alert validation', auth_source: 'Authentication source and policy check', internet_policy: 'Internet/URL/application access policy check', log_validation: 'Log retention and audit validation', endpoint_inventory: 'Endpoint/agent inventory check', protection_policy: 'Anti-malware scan and protection policy check', app_control: 'Software/application control policy check', device_control: 'USB/device control policy check', security_events: 'Security event logs and audit trail', syslog_export: 'Syslog/SIEM log forwarding check', agent_deployment: 'Agent deployment/self-protection check', event_source: 'Event source/sensor integration check', incident_alert: 'Incident/alert/dashboard validation', soar_response: 'SOAR/playbook response policy check',
  };
  return labels[capabilityId] ?? capabilityId;
}

function evidenceNeedsForText(text: string): string[] {
  const value = text.toLowerCase();
  const needs = [...DEFAULT_EVIDENCE_NEEDS];
  if (hasAny(value, ['log', 'event'])) needs.push('log retention/export evidence');
  if (hasAny(value, ['agent', 'endpoint', 'edr', 'antivirus'])) needs.push('endpoint agent inventory and update status');
  if (hasAny(value, ['policy', 'url', 'application', 'auth'])) needs.push('policy/auth configuration screenshot');
  if (hasAny(value, ['incident', 'alert', 'soar'])) needs.push('incident/alert/playbook evidence');
  return unique(needs);
}

function attr(xmlAttrs: string, name: string): string | undefined {
  const match = xmlAttrs.match(new RegExp(`\\b${name.replace(':', String.raw`\:`)}="([^"]*)"`));
  return match ? decodeXml(match[1]) : undefined;
}

function xmlText(xml: string): string { return normalizeWhitespace(decodeXml(xml.replace(/<[^>]+>/g, ' '))); }
function normalizeWhitespace(value: string): string { return value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').trim(); }
function normalizeHeader(value: string): string { return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ''); }
function hasAny(value: string, terms: string[]): boolean { return terms.some(term => value.includes(term)); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function requiredFilePath(filePath?: string): string { if (!filePath) throw new Error('filePath is required when rows are not provided.'); return filePath; }
function parseOptionalNumber(value?: string): number | undefined { const parsed = Number(value); return value && Number.isFinite(parsed) ? parsed : undefined; }

function decodeXml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}
