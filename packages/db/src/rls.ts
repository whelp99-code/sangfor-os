import { Prisma } from '@prisma/client';

export const RLS_TENANT_SETTING = 'app.tenant_id';
export const RLS_COMPANY_SETTING = 'app.company_id';
// U016/DB-01: project-root tables must compare their project_id column against this setting,
// never against RLS_COMPANY_SETTING — that mismatch was exactly the pre-U016 bug (see
// RLS_BASELINE_POLICIES below, and the U016 RED baseline evidence at
// rls-baseline-red.log) this pilot fixes at the source.
export const RLS_PROJECT_SETTING = 'app.project_id';

export interface RlsContext {
  tenantId: string;
  companyId: string;
}

export interface RlsTablePolicy {
  table: string;
  scopeColumn: 'tenant_id' | 'company_id' | 'project_id';
  setting: typeof RLS_TENANT_SETTING | typeof RLS_COMPANY_SETTING | typeof RLS_PROJECT_SETTING;
}

// U016/DB-01: fixed the pre-existing bug where every project_id-scoped table compared its
// project_id column against app.company_id instead of app.project_id (a company-scoped session
// could read/write any project's rows in that company — see rls-baseline-red.log for the RED
// proof this predicate previously read `"project_id"::text = current_setting('app.company_id', ...)`).
// This generic single-column builder remains for the pre-existing non-pilot tables listed here;
// the six-table U016 pilot below is instead expressed as exact hand-authored policies
// (RLS_PILOT_POLICIES) because their correct predicate needs a parent-hierarchy EXISTS check that
// this single-column-equality generator cannot express.
export const RLS_BASELINE_POLICIES: RlsTablePolicy[] = [
  { table: 'companies', scopeColumn: 'tenant_id', setting: RLS_TENANT_SETTING },
  { table: 'user_company_roles', scopeColumn: 'company_id', setting: RLS_COMPANY_SETTING },
  { table: 'personas', scopeColumn: 'company_id', setting: RLS_COMPANY_SETTING },
  { table: 'customers', scopeColumn: 'project_id', setting: RLS_PROJECT_SETTING },
  { table: 'partners', scopeColumn: 'project_id', setting: RLS_PROJECT_SETTING },
  { table: 'opportunities', scopeColumn: 'project_id', setting: RLS_PROJECT_SETTING },
  { table: 'knowledge_documents', scopeColumn: 'project_id', setting: RLS_PROJECT_SETTING },
  { table: 'quotes', scopeColumn: 'company_id', setting: RLS_COMPANY_SETTING },
  { table: 'notification_events', scopeColumn: 'company_id', setting: RLS_COMPANY_SETTING },
];

/**
 * U016/DB-01 — the six exact named policies the `20260715160000_rls_pilot` migration hand-authors
 * (a single-column EXISTS-free predicate like RLS_BASELINE_POLICIES above cannot express the
 * parent Project/Company/Tenant chain these need). This array is the source-of-truth documentation
 * consumed by rls.test.ts (shape/no-USING-true assertions) and rls.integration.test.ts /
 * db:contract's rls-pilot suite (which independently re-introspects `pg_policies` against the real
 * migration SQL) — the migration.sql text is the actual applied DDL and is not generated from this
 * array at runtime.
 */
export interface RlsPilotPolicy {
  table: 'companies' | 'projects' | 'user_company_roles' | 'project_members' | 'customers' | 'opportunities';
  policyName: string;
  predicate: string;
}

export const RLS_PILOT_TABLES = Object.freeze([
  'companies',
  'projects',
  'user_company_roles',
  'project_members',
  'customers',
  'opportunities',
] as const);

const COMPANY_CHAIN = `EXISTS (\n      SELECT 1 FROM companies\n      WHERE companies.id = projects.company_id\n        AND companies.tenant_id = current_setting('${RLS_TENANT_SETTING}', true)\n    )`;

function projectChain(table: 'project_members' | 'customers' | 'opportunities'): string {
  return `EXISTS (\n      SELECT 1 FROM projects\n      JOIN companies ON companies.id = projects.company_id\n      WHERE projects.id = ${table}.project_id\n        AND projects.company_id = current_setting('${RLS_COMPANY_SETTING}', true)\n        AND companies.tenant_id = current_setting('${RLS_TENANT_SETTING}', true)\n    )`;
}

export const RLS_PILOT_POLICIES: readonly RlsPilotPolicy[] = Object.freeze([
  {
    table: 'companies',
    policyName: 'sangfor_scope_companies',
    predicate: `tenant_id = current_setting('${RLS_TENANT_SETTING}', true) AND id = current_setting('${RLS_COMPANY_SETTING}', true)`,
  },
  {
    table: 'projects',
    policyName: 'sangfor_scope_projects',
    predicate: `company_id = current_setting('${RLS_COMPANY_SETTING}', true) AND id = current_setting('${RLS_PROJECT_SETTING}', true) AND ${COMPANY_CHAIN}`,
  },
  {
    table: 'user_company_roles',
    policyName: 'sangfor_scope_user_company_roles',
    predicate: `company_id = current_setting('${RLS_COMPANY_SETTING}', true)`,
  },
  {
    table: 'project_members',
    policyName: 'sangfor_scope_project_members',
    predicate: `project_id = current_setting('${RLS_PROJECT_SETTING}', true) AND ${projectChain('project_members')}`,
  },
  {
    table: 'customers',
    policyName: 'sangfor_scope_customers',
    predicate: `project_id = current_setting('${RLS_PROJECT_SETTING}', true) AND ${projectChain('customers')}`,
  },
  {
    table: 'opportunities',
    policyName: 'sangfor_scope_opportunities',
    predicate: `project_id = current_setting('${RLS_PROJECT_SETTING}', true) AND ${projectChain('opportunities')}`,
  },
]);

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

/** @deprecated U016/DB-01: session-level scope setting outside a transaction is forbidden going
 * forward — use `withRlsTransaction` from `./scoped-transaction` instead, which sets scope with
 * `SET LOCAL` inside one transaction. Not re-exported from `./index`; kept only for this module's
 * own tests and not callable from outside the package. */
export async function setRlsContext(executor: RlsExecutor, context: RlsContext): Promise<void> {
  await executor.$executeRaw(Prisma.sql`SELECT set_config(${RLS_TENANT_SETTING}, ${context.tenantId}, true)`);
  await executor.$executeRaw(Prisma.sql`SELECT set_config(${RLS_COMPANY_SETTING}, ${context.companyId}, true)`);
}
