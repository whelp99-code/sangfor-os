import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';

export const U032_MIGRATION_NAME = '20260716003200_u032_crm_scope_archive_owner_expand';
export const U032_MIGRATION_PATH = join(__dirname, '../../prisma/migrations', U032_MIGRATION_NAME, 'migration.sql');

export function dmmfModel(name: string) {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === name);
  if (!model) throw new Error(`DMMF model "${name}" not found — run prisma generate first`);
  return model;
}

export function dmmfField(modelName: string, fieldName: string) {
  const field = dmmfModel(modelName).fields.find((candidate) => candidate.name === fieldName);
  if (!field) throw new Error(`DMMF field "${modelName}.${fieldName}" not found — run prisma generate first`);
  return field;
}

export function dmmfIndex(modelName: string, fields: string[]) {
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
  const match = schema.match(new RegExp(`model\\s+${modelName}\\s+\\{([\\s\\S]*?)\\n\\}`, 'm'));
  if (!match) throw new Error(`Prisma schema model "${modelName}" not found`);
  return match[1].includes(`@@index([${fields.join(', ')}])`);
}

export function readU032Migration(): string {
  return readFileSync(U032_MIGRATION_PATH, 'utf8');
}

export function executableSql(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}
