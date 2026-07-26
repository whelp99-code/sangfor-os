import { Prisma } from '@prisma/client';

import { MODEL_SCOPE_INVENTORY, type ScopeInventoryEntry } from './scope-inventory';

export const SCOPE_RLS_POLICY_PREFIX = 'sangfor_scope_';

type DmmfField = {
  name: string;
  dbName?: string | null;
  kind: string;
};

type DmmfModel = {
  name: string;
  dbName?: string | null;
  fields: readonly DmmfField[];
};

export type ScopeRlsPolicy = {
  model: string;
  table: string;
  policyName: string;
  predicate: string;
  category: ScopeInventoryEntry['category'];
};

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function scalarColumn(model: DmmfModel, fieldName: string): string | null {
  const field = model.fields.find((candidate) => candidate.kind === 'scalar' && candidate.name === fieldName);
  return field ? field.dbName ?? field.name : null;
}

function companyPredicate(table: string, companyColumn: string): string {
  return [
    `${quoteIdentifier(table)}.${quoteIdentifier(companyColumn)} = current_setting('app.company_id', true)`,
    `EXISTS (SELECT 1 FROM "companies" AS scope_company WHERE scope_company."id" = ${quoteIdentifier(table)}.${quoteIdentifier(companyColumn)} AND scope_company."tenant_id" = current_setting('app.tenant_id', true))`,
  ].join(' AND ');
}

function projectPredicate(table: string, projectColumn: string): string {
  return [
    `${quoteIdentifier(table)}.${quoteIdentifier(projectColumn)} = current_setting('app.project_id', true)`,
    `EXISTS (SELECT 1 FROM "projects" AS scope_project JOIN "companies" AS scope_company ON scope_company."id" = scope_project."company_id" WHERE scope_project."id" = ${quoteIdentifier(table)}.${quoteIdentifier(projectColumn)} AND scope_project."company_id" = current_setting('app.company_id', true) AND scope_company."tenant_id" = current_setting('app.tenant_id', true))`,
  ].join(' AND ');
}

function rootPredicate(entry: ScopeInventoryEntry, model: DmmfModel, table: string): string {
  if (entry.model === 'Tenant') {
    return `${quoteIdentifier(table)}."id" = current_setting('app.tenant_id', true)`;
  }
  if (entry.model === 'Company') {
    return `${quoteIdentifier(table)}."id" = current_setting('app.company_id', true) AND ${quoteIdentifier(table)}."tenant_id" = current_setting('app.tenant_id', true)`;
  }
  if (entry.model === 'Project') {
    return `${quoteIdentifier(table)}."id" = current_setting('app.project_id', true) AND ${companyPredicate(table, 'company_id')}`;
  }

  if (entry.category === 'PROJECT_ROOT') {
    const projectColumn = scalarColumn(model, 'projectId');
    if (projectColumn) return projectPredicate(table, projectColumn);
  }
  if (entry.category === 'COMPANY_ROOT' || entry.category === 'COMPANY_DIRECT') {
    const companyColumn = scalarColumn(model, 'companyId');
    if (companyColumn) return companyPredicate(table, companyColumn);
  }
  if (entry.category === 'TENANT_ROOT') {
    const tenantColumn = scalarColumn(model, 'tenantId');
    if (tenantColumn) {
      return `${quoteIdentifier(table)}.${quoteIdentifier(tenantColumn)} = current_setting('app.tenant_id', true)`;
    }
  }

  return 'false';
}

export function buildScopeRlsPolicies(
  models: readonly DmmfModel[] = Prisma.dmmf.datamodel.models,
  inventory: Record<string, ScopeInventoryEntry> = MODEL_SCOPE_INVENTORY,
): ScopeRlsPolicy[] {
  const modelByName = new Map(models.map((model) => [model.name, model]));

  return Object.values(inventory)
    .filter((entry) => entry.category !== 'GLOBAL_SHARED')
    .map((entry) => {
      const model = modelByName.get(entry.model);
      if (!model) throw new Error(`Scope inventory model is missing from DMMF: ${entry.model}`);
      const table = model.dbName ?? model.name;
      const policyName = `${SCOPE_RLS_POLICY_PREFIX}${table}`;
      if (policyName.length > 63) throw new Error(`RLS policy name exceeds PostgreSQL identifier limit: ${policyName}`);

      if (entry.category === 'CHILD_VIA_FK') {
        const parent = modelByName.get(entry.parentModel);
        if (!parent) throw new Error(`Scope parent model is missing from DMMF: ${entry.parentModel}`);
        const fkColumn = scalarColumn(model, entry.scalarFkField);
        if (!fkColumn) throw new Error(`Scope FK is missing from DMMF: ${entry.model}.${entry.scalarFkField}`);
        const parentTable = parent.dbName ?? parent.name;
        return {
          model: entry.model,
          table,
          policyName,
          category: entry.category,
          predicate: `EXISTS (SELECT 1 FROM ${quoteIdentifier(parentTable)} AS scope_parent WHERE scope_parent."id" = ${quoteIdentifier(table)}.${quoteIdentifier(fkColumn)})`,
        };
      }

      return {
        model: entry.model,
        table,
        policyName,
        category: entry.category,
        predicate: rootPredicate(entry, model, table),
      };
    })
    .sort((left, right) => left.table.localeCompare(right.table));
}
