import { Prisma } from '@prisma/client';

export type RestoreTableSpec = {
  table: string;
  model: 'Company' | 'Project' | 'Customer' | 'CustomerActivityLog';
  scopeClass: 'COMPANY_ROOT' | 'PROJECT_ROOT' | 'CHILD_VIA_FK';
  scopeColumn: 'tenant_id' | 'company_id' | 'project_id' | 'customer_id';
  parentTable?: string;
  parentColumn?: string;
};

export const RESTORE_TABLE_SPECS: readonly RestoreTableSpec[] = Object.freeze([
  { table: 'companies', model: 'Company', scopeClass: 'COMPANY_ROOT', scopeColumn: 'tenant_id' },
  { table: 'projects', model: 'Project', scopeClass: 'PROJECT_ROOT', scopeColumn: 'company_id', parentTable: 'companies', parentColumn: 'company_id' },
  { table: 'customers', model: 'Customer', scopeClass: 'PROJECT_ROOT', scopeColumn: 'project_id', parentTable: 'projects', parentColumn: 'project_id' },
  { table: 'customer_activity_logs', model: 'CustomerActivityLog', scopeClass: 'CHILD_VIA_FK', scopeColumn: 'customer_id', parentTable: 'customers', parentColumn: 'customer_id' },
]);

const SPEC_BY_TABLE = new Map(RESTORE_TABLE_SPECS.map((spec) => [spec.table, spec]));
const MODEL_BY_NAME = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

export function restoreTableSpec(table: string): RestoreTableSpec {
  const spec = SPEC_BY_TABLE.get(table);
  if (!spec) throw new Error(`Restore table is not allowlisted: ${table}`);
  return spec;
}

export function assertAllowedColumn(table: string, column: string): void {
  const spec = restoreTableSpec(table);
  const model = MODEL_BY_NAME.get(spec.model);
  const allowed = model?.fields.some((field) => field.kind === 'scalar' && (field.dbName ?? field.name) === column);
  if (!allowed) throw new Error(`Restore column is not allowlisted: ${table}.${column}`);
}

export function quoteAllowedTable(table: string): string {
  restoreTableSpec(table);
  return `"${table}"`;
}

export function quoteAllowedColumn(table: string, column: string): string {
  assertAllowedColumn(table, column);
  return `"${column}"`;
}

