import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assertAllowedColumn, RESTORE_TABLE_SPECS, restoreTableSpec } from './identifiers';

describe('U074 tenant restore static safety contract', () => {
  it('allowlists only the fixture scope and one CHILD_VIA_FK path', () => {
    expect(RESTORE_TABLE_SPECS.map((spec) => spec.table)).toEqual([
      'companies',
      'projects',
      'customers',
      'customer_activity_logs',
    ]);
    expect(RESTORE_TABLE_SPECS.at(-1)?.scopeClass).toBe('CHILD_VIA_FK');
  });

  it('rejects unregistered tables and columns before SQL construction', () => {
    expect(() => restoreTableSpec('_prisma_migrations')).toThrow(/not allowlisted/);
    expect(() => restoreTableSpec('users')).toThrow(/not allowlisted/);
    expect(() => assertAllowedColumn('customers', 'project_id; DROP TABLE customers')).toThrow(/not allowlisted/);
  });

  it('never uses Prisma migration history as an import ledger', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'import.ts'), 'utf8');
    expect(source).not.toContain('_prisma_migrations');
    expect(source).not.toContain('migration_name');
  });
});
