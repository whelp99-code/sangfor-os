import { Prisma } from '@prisma/client';

export const RLS_TENANT_SETTING = 'app.tenant_id';
export const RLS_COMPANY_SETTING = 'app.company_id';

export interface RlsContext {
  tenantId: string;
  companyId: string;
}

export interface RlsTablePolicy {
  table: string;
  scopeColumn: 'tenant_id' | 'company_id' | 'project_id';
  setting: typeof RLS_TENANT_SETTING | typeof RLS_COMPANY_SETTING;
}

export const RLS_BASELINE_POLICIES: RlsTablePolicy[] = [
  { table: 'companies', scopeColumn: 'tenant_id', setting: RLS_TENANT_SETTING },
  { table: 'user_company_roles', scopeColumn: 'company_id', setting: RLS_COMPANY_SETTING },
  { table: 'personas', scopeColumn: 'company_id', setting: RLS_COMPANY_SETTING },
  { table: 'customers', scopeColumn: 'project_id', setting: RLS_COMPANY_SETTING },
  { table: 'partners', scopeColumn: 'project_id', setting: RLS_COMPANY_SETTING },
  { table: 'opportunities', scopeColumn: 'project_id', setting: RLS_COMPANY_SETTING },
  { table: 'knowledge_documents', scopeColumn: 'project_id', setting: RLS_COMPANY_SETTING },
  { table: 'quotes', scopeColumn: 'company_id', setting: RLS_COMPANY_SETTING },
  { table: 'notification_events', scopeColumn: 'company_id', setting: RLS_COMPANY_SETTING },
];

export type RlsExecutor = {
  $executeRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
};

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function buildRlsPolicyStatements(policy: RlsTablePolicy): string[] {
  const table = quoteIdentifier(policy.table);
  const policyName = quoteIdentifier(`${policy.table}_scope_policy`);
  const column = quoteIdentifier(policy.scopeColumn);
  const predicate = `${column}::text = current_setting('${policy.setting}', false)`;

  return [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS ${policyName} ON ${table};`,
    [
      `CREATE POLICY ${policyName}`,
      `ON ${table}`,
      `USING (${predicate})`,
      `WITH CHECK (${predicate});`,
    ].join('\n'),
  ];
}

export function buildAllRlsPolicyStatements(policies: RlsTablePolicy[] = RLS_BASELINE_POLICIES): string[] {
  return policies.flatMap(buildRlsPolicyStatements);
}

export async function setRlsContext(executor: RlsExecutor, context: RlsContext): Promise<void> {
  await executor.$executeRaw(Prisma.sql`SELECT set_config(${RLS_TENANT_SETTING}, ${context.tenantId}, true)`);
  await executor.$executeRaw(Prisma.sql`SELECT set_config(${RLS_COMPANY_SETTING}, ${context.companyId}, true)`);
}
