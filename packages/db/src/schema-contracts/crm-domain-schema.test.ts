import { describe, expect, it } from 'vitest';

import { dmmfField, dmmfIndex, dmmfModel, executableSql, readU032Migration } from './helpers';

function expectScalar(model: string, field: string, type: string, required: boolean, dbName: string) {
  const candidate = dmmfField(model, field);
  expect(candidate.kind).toBe('scalar');
  expect(candidate.type).toBe(type);
  expect(candidate.isRequired).toBe(required);
  expect(candidate.dbName).toBe(dbName);
  return candidate;
}

describe('U032 CRM scope, archive, and canonical owner DMMF contract', () => {
  it('keeps Customer project-scoped and adds archive state only', () => {
    expectScalar('Customer', 'archivedAt', 'DateTime', false, 'archived_at');
    expect(dmmfField('Customer', 'projectId').dbName).toBe('project_id');
    expect(() => dmmfField('Customer', 'ownerAssignmentId')).toThrow(/not found/);
    expect(() => dmmfField('Customer', 'ownershipRevision')).toThrow(/not found/);
    expect(dmmfIndex('Customer', ['projectId', 'archivedAt', 'updatedAt', 'id'])).toBe(true);
    expect(dmmfIndex('Customer', ['ownerAssignmentId', 'ownershipRevision'])).toBe(false);
  });

  it('makes only Opportunity and WorkTask canonical operational-owner targets', () => {
    for (const model of ['Opportunity', 'WorkTask']) {
      expectScalar(model, 'ownerAssignmentId', 'String', false, 'owner_assignment_id');
      const revision = expectScalar(model, 'ownershipRevision', 'Int', true, 'ownership_revision');
      expect(revision.default).toBe(0);
      expect(dmmfIndex(model, ['projectId', 'archivedAt', 'updatedAt', 'id'])).toBe(true);
      expect(dmmfIndex(model, ['ownerAssignmentId', 'ownershipRevision'])).toBe(true);
      const ownerRelation = dmmfField(model, 'ownerAssignment');
      expect(ownerRelation.kind).toBe('object');
      expect(ownerRelation.type).toBe('UserCompanyRole');
      expect(ownerRelation.relationName).toBe(`${model}OwnerAssignment`);
    }

    expect(dmmfField('Opportunity', 'ownerId').type).toBe('String');
    expect(dmmfField('Opportunity', 'owner').type).toBe('User');
    expect(dmmfField('WorkTask', 'assigneeName').type).toBe('String');
    expect(dmmfField('UserCompanyRole', 'ownedOpportunities').relationName).toBe('OpportunityOwnerAssignment');
    expect(dmmfField('UserCompanyRole', 'ownedWorkTasks').relationName).toBe('WorkTaskOwnerAssignment');
  });

  it('uses the existing U010 Project.company ownership bridge without redundant CRM scope columns', () => {
    const company = dmmfField('Project', 'company');
    expect(company.type).toBe('Company');
    expect(company.relationFromFields).toEqual(['companyId']);
    for (const model of ['Customer', 'Opportunity', 'WorkTask']) {
      expect(() => dmmfField(model, 'companyId')).toThrow(/not found/);
      expect(() => dmmfField(model, 'tenantId')).toThrow(/not found/);
    }
  });
});

describe('U032 expand migration safety and owner-guard SQL contract', () => {
  it('contains only additive CRM schema changes and matching index DDL', () => {
    const sql = readU032Migration();
    const executable = executableSql(sql);
    expect(executable).not.toMatch(/(?:^|;)\s*(?:INSERT\s+INTO|UPDATE\s+["a-z_]+|DELETE\s+FROM)\b/im);
    expect(executable).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|INDEX|CONSTRAINT|FUNCTION|TRIGGER)\b/i);
    expect(executable).not.toMatch(/\bSET\s+NOT\s+NULL\b/i);
    expect(executable).not.toMatch(/\bVALIDATE\s+CONSTRAINT\b/i);
    expect(sql).toMatch(/ALTER TABLE "customers" ADD COLUMN "archived_at" TIMESTAMP\(3\);/);
    expect(sql).toMatch(/ALTER TABLE "opportunities" ADD COLUMN "owner_assignment_id" TEXT;/);
    expect(sql).toMatch(/ALTER TABLE "opportunities" ADD COLUMN "ownership_revision" INTEGER NOT NULL DEFAULT 0;/);
    expect(sql).toMatch(/ALTER TABLE "work_tasks" ADD COLUMN "owner_assignment_id" TEXT;/);
    expect(sql).toMatch(/ALTER TABLE "work_tasks" ADD COLUMN "ownership_revision" INTEGER NOT NULL DEFAULT 0;/);
    for (const index of [
      'customers_project_id_archived_at_updated_at_id_idx',
      'opportunities_project_id_archived_at_updated_at_id_idx',
      'work_tasks_project_id_archived_at_updated_at_id_idx',
      'opportunities_owner_assignment_id_ownership_revision_idx',
      'work_tasks_owner_assignment_id_ownership_revision_idx',
    ]) expect(sql).toMatch(new RegExp(`CREATE INDEX "${index}"`));
    expect(sql).not.toMatch(/customers_owner_assignment_id|customer.*owner_scope_guard/i);
  });

  it('installs exactly one named scope guard per mutable owner table', () => {
    const sql = readU032Migration();
    for (const [table, fn, trigger] of [
      ['opportunities', 'opportunities_owner_scope_guard_fn', 'opportunities_owner_scope_guard_trg'],
      ['work_tasks', 'work_tasks_owner_scope_guard_fn', 'work_tasks_owner_scope_guard_trg'],
    ] as const) {
      expect((sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)`, 'g')) ?? []).length).toBe(1);
      expect((sql.match(new RegExp(`CREATE TRIGGER ${trigger}\\s+BEFORE INSERT OR UPDATE ON ${table}`, 'g')) ?? []).length).toBe(1);
    }
    expect(sql).toMatch(/role\.status = 'active'/);
    expect(sql).toMatch(/role\.expires_at IS NULL OR role\.expires_at > CURRENT_TIMESTAMP/);
    expect(sql).toMatch(/role\.revoked_at IS NULL/);
    expect(sql).toMatch(/assignment_company_id IS DISTINCT FROM project_company_id/);
    expect(sql).toMatch(/ownership_revision IS DISTINCT FROM OLD\.ownership_revision \+ 1/);
    expect(sql).toMatch(/ownership_revision changed without a corresponding owner_assignment_id change/);
  });
});
