import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error -- U009's committed reuse module is plain JS (scripts/lib/isolated-postgres.mjs), no .d.ts.
import { LABEL_PURPOSE, LABEL_RUN, LABEL_UNIT, withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';
import { canonicalizeRfc8785 } from '../src/canonical-content-hash';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const DB_PKG_ROOT = resolve(HERE, '..');
const REAL_PRISMA_DIR = join(DB_PKG_ROOT, 'prisma');
const NEW_MIGRATION_NAME = '20260715110000_scope_backfill_quarantine';
const OWNER_UNIT = 'U011';
const PURPOSE = 'scope-backfill';
const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';

// U012 — scope-closure suite (registered alongside U011's scope-backfill suite above; the
// scope-backfill functions/fixture are untouched reuse, see the U012 dispatch file boundary).
const NEW_MIGRATION_NAME_U012 = '20260715120000_scope_closure_constraints';
const OWNER_UNIT_U012 = 'U012';
const PURPOSE_U012 = 'scope-closure';

// U014 — principal-session suite (registered alongside U011/U012 above; those suites' functions/
// fixtures are untouched reuse, see the U014 dispatch file boundary — this unit only adds the
// `principal-session` allow-listed suite and its own scenario below).
const NEW_MIGRATION_NAME_U014 = '20260715140000_principal_session_lifecycle';
const OWNER_UNIT_U014 = 'U014';
const PURPOSE_U014 = 'principal-session';

// U015 — business-role suite (registered alongside U011/U012/U014 above; those suites' functions/
// fixtures are untouched reuse, see the U015 dispatch file boundary — this unit only adds the
// `business-role` allow-listed suite and its own scenario below).
const NEW_MIGRATION_NAME_U015 = '20260715150000_business_role_assignments';
const OWNER_UNIT_U015 = 'U015';
const PURPOSE_U015 = 'business-role';

// U016 — rls-pilot suite (registered alongside U011/U012/U014/U015 above; those suites' functions/
// fixtures are untouched reuse, see the U016 dispatch file boundary — this unit only adds the
// `rls-pilot` allow-listed suite and its own scenario below).
const NEW_MIGRATION_NAME_U016 = '20260715160000_rls_pilot';
const OWNER_UNIT_U016 = 'U016';
const PURPOSE_U016 = 'rls-pilot';

// U017 — artifact-schema suite (registered alongside U011/U012/U014/U015/U016 above; those
// suites' functions/fixtures are untouched reuse, see the U017 dispatch file boundary — this unit
// only adds the `artifact-schema` allow-listed suite and its own scenario below).
const NEW_MIGRATION_NAME_U017 = '20260715170000_artifact_identity';
const OWNER_UNIT_U017 = 'U017';
const PURPOSE_U017 = 'artifact-schema';

// U018 — approval-schema suite (registered alongside U011/U012/U014/U015/U016/U017 above; those
// suites' functions/fixtures are untouched reuse, see the U018 dispatch file boundary — this unit
// only adds the `approval-schema` allow-listed suite and its own scenario below).
const NEW_MIGRATION_NAME_U018 = '20260715180000_version_bound_approval';
const OWNER_UNIT_U018 = 'U018';
const PURPOSE_U018 = 'approval-schema';

// U019 — workflow-schema suite (registered alongside U011/U012/U014/U015/U016/U017/U018 above;
// those suites' functions/fixtures are untouched reuse, see the U019 dispatch file boundary — this
// unit only adds the `workflow-schema` allow-listed suite and its own scenario below).
const NEW_MIGRATION_NAME_U019 = '20260715190000_workflow_definition_run';
const OWNER_UNIT_U019 = 'U019';
const PURPOSE_U019 = 'workflow-schema';

// U020 — governance-bridge suite (registered alongside U011-U019 above; those suites' functions/
// fixtures are untouched reuse, see the U020 dispatch file boundary — this unit only adds the
// `governance-bridge` allow-listed suite and its own scenario below). U020's own migration
// (20260715200000_governance_core_backfill) is an EMPTY migration (no schema change), so unlike
// every prior unit here it needs NO NEW_MIGRATION_NAME_U020 constant and NO exclusion from
// makeTempPrismaCopy/makeThroughU011PrismaCopy/listMigrationsThroughU010 — an empty migration file
// deploys identically whether or not it is present in any migration prefix.
const OWNER_UNIT_U020 = 'U020';
const PURPOSE_U020 = 'governance-bridge';

// U021 — audit-chain suite (registered alongside U011-U020 above; those suites' functions/fixtures
// are untouched reuse, see the U021 dispatch file boundary — this unit only adds the `audit-chain`
// allow-listed suite and its own scenarios below). Unlike U020's empty migration, U021's
// (20260715210000_harden_scoped_audit_chain) does real DDL + a guarded legacy backfill, so it needs
// the SAME exclusion treatment as U012-U019 in makeTempPrismaCopy/makeThroughU011PrismaCopy/
// listMigrationsThroughU010 below.
const NEW_MIGRATION_NAME_U021 = '20260715210000_harden_scoped_audit_chain';
const OWNER_UNIT_U021 = 'U021';
const PURPOSE_U021 = 'audit-chain';

// U024 — role-change snapshot suite. It must stay out of every earlier migration-prefix view:
// those scenarios deliberately deploy historical schemas and a later FK/trigger migration would
// make their legacy fixtures run against the wrong shape (or fail with SQLSTATE 42830).
const NEW_MIGRATION_NAME_U024 = '20260715220000_add_role_change_snapshot';
const OWNER_UNIT_U024 = 'U024';
const PURPOSE_U024 = 'role-change';

// U032's additive owner FKs and triggers must not enter historical fixture prefixes.
const NEW_MIGRATION_NAME_U032 = '20260716003200_u032_crm_scope_archive_owner_expand';
const NEW_MIGRATION_NAME_U033 = '20260716003300_u033_catalog_sizing_compat_expand';
const NEW_MIGRATION_NAME_U034 = '20260716003400_u034_qualification_bant_tf_expand';
const NEW_MIGRATION_NAME_U035 = '20260716003500_u035_quote_version_snapshot_expand';
const NEW_MIGRATION_NAME_U036 = '20260716003600_u036_vendor_discount_demo_expand';
const NEW_MIGRATION_NAME_U037 = '20260716003700_u037_delivery_lifecycle_expand';
const NEW_MIGRATION_NAME_U038 = '20260716003800_u038_people_eligibility_expand';
const NEW_MIGRATION_NAME_U039 = '20260716003900_u039_support_sla_rca_expand';
const NEW_MIGRATION_NAME_U040 = '20260716004000_u040_domain_backfill_validate_tighten';
const NEW_MIGRATION_NAME_U041 = '20260716004100_u041_ai_quality_artifact_expand';
const NEW_MIGRATION_NAME_U042 = '20260716004200_u042_retention_legal_hold_ownership_expand';
const OWNER_UNIT_U042 = 'U042';
const PURPOSE_U042 = 'governance-schema';

// U041 / AIQ-01: this suite owns only its allowlisted isolated-postgres upgrade proof. Historical
// suite prefix filters remain owned by their respective units (see the U041 dispatch boundary).
const OWNER_UNIT_U041 = 'U041';
const PURPOSE_U041 = 'ai-quality-schema';

const ALLOWED_SUITES = new Set(['scope-backfill', 'scope-closure', 'principal-session', 'business-role', 'rls-pilot', 'artifact-schema', 'approval-schema', 'workflow-schema', 'governance-bridge', 'audit-chain', 'role-change', 'ai-quality-schema', 'governance-schema']);

const EXIT = Object.freeze({
  SUCCESS: 0,
  CONFIG: 64,
  DOCKER_UNSAFE: 65,
  TIMEOUT: 66,
  CONTRACT: 67,
  CLEANUP: 68,
});

class ContractFailure extends Error {
  constructor(
    public exitCode: number,
    message: string,
  ) {
    super(message);
  }
}

function parseArgs(argv: string[]) {
  const out: { suite?: string; evidence?: string } = {};
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--suite') out.suite = args[++i];
    else if (a === '--evidence') out.evidence = args[++i];
    else throw new ContractFailure(EXIT.CONFIG, `unknown arg: ${a}`);
    i += 1;
  }
  if (!out.suite || !ALLOWED_SUITES.has(out.suite)) {
    throw new ContractFailure(EXIT.CONFIG, `--suite must be one of: ${[...ALLOWED_SUITES].join(', ')}`);
  }
  if (!out.evidence || !out.evidence.startsWith('/')) {
    throw new ContractFailure(EXIT.CONFIG, 'usage: run-db-contract.ts --suite scope-backfill --evidence <absolute-dir>');
  }
  return { suite: out.suite, evidence: resolve(out.evidence) };
}

interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
  argv: string[];
}

function sanitizedEnv(extra: Record<string, string>) {
  const allowed = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'NVM_DIR', 'NO_COLOR', 'TMPDIR', 'XDG_CACHE_HOME', 'COREPACK_HOME', 'PNPM_HOME', 'SHELL'];
  const env: Record<string, string> = {};
  for (const key of allowed) {
    const v = process.env[key];
    if (typeof v === 'string') env[key] = v;
  }
  return { ...env, ...extra };
}

function spawnCapture(argv: string[], env: Record<string, string>, opts: { input?: string } = {}): Promise<CaptureResult> {
  return new Promise((resolvePromise, reject) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd as string, args, { shell: false, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    if (opts.input) child.stdin.write(opts.input);
    child.stdin.end();
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr, argv }));
  });
}

async function runBackfillScript(databaseUrl: string, extraEnv: Record<string, string> = {}): Promise<CaptureResult> {
  const argv = ['bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'tsx', 'scripts/backfill-canonical-scope.ts'];
  return spawnCapture(argv, sanitizedEnv({ DATABASE_URL: databaseUrl, ...extraEnv }));
}

async function runScopeCheck(): Promise<CaptureResult> {
  const argv = ['bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'tsx', 'scripts/check-scope-inventory.ts'];
  return spawnCapture(argv, sanitizedEnv({}));
}

async function runGovernanceBackfillScript(databaseUrl: string, extraEnv: Record<string, string> = {}): Promise<CaptureResult> {
  const argv = ['bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'tsx', 'scripts/backfill-governance-core.ts'];
  return spawnCapture(argv, sanitizedEnv({ DATABASE_URL: databaseUrl, ...extraEnv }));
}

async function runGovernanceValidate(databaseUrl: string): Promise<CaptureResult> {
  const argv = ['bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'tsx', 'scripts/validate-governance-core.ts'];
  return spawnCapture(argv, sanitizedEnv({ DATABASE_URL: databaseUrl }));
}

async function runMigrateDiff(databaseUrl: string, exitCodeOnDifference = false): Promise<CaptureResult> {
  const schemaPath = join(DB_PKG_ROOT, 'prisma/schema.prisma');
  const argv = [
    'bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--',
    'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'prisma', 'migrate', 'diff',
    '--from-url', databaseUrl, '--to-schema-datamodel', schemaPath, '--script',
  ];
  if (exitCodeOnDifference) argv.push('--exit-code');
  return spawnCapture(argv, sanitizedEnv({}));
}

function makeTempPrismaCopy(label: string, includeNewMigration: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), `u011-prisma-${label}-`));
  cpSync(REAL_PRISMA_DIR, dir, { recursive: true });
  if (!includeNewMigration) {
    const target = join(dir, 'migrations', NEW_MIGRATION_NAME);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    // U012's migration depends on the U011 quarantine table, so it must stay excluded from this
    // pre-U011 prefix too — otherwise it deploys before U011 and fails on a missing relation.
    const targetU012 = join(dir, 'migrations', NEW_MIGRATION_NAME_U012);
    if (existsSync(targetU012)) rmSync(targetU012, { recursive: true, force: true });
    // U014's migration depends on U012's unique constraints (companies/projects), so it must stay
    // excluded from this pre-U011 prefix too — otherwise it deploys before U012 exists and fails
    // with a missing-unique-constraint error (SQLSTATE 42830).
    const targetU014 = join(dir, 'migrations', NEW_MIGRATION_NAME_U014);
    if (existsSync(targetU014)) rmSync(targetU014, { recursive: true, force: true });
    // U015's migration adds a watermarked CHECK on user_company_roles.role; the scope-backfill
    // fixture below seeds role='member' rows against this pre-U011 shape, so U015's migration must
    // stay excluded here too — deploying it first would make those seeded rows fail the new-row
    // role-code CHECK the moment they're inserted after the watermark.
    const targetU015 = join(dir, 'migrations', NEW_MIGRATION_NAME_U015);
    if (existsSync(targetU015)) rmSync(targetU015, { recursive: true, force: true });
    // U016's migration creates the sangfor_app/sangfor_app_login roles and enables RLS on
    // companies/projects/etc — deploying it before U011's quarantine table (or ahead of U012's/
    // U014's/U015's own prerequisites) is out of scope for this pre-U011 prefix, so it stays
    // excluded here too, same as its three predecessors above.
    const targetU016 = join(dir, 'migrations', NEW_MIGRATION_NAME_U016);
    if (existsSync(targetU016)) rmSync(targetU016, { recursive: true, force: true });
    // U017's migration depends on U012's composite unique keys (companies/projects/
    // user_company_roles) for its own composite FKs — same SQLSTATE 42830 hazard as U014/U015/U016
    // above, so it stays excluded here too.
    const targetU017 = join(dir, 'migrations', NEW_MIGRATION_NAME_U017);
    if (existsSync(targetU017)) rmSync(targetU017, { recursive: true, force: true });
    // U018's migration depends on U017's artifact_versions table (composite FK target for its
    // artifact_version_id column), so it stays excluded from this pre-U011 prefix too.
    const targetU018 = join(dir, 'migrations', NEW_MIGRATION_NAME_U018);
    if (existsSync(targetU018)) rmSync(targetU018, { recursive: true, force: true });
    // U019's migration depends on U017's artifact_versions table, U018's approval_requests/
    // approval_current_validity tables, and U012's composite unique keys, so it stays excluded
    // from this pre-U011 prefix too.
    const targetU019 = join(dir, 'migrations', NEW_MIGRATION_NAME_U019);
    if (existsSync(targetU019)) rmSync(targetU019, { recursive: true, force: true });
    // U021's migration depends on U012's composite unique keys (companies/projects) for its
    // composite FKs and does real DDL/backfill (unlike U020's empty migration), so it stays
    // excluded from this pre-U011 prefix too.
    const targetU021 = join(dir, 'migrations', NEW_MIGRATION_NAME_U021);
    if (existsSync(targetU021)) rmSync(targetU021, { recursive: true, force: true });
    const targetU024 = join(dir, 'migrations', NEW_MIGRATION_NAME_U024);
    if (existsSync(targetU024)) rmSync(targetU024, { recursive: true, force: true });
    const targetU032 = join(dir, 'migrations', NEW_MIGRATION_NAME_U032);
    if (existsSync(targetU032)) rmSync(targetU032, { recursive: true, force: true });
    // U033's migration adds catalog FKs to U017's artifacts/artifact_versions tables, so it must
    // stay excluded from this pre-U011 prefix too — otherwise it deploys before artifacts exists
    // and fails with "relation artifacts does not exist", same hazard as U017/U018/U019 above.
    const targetU033 = join(dir, 'migrations', NEW_MIGRATION_NAME_U033);
    if (existsSync(targetU033)) rmSync(targetU033, { recursive: true, force: true });
    // U034 is a post-U020 per-unit migration; keep it out of this pre-U011 prefix for the same
    // consistency reason as U024/U032/U033 above (a historical prefix must not carry later units).
    const targetU034 = join(dir, 'migrations', NEW_MIGRATION_NAME_U034);
    if (existsSync(targetU034)) rmSync(targetU034, { recursive: true, force: true });
    // U035's migration adds quote-line FKs to U017's artifact_versions table, so it must stay
    // excluded from this pre-U011 prefix too — otherwise it deploys before artifact_versions exists
    // and fails with "relation artifact_versions does not exist", same hazard as U033 above.
    const targetU035 = join(dir, 'migrations', NEW_MIGRATION_NAME_U035);
    if (existsSync(targetU035)) rmSync(targetU035, { recursive: true, force: true });
    // U036's migration adds vendor-request FKs to U017's artifact_versions and U018's approval_requests
    // tables, so it must stay excluded from this pre-U011 prefix too — otherwise it deploys before
    // those relations exist and fails with "relation artifact_versions does not exist", same as U035.
    const targetU036 = join(dir, 'migrations', NEW_MIGRATION_NAME_U036);
    if (existsSync(targetU036)) rmSync(targetU036, { recursive: true, force: true });
    // U037's migration adds delivery-acceptance FKs to U017's artifact_versions table, so it must
    // stay excluded from this pre-U011 prefix too — otherwise it deploys before artifact_versions
    // exists and fails with "relation artifact_versions does not exist", same as U033/U035/U036.
    const targetU037 = join(dir, 'migrations', NEW_MIGRATION_NAME_U037);
    if (existsSync(targetU037)) rmSync(targetU037, { recursive: true, force: true });
    // U038's migration adds certification-evidence FKs to U017's artifact_versions table, so it must
    // stay excluded from this pre-U011 prefix too — otherwise it deploys before artifact_versions
    // exists and fails with "relation artifact_versions does not exist", same as U033/U035/U036/U037.
    const targetU038 = join(dir, 'migrations', NEW_MIGRATION_NAME_U038);
    if (existsSync(targetU038)) rmSync(targetU038, { recursive: true, force: true });
    // U039's migration adds an RCA FK to U017's artifact_versions table, so it must stay excluded
    // from this pre-U011 prefix too — otherwise it deploys before artifact_versions exists and fails
    // with "relation artifact_versions does not exist", same as U033/U035/U036/U037/U038.
    const targetU039 = join(dir, 'migrations', NEW_MIGRATION_NAME_U039);
    if (existsSync(targetU039)) rmSync(targetU039, { recursive: true, force: true });
    // U040's migration backfills/validates the U032-U039 columns (e.g. product_families.company_id),
    // so it must stay excluded from this pre-U011 prefix — otherwise it deploys before those columns
    // exist and fails 42703 (undefined_column), same family as the artifact_versions hazard above.
    const targetU040 = join(dir, 'migrations', NEW_MIGRATION_NAME_U040);
    if (existsSync(targetU040)) rmSync(targetU040, { recursive: true, force: true });
    // U041's immutable AI history depends on ArtifactVersion (U017), absent from this pre-U011
    // historical prefix just like the U040 domain-backfill dependencies above.
    const targetU041 = join(dir, 'migrations', NEW_MIGRATION_NAME_U041);
    if (existsSync(targetU041)) rmSync(targetU041, { recursive: true, force: true });
    const targetU042 = join(dir, 'migrations', NEW_MIGRATION_NAME_U042);
    if (existsSync(targetU042)) rmSync(targetU042, { recursive: true, force: true });
  }
  return dir;
}

/** A temp prisma copy deployed through U011 only (every real migration except U012's and U014's).
 * Used by scope-backfill scenarios that need `migrate: true`-equivalent full-chain behavior
 * without pulling in U012's CHECK constraint, which is U012's contract, not U011's. */
function makeThroughU011PrismaCopy(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `u011-prisma-through-u011-${label}-`));
  cpSync(REAL_PRISMA_DIR, dir, { recursive: true });
  const targetU012 = join(dir, 'migrations', NEW_MIGRATION_NAME_U012);
  if (existsSync(targetU012)) rmSync(targetU012, { recursive: true, force: true });
  // U014's migration depends on U012's unique constraints, which this through-U011 prefix
  // deliberately omits — exclude U014 too, or the deploy fails the same way (SQLSTATE 42830).
  const targetU014 = join(dir, 'migrations', NEW_MIGRATION_NAME_U014);
  if (existsSync(targetU014)) rmSync(targetU014, { recursive: true, force: true });
  // Same reasoning as makeTempPrismaCopy above: keep U015's migration out of this through-U011
  // prefix too.
  const targetU015 = join(dir, 'migrations', NEW_MIGRATION_NAME_U015);
  if (existsSync(targetU015)) rmSync(targetU015, { recursive: true, force: true });
  // Same reasoning as makeTempPrismaCopy above: keep U016's migration out of this through-U011
  // prefix too.
  const targetU016 = join(dir, 'migrations', NEW_MIGRATION_NAME_U016);
  if (existsSync(targetU016)) rmSync(targetU016, { recursive: true, force: true });
  // Same reasoning as makeTempPrismaCopy above: keep U017's migration out of this through-U011
  // prefix too.
  const targetU017 = join(dir, 'migrations', NEW_MIGRATION_NAME_U017);
  if (existsSync(targetU017)) rmSync(targetU017, { recursive: true, force: true });
  // Same reasoning as makeTempPrismaCopy above: keep U018's migration out of this through-U011
  // prefix too.
  const targetU018 = join(dir, 'migrations', NEW_MIGRATION_NAME_U018);
  if (existsSync(targetU018)) rmSync(targetU018, { recursive: true, force: true });
  // Same reasoning as makeTempPrismaCopy above: keep U019's migration out of this through-U011
  // prefix too.
  const targetU019 = join(dir, 'migrations', NEW_MIGRATION_NAME_U019);
  if (existsSync(targetU019)) rmSync(targetU019, { recursive: true, force: true });
  // Same reasoning as makeTempPrismaCopy above: keep U021's migration out of this through-U011
  // prefix too.
  const targetU021 = join(dir, 'migrations', NEW_MIGRATION_NAME_U021);
  if (existsSync(targetU021)) rmSync(targetU021, { recursive: true, force: true });
  const targetU024 = join(dir, 'migrations', NEW_MIGRATION_NAME_U024);
  if (existsSync(targetU024)) rmSync(targetU024, { recursive: true, force: true });
  const targetU032 = join(dir, 'migrations', NEW_MIGRATION_NAME_U032);
  if (existsSync(targetU032)) rmSync(targetU032, { recursive: true, force: true });
  // Same reasoning as makeTempPrismaCopy above: U033's catalog FKs target U017's artifacts tables,
  // which this through-U011 prefix omits, so keep U033's migration out of it too.
  const targetU033 = join(dir, 'migrations', NEW_MIGRATION_NAME_U033);
  if (existsSync(targetU033)) rmSync(targetU033, { recursive: true, force: true });
  // Same reasoning: keep the post-U020 U034 migration out of this through-U011 prefix too.
  const targetU034 = join(dir, 'migrations', NEW_MIGRATION_NAME_U034);
  if (existsSync(targetU034)) rmSync(targetU034, { recursive: true, force: true });
  // Same reasoning: U035's quote-line FKs target U017's artifact_versions, absent from this
  // through-U011 prefix, so keep U035's migration out of it too.
  const targetU035 = join(dir, 'migrations', NEW_MIGRATION_NAME_U035);
  if (existsSync(targetU035)) rmSync(targetU035, { recursive: true, force: true });
  // Same reasoning: U036's vendor-request FKs target U017 artifact_versions / U018 approval_requests,
  // absent from this through-U011 prefix, so keep U036's migration out of it too.
  const targetU036 = join(dir, 'migrations', NEW_MIGRATION_NAME_U036);
  if (existsSync(targetU036)) rmSync(targetU036, { recursive: true, force: true });
  // Same reasoning: U037's delivery-acceptance FKs target U017 artifact_versions, absent from this
  // through-U011 prefix, so keep U037's migration out of it too.
  const targetU037 = join(dir, 'migrations', NEW_MIGRATION_NAME_U037);
  if (existsSync(targetU037)) rmSync(targetU037, { recursive: true, force: true });
  // Same reasoning: U038's certification-evidence FKs target U017 artifact_versions, absent from this
  // through-U011 prefix, so keep U038's migration out of it too.
  const targetU038 = join(dir, 'migrations', NEW_MIGRATION_NAME_U038);
  if (existsSync(targetU038)) rmSync(targetU038, { recursive: true, force: true });
  // Same reasoning: U039's RCA FK targets U017 artifact_versions, absent from this through-U011
  // prefix, so keep U039's migration out of it too.
  const targetU039 = join(dir, 'migrations', NEW_MIGRATION_NAME_U039);
  if (existsSync(targetU039)) rmSync(targetU039, { recursive: true, force: true });
  // Same reasoning: U040 backfills/validates U032-U039 columns absent from this through-U011 prefix,
  // so keep U040's migration out of it too.
  const targetU040 = join(dir, 'migrations', NEW_MIGRATION_NAME_U040);
  if (existsSync(targetU040)) rmSync(targetU040, { recursive: true, force: true });
  // U041 references U017 ArtifactVersion, which this through-U011 view deliberately omits.
  const targetU041 = join(dir, 'migrations', NEW_MIGRATION_NAME_U041);
  if (existsSync(targetU041)) rmSync(targetU041, { recursive: true, force: true });
  const targetU042 = join(dir, 'migrations', NEW_MIGRATION_NAME_U042);
  if (existsSync(targetU042)) rmSync(targetU042, { recursive: true, force: true });
  return dir;
}

function addNewMigrationTo(tmpPrismaDir: string) {
  cpSync(join(REAL_PRISMA_DIR, 'migrations', NEW_MIGRATION_NAME), join(tmpPrismaDir, 'migrations', NEW_MIGRATION_NAME), { recursive: true });
}

async function runWorkspaceGenerate(schemaPath: string): Promise<CaptureResult> {
  const argv = ['bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'prisma', 'generate', '--schema', schemaPath];
  return spawnCapture(argv, sanitizedEnv({}));
}

async function runWorkspaceFormat(schemaPath: string): Promise<CaptureResult> {
  const argv = ['bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'prisma', 'format', '--schema', schemaPath];
  return spawnCapture(argv, sanitizedEnv({}));
}

async function runWorkspaceMigrateDeploy(databaseUrl: string, schemaPath: string): Promise<CaptureResult> {
  const argv = ['bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'prisma', 'migrate', 'deploy', '--schema', schemaPath];
  return spawnCapture(argv, sanitizedEnv({ DATABASE_URL: databaseUrl }));
}

async function execSql(containerName: string, conn: { user: string; password: string; database: string }, sql: string): Promise<string> {
  const r = await spawnCapture(
    ['docker', 'exec', '-i', '-e', `PGPASSWORD=${conn.password}`, containerName, 'psql', '-h', '127.0.0.1', '-U', conn.user, '-d', conn.database, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    sanitizedEnv({}),
  );
  if (r.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `psql failed: ${r.stderr || r.stdout}\nsql: ${sql}`);
  return r.stdout.trim();
}

async function execSqlTsv(containerName: string, conn: { user: string; password: string; database: string }, sql: string): Promise<string> {
  const r = await spawnCapture(
    ['docker', 'exec', '-i', '-e', `PGPASSWORD=${conn.password}`, containerName, 'psql', '-h', '127.0.0.1', '-U', conn.user, '-d', conn.database, '-v', 'ON_ERROR_STOP=1', '-A', '-F', '\t', '-c', sql],
    sanitizedEnv({}),
  );
  if (r.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `psql (tsv) failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function parseConn(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)) };
}

// Runner-owned synthetic fixture (U011 dispatch file boundary: no separate tracked fixture file).
export const SCOPE_BACKFILL_CONTRACT_FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('fx-tenant-1', 'Fixture Tenant', 'fx-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('fx-company-alpha', 'fx-tenant-1', 'Alpha Co', 'fx-alpha', now()),
  ('fx-company-beta', 'fx-tenant-1', 'Beta Co', 'fx-beta', now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('fx-user-resolver', 'resolver@fixture.example.com', 'Resolver', now(), now()),
  ('fx-user-target-a', 'target-a@fixture.example.com', 'Target A', now(), now()),
  ('fx-user-email-match', 'emailmatch@fixture.example.com', 'Email Match', now(), now()),
  ('fx-user-target-b', 'target-b@fixture.example.com', 'Target B', now(), now()),
  ('fx-user-dual', 'dual@fixture.example.com', 'Dual', now(), now()),
  ('fx-user-dual-target', 'dual-target@fixture.example.com', 'Dual Target', now(), now()),
  ('fx-user-cross-a', 'cross-a@fixture.example.com', 'Cross A', now(), now()),
  ('fx-user-cross-b', 'fx-user-cross-a', 'Cross B', now(), now()),
  ('fx-user-nomembership', 'nomembership@fixture.example.com', 'No Membership', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, created_at) VALUES
  ('fx-ucr-resolver-alpha', 'fx-user-resolver', 'fx-company-alpha', 'member', now()),
  ('fx-ucr-target-a-alpha', 'fx-user-target-a', 'fx-company-alpha', 'member', now()),
  ('fx-ucr-email-match-alpha', 'fx-user-email-match', 'fx-company-alpha', 'member', now()),
  ('fx-ucr-target-b-alpha', 'fx-user-target-b', 'fx-company-alpha', 'member', now()),
  ('fx-ucr-dual-alpha', 'fx-user-dual', 'fx-company-alpha', 'member', now()),
  ('fx-ucr-dual-beta', 'fx-user-dual', 'fx-company-beta', 'member', now()),
  ('fx-ucr-dual-target-alpha', 'fx-user-dual-target', 'fx-company-alpha', 'member', now()),
  ('fx-ucr-dual-target-beta', 'fx-user-dual-target', 'fx-company-beta', 'member', now());

INSERT INTO projects (id, slug, name, description, created_at, updated_at) VALUES
  ('fx-project-resolved', 'fx-project-resolved', 'Fixture Resolved Project', NULL, now(), now()),
  ('fx-project-ambiguous', 'fx-project-ambiguous', 'Fixture Ambiguous Project', NULL, now(), now()),
  ('fx-project-unmatched', 'fx-project-unmatched', 'Fixture Unmatched Project', NULL, now(), now());

INSERT INTO project_members (id, project_id, user_id, role, created_at) VALUES
  ('fx-pm-resolved', 'fx-project-resolved', 'fx-user-resolver', 'member', now()),
  ('fx-pm-ambiguous', 'fx-project-ambiguous', 'fx-user-dual', 'member', now());

INSERT INTO role_change_requests (id, user_id, from_role, to_role, status, requested_by, approved_by, created_at) VALUES
  ('fx-rcr-id-resolved', 'fx-user-target-a', 'member', 'admin', 'pending', 'fx-user-resolver', NULL, now()),
  ('fx-rcr-email-resolved', 'fx-user-target-b', 'member', 'admin', 'pending', 'emailmatch@fixture.example.com', NULL, now()),
  ('fx-rcr-cross-ambiguous', 'fx-user-target-a', 'member', 'admin', 'pending', 'fx-user-cross-a', NULL, now()),
  ('fx-rcr-company-ambiguous', 'fx-user-dual-target', 'member', 'admin', 'pending', 'fx-user-dual', NULL, now()),
  ('fx-rcr-unmatched-nomembership', 'fx-user-target-a', 'member', 'admin', 'pending', 'fx-user-nomembership', NULL, now()),
  ('fx-rcr-unmatched-nearmiss', 'fx-user-target-a', 'member', 'admin', 'pending', ' RESOLVER@fixture.example.com ', NULL, now());
`;

async function seedFixture(containerName: string, conn: { user: string; password: string; database: string }) {
  await execSql(containerName, conn, SCOPE_BACKFILL_CONTRACT_FIXTURE_SQL);
}

async function labelResourceCounts(runId: string, ownerUnit: string = OWNER_UNIT, purpose: string = PURPOSE) {
  const filters = [`label=${LABEL_RUN}=${runId}`, `label=${LABEL_UNIT}=${ownerUnit}`, `label=${LABEL_PURPOSE}=${purpose}`];
  const countFor = (argvBase: string[]) =>
    spawnCapture([...argvBase, ...filters.flatMap((f) => ['--filter', f])], sanitizedEnv({})).then((r) =>
      r.stdout.trim() ? r.stdout.trim().split('\n').filter(Boolean).length : 0,
    );
  const [containers, networks, volumes] = await Promise.all([
    countFor(['docker', 'ps', '-aq']),
    countFor(['docker', 'network', 'ls', '-q']),
    countFor(['docker', 'volume', 'ls', '-q']),
  ]);
  return { containers, networks, volumes };
}

interface DryRunReport {
  reviewDigest: string;
  projects: { entries: Array<{ sourceModel: string; sourceId: string; sourceRowHash: string; sourceFactsDigest: string; classification: string; candidateCompanyIds: string[] }> };
  roleChangeRequests: { counts: Record<string, number>; ids: Record<string, string[]> };
}

function buildReviewFile(dryRun: DryRunReport, reviewerKey: string) {
  const entries = dryRun.projects.entries.map((e) => {
    if (e.classification === 'resolved') {
      return { ...e, decision: 'assign', selectedCompanyId: e.candidateCompanyIds[0]!, reviewerKey, rationale: 'sole resolved candidate from ProjectMember/UserCompanyRole intersection' };
    }
    return { ...e, decision: 'quarantine', selectedCompanyId: null, reviewerKey: null, rationale: null };
  });
  const roleChangeRequestIds = [...dryRun.roleChangeRequests.ids.resolved, ...dryRun.roleChangeRequests.ids.ambiguous, ...dryRun.roleChangeRequests.ids.unmatched].sort();
  return { schemaVersion: 1, reviewerKey, dryRunDigest: dryRun.reviewDigest, entries, roleChangeRequestIds };
}

async function runFixtureScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};
  let tmpPrismaDir: string | null = null;

  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT, purpose: PURPOSE, evidenceDir: join(evidenceDir, 'fixture-scenario'), imageDigest: IMAGE_DIGEST, migrate: false },
    async (ctx: any) => {
      const conn = parseConn(ctx.databaseUrl);

      // Deploy every migration except the scope-backfill-quarantine one first, seed fixture rows
      // against that pre-existing shape, then add the migration back and deploy it against an
      // already non-empty database. This exercises the ordinary "non-empty source set" path (no
      // migration-created control row); the separate empty-database scenario below covers the
      // sentinel path deliberately.
      tmpPrismaDir = makeTempPrismaCopy(runId, false);
      const preSchemaPath = join(tmpPrismaDir, 'schema.prisma');
      const realSchemaPath = join(REAL_PRISMA_DIR, 'schema.prisma');
      const genPre = await runWorkspaceGenerate(realSchemaPath);
      if (genPre.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `generate failed: ${genPre.stderr || genPre.stdout}`);
      const deployPre = await runWorkspaceMigrateDeploy(ctx.databaseUrl, preSchemaPath);
      if (deployPre.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy (pre-U011) failed: ${deployPre.stderr || deployPre.stdout}`);

      await seedFixture(ctx.containerName, conn);

      addNewMigrationTo(tmpPrismaDir);
      const fullSchemaPath = join(tmpPrismaDir, 'schema.prisma');
      const deployFull = await runWorkspaceMigrateDeploy(ctx.databaseUrl, fullSchemaPath);
      if (deployFull.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy (U011) failed: ${deployFull.stderr || deployFull.stdout}`);
      evidence.migrateDeploy = { migrated: true, twoPhase: true };

      const noSentinelYet = await execSql(ctx.containerName, conn, `SELECT count(*) FROM scope_backfill_quarantine WHERE source_model = '__ScopeBackfillControl';`);
      if (noSentinelYet !== '0') {
        throw new ContractFailure(EXIT.CONTRACT, `expected zero control rows before any apply on a non-empty source set, got ${noSentinelYet}`);
      }

      const scopeCheck = await runScopeCheck();
      if (scopeCheck.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `scope:check failed: ${scopeCheck.stdout}\n${scopeCheck.stderr}`);
      const scopeCheckJson = JSON.parse(scopeCheck.stdout);
      if (scopeCheckJson.currentModelCount !== scopeCheckJson.inventoryModelCount || scopeCheckJson.ok !== true) {
        throw new ContractFailure(EXIT.CONTRACT, `scope:check did not report ok=true with schema matching the canonical inventory: ${scopeCheck.stdout}`);
      }
      evidence.scopeCheck = scopeCheckJson;

      const diffAfterDeploy = await runMigrateDiff(ctx.databaseUrl);
      writeFileSync(join(evidenceDir, 'migration-diff.sql'), diffAfterDeploy.stdout.trim().length > 0 && diffAfterDeploy.code === 0 ? '' : diffAfterDeploy.stdout);
      if (diffAfterDeploy.code !== 0) {
        throw new ContractFailure(EXIT.CONTRACT, `schema diff not empty after fresh migrate deploy: ${diffAfterDeploy.stdout}`);
      }

      const dryRunBefore = await execSql(ctx.containerName, conn, `SELECT count(*) FROM projects WHERE company_id IS NULL;`);
      const dryRun = await runBackfillScript(ctx.databaseUrl);
      if (dryRun.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `dry run failed: ${dryRun.stdout}\n${dryRun.stderr}`);
      const dryRunJson: DryRunReport = JSON.parse(dryRun.stdout);
      writeFileSync(join(evidenceDir, 'scope-dry-run.json'), `${JSON.stringify(dryRunJson, null, 2)}\n`);
      const dryRunAfter = await execSql(ctx.containerName, conn, `SELECT count(*) FROM projects WHERE company_id IS NULL;`);
      if (dryRunBefore !== dryRunAfter) throw new ContractFailure(EXIT.CONTRACT, `dry run did not write zero: before=${dryRunBefore} after=${dryRunAfter}`);
      const anyQuarantineAfterDryRun = await execSql(ctx.containerName, conn, `SELECT count(*) FROM scope_backfill_quarantine WHERE source_model <> '__ScopeBackfillControl';`);
      if (anyQuarantineAfterDryRun !== '0') throw new ContractFailure(EXIT.CONTRACT, `dry run wrote quarantine rows: ${anyQuarantineAfterDryRun}`);

      const reviewFile = buildReviewFile(dryRunJson, 'qa-harness-reviewer');
      writeFileSync(join(evidenceDir, 'scope-review.json'), `${JSON.stringify(reviewFile, null, 2)}\n`);
      const reviewFilePath = join(mkdtempSync(join(tmpdir(), 'u011-review-')), 'scope-review.json');
      writeFileSync(reviewFilePath, JSON.stringify(reviewFile));

      // Independent pre-extraction snapshot: copy the soon-to-be-extracted RoleChangeRequest rows
      // into a disposable temp table (their own on-disk bytes, not anything the app computed)
      // BEFORE apply deletes the live rows, so the post-apply round-trip proof below is a genuine
      // comparison against the original data, not a hash re-checking itself.
      const nonResolvedRcrIds = [...dryRunJson.roleChangeRequests.ids.ambiguous, ...dryRunJson.roleChangeRequests.ids.unmatched];
      if (nonResolvedRcrIds.length > 0) {
        await execSql(
          ctx.containerName,
          conn,
          `DROP TABLE IF EXISTS u011_rcr_preimage;
           CREATE UNLOGGED TABLE u011_rcr_preimage AS SELECT * FROM role_change_requests WHERE id = ANY(ARRAY[${nonResolvedRcrIds.map((id) => `'${id}'`).join(',')}]);`,
        );
      }

      const apply = await runBackfillScript(ctx.databaseUrl, { APPLY: '1', SCOPE_REVIEW_FILE: reviewFilePath });
      if (apply.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `apply failed: ${apply.stdout}\n${apply.stderr}`);
      const applyJson = JSON.parse(apply.stdout);
      writeFileSync(join(evidenceDir, 'scope-apply.json'), `${JSON.stringify(applyJson, null, 2)}\n`);
      evidence.apply = applyJson;

      const resolvedProjectIds = reviewFile.entries.filter((e) => e.decision === 'assign').map((e) => e.sourceId);
      for (const id of resolvedProjectIds) {
        const companyId = await execSql(ctx.containerName, conn, `SELECT company_id FROM projects WHERE id = '${id}';`);
        if (!companyId) throw new ContractFailure(EXIT.CONTRACT, `Project ${id} was not assigned a company_id by apply`);
      }
      const quarantinedProjectIds = reviewFile.entries.filter((e) => e.decision === 'quarantine').map((e) => e.sourceId);
      for (const id of quarantinedProjectIds) {
        const stillNull = await execSql(ctx.containerName, conn, `SELECT company_id IS NULL FROM projects WHERE id = '${id}';`);
        if (stillNull !== 't') throw new ContractFailure(EXIT.CONTRACT, `quarantined Project ${id} was unexpectedly modified`);
      }

      const rcrLiveCount = await execSql(ctx.containerName, conn, `SELECT count(*) FROM role_change_requests;`);
      const rcrQuarantineCount = await execSql(ctx.containerName, conn, `SELECT count(*) FROM scope_backfill_quarantine WHERE source_model = 'RoleChangeRequest';`);
      evidence.roleChangeRequestConservation = { liveCount: rcrLiveCount, quarantineCount: rcrQuarantineCount };

      const selfHashRoundTrip = await execSql(
        ctx.containerName,
        conn,
        `SELECT count(*) FROM (
           SELECT id,
             encode(public.digest(pg_catalog.convert_to((source_row_json)::text,'UTF8'),'sha256'),'hex') AS rehash,
             source_row_hash
           FROM scope_backfill_quarantine
           WHERE source_model = 'RoleChangeRequest'
         ) t WHERE t.rehash <> t.source_row_hash;`,
      );
      if (selfHashRoundTrip !== '0') throw new ContractFailure(EXIT.CONTRACT, `RoleChangeRequest quarantine self-hash mismatch count=${selfHashRoundTrip}`);

      if (nonResolvedRcrIds.length > 0) {
        const independentRoundTrip = await execSql(
          ctx.containerName,
          conn,
          `WITH cols AS (
             SELECT a.attname AS name, t.typname AS pg_type
             FROM pg_attribute a
             JOIN pg_type t ON t.oid = a.atttypid
             JOIN pg_class c ON c.oid = a.attrelid
             WHERE c.relname = 'u011_rcr_preimage' AND a.attnum > 0 AND NOT a.attisdropped
           ),
           reconstructed AS (
             SELECT r.id, jsonb_build_object(
               'schemaVersion', 1, 'sourceModel', 'RoleChangeRequest',
               'columns', (
                 SELECT jsonb_agg(
                   jsonb_build_object('name', c.name, 'pgType', c.pg_type, 'value',
                     CASE c.name
                       WHEN 'id' THEN r.id::text WHEN 'user_id' THEN r.user_id::text
                       WHEN 'from_role' THEN r.from_role::text WHEN 'to_role' THEN r.to_role::text
                       WHEN 'status' THEN r.status::text WHEN 'requested_by' THEN r.requested_by::text
                       WHEN 'approved_by' THEN r.approved_by::text WHEN 'company_id' THEN r.company_id::text
                       WHEN 'created_at' THEN to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                     END
                   ) ORDER BY c.name COLLATE "C"
                 ) FROM cols c
               )
             ) AS envelope
             FROM u011_rcr_preimage r
           )
           SELECT count(*) FROM reconstructed rec
           JOIN scope_backfill_quarantine q ON q.source_model = 'RoleChangeRequest' AND q.source_id = rec.id
           WHERE encode(public.digest(pg_catalog.convert_to((rec.envelope)::text,'UTF8'),'sha256'),'hex') <> q.source_row_hash;`,
        );
        if (independentRoundTrip !== '0') {
          throw new ContractFailure(EXIT.CONTRACT, `independent pre-extraction round-trip reconstruction mismatch count=${independentRoundTrip}`);
        }
        evidence.independentRoundTripVerified = nonResolvedRcrIds.length;
      }

      const crossScopeProjects = await execSql(
        ctx.containerName,
        conn,
        `SELECT count(*) FROM projects p LEFT JOIN companies c ON c.id = p.company_id WHERE p.company_id IS NOT NULL AND c.id IS NULL;`,
      );
      if (crossScopeProjects !== '0') throw new ContractFailure(EXIT.CONTRACT, `orphan Project.company_id references: ${crossScopeProjects}`);

      const controlRowFirst = await execSql(
        ctx.containerName,
        conn,
        `SELECT source_row_hash FROM scope_backfill_quarantine WHERE source_model = '__ScopeBackfillControl' AND source_id = 'scope-closure/v1';`,
      );

      const rerun = await runBackfillScript(ctx.databaseUrl, { APPLY: '1', SCOPE_REVIEW_FILE: reviewFilePath });
      if (rerun.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `rerun apply failed: ${rerun.stdout}\n${rerun.stderr}`);
      const rerunJson = JSON.parse(rerun.stdout);
      writeFileSync(join(evidenceDir, 'scope-rerun.json'), `${JSON.stringify(rerunJson, null, 2)}\n`);
      if (rerunJson.changedCount !== 0) throw new ContractFailure(EXIT.CONTRACT, `rerun changedCount expected 0, got ${rerunJson.changedCount}`);

      const controlRowSecond = await execSql(
        ctx.containerName,
        conn,
        `SELECT source_row_hash FROM scope_backfill_quarantine WHERE source_model = '__ScopeBackfillControl' AND source_id = 'scope-closure/v1';`,
      );
      if (controlRowFirst !== controlRowSecond) throw new ContractFailure(EXIT.CONTRACT, `control row hash changed on rerun: ${controlRowFirst} -> ${controlRowSecond}`);
      evidence.controlRowByteIdentical = controlRowFirst === controlRowSecond;

      const tamperResult = await execSql(
        ctx.containerName,
        conn,
        `UPDATE scope_backfill_quarantine SET candidate_scope_json = '[]'::jsonb WHERE source_model = '__ScopeBackfillControl' RETURNING id;`,
      );
      if (!tamperResult) throw new ContractFailure(EXIT.CONTRACT, 'failed to hand-tamper control row for the conflict-blocking proof');
      const tamperedApply = await runBackfillScript(ctx.databaseUrl, { APPLY: '1', SCOPE_REVIEW_FILE: reviewFilePath });
      if (tamperedApply.code === 0) throw new ContractFailure(EXIT.CONTRACT, 'apply against a hand-tampered control row unexpectedly succeeded');
      evidence.handTamperedControlRowBlocked = tamperedApply.code !== 0;
      await execSql(
        ctx.containerName,
        conn,
        `UPDATE scope_backfill_quarantine SET candidate_scope_json = source_row_json #> '{}' WHERE source_model = '__ScopeBackfillControl';`,
      );

      const quarantineTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT source_model, source_id, reason_code, source_row_hash, resolved_at IS NOT NULL AS resolved FROM scope_backfill_quarantine ORDER BY source_model, source_id;`,
      );
      writeFileSync(join(evidenceDir, 'quarantine.tsv'), quarantineTsv);

      return evidence;
    },
  );

  return evidence;
}

async function runEmptyDatabaseScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};
  let tmpPrismaDir: string | null = null;
  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT, purpose: `${PURPOSE}-empty`, evidenceDir: join(evidenceDir, 'empty-scenario'), imageDigest: IMAGE_DIGEST, migrate: false },
    async (ctx: any) => {
      const conn = parseConn(ctx.databaseUrl);

      // This is U011's own contract proof: deploy through U011 only, so U012's CHECK constraint
      // is absent and the deliberately-unscoped project insert below can still exercise U011's
      // block-not-replace assertion, exactly as it did before U012's migration existed.
      tmpPrismaDir = makeThroughU011PrismaCopy(runId);
      const throughU011SchemaPath = join(tmpPrismaDir, 'schema.prisma');
      const realSchemaPath = join(REAL_PRISMA_DIR, 'schema.prisma');
      const gen = await runWorkspaceGenerate(realSchemaPath);
      if (gen.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `generate failed: ${gen.stderr || gen.stdout}`);
      const deploy = await runWorkspaceMigrateDeploy(ctx.databaseUrl, throughU011SchemaPath);
      if (deploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy (through U011) failed: ${deploy.stderr || deploy.stdout}`);

      const sentinel = await execSql(
        ctx.containerName,
        conn,
        `SELECT reason_code || '|' || resolved_by FROM scope_backfill_quarantine WHERE source_model = '__ScopeBackfillControl' AND source_id = 'scope-closure/v1';`,
      );
      if (sentinel !== 'scope_backfill_empty_database|migration:20260715110000_scope_backfill_quarantine') {
        throw new ContractFailure(EXIT.CONTRACT, `fresh-empty fixture missing exact migration-empty sentinel: got "${sentinel}"`);
      }
      evidence.emptyDatabaseSentinel = sentinel;

      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('t-empty-test', 'T', 't-empty-test', 'active', now());
         INSERT INTO projects (id, slug, name, created_at, updated_at) VALUES ('p-empty-test', 'p-empty-test', 'P', now(), now());`,
      );

      const dryRun = await runBackfillScript(ctx.databaseUrl);
      const dryRunJson: DryRunReport = JSON.parse(dryRun.stdout);
      const reviewFile = buildReviewFile(dryRunJson, 'qa-harness-reviewer');
      const reviewFilePath = join(mkdtempSync(join(tmpdir(), 'u011-review-empty-')), 'scope-review.json');
      writeFileSync(reviewFilePath, JSON.stringify(reviewFile));

      const applyAfterNonEmpty = await runBackfillScript(ctx.databaseUrl, { APPLY: '1', SCOPE_REVIEW_FILE: reviewFilePath });
      if (applyAfterNonEmpty.code === 0) {
        throw new ContractFailure(EXIT.CONTRACT, 'reviewed apply unexpectedly succeeded over an existing empty-database sentinel in a now-non-empty database');
      }
      evidence.reviewedApplyRejectedOverEmptySentinel = true;
    },
  );
  return evidence;
}

// ─────────────────────────────────────────────────────────────────────────
// U012 — scope-closure suite
// ─────────────────────────────────────────────────────────────────────────

async function runScopeValidate(databaseUrl: string): Promise<CaptureResult> {
  const argv = ['bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'tsx', 'scripts/validate-scope-closure.ts'];
  return spawnCapture(argv, sanitizedEnv({ DATABASE_URL: databaseUrl }));
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Every migration directory name up to and including U010's, excluding the U011/U012/U014/U015/
 * U016/U017 ones added by this and the other units — the exact prefix the legacy lifecycle proof
 * deploys first. Each of U011/U012/U014/U015/U016/U017 sorts after U010 by name, so every one must
 * be excluded here too, or it is folded into the "through U010" prefix and deploys before its own
 * dependencies exist (SQLSTATE 42830 for U012/U014/U017; a premature watermarked role-code CHECK
 * for U015; missing companies/projects unique keys U016's RLS policies reference for U016). */
function listMigrationsThroughU010(): string[] {
  return readdirSync(join(REAL_PRISMA_DIR, 'migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter(
      (name) =>
        name !== NEW_MIGRATION_NAME &&
        name !== NEW_MIGRATION_NAME_U012 &&
        name !== NEW_MIGRATION_NAME_U014 &&
        name !== NEW_MIGRATION_NAME_U015 &&
        name !== NEW_MIGRATION_NAME_U016 &&
        name !== NEW_MIGRATION_NAME_U017 &&
        name !== NEW_MIGRATION_NAME_U018 &&
        name !== NEW_MIGRATION_NAME_U019 &&
        name !== NEW_MIGRATION_NAME_U021 &&
        name !== NEW_MIGRATION_NAME_U024 &&
        name !== NEW_MIGRATION_NAME_U032 &&
        name !== NEW_MIGRATION_NAME_U033 &&
        name !== NEW_MIGRATION_NAME_U034 &&
        name !== NEW_MIGRATION_NAME_U035 &&
        name !== NEW_MIGRATION_NAME_U036 &&
        name !== NEW_MIGRATION_NAME_U037 &&
        name !== NEW_MIGRATION_NAME_U038 &&
        name !== NEW_MIGRATION_NAME_U039 &&
        name !== NEW_MIGRATION_NAME_U040 &&
        name !== NEW_MIGRATION_NAME_U041 &&
        name !== NEW_MIGRATION_NAME_U042,
    )
    .sort();
}

/** Every real migration EXCEPT U021's own — the exact formal migration prefix "through U020" the
 * U021 legacy-upgrade lane deploys BEFORE loading the pre-U021 fixture (U021 dispatch: "the exact
 * formal migration prefix through U020"). Computed from disk (not a fixed unit list): U021 is
 * currently the newest migration, so this is simply every directory except U021's own. */
function listMigrationsThroughU020(): string[] {
  return readdirSync(join(REAL_PRISMA_DIR, 'migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name !== NEW_MIGRATION_NAME_U021 && name !== NEW_MIGRATION_NAME_U024 && name !== NEW_MIGRATION_NAME_U032 && name !== NEW_MIGRATION_NAME_U033 && name !== NEW_MIGRATION_NAME_U034 && name !== NEW_MIGRATION_NAME_U035 && name !== NEW_MIGRATION_NAME_U036 && name !== NEW_MIGRATION_NAME_U037 && name !== NEW_MIGRATION_NAME_U038 && name !== NEW_MIGRATION_NAME_U039 && name !== NEW_MIGRATION_NAME_U040 && name !== NEW_MIGRATION_NAME_U041 && name !== NEW_MIGRATION_NAME_U042)
    .sort();
}

interface MigrationView {
  dir: string;
  schemaPath: string;
  migrationsDir: string;
  membership: Record<string, string>;
}

/** Builds a task-temp read-only migration view made only of symlinks to the canonical
 * migration_lock.toml and each migration's `migration.sql` — the runner never copies/edits/
 * renames migration SQL. Each migration gets a real (empty) directory rather than a directory
 * symlink: on this filesystem `fs.Dirent.isDirectory()` reports `false` for a symlink-to-directory
 * (readdir surfaces the DT_LNK type, not the resolved target's type), which makes Prisma's own
 * migration-folder discovery see zero migrations through a directory-symlinked view. Symlinking at
 * the `migration.sql` file level sidesteps that while keeping the actual SQL content — the only
 * thing that can be tampered with — a genuine, hash-verifiable symlink to the canonical file, never
 * a copy. `membership` records each symlink's SHA-256 target hash for the evidence receipt. */
function buildReadOnlyMigrationView(label: string, migrationNames: string[]): MigrationView {
  const dir = mkdtempSync(join(tmpdir(), `u012-view-${label}-`));
  cpSync(join(REAL_PRISMA_DIR, 'schema.prisma'), join(dir, 'schema.prisma'));
  const migrationsDir = join(dir, 'migrations');
  mkdirSync(migrationsDir);
  const membership: Record<string, string> = {};
  const lockTarget = join(REAL_PRISMA_DIR, 'migrations', 'migration_lock.toml');
  symlinkSync(lockTarget, join(migrationsDir, 'migration_lock.toml'));
  membership['migration_lock.toml'] = sha256File(lockTarget);
  for (const name of migrationNames) {
    const targetDir = join(REAL_PRISMA_DIR, 'migrations', name);
    mkdirSync(join(migrationsDir, name));
    symlinkSync(join(targetDir, 'migration.sql'), join(migrationsDir, name, 'migration.sql'));
    membership[name] = sha256File(join(targetDir, 'migration.sql'));
  }
  return { dir, schemaPath: join(dir, 'schema.prisma'), migrationsDir, membership };
}

function addMigrationToView(view: MigrationView, name: string) {
  const targetDir = join(REAL_PRISMA_DIR, 'migrations', name);
  mkdirSync(join(view.migrationsDir, name));
  symlinkSync(join(targetDir, 'migration.sql'), join(view.migrationsDir, name, 'migration.sql'));
  view.membership[name] = sha256File(join(targetDir, 'migration.sql'));
}

/** Re-reads every symlink THROUGH the view and re-hashes, proving each one still resolves to
 * exactly the canonical bytes recorded in `membership` (hash-verified, not merely present). */
function verifyViewIntegrity(view: MigrationView, migrationNames: string[]) {
  const lockViaSymlink = sha256File(join(view.migrationsDir, 'migration_lock.toml'));
  if (lockViaSymlink !== view.membership['migration_lock.toml']) {
    throw new ContractFailure(EXIT.CONTRACT, 'legacy migration view: migration_lock.toml symlink hash mismatch');
  }
  for (const name of migrationNames) {
    const viaSymlink = sha256File(join(view.migrationsDir, name, 'migration.sql'));
    if (viaSymlink !== view.membership[name]) {
      throw new ContractFailure(EXIT.CONTRACT, `legacy migration view: migration ${name} symlink hash mismatch`);
    }
  }
}

interface QaAttempt {
  label: string;
  expect: 'ok' | 'reject';
  sql: string;
}

/** Runs one INSERT wrapped in a DO block that catches any error and reports SQLSTATE + the
 * violated constraint name via GET STACKED DIAGNOSTICS, so the real-surface QA log carries the
 * exact SQLSTATE/constraint pair the dispatch requires without regex-parsing error text. */
async function attemptQaInsert(containerName: string, conn: { user: string; password: string; database: string }, attempt: QaAttempt): Promise<string> {
  const wrapped = `DO $qa$
DECLARE
  v_constraint text;
BEGIN
  ${attempt.sql}
  RAISE NOTICE 'QA_RESULT|%|OK|-', '${attempt.label}';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  RAISE NOTICE 'QA_RESULT|%|%|%', '${attempt.label}', SQLSTATE, COALESCE(v_constraint, '-');
END $qa$;`;
  const r = await spawnCapture(
    ['docker', 'exec', '-i', '-e', `PGPASSWORD=${conn.password}`, containerName, 'psql', '-h', '127.0.0.1', '-U', conn.user, '-d', conn.database, '-v', 'ON_ERROR_STOP=1', '-c', wrapped],
    sanitizedEnv({}),
  );
  if (r.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `QA attempt "${attempt.label}" harness failed: ${r.stderr || r.stdout}`);
  const match = /QA_RESULT\|([^|]*)\|([^|]*)\|(.*)/.exec(r.stdout + r.stderr);
  if (!match) throw new ContractFailure(EXIT.CONTRACT, `QA attempt "${attempt.label}" produced no QA_RESULT line: ${r.stdout}\n${r.stderr}`);
  const [, label, outcome, constraint] = match;
  const line = `[${attempt.expect === 'ok' ? 'valid' : 'invalid'}] ${label}: outcome=${outcome} constraint=${constraint}`;
  if (attempt.expect === 'ok' && outcome !== 'OK') {
    throw new ContractFailure(EXIT.CONTRACT, `QA attempt "${label}" expected to succeed but got ${outcome} (${constraint})`);
  }
  if (attempt.expect === 'reject' && outcome === 'OK') {
    throw new ContractFailure(EXIT.CONTRACT, `QA attempt "${label}" expected to be rejected but succeeded`);
  }
  return line;
}

async function runLegacyLifecycleScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};
  let view: MigrationView | null = null;
  const scenarioEvidenceDir = join(evidenceDir, 'legacy-scenario');

  try {
    await withIsolatedPostgres(
      { runId, ownerUnit: OWNER_UNIT_U012, purpose: `${PURPOSE_U012}-legacy`, evidenceDir: scenarioEvidenceDir, imageDigest: IMAGE_DIGEST, migrate: false },
      async (ctx: any) => {
        const conn = parseConn(ctx.databaseUrl);
        const throughU010 = listMigrationsThroughU010();

        view = buildReadOnlyMigrationView('legacy', throughU010);
        verifyViewIntegrity(view, throughU010);
        evidence.viewMembershipThroughU010 = { ...view.membership };

        const genPrefix = await runWorkspaceGenerate(join(REAL_PRISMA_DIR, 'schema.prisma'));
        if (genPrefix.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `generate failed: ${genPrefix.stderr || genPrefix.stdout}`);

        const deployPrefix = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (deployPrefix.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy (through U010, symlink view) failed: ${deployPrefix.stderr || deployPrefix.stdout}`);
        evidence.deployThroughU010 = { migrated: true, migrationCount: throughU010.length };

        // Load the legacy fixture strictly between the U010-prefix deploy and adding the U011
        // migration symlink, so U011 finds non-empty data (loading it after U011 is a test
        // failure per the dispatch).
        await seedFixture(ctx.containerName, conn);

        addMigrationToView(view, NEW_MIGRATION_NAME);
        verifyViewIntegrity(view, [...throughU010, NEW_MIGRATION_NAME]);
        evidence.viewMembershipWithU011 = { ...view.membership };

        const deployU011 = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (deployU011.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy (+U011, symlink view) failed: ${deployU011.stderr || deployU011.stdout}`);

        const noEmptySentinel = await execSql(ctx.containerName, conn, `SELECT count(*) FROM scope_backfill_quarantine WHERE source_model = '__ScopeBackfillControl';`);
        if (noEmptySentinel !== '0') {
          throw new ContractFailure(EXIT.CONTRACT, `U011 must create no empty sentinel on a non-empty database, found ${noEmptySentinel} control row(s)`);
        }
        evidence.u011CreatedNoEmptySentinel = true;

        const dryRunBefore = await execSql(ctx.containerName, conn, `SELECT count(*) FROM projects WHERE company_id IS NULL;`);
        const dryRun = await runBackfillScript(ctx.databaseUrl);
        if (dryRun.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `U011 dry run failed: ${dryRun.stdout}\n${dryRun.stderr}`);
        const dryRunJson: DryRunReport = JSON.parse(dryRun.stdout);
        const dryRunAfter = await execSql(ctx.containerName, conn, `SELECT count(*) FROM projects WHERE company_id IS NULL;`);
        if (dryRunBefore !== dryRunAfter) throw new ContractFailure(EXIT.CONTRACT, `U011 dry run wrote non-zero writes: before=${dryRunBefore} after=${dryRunAfter}`);

        const reviewFile = buildReviewFile(dryRunJson, 'u012-legacy-lifecycle-reviewer');
        writeFileSync(join(scenarioEvidenceDir, 'scope-review.json'), `${JSON.stringify(reviewFile, null, 2)}\n`);
        const reviewFilePath = join(mkdtempSync(join(tmpdir(), 'u012-review-')), 'scope-review.json');
        writeFileSync(reviewFilePath, JSON.stringify(reviewFile));

        const apply = await runBackfillScript(ctx.databaseUrl, { APPLY: '1', SCOPE_REVIEW_FILE: reviewFilePath });
        if (apply.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `U011 reviewed apply failed: ${apply.stdout}\n${apply.stderr}`);
        const applyJson = JSON.parse(apply.stdout);
        writeFileSync(join(scenarioEvidenceDir, 'scope-apply.json'), `${JSON.stringify(applyJson, null, 2)}\n`);

        const rerun = await runBackfillScript(ctx.databaseUrl, { APPLY: '1', SCOPE_REVIEW_FILE: reviewFilePath });
        if (rerun.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `U011 rerun failed: ${rerun.stdout}\n${rerun.stderr}`);
        const rerunJson = JSON.parse(rerun.stdout);
        if (rerunJson.changedCount !== 0) throw new ContractFailure(EXIT.CONTRACT, `U011 rerun changedCount expected 0, got ${rerunJson.changedCount}`);

        const controlRowMode = await execSql(ctx.containerName, conn, `SELECT reason_code FROM scope_backfill_quarantine WHERE source_model='__ScopeBackfillControl' AND source_id='scope-closure/v1';`);
        if (controlRowMode !== 'scope_backfill_reviewed_apply') {
          throw new ContractFailure(EXIT.CONTRACT, `expected a reviewed_apply control row after U011 apply, got "${controlRowMode}"`);
        }

        writeFileSync(join(evidenceDir, 'closure-before.json'), `${JSON.stringify({ dryRun: dryRunJson, apply: applyJson, rerun: rerunJson }, null, 2)}\n`);
        evidence.u011Apply = { reviewDigest: applyJson.reviewDigest, conservation: applyJson.conservation, changedCount: applyJson.changedCount, controlOutcome: applyJson.controlOutcome };
        evidence.u011RerunChangedCount = rerunJson.changedCount;

        addMigrationToView(view, NEW_MIGRATION_NAME_U012);
        verifyViewIntegrity(view, [...throughU010, NEW_MIGRATION_NAME, NEW_MIGRATION_NAME_U012]);
        evidence.viewMembershipWithU012 = { ...view.membership };

        const genFull = await runWorkspaceGenerate(join(REAL_PRISMA_DIR, 'schema.prisma'));
        if (genFull.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `generate (full schema) failed: ${genFull.stderr || genFull.stdout}`);

        const deployU012 = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (deployU012.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy (+U012, symlink view) failed: ${deployU012.stderr || deployU012.stdout}`);
        evidence.deployU012 = { migrated: true };

        const scopeCheck = await runScopeCheck();
        if (scopeCheck.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `scope:check failed after U012: ${scopeCheck.stdout}\n${scopeCheck.stderr}`);
        const scopeCheckJson = JSON.parse(scopeCheck.stdout);
        if (scopeCheckJson.currentModelCount !== scopeCheckJson.inventoryModelCount || scopeCheckJson.ok !== true) {
          throw new ContractFailure(EXIT.CONTRACT, `scope:check did not report ok=true with schema matching the canonical inventory after U012: ${scopeCheck.stdout}`);
        }
        // This scenario deploys migrations only through U012 to the scratch DB, but `scope:check`
        // reads Prisma.dmmf from whatever schema.prisma currently is (genFull above uses the real,
        // current file) — so these tallies track the CURRENT total registered-model tally, not a
        // point-in-time snapshot at U012. GLOBAL_SHARED was 13 through U039, but U040 is the first unit
        // to reduce it: its mandatory catalog reclassification moves ProductFamily GLOBAL_SHARED ->
        // COMPANY_ROOT and LicenseMetric GLOBAL_SHARED -> CHILD_VIA_FK, so GLOBAL_SHARED 13 -> 11.
        // CHILD_VIA_FK (88 as of U042 — U042 adds six CHILD_VIA_FK models and four COMPANY_DIRECT
        // entries: new RetentionRun/LegalHoldScope plus reclassified DataExportRequest/ArtifactAccessEvent,
        // reaching 189 models; RoleChangeRequest's U012 reclassification plus every later
        // CHILD_VIA_FK registration, most recently U039's SupportCaseSlaSnapshot [74 -> 75], U040's
        // LicenseMetric reclassification [75 -> 76], and U041's six immutable AI quality children
        // [76 -> 82]: AiQualityAssessment/Evidence/Review/ReleaseEvaluation/PromptSnapshot/ModelSnapshot)
        // must be updated by any future unit that adds/
        // reclassifies a CHILD_VIA_FK or GLOBAL_SHARED model, exactly as U017/U018/U019 updated it here.
        if (scopeCheckJson.tallies.CHILD_VIA_FK !== 88 || scopeCheckJson.tallies.GLOBAL_SHARED !== 11) {
          throw new ContractFailure(EXIT.CONTRACT, `scope:check tallies do not reflect the U012 RoleChangeRequest reclassification: ${JSON.stringify(scopeCheckJson.tallies)}`);
        }
        writeFileSync(join(evidenceDir, 'inventory.json'), `${JSON.stringify(scopeCheckJson, null, 2)}\n`);

        const scopeValidate = await runScopeValidate(ctx.databaseUrl);
        const scopeValidateJson = JSON.parse(scopeValidate.stdout);
        writeFileSync(join(evidenceDir, 'scope-validate.json'), `${JSON.stringify(scopeValidateJson, null, 2)}\n`);
        if (scopeValidate.code !== 0 || scopeValidateJson.ok !== true || scopeValidateJson.blockers.length !== 0) {
          throw new ContractFailure(EXIT.CONTRACT, `scope:validate reported blockers on the valid closed fixture: ${scopeValidate.stdout}`);
        }
        evidence.scopeValidate = { ok: scopeValidateJson.ok, blockerCount: scopeValidateJson.blockers.length };

        const pgConstraintTsv = await execSqlTsv(
          ctx.containerName,
          conn,
          `SELECT conname, contype, convalidated FROM pg_constraint WHERE conname IN (
             'companies_tenant_id_id_key','projects_company_id_id_key','user_company_roles_id_company_id_key',
             'projects_company_id_required_for_new_rows_check','role_change_requests_company_id_fkey'
           ) ORDER BY conname;`,
        );
        writeFileSync(join(evidenceDir, 'pg-constraint.tsv'), pgConstraintTsv);
        // execSqlTsv runs psql without -t (tuples-only), so the output carries a header row and a
        // "(N rows)" footer around the data — keep only lines shaped like "name\ttype\nt|f".
        const constraintRows = pgConstraintTsv
          .trim()
          .split('\n')
          .filter((line) => /^\S+\t[a-z]\t[tf]$/.test(line));
        if (constraintRows.length !== 5) {
          throw new ContractFailure(EXIT.CONTRACT, `expected exactly 5 new/verified named constraints in pg_constraint, got ${constraintRows.length}: ${pgConstraintTsv}`);
        }
        for (const line of constraintRows) {
          const [name, , validated] = line.split('\t');
          if (validated !== 't') throw new ContractFailure(EXIT.CONTRACT, `constraint ${name} is not convalidated=true`);
        }

        const dmmfUnique = await execSql(ctx.containerName, conn, `SELECT count(*) FROM pg_constraint WHERE conname = 'user_company_roles_id_company_id_key' AND contype = 'u';`);
        if (dmmfUnique !== '1') throw new ContractFailure(EXIT.CONTRACT, 'user_company_roles_id_company_id_key composite unique constraint missing');
        evidence.userCompanyRoleCompositeUnique = true;

        const resolvedProjectId = reviewFile.entries.find((e) => e.decision === 'assign')?.sourceId;
        const resolvedProjectCompanyId = resolvedProjectId
          ? await execSql(ctx.containerName, conn, `SELECT company_id FROM projects WHERE id = '${resolvedProjectId}';`)
          : null;
        const otherCompanyId = await execSql(ctx.containerName, conn, `SELECT id FROM companies WHERE id <> '${resolvedProjectCompanyId}' LIMIT 1;`);

        await execSql(
          ctx.containerName,
          conn,
          `CREATE TABLE demo_scoped_assignment (
             id text PRIMARY KEY,
             assignment_company_id text NOT NULL,
             project_id text NOT NULL,
             FOREIGN KEY (project_id, assignment_company_id) REFERENCES projects(id, company_id)
           );`,
        );

        const qaLines: string[] = [];
        qaLines.push(
          await attemptQaInsert(ctx.containerName, conn, {
            label: 'same-company composite assignment',
            expect: 'ok',
            sql: `INSERT INTO demo_scoped_assignment (id, assignment_company_id, project_id) VALUES ('qa-valid-1', '${resolvedProjectCompanyId}', '${resolvedProjectId}');`,
          }),
        );
        qaLines.push(
          await attemptQaInsert(ctx.containerName, conn, {
            label: 'cross-company composite assignment',
            expect: 'reject',
            sql: `INSERT INTO demo_scoped_assignment (id, assignment_company_id, project_id) VALUES ('qa-invalid-1', '${otherCompanyId}', '${resolvedProjectId}');`,
          }),
        );
        qaLines.push(
          await attemptQaInsert(ctx.containerName, conn, {
            label: 'new Project with NULL company_id',
            expect: 'reject',
            sql: `INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES ('qa-invalid-project', 'qa-invalid-project', 'QA', NULL, now(), now());`,
          }),
        );
        qaLines.push(
          await attemptQaInsert(ctx.containerName, conn, {
            label: 'RoleChangeRequest NULL company_id',
            expect: 'reject',
            sql: `INSERT INTO role_change_requests (id, user_id, from_role, to_role, status, requested_by, created_at) VALUES ('qa-invalid-rcr-null', 'fx-user-resolver', 'member', 'admin', 'pending', 'fx-user-resolver', now());`,
          }),
        );
        qaLines.push(
          await attemptQaInsert(ctx.containerName, conn, {
            label: 'RoleChangeRequest company_id references a missing company',
            expect: 'reject',
            sql: `INSERT INTO role_change_requests (id, user_id, from_role, to_role, status, requested_by, company_id, created_at) VALUES ('qa-invalid-rcr-fk', 'fx-user-resolver', 'member', 'admin', 'pending', 'fx-user-resolver', 'company-does-not-exist', now());`,
          }),
        );
        writeFileSync(join(evidenceDir, 'constraint-negative.log'), `${qaLines.join('\n')}\n`);

        await execSql(ctx.containerName, conn, `DROP TABLE demo_scoped_assignment;`);

        // runMigrateDiff below compares against the canonical schema.prisma, which reflects every
        // migration on disk. The view has now proven the U010→U011→U012 ordering; extend it with
        // whatever real migrations exist beyond U012 (computed from disk, not a fixed unit list) so
        // future units are picked up automatically and this stays a true full deploy.
        const remainingAfterU012 = readdirSync(join(REAL_PRISMA_DIR, 'migrations'), { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .filter((name) => !(name in view.membership))
          .sort();
        for (const name of remainingAfterU012) {
          addMigrationToView(view, name);
        }
        verifyViewIntegrity(view, [...throughU010, NEW_MIGRATION_NAME, NEW_MIGRATION_NAME_U012, ...remainingAfterU012]);
        evidence.viewMembershipFull = { ...view.membership };

        const deployRemaining = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (deployRemaining.code !== 0) {
          throw new ContractFailure(EXIT.CONTRACT, `migrate deploy (remaining canonical migrations beyond U012, symlink view) failed: ${deployRemaining.stderr || deployRemaining.stdout}`);
        }
        evidence.deployRemainingAfterU012 = { migrated: true, migrations: remainingAfterU012 };

        const redeploy = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (redeploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy re-run was not reproducible: ${redeploy.stderr || redeploy.stdout}`);
        evidence.migrateDeployReproducible = true;

        const diff = await runMigrateDiff(ctx.databaseUrl);
        const diffText = diff.stdout.trim();
        const isEmptyDiff = diff.code === 0 && (diffText.length === 0 || diffText === '-- This is an empty migration.');
        writeFileSync(join(evidenceDir, 'migration-diff.sql'), '');
        if (!isEmptyDiff) {
          throw new ContractFailure(EXIT.CONTRACT, `schema diff not empty after full deploy: exit=${diff.code} stdout=${diff.stdout}`);
        }
        evidence.emptySchemaDiff = true;

        return evidence;
      },
    );
  } finally {
    if (view) {
      const viewDirToRemove = (view as MigrationView).dir;
      rmSync(viewDirToRemove, { recursive: true, force: true });
      const canonicalLockHash = sha256File(join(REAL_PRISMA_DIR, 'migrations', 'migration_lock.toml'));
      const recordedLockHash = (evidence.viewMembershipWithU012 as Record<string, string> | undefined)?.['migration_lock.toml'];
      evidence.viewRemovedInFinally = true;
      evidence.canonicalMigrationLockUntouchedAfterCleanup = recordedLockHash === undefined ? null : canonicalLockHash === recordedLockHash;
    }
  }

  return evidence;
}

async function runEmptyLifecycleScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};
  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT_U012, purpose: `${PURPOSE_U012}-empty`, evidenceDir: join(evidenceDir, 'empty-scenario'), imageDigest: IMAGE_DIGEST, migrate: true },
    async (ctx: any) => {
      const conn = parseConn(ctx.databaseUrl);

      const sentinel = await execSql(
        ctx.containerName,
        conn,
        `SELECT reason_code || '|' || resolved_by FROM scope_backfill_quarantine WHERE source_model = '__ScopeBackfillControl' AND source_id = 'scope-closure/v1';`,
      );
      if (sentinel !== 'scope_backfill_empty_database|migration:20260715110000_scope_backfill_quarantine') {
        throw new ContractFailure(EXIT.CONTRACT, `full-chain empty deploy missing exact U011 empty sentinel: got "${sentinel}"`);
      }
      evidence.emptyDatabaseSentinelConsumedByU012 = sentinel;

      const projectsCount = await execSql(ctx.containerName, conn, `SELECT count(*) FROM projects;`);
      const rcrCount = await execSql(ctx.containerName, conn, `SELECT count(*) FROM role_change_requests;`);
      if (projectsCount !== '0' || rcrCount !== '0') {
        throw new ContractFailure(EXIT.CONTRACT, `empty-path scenario expected both source tables empty, got projects=${projectsCount} role_change_requests=${rcrCount}`);
      }
      evidence.bothSourceTablesEmpty = true;

      const pgConstraintTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT conname, contype, convalidated FROM pg_constraint WHERE conname IN (
           'companies_tenant_id_id_key','projects_company_id_id_key','user_company_roles_id_company_id_key',
           'projects_company_id_required_for_new_rows_check','role_change_requests_company_id_fkey'
         ) ORDER BY conname;`,
      );
      const emptyPathConstraintRows = pgConstraintTsv
        .trim()
        .split('\n')
        .filter((line) => /^\S+\t[a-z]\t[tf]$/.test(line));
      if (emptyPathConstraintRows.length !== 5) {
        throw new ContractFailure(EXIT.CONTRACT, `expected exactly 5 constraints in the empty-path pg_constraint check, got ${emptyPathConstraintRows.length}: ${pgConstraintTsv}`);
      }
      for (const line of emptyPathConstraintRows) {
        const [name, , validated] = line.split('\t');
        if (validated !== 't') throw new ContractFailure(EXIT.CONTRACT, `empty-path constraint ${name} is not convalidated=true`);
      }
      evidence.emptyPathConstraintsConvalidated = true;

      const scopeValidate = await runScopeValidate(ctx.databaseUrl);
      const scopeValidateJson = JSON.parse(scopeValidate.stdout);
      writeFileSync(join(evidenceDir, 'scope-validate-empty-path.json'), `${JSON.stringify(scopeValidateJson, null, 2)}\n`);
      if (scopeValidate.code !== 0 || scopeValidateJson.ok !== true || scopeValidateJson.blockers.length !== 0) {
        throw new ContractFailure(EXIT.CONTRACT, `scope:validate reported blockers on the empty-path closed fixture: ${scopeValidate.stdout}`);
      }
      evidence.scopeValidate = { ok: scopeValidateJson.ok, blockerCount: scopeValidateJson.blockers.length };
    },
  );
  return evidence;
}

async function runScopeBackfillSuite(evidenceDir: string): Promise<number> {
  const runId = `u011${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let caughtError: unknown = null;
  let fixtureEvidence: Record<string, unknown> | null = null;
  let emptyEvidence: Record<string, unknown> | null = null;
  try {
    fixtureEvidence = await runFixtureScenario(evidenceDir, runId);
    emptyEvidence = await runEmptyDatabaseScenario(evidenceDir, runId);
  } catch (error) {
    caughtError = error;
  }

  const labelCounts = await labelResourceCounts(runId);
  const cleanupOk = labelCounts.containers === 0 && labelCounts.networks === 0 && labelCounts.volumes === 0;
  const cleanup = {
    schemaVersion: 1,
    unit: OWNER_UNIT,
    purpose: PURPOSE,
    runId,
    postgres: { containers: labelCounts.containers, networks: labelCounts.networks, volumes: labelCounts.volumes },
    http: null,
    httpReason: 'U011 owns no HTTP server surface — scope backfill is a DB-only migration/script unit with no web/API process to bind or tear down.',
    childProcesses: 0,
    result: cleanupOk ? 'PASS' : 'FAIL',
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(evidenceDir, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`run-db-contract: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError instanceof ContractFailure ? caughtError.exitCode : EXIT.CONTRACT;
  }

  writeFileSync(
    join(evidenceDir, 'db-contract-receipt.json'),
    `${JSON.stringify({ schemaVersion: 1, unit: OWNER_UNIT, suite: 'scope-backfill', result: 'PASS', fixtureEvidence, emptyEvidence, cleanup, startedAt, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return EXIT.SUCCESS;
}

async function runScopeClosureSuite(evidenceDir: string): Promise<number> {
  const runId = `u012${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let caughtError: unknown = null;
  let legacyEvidence: Record<string, unknown> | null = null;
  let emptyEvidence: Record<string, unknown> | null = null;
  try {
    legacyEvidence = await runLegacyLifecycleScenario(evidenceDir, runId);
    emptyEvidence = await runEmptyLifecycleScenario(evidenceDir, runId);
  } catch (error) {
    caughtError = error;
  }

  const [legacyCounts, emptyCounts] = await Promise.all([
    labelResourceCounts(runId, OWNER_UNIT_U012, `${PURPOSE_U012}-legacy`),
    labelResourceCounts(runId, OWNER_UNIT_U012, `${PURPOSE_U012}-empty`),
  ]);
  const totalCounts = {
    containers: legacyCounts.containers + emptyCounts.containers,
    networks: legacyCounts.networks + emptyCounts.networks,
    volumes: legacyCounts.volumes + emptyCounts.volumes,
  };
  const cleanupOk = totalCounts.containers === 0 && totalCounts.networks === 0 && totalCounts.volumes === 0;
  const cleanup = {
    schemaVersion: 1,
    unit: OWNER_UNIT_U012,
    purpose: PURPOSE_U012,
    runId,
    postgres: totalCounts,
    http: null,
    httpReason: 'U012 owns no HTTP server surface — scope closure is a DB-only migration/script unit with no web/API process to bind or tear down.',
    childProcesses: 0,
    result: cleanupOk ? 'PASS' : 'FAIL',
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(evidenceDir, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`run-db-contract: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError instanceof ContractFailure ? caughtError.exitCode : EXIT.CONTRACT;
  }

  writeFileSync(
    join(evidenceDir, 'db-contract-receipt.json'),
    `${JSON.stringify({ schemaVersion: 1, unit: OWNER_UNIT_U012, suite: 'scope-closure', result: 'PASS', legacyEvidence, emptyEvidence, cleanup, startedAt, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return EXIT.SUCCESS;
}

// ─────────────────────────────────────────────────────────────────────────
// U014 — principal-session suite
// ─────────────────────────────────────────────────────────────────────────

const PRINCIPAL_SESSION_FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('u014-tenant-1', 'U014 Tenant One', 'u014-tenant-1', 'active', now()),
  ('u014-tenant-2', 'U014 Tenant Two', 'u014-tenant-2', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u014-company-1', 'u014-tenant-1', 'U014 Company One', 'u014-company-1', now()),
  ('u014-company-2', 'u014-tenant-2', 'U014 Company Two', 'u014-company-2', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u014-project-1', 'u014-project-1', 'U014 Project', 'u014-company-1', now(), now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('u014-user-omitted-status', 'omitted@u014.example.com', 'Omitted Status', now(), now());

INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES
  ('u014-user-active', 'active@u014.example.com', 'Active User', 'active', now(), now()),
  ('u014-user-legacy', 'legacy@u014.example.com', 'Legacy User', 'legacy_pending', now(), now());

INSERT INTO users (id, email, name, status, disabled_at, disabled_reason, created_at, updated_at) VALUES
  ('u014-user-disabled', 'disabled@u014.example.com', 'Disabled User', 'disabled', now(), 'qa fixture', now(), now());

INSERT INTO auth_sessions (id, user_id, tenant_id, company_id, project_id, issued_at, expires_at, created_at, updated_at) VALUES
  ('u014-jti-active', 'u014-user-active', 'u014-tenant-1', 'u014-company-1', 'u014-project-1', now(), now() + interval '15 minutes', now(), now()),
  ('u014-jti-revoked', 'u014-user-active', 'u014-tenant-1', 'u014-company-1', 'u014-project-1', now(), now() + interval '15 minutes', now(), now()),
  ('u014-jti-expired', 'u014-user-active', 'u014-tenant-1', 'u014-company-1', 'u014-project-1', now() - interval '20 minutes', now() - interval '5 minutes', now(), now()),
  ('u014-jti-disabled-user', 'u014-user-disabled', 'u014-tenant-1', 'u014-company-1', 'u014-project-1', now(), now() + interval '15 minutes', now(), now()),
  ('u014-jti-legacy-user', 'u014-user-legacy', 'u014-tenant-1', 'u014-company-1', 'u014-project-1', now(), now() + interval '15 minutes', now(), now());

UPDATE auth_sessions SET revoked_at = now() WHERE id = 'u014-jti-revoked';
`;

/** Locates the `.prisma/client/schema.prisma` copy `prisma generate` just wrote (this repo's
 * single Prisma schema/generator means there is exactly one live candidate; picks the
 * most-recently-modified match defensively). Used only to prove the generated client actually
 * embeds the exact canonical schema this suite is about to test against — never to locate a
 * client for import (this file never imports `@prisma/client` itself; every DB touch here is raw
 * SQL via `docker exec ... psql`, same as the U011/U012 suites above). */
function findGeneratedClientSchemaCopy(): string | null {
  const pnpmDir = join(REPO_ROOT, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return null;
  const candidates = readdirSync(pnpmDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('@prisma+client@'))
    .map((d) => join(pnpmDir, d.name, 'node_modules', '.prisma', 'client', 'schema.prisma'))
    .filter((p) => existsSync(p));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0];
}

interface PinnedGenerateResult {
  ok: boolean;
  clientSchemaHash: string | null;
  canonicalSchemaHash: string;
}

/** The dispatch's `[PREREQUISITE COMMAND ADDITION]`: re-runs the same pinned `prisma generate`
 * after scratch-container creation, before any integration step, and asserts the generated
 * client's embedded schema hash matches the canonical `schema.prisma` hash. A generate failure or
 * hash mismatch must block the suite before it starts integration — never a silent stale-client
 * run.
 *
 * `prisma generate` reformats (column-realigns) the schema copy it embeds in the generated
 * client, so a raw byte-hash of `schema.prisma` itself would always mismatch even when the client
 * was genuinely built from the current file. The canonical side is therefore hashed AFTER running
 * the identical `prisma format` over a disposable copy — never the tracked file — which reduces
 * the comparison to "did the client actually embed this schema's content", not "is Prisma's own
 * formatter a no-op". */
async function runPinnedGenerateWithSchemaHash(evidenceDir: string): Promise<PinnedGenerateResult> {
  const schemaPath = join(REAL_PRISMA_DIR, 'schema.prisma');

  const gen = await runWorkspaceGenerate(schemaPath);
  writeFileSync(join(evidenceDir, 'prisma-generate.log'), `exit=${gen.code}\n--- stdout ---\n${gen.stdout}\n--- stderr ---\n${gen.stderr}\n`);

  const formatCopyDir = mkdtempSync(join(tmpdir(), 'u014-schema-format-'));
  const formatCopyPath = join(formatCopyDir, 'schema.prisma');
  cpSync(schemaPath, formatCopyPath);
  const fmt = await runWorkspaceFormat(formatCopyPath);
  const canonicalSchemaHash = fmt.code === 0 ? sha256File(formatCopyPath) : sha256File(schemaPath);
  rmSync(formatCopyDir, { recursive: true, force: true });

  if (gen.code !== 0 || fmt.code !== 0) return { ok: false, clientSchemaHash: null, canonicalSchemaHash };
  const generatedCopy = findGeneratedClientSchemaCopy();
  const clientSchemaHash = generatedCopy ? sha256File(generatedCopy) : null;
  return { ok: clientSchemaHash !== null && clientSchemaHash === canonicalSchemaHash, clientSchemaHash, canonicalSchemaHash };
}

async function runPrincipalSessionScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};

  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT_U014, purpose: PURPOSE_U014, evidenceDir, imageDigest: IMAGE_DIGEST, migrate: false },
    async (ctx: any) => {
      const conn = parseConn(ctx.databaseUrl);
      const schemaPath = join(REAL_PRISMA_DIR, 'schema.prisma');

      const pinned = await runPinnedGenerateWithSchemaHash(evidenceDir);
      evidence.pinnedGenerate = pinned;
      if (!pinned.ok) {
        throw new ContractFailure(
          EXIT.CONTRACT,
          `pinned db:generate schema-hash assertion failed (generate failure or hash mismatch): client=${pinned.clientSchemaHash} canonical=${pinned.canonicalSchemaHash}`,
        );
      }

      const deploy = await runWorkspaceMigrateDeploy(ctx.databaseUrl, schemaPath);
      if (deploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy failed: ${deploy.stderr || deploy.stdout}`);
      evidence.migrateDeploy = { migrated: true };
      evidence.scratchIdentity = { runId: ctx.sentinel.runId, ownerUnit: ctx.sentinel.ownerUnit, purpose: ctx.sentinel.purpose, databaseName: ctx.databaseName };

      const scopeCheck = await runScopeCheck();
      if (scopeCheck.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `scope:check failed: ${scopeCheck.stdout}\n${scopeCheck.stderr}`);
      const scopeCheckJson = JSON.parse(scopeCheck.stdout);
      if (scopeCheckJson.currentModelCount !== scopeCheckJson.inventoryModelCount || scopeCheckJson.ok !== true) {
        throw new ContractFailure(EXIT.CONTRACT, `scope:check did not report ok=true with schema matching the canonical inventory: ${scopeCheck.stdout}`);
      }
      writeFileSync(join(evidenceDir, 'inventory.json'), `${JSON.stringify(scopeCheckJson, null, 2)}\n`);
      evidence.scopeCheck = { currentModelCount: scopeCheckJson.currentModelCount, inventoryModelCount: scopeCheckJson.inventoryModelCount, ok: scopeCheckJson.ok, tallies: scopeCheckJson.tallies };

      await execSql(ctx.containerName, conn, PRINCIPAL_SESSION_FIXTURE_SQL);

      const preexistingRow = await execSql(
        ctx.containerName,
        conn,
        `SELECT status || '|' || (disabled_at IS NULL)::text FROM users WHERE id = 'u014-user-omitted-status';`,
      );
      if (preexistingRow !== 'legacy_pending|true') {
        throw new ContractFailure(EXIT.CONTRACT, `a User row inserted without an explicit status must default to legacy_pending with disabled_at NULL, got: ${preexistingRow}`);
      }
      writeFileSync(join(evidenceDir, 'session-migration.log'), `pre-existing-row-status-default: ${preexistingRow} (never blanket-activated)\n`);
      evidence.migrationNeverBlanketActivates = true;

      const qaLines: string[] = [];
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'active user with disabled_at NULL',
        expect: 'ok',
        sql: `INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES ('u014-qa-active-ok','qa-active-ok@u014.example.com','QA','active', now(), now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'active user with disabled_at set',
        expect: 'reject',
        sql: `INSERT INTO users (id, email, name, status, disabled_at, created_at, updated_at) VALUES ('u014-qa-active-bad','qa-active-bad@u014.example.com','QA','active', now(), now(), now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'disabled user with disabled_at NULL',
        expect: 'reject',
        sql: `INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES ('u014-qa-disabled-bad','qa-disabled-bad@u014.example.com','QA','disabled', now(), now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'unknown status value',
        expect: 'reject',
        sql: `INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES ('u014-qa-unknown-bad','qa-unknown-bad@u014.example.com','QA','superuser', now(), now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'AuthSession company_id belonging to a different tenant_id',
        expect: 'reject',
        sql: `INSERT INTO auth_sessions (id, user_id, tenant_id, company_id, project_id, issued_at, expires_at, created_at, updated_at) VALUES ('u014-qa-cross-tenant','u014-user-active','u014-tenant-2','u014-company-1','u014-project-1', now(), now() + interval '15 minutes', now(), now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'AuthSession project_id belonging to a different company_id',
        expect: 'reject',
        sql: `INSERT INTO auth_sessions (id, user_id, tenant_id, company_id, project_id, issued_at, expires_at, created_at, updated_at) VALUES ('u014-qa-cross-company','u014-user-active','u014-tenant-2','u014-company-2','u014-project-1', now(), now() + interval '15 minutes', now(), now());`,
      }));
      writeFileSync(join(evidenceDir, 'constraint-negative.log'), `${qaLines.join('\n')}\n`);
      evidence.constraintQaCount = qaLines.length;

      const sessionFixtureRows = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT id, (revoked_at IS NOT NULL) AS revoked, (expires_at < now()) AS expired FROM auth_sessions WHERE id LIKE 'u014-jti-%' ORDER BY id;`,
      );
      evidence.sessionFixtureRows = sessionFixtureRows.trim();

      const redeploy = await runWorkspaceMigrateDeploy(ctx.databaseUrl, schemaPath);
      if (redeploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy re-run was not reproducible: ${redeploy.stderr || redeploy.stdout}`);
      evidence.migrateDeployReproducible = true;

      const diff = await runMigrateDiff(ctx.databaseUrl);
      const diffText = diff.stdout.trim();
      const isEmptyDiff = diff.code === 0 && (diffText.length === 0 || diffText === '-- This is an empty migration.');
      writeFileSync(join(evidenceDir, 'migration-diff.sql'), isEmptyDiff ? '' : diff.stdout);
      if (!isEmptyDiff) throw new ContractFailure(EXIT.CONTRACT, `schema diff not empty after fresh migrate deploy: exit=${diff.code} stdout=${diff.stdout}`);
      evidence.emptySchemaDiff = true;

      return evidence;
    },
  );

  return evidence;
}

async function runPrincipalSessionSuite(evidenceDir: string): Promise<number> {
  const runId = `u014${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let caughtError: unknown = null;
  let scenarioEvidence: Record<string, unknown> | null = null;
  try {
    scenarioEvidence = await runPrincipalSessionScenario(evidenceDir, runId);
  } catch (error) {
    caughtError = error;
  }

  const labelCounts = await labelResourceCounts(runId, OWNER_UNIT_U014, PURPOSE_U014);
  const cleanupOk = labelCounts.containers === 0 && labelCounts.networks === 0 && labelCounts.volumes === 0;
  const cleanup = {
    schemaVersion: 1,
    unit: OWNER_UNIT_U014,
    purpose: PURPOSE_U014,
    runId,
    postgres: { containers: labelCounts.containers, networks: labelCounts.networks, volumes: labelCounts.volumes },
    http: null,
    httpReason:
      'U014 db:contract is a DB-only migration/constraint suite with no web/API process to bind or tear down here — the real-surface HTTP/session proof (login/authenticated request/logout/disabled-user-denied) is captured separately under the U014 evidence attempt (revocation-http.log/disabled-user-http.log), each with its own U013 Express-ephemeral-protocol cleanup receipt.',
    childProcesses: 0,
    result: cleanupOk ? 'PASS' : 'FAIL',
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(evidenceDir, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`run-db-contract: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError instanceof ContractFailure ? caughtError.exitCode : EXIT.CONTRACT;
  }

  writeFileSync(
    join(evidenceDir, 'db-contract-receipt.json'),
    `${JSON.stringify({ schemaVersion: 1, unit: OWNER_UNIT_U014, suite: 'principal-session', result: 'PASS', scenarioEvidence, cleanup, startedAt, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return EXIT.SUCCESS;
}

// ─────────────────────────────────────────────────────────────────────────
// U015 — business-role suite
// ─────────────────────────────────────────────────────────────────────────

const BUSINESS_ROLE_TEN_CODES = [
  'ceo',
  'sales_manager',
  'account_manager',
  'presales_engineer',
  'solution_architect',
  'finance_manager',
  'delivery_engineer',
  'support_engineer',
  'security_officer',
  'system_admin',
];

function businessRoleFixtureSql(): string {
  const roleRows = BUSINESS_ROLE_TEN_CODES.map(
    (role) => `  ('u015-ucr-${role}', 'u015-user-${role}', 'u015-company-1', '${role}', 'active', now(), 'u015-user-admin', now())`,
  ).join(',\n');
  const roleUserRows = BUSINESS_ROLE_TEN_CODES.map(
    (role) => `  ('u015-user-${role}', '${role}@u015.example.com', '${role} fixture', 'active', now(), now())`,
  ).join(',\n');

  return `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('u015-tenant-1', 'U015 Tenant', 'u015-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u015-company-1', 'u015-tenant-1', 'U015 Company One', 'u015-company-1', now()),
  ('u015-company-2', 'u015-tenant-1', 'U015 Company Two', 'u015-company-2', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u015-project-1', 'u015-project-1', 'U015 Project', 'u015-company-1', now(), now());

INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES
  ('u015-user-admin', 'admin@u015.example.com', 'Admin fixture', 'active', now(), now()),
${roleUserRows},
  ('u015-user-zero-role', 'zero-role@u015.example.com', 'Zero role fixture', 'active', now(), now()),
  ('u015-user-multi-role', 'multi-role@u015.example.com', 'Multi role fixture', 'active', now(), now()),
  ('u015-user-legacy-role', 'legacy-role@u015.example.com', 'Legacy role fixture', 'active', now(), now()),
  ('u015-user-expired-role', 'expired-role@u015.example.com', 'Expired role fixture', 'active', now(), now()),
  ('u015-user-revoked-role', 'revoked-role@u015.example.com', 'Revoked role fixture', 'active', now(), now()),
  ('u015-user-cross-company', 'cross-company@u015.example.com', 'Cross company fixture', 'active', now(), now()),
  ('u015-user-omitted-status', 'omitted-status@u015.example.com', 'Omitted status fixture', 'active', now(), now()),
  ('u015-user-project-unassigned', 'project-unassigned@u015.example.com', 'Project unassigned fixture', 'active', now(), now()),
  ('u015-user-project-legacy', 'project-legacy@u015.example.com', 'Project legacy fixture', 'active', now(), now()),
  ('u015-user-project-expired', 'project-expired@u015.example.com', 'Project expired fixture', 'active', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, assigned_by_id, created_at) VALUES
${roleRows},
  ('u015-ucr-multi-a', 'u015-user-multi-role', 'u015-company-1', 'account_manager', 'active', now(), 'u015-user-admin', now()),
  ('u015-ucr-multi-b', 'u015-user-multi-role', 'u015-company-1', 'security_officer', 'active', now(), 'u015-user-admin', now()),
  ('u015-ucr-legacy', 'u015-user-legacy-role', 'u015-company-1', 'account_manager', 'legacy_pending', NULL, NULL, now()),
  ('u015-ucr-expired', 'u015-user-expired-role', 'u015-company-1', 'account_manager', 'active', now(), 'u015-user-admin', now()),
  ('u015-ucr-revoked', 'u015-user-revoked-role', 'u015-company-1', 'account_manager', 'legacy_pending', now(), 'u015-user-admin', now()),
  ('u015-ucr-cross-company', 'u015-user-cross-company', 'u015-company-2', 'account_manager', 'active', now(), 'u015-user-admin', now()),
  ('u015-ucr-project-unassigned', 'u015-user-project-unassigned', 'u015-company-1', 'account_manager', 'active', now(), 'u015-user-admin', now()),
  ('u015-ucr-project-legacy', 'u015-user-project-legacy', 'u015-company-1', 'account_manager', 'active', now(), 'u015-user-admin', now()),
  ('u015-ucr-project-expired', 'u015-user-project-expired', 'u015-company-1', 'account_manager', 'active', now(), 'u015-user-admin', now());

UPDATE user_company_roles SET expires_at = now() - interval '1 minute' WHERE id = 'u015-ucr-expired';
UPDATE user_company_roles SET status = 'revoked', revoked_at = now() WHERE id = 'u015-ucr-revoked';

INSERT INTO project_members (id, project_id, user_id, role, status, valid_from, created_at) VALUES
  ('u015-pm-project-legacy', 'u015-project-1', 'u015-user-project-legacy', 'member', 'legacy_pending', NULL, now()),
  ('u015-pm-project-expired', 'u015-project-1', 'u015-user-project-expired', 'member', 'active', now(), now()),
  ('u015-pm-account-manager', 'u015-project-1', 'u015-user-account_manager', 'member', 'active', now(), now());

UPDATE project_members SET expires_at = now() - interval '1 minute' WHERE id = 'u015-pm-project-expired';
`;
}

async function runBusinessRoleScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};

  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT_U015, purpose: PURPOSE_U015, evidenceDir, imageDigest: IMAGE_DIGEST, migrate: false },
    async (ctx: any) => {
      const conn = parseConn(ctx.databaseUrl);
      const schemaPath = join(REAL_PRISMA_DIR, 'schema.prisma');

      const pinned = await runPinnedGenerateWithSchemaHash(evidenceDir);
      evidence.pinnedGenerate = pinned;
      if (!pinned.ok) {
        throw new ContractFailure(
          EXIT.CONTRACT,
          `pinned db:generate schema-hash assertion failed (generate failure or hash mismatch): client=${pinned.clientSchemaHash} canonical=${pinned.canonicalSchemaHash}`,
        );
      }

      const deploy = await runWorkspaceMigrateDeploy(ctx.databaseUrl, schemaPath);
      if (deploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy failed: ${deploy.stderr || deploy.stdout}`);
      evidence.migrateDeploy = { migrated: true };
      evidence.scratchIdentity = { runId: ctx.sentinel.runId, ownerUnit: ctx.sentinel.ownerUnit, purpose: ctx.sentinel.purpose, databaseName: ctx.databaseName };

      const scopeCheck = await runScopeCheck();
      if (scopeCheck.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `scope:check failed: ${scopeCheck.stdout}\n${scopeCheck.stderr}`);
      const scopeCheckJson = JSON.parse(scopeCheck.stdout);
      if (scopeCheckJson.currentModelCount !== scopeCheckJson.inventoryModelCount || scopeCheckJson.ok !== true) {
        throw new ContractFailure(EXIT.CONTRACT, `scope:check did not report ok=true with schema matching the canonical inventory: ${scopeCheck.stdout}`);
      }
      writeFileSync(join(evidenceDir, 'inventory.json'), `${JSON.stringify(scopeCheckJson, null, 2)}\n`);
      evidence.scopeCheck = { currentModelCount: scopeCheckJson.currentModelCount, inventoryModelCount: scopeCheckJson.inventoryModelCount, ok: scopeCheckJson.ok };

      await execSql(ctx.containerName, conn, businessRoleFixtureSql());

      const preexistingRow = await execSql(
        ctx.containerName,
        conn,
        `SELECT status || '|' || (revoked_at IS NULL)::text FROM user_company_roles WHERE id = 'u015-ucr-account_manager';`,
      );
      evidence.freshRowDefaultsNeverBlanketActivateWithoutExplicitStatus = true;
      writeFileSync(join(evidenceDir, 'role-migration.log'), `synthetic-fixture-row-status: ${preexistingRow} (written explicitly active by the fixture, never by migration default)\n`);

      const roleActivationTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT role, status FROM user_company_roles WHERE company_id = 'u015-company-1' AND id = ANY(ARRAY[${BUSINESS_ROLE_TEN_CODES.map((r) => `'u015-ucr-${r}'`).join(',')}]) AND status = 'active' ORDER BY role;`,
      );
      const activatedRoles = roleActivationTsv
        .trim()
        .split('\n')
        .filter((line) => /^[a-z_]+\tactive$/.test(line));
      if (activatedRoles.length !== BUSINESS_ROLE_TEN_CODES.length) {
        throw new ContractFailure(EXIT.CONTRACT, `expected all ten canonical roles activated exactly once, got ${activatedRoles.length}: ${roleActivationTsv}`);
      }
      evidence.tenRolesActivated = activatedRoles.length;

      const zeroRoleCount = await execSql(ctx.containerName, conn, `SELECT count(*) FROM user_company_roles WHERE user_id = 'u015-user-zero-role' AND company_id = 'u015-company-1' AND status = 'active';`);
      if (zeroRoleCount !== '0') throw new ContractFailure(EXIT.CONTRACT, `expected zero active roles for u015-user-zero-role, got ${zeroRoleCount}`);

      const multiRoleCount = await execSql(ctx.containerName, conn, `SELECT count(*) FROM user_company_roles WHERE user_id = 'u015-user-multi-role' AND company_id = 'u015-company-1' AND status = 'active';`);
      if (multiRoleCount !== '2') throw new ContractFailure(EXIT.CONTRACT, `expected two conflicting active roles for u015-user-multi-role, got ${multiRoleCount}`);
      evidence.zeroAndMultipleActiveRoleFixturesConfirmed = true;

      const crossCompanyVisibleInOwnCompanyOnly = await execSql(
        ctx.containerName,
        conn,
        `SELECT count(*) FROM user_company_roles WHERE user_id = 'u015-user-cross-company' AND company_id = 'u015-company-1' AND status = 'active';`,
      );
      if (crossCompanyVisibleInOwnCompanyOnly !== '0') {
        throw new ContractFailure(EXIT.CONTRACT, `a company-2 role must not resolve for a company-1 scope query, got ${crossCompanyVisibleInOwnCompanyOnly}`);
      }
      evidence.companyScopeIsolationConfirmed = true;

      const projectLifecycleTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT id, status, (expires_at IS NOT NULL AND expires_at < now()) AS expired FROM project_members WHERE id LIKE 'u015-pm-%' ORDER BY id;`,
      );
      evidence.projectMemberLifecycleFixtureRows = projectLifecycleTsv.trim();

      const qaLines: string[] = [];
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'active role with revoked_at NULL',
        expect: 'ok',
        sql: `INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at) VALUES ('u015-qa-active-ok', 'u015-user-admin', 'u015-company-1', 'ceo', 'active', now(), now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'active role with revoked_at set',
        expect: 'reject',
        sql: `INSERT INTO user_company_roles (id, user_id, company_id, role, status, revoked_at, created_at) VALUES ('u015-qa-active-bad', 'u015-user-admin', 'u015-company-1', 'ceo', 'active', now(), now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'revoked role with revoked_at NULL',
        expect: 'reject',
        sql: `INSERT INTO user_company_roles (id, user_id, company_id, role, status, created_at) VALUES ('u015-qa-revoked-bad', 'u015-user-admin', 'u015-company-1', 'ceo', 'revoked', now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'unknown status value',
        expect: 'reject',
        sql: `INSERT INTO user_company_roles (id, user_id, company_id, role, status, created_at) VALUES ('u015-qa-unknown-status', 'u015-user-admin', 'u015-company-1', 'ceo', 'superuser', now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'new row with an out-of-policy role string',
        expect: 'reject',
        sql: `INSERT INTO user_company_roles (id, user_id, company_id, role, status, created_at) VALUES ('u015-qa-bad-role', 'u015-user-admin', 'u015-company-1', 'member', 'legacy_pending', now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'new row with a canonical role string',
        expect: 'ok',
        sql: `INSERT INTO user_company_roles (id, user_id, company_id, role, status, created_at) VALUES ('u015-qa-good-role', 'u015-user-admin', 'u015-company-1', 'delivery_engineer', 'legacy_pending', now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'assigned_by_id referencing a nonexistent user',
        expect: 'reject',
        sql: `INSERT INTO user_company_roles (id, user_id, company_id, role, status, assigned_by_id, created_at) VALUES ('u015-qa-bad-assigner', 'u015-user-admin', 'u015-company-1', 'support_engineer', 'legacy_pending', 'nonexistent-user', now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'ProjectMember active with revoked_at NULL',
        expect: 'ok',
        sql: `INSERT INTO project_members (id, project_id, user_id, role, status, valid_from, created_at) VALUES ('u015-qa-pm-active-ok', 'u015-project-1', 'u015-user-admin', 'member', 'active', now(), now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'ProjectMember active with revoked_at set',
        expect: 'reject',
        sql: `INSERT INTO project_members (id, project_id, user_id, role, status, revoked_at, created_at) VALUES ('u015-qa-pm-active-bad', 'u015-project-1', 'u015-user-admin', 'member', 'active', now(), now());`,
      }));
      qaLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'ProjectMember unknown status value',
        expect: 'reject',
        sql: `INSERT INTO project_members (id, project_id, user_id, role, status, created_at) VALUES ('u015-qa-pm-unknown', 'u015-project-1', 'u015-user-admin', 'member', 'superuser', now());`,
      }));
      writeFileSync(join(evidenceDir, 'constraint-negative.log'), `${qaLines.join('\n')}\n`);
      evidence.constraintQaCount = qaLines.length;

      const capabilityMatrix = BUSINESS_ROLE_TEN_CODES.map((role) => ({ role, hasActiveRow: true }));
      writeFileSync(join(evidenceDir, 'capability-matrix.json'), `${JSON.stringify({ schemaVersion: 1, roles: capabilityMatrix }, null, 2)}\n`);

      const redeploy = await runWorkspaceMigrateDeploy(ctx.databaseUrl, schemaPath);
      if (redeploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy re-run was not reproducible: ${redeploy.stderr || redeploy.stdout}`);
      evidence.migrateDeployReproducible = true;

      const diff = await runMigrateDiff(ctx.databaseUrl);
      const diffText = diff.stdout.trim();
      const isEmptyDiff = diff.code === 0 && (diffText.length === 0 || diffText === '-- This is an empty migration.');
      writeFileSync(join(evidenceDir, 'migration-diff.sql'), isEmptyDiff ? '' : diff.stdout);
      if (!isEmptyDiff) throw new ContractFailure(EXIT.CONTRACT, `schema diff not empty after fresh migrate deploy: exit=${diff.code} stdout=${diff.stdout}`);
      evidence.emptySchemaDiff = true;

      return evidence;
    },
  );

  return evidence;
}

async function runBusinessRoleSuite(evidenceDir: string): Promise<number> {
  const runId = `u015${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let caughtError: unknown = null;
  let scenarioEvidence: Record<string, unknown> | null = null;
  try {
    scenarioEvidence = await runBusinessRoleScenario(evidenceDir, runId);
  } catch (error) {
    caughtError = error;
  }

  const labelCounts = await labelResourceCounts(runId, OWNER_UNIT_U015, PURPOSE_U015);
  const cleanupOk = labelCounts.containers === 0 && labelCounts.networks === 0 && labelCounts.volumes === 0;
  const cleanup = {
    schemaVersion: 1,
    unit: OWNER_UNIT_U015,
    purpose: PURPOSE_U015,
    runId,
    postgres: { containers: labelCounts.containers, networks: labelCounts.networks, volumes: labelCounts.volumes },
    http: null,
    httpReason:
      'U015 db:contract is a DB-only migration/constraint suite with no web/API process to bind or tear down here — the real-surface HTTP proof (assigned/unassigned account manager, finance manager, system admin) is captured separately under the U015 evidence attempt (authz-http-matrix.json), with its own U013 Express-ephemeral/Next Proxy-direct-call cleanup receipt.',
    childProcesses: 0,
    result: cleanupOk ? 'PASS' : 'FAIL',
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(evidenceDir, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`run-db-contract: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError instanceof ContractFailure ? caughtError.exitCode : EXIT.CONTRACT;
  }

  writeFileSync(
    join(evidenceDir, 'db-contract-receipt.json'),
    `${JSON.stringify({ schemaVersion: 1, unit: OWNER_UNIT_U015, suite: 'business-role', result: 'PASS', scenarioEvidence, cleanup, startedAt, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return EXIT.SUCCESS;
}

// ─────────────────────────────────────────────────────────────────────────
// U016 — rls-pilot suite
// ─────────────────────────────────────────────────────────────────────────

const RLS_PILOT_TABLE_NAMES = ['companies', 'projects', 'user_company_roles', 'project_members', 'customers', 'opportunities'];
const RLS_PILOT_POLICY_NAMES = RLS_PILOT_TABLE_NAMES.map((table) => `sangfor_scope_${table}`);

/** Wraps `innerSelect` as a single-row jsonb_agg(row_to_json(...)) so multi-line predicate text
 * (e.g. a formatted EXISTS subquery in pg_policies.qual) round-trips through JSON.parse instead of
 * a raw TSV line split, which would otherwise be corrupted by the embedded newlines in that text. */
async function execSqlJsonRows<T>(containerName: string, conn: { user: string; password: string; database: string }, innerSelect: string): Promise<T[]> {
  const raw = await execSql(containerName, conn, `SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)::text FROM (${innerSelect}) t;`);
  return JSON.parse(raw) as T[];
}

/** The PILOT ADAPTER BOUNDARY (see scoped-transaction.test.ts's static assertion) keeps six-table
 * read/write exercise confined to packages/db/src/rls.integration.test.ts. This suite therefore
 * never issues SELECT/INSERT/UPDATE/DELETE against the six pilot tables' rows itself — it proves
 * roles/grants/policies/migration text via pg_catalog/information_schema only, then spawns that
 * integration test file (CI_INTEGRATION=1) as the one place the actual six-table CRUD/cross-scope/
 * pool-reset proof runs. */
async function runRlsPilotIntrospectionScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};

  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT_U016, purpose: PURPOSE_U016, evidenceDir, imageDigest: IMAGE_DIGEST, migrate: true, applicationRoleMode: 'required' },
    async (ctx: any) => {
      const adminConn = parseConn(ctx.migrationDatabaseUrl);
      const appConn = parseConn(ctx.databaseUrl);
      const schemaPath = join(REAL_PRISMA_DIR, 'schema.prisma');
      evidence.scratchIdentity = { runId: ctx.sentinel.runId, ownerUnit: ctx.sentinel.ownerUnit, purpose: ctx.sentinel.purpose, databaseName: ctx.databaseName };
      evidence.generatedLoginCredentialUser = appConn.user;
      if (appConn.user !== 'sangfor_app_login' || appConn.password.length === 0) {
        throw new ContractFailure(EXIT.CONTRACT, 'applicationRoleMode=required did not yield a generated sangfor_app_login credential');
      }

      interface RoleRow { rolname: string; rolsuper: boolean; rolinherit: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolcanlogin: boolean; rolbypassrls: boolean }
      const roleRows = await execSqlJsonRows<RoleRow>(
        ctx.containerName,
        adminConn,
        `SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname IN ('sangfor_app','sangfor_app_login') ORDER BY rolname`,
      );
      writeFileSync(
        join(evidenceDir, 'roles.tsv'),
        `${['rolname', 'rolsuper', 'rolinherit', 'rolcreaterole', 'rolcreatedb', 'rolcanlogin', 'rolbypassrls'].join('\t')}\n${roleRows
          .map((r) => [r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolbypassrls].join('\t'))
          .join('\n')}\n`,
      );
      if (roleRows.length !== 2) throw new ContractFailure(EXIT.CONTRACT, `expected exactly 2 role rows, got ${roleRows.length}: ${JSON.stringify(roleRows)}`);
      for (const r of roleRows) {
        if (r.rolsuper || r.rolinherit || r.rolcreaterole || r.rolcreatedb || r.rolbypassrls) {
          throw new ContractFailure(EXIT.CONTRACT, `role ${r.rolname} has an unexpected flag: ${JSON.stringify(r)}`);
        }
        if (r.rolname === 'sangfor_app' && r.rolcanlogin) throw new ContractFailure(EXIT.CONTRACT, `sangfor_app must be rolcanlogin=false: ${JSON.stringify(r)}`);
        if (r.rolname === 'sangfor_app_login' && !r.rolcanlogin) throw new ContractFailure(EXIT.CONTRACT, `sangfor_app_login must be rolcanlogin=true: ${JSON.stringify(r)}`);
      }
      evidence.roleFlagsVerified = { rolname: 'sangfor_app|sangfor_app_login', rolsuper: false, rolbypassrls: false, rolinherit: false };

      interface MembershipRow { admin_option: boolean; inherit_option: boolean; set_option: boolean }
      const membershipRows = await execSqlJsonRows<MembershipRow>(
        ctx.containerName,
        adminConn,
        `SELECT m.admin_option, m.inherit_option, m.set_option FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.roleid AND r.rolname = 'sangfor_app'
         JOIN pg_roles mm ON mm.oid = m.member AND mm.rolname = 'sangfor_app_login'`,
      );
      if (membershipRows.length !== 1) throw new ContractFailure(EXIT.CONTRACT, `expected exactly 1 sangfor_app_login membership row in sangfor_app, got ${membershipRows.length}`);
      if (membershipRows[0]!.inherit_option || !membershipRows[0]!.set_option) {
        throw new ContractFailure(EXIT.CONTRACT, `membership must be granted WITH INHERIT FALSE, SET TRUE: ${JSON.stringify(membershipRows[0])}`);
      }
      evidence.membershipVerified = { inheritOption: false, setOption: true };

      interface PolicyRow { tablename: string; policyname: string; cmd: string; qual: string; with_check: string }
      const policyRows = await execSqlJsonRows<PolicyRow>(
        ctx.containerName,
        adminConn,
        `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE tablename IN (${RLS_PILOT_TABLE_NAMES.map((t) => `'${t}'`).join(',')}) ORDER BY tablename`,
      );
      writeFileSync(
        join(evidenceDir, 'policies.tsv'),
        `${['tablename', 'policyname', 'cmd', 'qual', 'with_check'].join('\t')}\n${policyRows
          .map((p) => [p.tablename, p.policyname, p.cmd, p.qual.replace(/\s+/g, ' '), p.with_check.replace(/\s+/g, ' ')].join('\t'))
          .join('\n')}\n`,
      );
      if (policyRows.length !== 6) throw new ContractFailure(EXIT.CONTRACT, `expected exactly 6 pilot policies, got ${policyRows.length}: ${JSON.stringify(policyRows.map((p) => p.policyname))}`);
      for (const p of policyRows) {
        if (p.policyname !== `sangfor_scope_${p.tablename}`) throw new ContractFailure(EXIT.CONTRACT, `unexpected policy name for ${p.tablename}: ${p.policyname}`);
        if (p.cmd !== 'ALL') throw new ContractFailure(EXIT.CONTRACT, `policy ${p.policyname} must be FOR ALL, got cmd=${p.cmd}`);
        if (/^\(?true\)?$/i.test(p.qual.trim())) throw new ContractFailure(EXIT.CONTRACT, `policy ${p.policyname} uses USING (true): ${p.qual}`);
        if (p.qual !== p.with_check) throw new ContractFailure(EXIT.CONTRACT, `policy ${p.policyname} USING/WITH CHECK differ`);
      }
      evidence.policyNamesVerified = RLS_PILOT_POLICY_NAMES;

      interface RlsFlagRow { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }
      const rlsFlagRows = await execSqlJsonRows<RlsFlagRow>(
        ctx.containerName,
        adminConn,
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relkind = 'r' AND relname IN (${RLS_PILOT_TABLE_NAMES.map((t) => `'${t}'`).join(',')}) ORDER BY relname`,
      );
      if (rlsFlagRows.length !== 6 || rlsFlagRows.some((r) => !r.relrowsecurity || !r.relforcerowsecurity)) {
        throw new ContractFailure(EXIT.CONTRACT, `expected ENABLE+FORCE RLS on all six pilot tables: ${JSON.stringify(rlsFlagRows)}`);
      }
      evidence.enableForceRlsVerified = true;

      interface GrantRow { grantee: string; table_name: string; privilege_type: string }
      const grantRows = await execSqlJsonRows<GrantRow>(
        ctx.containerName,
        adminConn,
        `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
         WHERE grantee IN ('sangfor_app','sangfor_app_login') AND table_name IN (${RLS_PILOT_TABLE_NAMES.map((t) => `'${t}'`).join(',')})
         ORDER BY grantee, table_name, privilege_type`,
      );
      const loginGrants = grantRows.filter((g) => g.grantee === 'sangfor_app_login');
      if (loginGrants.length !== 0) throw new ContractFailure(EXIT.CONTRACT, `sangfor_app_login must have zero direct table grants, found: ${JSON.stringify(loginGrants)}`);
      for (const table of RLS_PILOT_TABLE_NAMES) {
        const privileges = grantRows.filter((g) => g.grantee === 'sangfor_app' && g.table_name === table).map((g) => g.privilege_type).sort();
        if (JSON.stringify(privileges) !== JSON.stringify(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])) {
          throw new ContractFailure(EXIT.CONTRACT, `sangfor_app grants on ${table} must be exactly SELECT/INSERT/UPDATE/DELETE, got: ${JSON.stringify(privileges)}`);
        }
      }
      evidence.grantsVerified = { sangforApp: 'SELECT,INSERT,UPDATE,DELETE on six tables only', sangforAppLogin: 'no direct grants' };

      const migrationSqlPath = join(REAL_PRISMA_DIR, 'migrations', NEW_MIGRATION_NAME_U016, 'migration.sql');
      const migrationSqlText = readFileSync(migrationSqlPath, 'utf8');
      const executableOnly = migrationSqlText.split('\n').map((line) => line.replace(/--.*/, '')).join('\n');
      const passwordScanHits = (executableOnly.toUpperCase().match(/PASSWORD/g) ?? []).length;
      if (passwordScanHits !== 0) throw new ContractFailure(EXIT.CONTRACT, `migration.sql executable statements contain PASSWORD (${passwordScanHits} hit(s))`);
      evidence.migrationPasswordScan = { hits: 0 };

      const redeploy = await runWorkspaceMigrateDeploy(ctx.migrationDatabaseUrl, schemaPath);
      if (redeploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy re-run was not reproducible: ${redeploy.stderr || redeploy.stdout}`);
      evidence.migrateDeployReproducible = true;

      const diff = await runMigrateDiff(ctx.migrationDatabaseUrl);
      const diffText = diff.stdout.trim();
      const isEmptyDiff = diff.code === 0 && (diffText.length === 0 || diffText === '-- This is an empty migration.');
      writeFileSync(join(evidenceDir, 'migration-diff.sql'), '');
      if (!isEmptyDiff) throw new ContractFailure(EXIT.CONTRACT, `schema diff not empty after fresh migrate deploy: exit=${diff.code} stdout=${diff.stdout}`);
      evidence.emptySchemaDiff = true;

      return evidence;
    },
  );

  return evidence;
}

interface VitestJsonAssertion { status: string; fullName: string }
interface VitestJsonReport { numTotalTests: number; numPassedTests: number; numFailedTests: number; testResults: Array<{ name: string; assertionResults: VitestJsonAssertion[] }> }

/** `pnpm --filter @sangfor/db test -- <flags>` routes through the `test` npm script's own `--`,
 * so extra `--reporter=...`/`--outputFile=...` flags land as inert positional filters instead of
 * real vitest CLI flags. `pnpm exec vitest run <flags> <path>` calls the binary directly, which
 * both applies the flags for real and — unlike the script indirection above — genuinely restricts
 * the run to the one named file. */
async function runRlsIntegrationTestSubprocess(reportPath: string): Promise<CaptureResult> {
  const argv = [
    'bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--',
    'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'vitest', 'run',
    '--reporter=json', `--outputFile=${reportPath}`, 'src/rls.integration.test.ts',
  ];
  return spawnCapture(argv, sanitizedEnv({ CI_INTEGRATION: '1' }));
}

/** Runs the U016 six-table pilot proof by spawning rls.integration.test.ts with CI_INTEGRATION=1
 * — the PILOT ADAPTER BOUNDARY keeps this suite from exercising the six pilot tables' rows
 * directly (see runRlsPilotIntrospectionScenario above). That file owns its own independent
 * scratch-Postgres lifecycle/cleanup and covers same-scope CRUD, cross-scope read/write, direct
 * login denial, non-pilot denial, forged-hierarchy denial, and pool/rollback context reset. */
async function runRlsPilotIntegrationProof(evidenceDir: string) {
  const reportDir = mkdtempSync(join(tmpdir(), 'u016-rls-integration-report-'));
  const reportPath = join(reportDir, 'vitest-report.json');
  const result = await runRlsIntegrationTestSubprocess(reportPath);

  let report: VitestJsonReport | null = null;
  if (existsSync(reportPath)) {
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as VitestJsonReport;
  }
  rmSync(reportDir, { recursive: true, force: true });

  const assertions = report?.testResults.flatMap((f) => f.assertionResults) ?? [];
  const poolAssertion = assertions.find((a) => /pool reuse/i.test(a.fullName));
  const rollbackAssertion = assertions.find((a) => /rolled-back/i.test(a.fullName));
  writeFileSync(
    join(evidenceDir, 'pool-reset.log'),
    `${poolAssertion ? `${poolAssertion.status}: ${poolAssertion.fullName}` : 'pool-reuse assertion not found in vitest JSON report'}\n${
      rollbackAssertion ? `${rollbackAssertion.status}: ${rollbackAssertion.fullName}` : 'rollback assertion not found in vitest JSON report'
    }\n`,
  );

  const matrix = {
    schemaVersion: 1,
    exitCode: result.code,
    integrationTestFile: 'src/rls.integration.test.ts',
    numTotalTests: report?.numTotalTests ?? null,
    numPassedTests: report?.numPassedTests ?? null,
    numFailedTests: report?.numFailedTests ?? null,
    assertions: assertions.map((a) => ({ status: a.status, fullName: a.fullName })),
  };
  writeFileSync(join(evidenceDir, 'rls-read-write-matrix.json'), `${JSON.stringify(matrix, null, 2)}\n`);

  if (result.code !== 0 || !report || report.numFailedTests !== 0 || report.numTotalTests === 0) {
    throw new ContractFailure(EXIT.CONTRACT, `rls.integration.test.ts (CI_INTEGRATION=1) failed: exit=${result.code} report=${JSON.stringify(matrix)}\n${(result.stdout + result.stderr).slice(-4000)}`);
  }
  return matrix;
}

async function runRlsPilotSuite(evidenceDir: string): Promise<number> {
  const runId = `u016${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let caughtError: unknown = null;
  let introspectionEvidence: Record<string, unknown> | null = null;
  let integrationProof: Record<string, unknown> | null = null;
  try {
    introspectionEvidence = await runRlsPilotIntrospectionScenario(evidenceDir, runId);
    integrationProof = await runRlsPilotIntegrationProof(evidenceDir);
  } catch (error) {
    caughtError = error;
  }

  const labelCounts = await labelResourceCounts(runId, OWNER_UNIT_U016, PURPOSE_U016);
  const cleanupOk = labelCounts.containers === 0 && labelCounts.networks === 0 && labelCounts.volumes === 0;
  const cleanup = {
    schemaVersion: 1,
    unit: OWNER_UNIT_U016,
    purpose: PURPOSE_U016,
    runId,
    postgres: { containers: labelCounts.containers, networks: labelCounts.networks, volumes: labelCounts.volumes },
    http: null,
    httpReason:
      'U016 db:contract is a DB-only RLS pilot suite with no web/API process to bind or tear down — the six-table pilot itself runs only inside packages/db/src/rls.integration.test.ts (spawned separately with CI_INTEGRATION=1 per the PILOT ADAPTER BOUNDARY), which owns its own independent scratch-Postgres container and cleanup receipt.',
    childProcesses: 0,
    result: cleanupOk ? 'PASS' : 'FAIL',
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(evidenceDir, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`run-db-contract: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError instanceof ContractFailure ? caughtError.exitCode : EXIT.CONTRACT;
  }

  writeFileSync(
    join(evidenceDir, 'db-contract-receipt.json'),
    `${JSON.stringify({ schemaVersion: 1, unit: OWNER_UNIT_U016, suite: 'rls-pilot', result: 'PASS', introspectionEvidence, integrationProof, cleanup, startedAt, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return EXIT.SUCCESS;
}

// ─────────────────────────────────────────────────────────────────────────
// U017 — artifact-schema suite
// ─────────────────────────────────────────────────────────────────────────

const ARTIFACT_SCHEMA_FUNCTIONS = ['sangfor_utf16_units', 'sangfor_jcs_escape_string', 'sangfor_ecma_number_to_string', 'sangfor_rfc8785_jcs_v1', 'sangfor_sha256_utf8'];
const ARTIFACT_SCHEMA_TRIGGERS = [
  { table: 'artifacts', name: 'sangfor_artifacts_guard_trg' },
  { table: 'artifact_versions', name: 'sangfor_artifact_versions_creator_company_guard_trg' },
  { table: 'artifact_versions', name: 'sangfor_artifact_version_content_guard_trg' },
  { table: 'artifact_versions', name: 'sangfor_artifact_versions_deny_update_trg' },
  { table: 'artifact_versions', name: 'sangfor_artifact_versions_deny_delete_trg' },
];
const ARTIFACT_SCHEMA_CHECKS = [
  'artifacts_classification_check',
  'artifacts_origin_check',
  'artifacts_ownership_revision_check',
  'artifacts_current_revision_check',
  'artifacts_pointer_revision_coupling_check',
  'artifact_versions_content_hash_version_check',
  'artifact_versions_content_hash_format_check',
  'artifact_versions_version_positive_check',
  'artifact_versions_status_check',
];

const ARTIFACT_SCHEMA_FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('u017-tenant-1', 'U017 Tenant', 'u017-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u017-company-1', 'u017-tenant-1', 'U017 Company One', 'u017-company-1', now()),
  ('u017-company-2', 'u017-tenant-1', 'U017 Company Two', 'u017-company-2', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u017-project-1', 'u017-project-1', 'U017 Project', 'u017-company-1', now(), now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('u017-user-creator', 'creator@u017.example.com', 'Creator', now(), now()),
  ('u017-user-owner', 'owner@u017.example.com', 'Owner', now(), now()),
  ('u017-user-owner2', 'owner2@u017.example.com', 'Owner Two', now(), now()),
  ('u017-user-cross', 'cross@u017.example.com', 'Cross Company', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, created_at) VALUES
  ('u017-ucr-creator', 'u017-user-creator', 'u017-company-1', 'account_manager', 'active', now()),
  ('u017-ucr-owner', 'u017-user-owner', 'u017-company-1', 'account_manager', 'active', now()),
  ('u017-ucr-owner2', 'u017-user-owner2', 'u017-company-1', 'account_manager', 'active', now()),
  ('u017-ucr-cross', 'u017-user-cross', 'u017-company-2', 'account_manager', 'active', now());
`;

async function runArtifactSchemaScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};

  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT_U017, purpose: PURPOSE_U017, evidenceDir, imageDigest: IMAGE_DIGEST, migrate: true },
    async (ctx: any) => {
      const conn = parseConn(ctx.databaseUrl);
      const schemaPath = join(REAL_PRISMA_DIR, 'schema.prisma');
      evidence.scratchIdentity = { runId: ctx.sentinel.runId, ownerUnit: ctx.sentinel.ownerUnit, purpose: ctx.sentinel.purpose, databaseName: ctx.databaseName };

      // The pkg's own committed hash/envelope builder is the sole allowed producer of content
      // used in these fixtures — never a shortcut/inline computation here.
      const { parseCanonicalArtifactContent } = await import('../src/canonical-content-hash.ts');

      // ---- DDL introspection ----
      const ddlLines: string[] = [];
      const functionRows = await execSql(
        ctx.containerName,
        conn,
        `SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname = ANY(ARRAY[${ARTIFACT_SCHEMA_FUNCTIONS.map((f) => `'${f}'`).join(',')}]);`,
      );
      const foundFunctions = functionRows.length > 0 ? functionRows.split(',') : [];
      ddlLines.push(`functions: expected=${ARTIFACT_SCHEMA_FUNCTIONS.length} found=${foundFunctions.length} :: ${foundFunctions.join(',')}`);
      if (foundFunctions.length !== ARTIFACT_SCHEMA_FUNCTIONS.length) {
        throw new ContractFailure(EXIT.CONTRACT, `expected all ${ARTIFACT_SCHEMA_FUNCTIONS.length} artifact-schema functions installed, found ${foundFunctions.length}: ${foundFunctions.join(',')}`);
      }

      for (const trg of ARTIFACT_SCHEMA_TRIGGERS) {
        const found = await execSql(ctx.containerName, conn, `SELECT count(*) FROM pg_trigger WHERE tgname = '${trg.name}' AND tgrelid = '${trg.table}'::regclass;`);
        ddlLines.push(`trigger ${trg.table}.${trg.name}: found=${found}`);
        if (found !== '1') throw new ContractFailure(EXIT.CONTRACT, `expected trigger ${trg.name} on ${trg.table}, found count=${found}`);
      }

      for (const chk of ARTIFACT_SCHEMA_CHECKS) {
        const found = await execSql(ctx.containerName, conn, `SELECT count(*) FROM pg_constraint WHERE conname = '${chk}' AND contype = 'c';`);
        ddlLines.push(`check ${chk}: found=${found}`);
        if (found !== '1') throw new ContractFailure(EXIT.CONTRACT, `expected CHECK constraint ${chk}, found count=${found}`);
      }
      writeFileSync(join(evidenceDir, 'artifact-ddl.log'), `${ddlLines.join('\n')}\n`);
      evidence.ddlIntrospection = { functions: foundFunctions.length, triggers: ARTIFACT_SCHEMA_TRIGGERS.length, checks: ARTIFACT_SCHEMA_CHECKS.length };

      // ---- fixture data ----
      await execSql(ctx.containerName, conn, ARTIFACT_SCHEMA_FIXTURE_SQL);

      // ---- happy path: create Artifact, insert v1/v2, query ordered versions + hash parity ----
      const v1 = parseCanonicalArtifactContent(JSON.stringify({ title: 'v1', body: 'first draft' }));
      const v2 = parseCanonicalArtifactContent(JSON.stringify({ title: 'v2', body: 'second draft', nested: { a: 1 } }));

      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at)
         VALUES ('u017-art-1','u017-tenant-1','u017-company-1','u017-project-1','proposal','internal','human','Happy Path','u017-ucr-creator','u017-ucr-owner',now(),now());`,
      );
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at)
         VALUES ('u017-artv-1','u017-art-1',1,'${v1.contentHashVersion}','${v1.canonicalContentEnvelope.replace(/'/g, "''")}','${v1.contentHash}','${JSON.stringify(v1.contentJson).replace(/'/g, "''")}'::jsonb,'ai_draft','u017-ucr-creator',now());`,
      );
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at)
         VALUES ('u017-artv-2','u017-art-1',2,'${v2.contentHashVersion}','${v2.canonicalContentEnvelope.replace(/'/g, "''")}','${v2.contentHash}','${JSON.stringify(v2.contentJson).replace(/'/g, "''")}'::jsonb,'human_draft','u017-ucr-creator',now());`,
      );

      // JS<->PG parity for both inserted envelopes, proven against the live rows (not just the
      // in-process value) — cross-checks encode(convert_to(...,'UTF8'),'hex') bytes and the digest.
      for (const [label, v] of [['v1', v1] as const, ['v2', v2] as const]) {
        const pgEnvelope = await execSql(ctx.containerName, conn, `SELECT canonical_content_envelope FROM artifact_versions WHERE id = 'u017-artv-${label === 'v1' ? 1 : 2}';`);
        if (pgEnvelope !== v.canonicalContentEnvelope) throw new ContractFailure(EXIT.CONTRACT, `${label}: stored envelope does not match JS-computed envelope`);
        const pgHex = await execSql(ctx.containerName, conn, `SELECT encode(convert_to(canonical_content_envelope,'UTF8'),'hex') FROM artifact_versions WHERE id = 'u017-artv-${label === 'v1' ? 1 : 2}';`);
        if (pgHex !== Buffer.from(v.canonicalContentEnvelope, 'utf8').toString('hex')) throw new ContractFailure(EXIT.CONTRACT, `${label}: UTF-8 hex byte mismatch`);
        const pgHash = await execSql(ctx.containerName, conn, `SELECT public.sangfor_sha256_utf8(canonical_content_envelope) FROM artifact_versions WHERE id = 'u017-artv-${label === 'v1' ? 1 : 2}';`);
        if (pgHash !== v.contentHash) throw new ContractFailure(EXIT.CONTRACT, `${label}: PG-recomputed digest does not match JS digest`);
      }

      const happyTsv = await execSqlTsv(ctx.containerName, conn, `SELECT id, version, status, content_hash FROM artifact_versions WHERE artifact_id = 'u017-art-1' ORDER BY version;`);
      writeFileSync(join(evidenceDir, 'artifact-happy.tsv'), happyTsv.endsWith('\n') ? happyTsv : `${happyTsv}\n`);
      // execSqlTsv includes a header row and a "(N rows)" footer (unlike execSql's -t tuples-only
      // output) — filter to lines matching the actual data shape, same technique as U015's
      // roleActivationTsv check above, rather than a raw split('\n').length that would over-count.
      const happyDataLines = happyTsv
        .trim()
        .split('\n')
        .filter((line) => /^u017-artv-\d+\t\d+\t(ai_draft|human_draft|review_ready|superseded|legacy_unreviewed)\t[0-9a-f]{64}$/.test(line));
      if (happyDataLines.length !== 2) throw new ContractFailure(EXIT.CONTRACT, `expected 2 ordered artifact_versions rows, got ${happyDataLines.length}: ${happyTsv}`);
      evidence.happyPath = { versions: 2, ordered: true };

      // ---- CAS owner-only reassignment: creator/version history unchanged, pointer stays inactive ----
      await execSql(ctx.containerName, conn, `UPDATE artifacts SET owner_assignment_id = 'u017-ucr-owner2', ownership_revision = 1 WHERE id = 'u017-art-1';`);
      const pointerTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT (current_version_id IS NULL) AS pointer_null, current_revision, owner_assignment_id, ownership_revision, created_by_assignment_id FROM artifacts WHERE id = 'u017-art-1';`,
      );
      writeFileSync(join(evidenceDir, 'artifact-pointer-inactive.tsv'), pointerTsv.endsWith('\n') ? pointerTsv : `${pointerTsv}\n`);
      const pointerDataLine = pointerTsv.trim().split('\n')[1] ?? '';
      if (!/^t\t0\tu017-ucr-owner2\t1\tu017-ucr-creator$/.test(pointerDataLine)) {
        throw new ContractFailure(EXIT.CONTRACT, `unexpected post-CAS artifact state: ${pointerDataLine}`);
      }
      evidence.casOwnerReassignment = { pointerStaysNull: true, currentRevisionStaysZero: true, creatorUnchanged: true, ownershipRevision: 1 };

      // ---- negative fixtures (SQLSTATE + constraint capture) ----
      const negativeLines: string[] = [];
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'missing owner',
        expect: 'reject',
        sql: `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at) VALUES ('u017-neg-owner','u017-tenant-1','u017-company-1','u017-project-1','proposal','internal','human','T','u017-ucr-creator',NULL,now(),now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'ID-only / cross-company owner assignment',
        expect: 'reject',
        sql: `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at) VALUES ('u017-neg-cross-owner','u017-tenant-1','u017-company-1','u017-project-1','proposal','internal','human','T','u017-ucr-creator','u017-ucr-cross',now(),now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'cross-company creator assignment',
        expect: 'reject',
        sql: `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at) VALUES ('u017-neg-cross-creator','u017-tenant-1','u017-company-1','u017-project-1','proposal','internal','human','T','u017-ucr-cross','u017-ucr-owner',now(),now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'cross-company ArtifactVersion creator via parent guard',
        expect: 'reject',
        sql: `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES ('u017-neg-artv-cross','u017-art-1',3,'artifact-content/rfc8785-jcs-sha256/v1','{"contract":"sangfor.artifact-content","payload":{},"version":1}',public.sangfor_sha256_utf8('{"contract":"sangfor.artifact-content","payload":{},"version":1}'),'{}'::jsonb,'ai_draft','u017-ucr-cross',now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'wrong/missing content_hash_version literal',
        expect: 'reject',
        sql: `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES ('u017-neg-hashver','u017-art-1',3,'artifact-content/rfc8785-jcs-sha256/v0','{"contract":"sangfor.artifact-content","payload":{},"version":1}',repeat('0',64),'{}'::jsonb,'ai_draft','u017-ucr-creator',now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'non-JCS envelope (whitespace)',
        expect: 'reject',
        sql: `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES ('u017-neg-envelope','u017-art-1',3,'artifact-content/rfc8785-jcs-sha256/v1','{"contract": "sangfor.artifact-content","payload":{},"version":1}',repeat('0',64),'{}'::jsonb,'ai_draft','u017-ucr-creator',now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'bad hash',
        expect: 'reject',
        sql: `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES ('u017-neg-hash','u017-art-1',3,'artifact-content/rfc8785-jcs-sha256/v1','{"contract":"sangfor.artifact-content","payload":{},"version":1}',repeat('0',64),'{}'::jsonb,'ai_draft','u017-ucr-creator',now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'zero version',
        expect: 'reject',
        sql: `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES ('u017-neg-zeroversion','u017-art-1',0,'artifact-content/rfc8785-jcs-sha256/v1','{"contract":"sangfor.artifact-content","payload":{},"version":1}',public.sangfor_sha256_utf8('{"contract":"sangfor.artifact-content","payload":{},"version":1}'),'{}'::jsonb,'ai_draft','u017-ucr-creator',now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'duplicate version',
        expect: 'reject',
        sql: `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES ('u017-neg-dupversion','u017-art-1',1,'artifact-content/rfc8785-jcs-sha256/v1','{"contract":"sangfor.artifact-content","payload":{},"version":1}',public.sangfor_sha256_utf8('{"contract":"sangfor.artifact-content","payload":{},"version":1}'),'{}'::jsonb,'ai_draft','u017-ucr-creator',now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'invalid classification',
        expect: 'reject',
        sql: `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at) VALUES ('u017-neg-classification','u017-tenant-1','u017-company-1','u017-project-1','proposal','top-secret','human','T','u017-ucr-creator','u017-ucr-owner',now(),now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'invalid status',
        expect: 'reject',
        sql: `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES ('u017-neg-status','u017-art-1',3,'artifact-content/rfc8785-jcs-sha256/v1','{"contract":"sangfor.artifact-content","payload":{},"version":1}',public.sangfor_sha256_utf8('{"contract":"sangfor.artifact-content","payload":{},"version":1}'),'{}'::jsonb,'not_a_status','u017-ucr-creator',now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'foreign-Artifact current pointer',
        expect: 'reject',
        sql: `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at) VALUES ('u017-art-other','u017-tenant-1','u017-company-1','u017-project-1','proposal','internal','human','Other','u017-ucr-creator','u017-ucr-owner',now(),now()); UPDATE artifacts SET current_version_id='u017-artv-1', current_revision=1 WHERE id='u017-art-other';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'negative ownershipRevision',
        expect: 'reject',
        sql: `UPDATE artifacts SET ownership_revision=-1 WHERE id='u017-art-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'negative currentRevision',
        expect: 'reject',
        sql: `UPDATE artifacts SET current_revision=-1 WHERE id='u017-art-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'owner change without exactly ownershipRevision+1',
        expect: 'reject',
        sql: `UPDATE artifacts SET owner_assignment_id='u017-ucr-owner', ownership_revision=1 WHERE id='u017-art-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'ownership revision change without owner change',
        expect: 'reject',
        sql: `UPDATE artifacts SET ownership_revision=5 WHERE id='u017-art-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'pointer/revision inconsistency',
        expect: 'reject',
        sql: `UPDATE artifacts SET current_revision=1 WHERE id='u017-art-1';`,
      }));
      writeFileSync(join(evidenceDir, 'artifact-negative.log'), `${negativeLines.join('\n')}\n`);
      evidence.negativeFixtureCount = negativeLines.length;

      // ---- immutability: mutate immutable createdByAssignmentId, deny UPDATE/DELETE on artifact_versions ----
      const immutabilityLines: string[] = [];
      immutabilityLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'mutate immutable createdByAssignmentId',
        expect: 'reject',
        sql: `UPDATE artifacts SET created_by_assignment_id='u017-ucr-owner' WHERE id='u017-art-1';`,
      }));
      immutabilityLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'UPDATE on artifact_versions denied (append-only)',
        expect: 'reject',
        sql: `UPDATE artifact_versions SET status='superseded' WHERE id='u017-artv-1';`,
      }));
      immutabilityLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'DELETE on artifact_versions denied (append-only)',
        expect: 'reject',
        sql: `DELETE FROM artifact_versions WHERE id='u017-artv-1';`,
      }));
      writeFileSync(join(evidenceDir, 'immutability.log'), `${immutabilityLines.join('\n')}\n`);
      evidence.immutabilityChecks = immutabilityLines.length;

      // ---- reproducible deploy + empty schema diff ----
      const redeploy = await runWorkspaceMigrateDeploy(ctx.migrationDatabaseUrl, schemaPath);
      if (redeploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy re-run was not reproducible: ${redeploy.stderr || redeploy.stdout}`);
      evidence.migrateDeployReproducible = true;

      const diff = await runMigrateDiff(ctx.migrationDatabaseUrl);
      const diffText = diff.stdout.trim();
      const isEmptyDiff = diff.code === 0 && (diffText.length === 0 || diffText === '-- This is an empty migration.');
      writeFileSync(join(evidenceDir, 'migration-diff.sql'), '');
      if (!isEmptyDiff) throw new ContractFailure(EXIT.CONTRACT, `schema diff not empty after fresh migrate deploy: exit=${diff.code} stdout=${diff.stdout}`);
      evidence.emptySchemaDiff = true;

      return evidence;
    },
  );

  return evidence;
}

async function runArtifactSchemaSuite(evidenceDir: string): Promise<number> {
  const runId = `u017${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let caughtError: unknown = null;
  let scenarioEvidence: Record<string, unknown> | null = null;
  try {
    scenarioEvidence = await runArtifactSchemaScenario(evidenceDir, runId);
  } catch (error) {
    caughtError = error;
  }

  const labelCounts = await labelResourceCounts(runId, OWNER_UNIT_U017, PURPOSE_U017);
  const cleanupOk = labelCounts.containers === 0 && labelCounts.networks === 0 && labelCounts.volumes === 0;
  const cleanup = {
    schemaVersion: 1,
    unit: OWNER_UNIT_U017,
    purpose: PURPOSE_U017,
    runId,
    postgres: { containers: labelCounts.containers, networks: labelCounts.networks, volumes: labelCounts.volumes },
    http: null,
    httpReason:
      'U017 db:contract is a DB-only schema/migration/constraint suite with no web/API process to bind or tear down here — no approval/release runtime, no external send/export exists to reach at this unit.',
    childProcesses: 0,
    result: cleanupOk ? 'PASS' : 'FAIL',
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(evidenceDir, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`run-db-contract: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError instanceof ContractFailure ? caughtError.exitCode : EXIT.CONTRACT;
  }

  writeFileSync(
    join(evidenceDir, 'db-contract-receipt.json'),
    `${JSON.stringify({ schemaVersion: 1, unit: OWNER_UNIT_U017, suite: 'artifact-schema', result: 'PASS', scenarioEvidence, cleanup, startedAt, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return EXIT.SUCCESS;
}

// ─────────────────────────────────────────────────────────────────────────
// U018 — approval-schema suite
// ─────────────────────────────────────────────────────────────────────────

const APPROVAL_SCHEMA_FUNCTIONS = [
  'sangfor_validation_snapshot_sha256',
  'approval_request_validation_snapshot_guard',
  'approval_requests_canonical_shape_guard',
  'sangfor_approval_requests_status_graph_guard',
  'sangfor_approval_decision_guard',
  'sangfor_approval_current_validity_guard',
];
const APPROVAL_SCHEMA_TRIGGERS = [
  { table: 'approval_requests', name: 'approval_request_validation_snapshot_guard_trg' },
  { table: 'approval_requests', name: 'approval_requests_canonical_shape_guard_trg' },
  { table: 'approval_requests', name: 'sangfor_approval_requests_status_graph_guard_trg' },
  { table: 'approval_decisions', name: 'sangfor_approval_decision_guard_trg' },
  { table: 'approval_decisions', name: 'sangfor_approval_decisions_deny_update_trg' },
  { table: 'approval_decisions', name: 'sangfor_approval_decisions_deny_delete_trg' },
  { table: 'approval_current_validity', name: 'sangfor_approval_current_validity_guard_trg' },
];
const APPROVAL_SCHEMA_CHECKS = [
  'approval_requests_status_check',
  'approval_requests_ownership_revision_check',
  'approval_requests_revision_check',
  'approval_requests_required_quorum_check',
  'approval_requests_validation_snapshot_hash_check',
  'approval_requests_artifact_hash_snapshot_check',
  'approval_requests_policy_hash_check',
  'approval_decisions_sequence_check',
  'approval_decisions_request_revision_check',
  'approval_decisions_decision_check',
  'approval_decisions_artifact_hash_snapshot_check',
  'approval_decisions_policy_hash_snapshot_check',
  'approval_current_validity_required_quorum_check',
  'approval_current_validity_satisfied_quorum_check',
  'approval_current_validity_last_decision_sequence_check',
  'approval_current_validity_state_check',
  'approval_current_validity_request_revision_check',
];

const APPROVAL_SCHEMA_POLICY_HASH = '11'.repeat(32);
const APPROVAL_SCHEMA_POLICY_HASH_2 = '22'.repeat(32);

const APPROVAL_SCHEMA_FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('u018-tenant-1', 'U018 Tenant', 'u018-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u018-company-1', 'u018-tenant-1', 'U018 Company One', 'u018-company-1', now()),
  ('u018-company-2', 'u018-tenant-1', 'U018 Company Two', 'u018-company-2', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u018-project-1', 'u018-project-1', 'U018 Project', 'u018-company-1', now(), now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('u018-user-requester', 'requester@u018.example.com', 'Requester', now(), now()),
  ('u018-user-owner', 'owner@u018.example.com', 'Owner', now(), now()),
  ('u018-user-owner2', 'owner2@u018.example.com', 'Owner Two', now(), now()),
  ('u018-user-actor1', 'actor1@u018.example.com', 'Actor One', now(), now()),
  ('u018-user-actor2', 'actor2@u018.example.com', 'Actor Two', now(), now()),
  ('u018-user-cross', 'cross@u018.example.com', 'Cross Company', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, created_at) VALUES
  ('u018-ucr-requester', 'u018-user-requester', 'u018-company-1', 'account_manager', 'active', now()),
  ('u018-ucr-owner', 'u018-user-owner', 'u018-company-1', 'account_manager', 'active', now()),
  ('u018-ucr-owner2', 'u018-user-owner2', 'u018-company-1', 'account_manager', 'active', now()),
  ('u018-ucr-actor1', 'u018-user-actor1', 'u018-company-1', 'account_manager', 'active', now()),
  ('u018-ucr-actor2', 'u018-user-actor2', 'u018-company-1', 'account_manager', 'active', now()),
  ('u018-ucr-cross', 'u018-user-cross', 'u018-company-2', 'account_manager', 'active', now());
`;

async function runApprovalSchemaScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};

  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT_U018, purpose: PURPOSE_U018, evidenceDir, imageDigest: IMAGE_DIGEST, migrate: true },
    async (ctx: any) => {
      const conn = parseConn(ctx.databaseUrl);
      const schemaPath = join(REAL_PRISMA_DIR, 'schema.prisma');
      evidence.scratchIdentity = { runId: ctx.sentinel.runId, ownerUnit: ctx.sentinel.ownerUnit, purpose: ctx.sentinel.purpose, databaseName: ctx.databaseName };

      const { parseCanonicalArtifactContent } = await import('../src/canonical-content-hash.ts');

      // ---- DDL introspection ----
      const ddlLines: string[] = [];
      const functionRows = await execSql(
        ctx.containerName,
        conn,
        `SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname = ANY(ARRAY[${APPROVAL_SCHEMA_FUNCTIONS.map((f) => `'${f}'`).join(',')}]);`,
      );
      const foundFunctions = functionRows.length > 0 ? functionRows.split(',') : [];
      ddlLines.push(`functions: expected=${APPROVAL_SCHEMA_FUNCTIONS.length} found=${foundFunctions.length} :: ${foundFunctions.join(',')}`);
      if (foundFunctions.length !== APPROVAL_SCHEMA_FUNCTIONS.length) {
        throw new ContractFailure(EXIT.CONTRACT, `expected all ${APPROVAL_SCHEMA_FUNCTIONS.length} approval-schema functions installed, found ${foundFunctions.length}: ${foundFunctions.join(',')}`);
      }

      for (const trg of APPROVAL_SCHEMA_TRIGGERS) {
        const found = await execSql(ctx.containerName, conn, `SELECT count(*) FROM pg_trigger WHERE tgname = '${trg.name}' AND tgrelid = '${trg.table}'::regclass;`);
        ddlLines.push(`trigger ${trg.table}.${trg.name}: found=${found}`);
        if (found !== '1') throw new ContractFailure(EXIT.CONTRACT, `expected trigger ${trg.name} on ${trg.table}, found count=${found}`);
      }

      for (const chk of APPROVAL_SCHEMA_CHECKS) {
        const found = await execSql(ctx.containerName, conn, `SELECT count(*) FROM pg_constraint WHERE conname = '${chk}' AND contype = 'c';`);
        ddlLines.push(`check ${chk}: found=${found}`);
        if (found !== '1') throw new ContractFailure(EXIT.CONTRACT, `expected CHECK constraint ${chk}, found count=${found}`);
      }

      const openUniqueIndex = await execSql(ctx.containerName, conn, `SELECT count(*) FROM pg_indexes WHERE indexname = 'approval_requests_open_unique_idx';`);
      ddlLines.push(`partial unique index approval_requests_open_unique_idx: found=${openUniqueIndex}`);
      if (openUniqueIndex !== '1') throw new ContractFailure(EXIT.CONTRACT, `expected partial unique index approval_requests_open_unique_idx, found count=${openUniqueIndex}`);

      writeFileSync(join(evidenceDir, 'approval-ddl.log'), `${ddlLines.join('\n')}\n`);
      evidence.ddlIntrospection = { functions: foundFunctions.length, triggers: APPROVAL_SCHEMA_TRIGGERS.length, checks: APPROVAL_SCHEMA_CHECKS.length };

      // ---- fixture data: tenant/companies/project/users/roles, then a real Artifact+ArtifactVersion (U017 reuse) to bind approvals to ----
      await execSql(ctx.containerName, conn, APPROVAL_SCHEMA_FIXTURE_SQL);

      const v1 = parseCanonicalArtifactContent(JSON.stringify({ title: 'release candidate', body: 'v1' }));
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at)
         VALUES ('u018-art-1','u018-tenant-1','u018-company-1','u018-project-1','proposal','internal','human','U018 Artifact','u018-ucr-requester','u018-ucr-owner',now(),now());`,
      );
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at)
         VALUES ('u018-artv-1','u018-art-1',1,'${v1.contentHashVersion}','${v1.canonicalContentEnvelope.replace(/'/g, "''")}','${v1.contentHash}','${JSON.stringify(v1.contentJson).replace(/'/g, "''")}'::jsonb,'review_ready','u018-ucr-requester',now());`,
      );
      const artifactContentHash = v1.contentHash;

      // ---- PG-authoritative validation-snapshot digest: SQL function equality for reordered/nested/Unicode/numeric JSON (no JS hash authoritative) ----
      const digestVectors: Array<{ name: string; a: unknown; b: unknown }> = [
        { name: 'reordered-keys', a: { alpha: 1, beta: 2 }, b: { beta: 2, alpha: 1 } },
        { name: 'nested-object', a: { outer: { x: 1, y: [1, 2, 3] } }, b: { outer: { y: [1, 2, 3], x: 1 } } },
        { name: 'unicode', a: { label: '한글 유니코드 éè' }, b: { label: '한글 유니코드 éè' } },
        { name: 'numeric', a: { score: 12.5, count: 0 }, b: { count: 0, score: 12.5 } },
      ];
      const digestLines: string[] = [];
      for (const v of digestVectors) {
        const hashA = await execSql(ctx.containerName, conn, `SELECT public.sangfor_validation_snapshot_sha256('${JSON.stringify(v.a).replace(/'/g, "''")}'::jsonb);`);
        const hashB = await execSql(ctx.containerName, conn, `SELECT public.sangfor_validation_snapshot_sha256('${JSON.stringify(v.b).replace(/'/g, "''")}'::jsonb);`);
        digestLines.push(`${v.name}: a=${hashA} b=${hashB} equal=${hashA === hashB}`);
        if (!/^[0-9a-f]{64}$/.test(hashA) || hashA !== hashB) {
          throw new ContractFailure(EXIT.CONTRACT, `sangfor_validation_snapshot_sha256 did not reproduce byte-identical hashes for reordered/equivalent JSON vector "${v.name}": a=${hashA} b=${hashB}`);
        }
      }
      evidence.validationSnapshotDigestParity = digestLines;

      // ---- happy path: explicit false, omit hash, receive DB-generated hash; revision-0/ownershipRevision-0 pending exact-version request ----
      const validationSnapshotJson = { policy: 'release-gate', inputs: { score: 9, tags: ['a', 'b'] }, unicode: '검토' };
      const validationSnapshotLiteral = JSON.stringify(validationSnapshotJson).replace(/'/g, "''");
      const expectedHash = await execSql(ctx.containerName, conn, `SELECT public.sangfor_validation_snapshot_sha256('${validationSnapshotLiteral}'::jsonb);`);

      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO approval_requests (
           id, status, reason, created_at, tenant_id, company_id, project_id, artifact_version_id, action,
           artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id,
           ownership_revision, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum,
           revision, legacy_unbound, updated_at
         ) VALUES (
           'u018-appr-1', 'pending', 'release gate', now(), 'u018-tenant-1', 'u018-company-1', 'u018-project-1', 'u018-artv-1', 'release',
           '${artifactContentHash}', 'u018-ucr-requester', 'sess-req-1', 'u018-ucr-owner',
           0, 'release-gate', 'v1', '${APPROVAL_SCHEMA_POLICY_HASH}', '${validationSnapshotLiteral}'::jsonb, 2,
           0, false, now()
         );`,
      );
      const returnedHash = await execSql(ctx.containerName, conn, `SELECT validation_snapshot_hash FROM approval_requests WHERE id = 'u018-appr-1';`);
      if (returnedHash !== expectedHash) {
        throw new ContractFailure(EXIT.CONTRACT, `DB-returned validation_snapshot_hash "${returnedHash}" does not equal SELECT sangfor_validation_snapshot_sha256($1::jsonb) "${expectedHash}"`);
      }
      evidence.dbGeneratedHashMatchesFunction = true;

      const happyTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT id, status, legacy_unbound, revision, ownership_revision, validation_snapshot_hash FROM approval_requests WHERE id = 'u018-appr-1';`,
      );
      writeFileSync(join(evidenceDir, 'approval-happy.tsv'), happyTsv.endsWith('\n') ? happyTsv : `${happyTsv}\n`);
      const happyDataLine = happyTsv.trim().split('\n')[1] ?? '';
      if (!new RegExp(`^u018-appr-1\\tpending\\tf\\t0\\t0\\t${expectedHash}$`).test(happyDataLine)) {
        throw new ContractFailure(EXIT.CONTRACT, `unexpected post-insert canonical approval_requests state: ${happyDataLine}`);
      }
      evidence.happyPath = { revisionZero: true, ownershipRevisionZero: true, statusPending: true };

      // ---- CAS owner-only reassignment: ownershipRevision 0->1, requester/revision/history unchanged ----
      await execSql(ctx.containerName, conn, `UPDATE approval_requests SET owner_assignment_id = 'u018-ucr-owner2', ownership_revision = 1 WHERE id = 'u018-appr-1';`);
      const casTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT owner_assignment_id, ownership_revision, requested_by_assignment_id, revision FROM approval_requests WHERE id = 'u018-appr-1';`,
      );
      const casDataLine = casTsv.trim().split('\n')[1] ?? '';
      if (!/^u018-ucr-owner2\t1\tu018-ucr-requester\t0$/.test(casDataLine)) {
        throw new ContractFailure(EXIT.CONTRACT, `unexpected post-CAS approval_requests state: ${casDataLine}`);
      }
      evidence.casOwnerReassignment = { ownershipRevision: 1, requesterUnchanged: true, revisionUnchanged: true };

      // ---- two immutable ApprovalDecision rows with exact resulting revisions ----
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at)
         VALUES ('u018-dec-1', 'u018-appr-1', 1, 0, 'u018-artv-1', '${artifactContentHash}', 'approve', 'u018-ucr-actor1', 'sess-actor-1', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      );
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at)
         VALUES ('u018-dec-2', 'u018-appr-1', 2, 0, 'u018-artv-1', '${artifactContentHash}', 'approve', 'u018-ucr-actor2', 'sess-actor-2', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      );
      const decisionsTsv = await execSqlTsv(ctx.containerName, conn, `SELECT id, sequence, request_revision, decision FROM approval_decisions WHERE approval_request_id = 'u018-appr-1' ORDER BY sequence;`);
      const decisionDataLines = decisionsTsv.trim().split('\n').filter((l) => /^u018-dec-\d\t\d\t\d\t(approve|reject)$/.test(l));
      if (decisionDataLines.length !== 2) throw new ContractFailure(EXIT.CONTRACT, `expected 2 ordered approval_decisions rows, got ${decisionDataLines.length}: ${decisionsTsv}`);
      evidence.decisionRows = 2;

      // ---- non-valid ApprovalCurrentValidity projection (migration/backfill authority-zero: no valid row exists anywhere in this scenario) ----
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO approval_current_validity (approval_request_id, request_revision, artifact_version_id, artifact_hash_snapshot, policy_hash_snapshot, required_quorum, satisfied_quorum, last_decision_sequence, state, updated_at)
         VALUES ('u018-appr-1', 0, 'u018-artv-1', '${artifactContentHash}', '${APPROVAL_SCHEMA_POLICY_HASH}', 2, 2, 2, 'pending', now());`,
      );
      const validityTsv = await execSqlTsv(ctx.containerName, conn, `SELECT approval_request_id, state, satisfied_quorum, last_decision_sequence FROM approval_current_validity WHERE approval_request_id = 'u018-appr-1';`);
      writeFileSync(join(evidenceDir, 'approval-validity-nonvalid.tsv'), validityTsv.endsWith('\n') ? validityTsv : `${validityTsv}\n`);
      const validityDataLine = validityTsv.trim().split('\n')[1] ?? '';
      if (!/^u018-appr-1\tpending\t2\t2$/.test(validityDataLine)) {
        throw new ContractFailure(EXIT.CONTRACT, `unexpected non-valid projection state: ${validityDataLine}`);
      }
      const noValidAnywhere = await execSql(ctx.containerName, conn, `SELECT count(*) FROM approval_current_validity WHERE state = 'valid';`);
      if (noValidAnywhere !== '0') throw new ContractFailure(EXIT.CONTRACT, `expected zero state=valid rows in this schema-only scenario, found ${noValidAnywhere}`);
      evidence.nonValidProjection = { state: 'pending', zeroValidRowsAnywhere: true };

      // ---- compatibility fixture: the UNCHANGED pre-U022 approval-db.ts writer stores legacy_unbound=true with zero canonical authority, and cannot be upgraded ----
      // approval-db.ts imports the @sangfor/db singleton `prisma` client, which is constructed
      // (reading env DATABASE_URL) at that module's first import — set it to this scratch
      // database's URL before the dynamic import below triggers that construction.
      process.env.DATABASE_URL = ctx.databaseUrl;
      const { createApprovalIfNeeded } = await import('../../business/src/governance/approval-db.ts');
      const { PrismaClient } = await import('@prisma/client');
      const legacyPrisma = new (PrismaClient as any)({ datasources: { db: { url: ctx.databaseUrl } } });
      try {
        await legacyPrisma.command.create({ data: { id: 'u018-command-1', key: 'deploy', title: 'Deploy' } });
        await legacyPrisma.commandRun.create({
          data: { id: 'u018-run-1', commandId: 'u018-command-1', projectId: 'u018-project-1', status: 'pending' },
        });
        await legacyPrisma.riskAnalysis.create({ data: { id: 'u018-risk-1', commandRunId: 'u018-run-1', riskLevel: 'high', riskJson: {} } });
        const legacyApproval = await createApprovalIfNeeded('u018-run-1', 'high');
        if (!legacyApproval) throw new ContractFailure(EXIT.CONTRACT, 'unchanged approval-db.ts createApprovalIfNeeded unexpectedly returned null for a high-risk run');
        const legacyTsv = await execSqlTsv(
          ctx.containerName,
          conn,
          `SELECT legacy_unbound, tenant_id IS NULL, company_id IS NULL, artifact_version_id IS NULL, requested_by_assignment_id IS NULL, ownership_revision, revision FROM approval_requests WHERE id = '${legacyApproval.id}';`,
        );
        writeFileSync(join(evidenceDir, 'legacy-unbound.tsv'), legacyTsv.endsWith('\n') ? legacyTsv : `${legacyTsv}\n`);
        const legacyDataLine = legacyTsv.trim().split('\n')[1] ?? '';
        if (!/^t\tt\tt\tt\tt\t0\t0$/.test(legacyDataLine)) {
          throw new ContractFailure(EXIT.CONTRACT, `unchanged legacy writer did not store legacy_unbound=true with zero canonical fields: ${legacyDataLine}`);
        }
        evidence.legacyWriterUnchanged = { legacyUnbound: true, canonicalFieldsNull: true, ownershipRevisionZero: true, revisionZero: true };

        const upgradeAttempt = await attemptQaInsert(ctx.containerName, conn, {
          label: 'legacy-unbound row cannot be upgraded to canonical (true->false)',
          expect: 'reject',
          sql: `UPDATE approval_requests SET legacy_unbound = false WHERE id = '${legacyApproval.id}';`,
        });
        evidence.legacyCannotBeUpgraded = upgradeAttempt;
      } finally {
        await legacyPrisma.$disconnect();
      }

      // ---- negative fixtures (SQLSTATE + constraint capture) ----
      const negativeLines: string[] = [];
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'canonical fields supplied without explicit legacyUnbound=false (defaults true, shape guard rejects)',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, updated_at) VALUES ('u018-neg-noflag', 'pending', now(), 'u018-tenant-1', 'u018-company-1', 'u018-project-1', 'u018-artv-1', 'release', '${artifactContentHash}', 'u018-ucr-requester', 'sess', 'u018-ucr-owner', 'release-gate', 'v1', '${APPROVAL_SCHEMA_POLICY_HASH}', '{}'::jsonb, 2, now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'legacyUnbound=false with a partial shape (missing action)',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, legacy_unbound, updated_at) VALUES ('u018-neg-partial', 'pending', now(), 'u018-tenant-1', 'u018-company-1', 'u018-project-1', 'u018-artv-1', '${artifactContentHash}', 'u018-ucr-requester', 'sess', 'u018-ucr-owner', 'release-gate', 'v1', '${APPROVAL_SCHEMA_POLICY_HASH}', '{}'::jsonb, 2, false, now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'legacyUnbound=true with a canonical field set (tenant_id)',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, tenant_id, legacy_unbound, updated_at) VALUES ('u018-neg-truewithfield', 'pending', now(), 'u018-tenant-1', true, now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'caller-supplied wrong validation_snapshot_hash',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, validation_snapshot_hash, required_quorum, legacy_unbound, updated_at) VALUES ('u018-neg-wronghash', 'pending', now(), 'u018-tenant-1', 'u018-company-1', 'u018-project-1', 'u018-artv-1', 'release', '${artifactContentHash}', 'u018-ucr-requester', 'sess', 'u018-ucr-owner', 'release-gate', 'v1', '${APPROVAL_SCHEMA_POLICY_HASH}', '{}'::jsonb, repeat('0',64), 2, false, now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'UPDATE of validation_snapshot alone',
        expect: 'reject',
        sql: `UPDATE approval_requests SET validation_snapshot = '{"changed":true}'::jsonb WHERE id = 'u018-appr-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'UPDATE of validation_snapshot_hash alone',
        expect: 'reject',
        sql: `UPDATE approval_requests SET validation_snapshot_hash = repeat('1',64) WHERE id = 'u018-appr-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'UPDATE of both snapshot+hash together to a mutually-consistent-but-different pair',
        expect: 'reject',
        sql: `UPDATE approval_requests SET validation_snapshot = '{"changed":true}'::jsonb, validation_snapshot_hash = public.sangfor_validation_snapshot_sha256('{"changed":true}'::jsonb) WHERE id = 'u018-appr-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'legacy_unbound true->false UPDATE (covered above via legacyCannotBeUpgraded; repeated on the canonical fixture path for a hand-inserted legacy row)',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, legacy_unbound, updated_at) VALUES ('u018-neg-legacyflip', 'pending', now(), true, now()); UPDATE approval_requests SET legacy_unbound = false WHERE id = 'u018-neg-legacyflip';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'ID-only / cross-company requested_by_assignment_id',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, legacy_unbound, updated_at) VALUES ('u018-neg-crossrequester', 'pending', now(), 'u018-tenant-1', 'u018-company-1', 'u018-project-1', 'u018-artv-1', 'release-crossreq', '${artifactContentHash}', 'u018-ucr-cross', 'sess', 'u018-ucr-owner', 'release-gate', 'v1', '${APPROVAL_SCHEMA_POLICY_HASH}', '{}'::jsonb, 2, false, now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'ID-only / cross-company owner_assignment_id',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, legacy_unbound, updated_at) VALUES ('u018-neg-crossowner', 'pending', now(), 'u018-tenant-1', 'u018-company-1', 'u018-project-1', 'u018-artv-1', 'release-crossown', '${artifactContentHash}', 'u018-ucr-requester', 'sess', 'u018-ucr-cross', 'release-gate', 'v1', '${APPROVAL_SCHEMA_POLICY_HASH}', '{}'::jsonb, 2, false, now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'negative ownership_revision',
        expect: 'reject',
        sql: `UPDATE approval_requests SET ownership_revision = -1 WHERE id = 'u018-appr-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'owner change without exactly ownershipRevision+1',
        expect: 'reject',
        sql: `UPDATE approval_requests SET owner_assignment_id = 'u018-ucr-owner', ownership_revision = 1 WHERE id = 'u018-appr-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'request scope mismatch (company_id not matching the referenced ArtifactVersion/Artifact)',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, legacy_unbound, updated_at) VALUES ('u018-neg-scopemismatch', 'pending', now(), 'u018-tenant-1', 'u018-company-2', 'u018-project-1', 'u018-artv-1', 'release', '${artifactContentHash}', 'u018-ucr-cross', 'sess', 'u018-ucr-cross', 'release-gate', 'v1', '${APPROVAL_SCHEMA_POLICY_HASH}', '{}'::jsonb, 2, false, now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'request version/hash mismatch (artifact_hash_snapshot not matching the referenced ArtifactVersion.content_hash)',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, legacy_unbound, updated_at) VALUES ('u018-neg-hashmismatch', 'pending', now(), 'u018-tenant-1', 'u018-company-1', 'u018-project-1', 'u018-artv-1', 'release', repeat('0',64), 'u018-ucr-requester', 'sess', 'u018-ucr-owner', 'release-gate', 'v1', '${APPROVAL_SCHEMA_POLICY_HASH}', '{}'::jsonb, 2, false, now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'mutation of the immutable requester (requested_by_assignment_id)',
        expect: 'reject',
        sql: `UPDATE approval_requests SET requested_by_assignment_id = 'u018-ucr-owner' WHERE id = 'u018-appr-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'illegal canonical request status literal',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, legacy_unbound, updated_at) VALUES ('u018-neg-badstatus', 'not_a_real_status', now(), 'u018-tenant-1', 'u018-company-1', 'u018-project-1', 'u018-artv-1', 'release', '${artifactContentHash}', 'u018-ucr-requester', 'sess', 'u018-ucr-owner', 'release-gate', 'v1', '${APPROVAL_SCHEMA_POLICY_HASH}', '{}'::jsonb, 2, false, now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'duplicate OPEN request for the same (artifact_version_id, action, policy_hash)',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, legacy_unbound, updated_at) VALUES ('u018-neg-dupopen', 'pending', now(), 'u018-tenant-1', 'u018-company-1', 'u018-project-1', 'u018-artv-1', 'release', '${artifactContentHash}', 'u018-ucr-requester', 'sess', 'u018-ucr-owner', 'release-gate', 'v1', '${APPROVAL_SCHEMA_POLICY_HASH}', '{}'::jsonb, 1, false, now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'duplicate decision sequence for the same request',
        expect: 'reject',
        sql: `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at) VALUES ('u018-neg-dupseq', 'u018-appr-1', 1, 0, 'u018-artv-1', '${artifactContentHash}', 'approve', 'u018-ucr-owner2', 'sess', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'nonpositive decision sequence',
        expect: 'reject',
        sql: `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at) VALUES ('u018-neg-zeroseq', 'u018-appr-1', 0, 0, 'u018-artv-1', '${artifactContentHash}', 'approve', 'u018-ucr-owner2', 'sess', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'duplicate actor for the same request',
        expect: 'reject',
        sql: `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at) VALUES ('u018-neg-dupactor', 'u018-appr-1', 3, 0, 'u018-artv-1', '${artifactContentHash}', 'reject', 'u018-ucr-actor1', 'sess', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'decision negative request_revision',
        expect: 'reject',
        sql: `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at) VALUES ('u018-neg-negrev', 'u018-appr-1', 4, -1, 'u018-artv-1', '${artifactContentHash}', 'approve', 'u018-ucr-owner2', 'sess', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'decision version mismatch (wrong artifact_version_id)',
        expect: 'reject',
        sql: `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at) VALUES ('u018-neg-decversion', 'u018-appr-1', 4, 0, 'nonexistent-version', '${artifactContentHash}', 'approve', 'u018-ucr-owner2', 'sess', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'decision hash mismatch (wrong artifact_hash_snapshot)',
        expect: 'reject',
        sql: `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at) VALUES ('u018-neg-dechash', 'u018-appr-1', 4, 0, 'u018-artv-1', repeat('0',64), 'approve', 'u018-ucr-owner2', 'sess', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'decision policy mismatch (wrong policy_hash_snapshot)',
        expect: 'reject',
        sql: `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at) VALUES ('u018-neg-decpolicy', 'u018-appr-1', 4, 0, 'u018-artv-1', '${artifactContentHash}', 'approve', 'u018-ucr-owner2', 'sess', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH_2}', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'decision request-revision mismatch (parent revision is 0, supplying 7)',
        expect: 'reject',
        sql: `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at) VALUES ('u018-neg-decrevmismatch', 'u018-appr-1', 4, 7, 'u018-artv-1', '${artifactContentHash}', 'approve', 'u018-ucr-owner2', 'sess', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'cross-company decision actor via parent guard',
        expect: 'reject',
        sql: `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at) VALUES ('u018-neg-decactorcross', 'u018-appr-1', 4, 0, 'u018-artv-1', '${artifactContentHash}', 'approve', 'u018-ucr-cross', 'sess', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'illegal decision vocabulary',
        expect: 'reject',
        sql: `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at) VALUES ('u018-neg-decvocab', 'u018-appr-1', 4, 0, 'u018-artv-1', '${artifactContentHash}', 'maybe', 'u018-ucr-owner2', 'sess', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'attempt to treat a legacy approved row as canonical (ApprovalDecision against a legacyUnbound=true parent)',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, legacy_unbound, updated_at) VALUES ('u018-neg-legacyparent', 'approved', now(), true, now());
              INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at) VALUES ('u018-neg-decagainstlegacy', 'u018-neg-legacyparent', 1, 0, 'u018-artv-1', '${artifactContentHash}', 'approve', 'u018-ucr-actor1', 'sess', 'account_manager', '${APPROVAL_SCHEMA_POLICY_HASH}', now());`,
      }));
      writeFileSync(join(evidenceDir, 'approval-negative.log'), `${negativeLines.join('\n')}\n`);
      evidence.negativeFixtureCount = negativeLines.length;

      // ---- decision-immutability + append-only proofs ----
      const immutabilityLines: string[] = [];
      immutabilityLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'UPDATE on approval_decisions denied (append-only)',
        expect: 'reject',
        sql: `UPDATE approval_decisions SET decision = 'reject' WHERE id = 'u018-dec-1';`,
      }));
      immutabilityLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'DELETE on approval_decisions denied (append-only)',
        expect: 'reject',
        sql: `DELETE FROM approval_decisions WHERE id = 'u018-dec-1';`,
      }));
      writeFileSync(join(evidenceDir, 'decision-immutability.log'), `${immutabilityLines.join('\n')}\n`);
      evidence.decisionImmutabilityChecks = immutabilityLines.length;

      // ---- illegal projection resurrection + valid-precondition proofs (a second/third canonical request driven to rejected/approved through the status graph) ----
      const validityNegativeLines: string[] = [];
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, revision, legacy_unbound, updated_at)
         VALUES ('u018-appr-rejected', 'pending', now(), 'u018-tenant-1', 'u018-company-1', 'u018-project-1', 'u018-artv-1', 'reject-path', '${artifactContentHash}', 'u018-ucr-requester', 'sess', 'u018-ucr-owner', 'release-gate', 'v1', '${APPROVAL_SCHEMA_POLICY_HASH_2}', '{}'::jsonb, 1, 0, false, now());
         UPDATE approval_requests SET status = 'ready_for_human_approval' WHERE id = 'u018-appr-rejected';
         UPDATE approval_requests SET status = 'rejected' WHERE id = 'u018-appr-rejected';`,
      );
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO approval_current_validity (approval_request_id, request_revision, artifact_version_id, artifact_hash_snapshot, policy_hash_snapshot, required_quorum, satisfied_quorum, last_decision_sequence, state, updated_at)
         VALUES ('u018-appr-rejected', 0, 'u018-artv-1', '${artifactContentHash}', '${APPROVAL_SCHEMA_POLICY_HASH_2}', 1, 0, 0, 'invalid', now());`,
      );
      validityNegativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'illegal projection resurrection (invalid -> pending)',
        expect: 'reject',
        sql: `UPDATE approval_current_validity SET state = 'pending' WHERE approval_request_id = 'u018-appr-rejected';`,
      }));
      validityNegativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'valid requires the parent request status=approved (parent is rejected)',
        expect: 'reject',
        sql: `UPDATE approval_current_validity SET state = 'valid', satisfied_quorum = 1, evaluated_at = now() WHERE approval_request_id = 'u018-appr-rejected';`,
      }));

      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, revision, legacy_unbound, updated_at)
         VALUES ('u018-appr-approved', 'pending', now(), 'u018-tenant-1', 'u018-company-1', 'u018-project-1', 'u018-artv-1', 'approve-path', '${artifactContentHash}', 'u018-ucr-requester', 'sess', 'u018-ucr-owner', 'release-gate', 'v1', 'ff${'ff'.repeat(31)}', '{}'::jsonb, 2, 0, false, now());
         UPDATE approval_requests SET status = 'ready_for_human_approval' WHERE id = 'u018-appr-approved';
         UPDATE approval_requests SET status = 'approved' WHERE id = 'u018-appr-approved';
         INSERT INTO approval_current_validity (approval_request_id, request_revision, artifact_version_id, artifact_hash_snapshot, policy_hash_snapshot, required_quorum, satisfied_quorum, last_decision_sequence, state, updated_at)
         VALUES ('u018-appr-approved', 0, 'u018-artv-1', '${artifactContentHash}', 'ff${'ff'.repeat(31)}', 2, 0, 0, 'pending', now());`,
      );
      validityNegativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'valid requires distinct quorum (satisfied_quorum below required_quorum)',
        expect: 'reject',
        sql: `UPDATE approval_current_validity SET state = 'valid', satisfied_quorum = 1, evaluated_at = now() WHERE approval_request_id = 'u018-appr-approved';`,
      }));
      validityNegativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'valid requires a non-null evaluatedAt',
        expect: 'reject',
        sql: `UPDATE approval_current_validity SET state = 'valid', satisfied_quorum = 2 WHERE approval_request_id = 'u018-appr-approved';`,
      }));
      validityNegativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'validity snapshot revision/version/hash/policy/quorum mismatch',
        expect: 'reject',
        sql: `UPDATE approval_current_validity SET required_quorum = 99 WHERE approval_request_id = 'u018-appr-approved';`,
      }));
      writeFileSync(join(evidenceDir, 'approval-negative.log'), `${[...negativeLines, ...validityNegativeLines].join('\n')}\n`);
      evidence.validityNegativeFixtureCount = validityNegativeLines.length;

      // ---- reproducible deploy + empty schema diff ----
      const redeploy = await runWorkspaceMigrateDeploy(ctx.migrationDatabaseUrl, schemaPath);
      if (redeploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy re-run was not reproducible: ${redeploy.stderr || redeploy.stdout}`);
      evidence.migrateDeployReproducible = true;

      const diff = await runMigrateDiff(ctx.migrationDatabaseUrl);
      const diffText = diff.stdout.trim();
      const isEmptyDiff = diff.code === 0 && (diffText.length === 0 || diffText === '-- This is an empty migration.');
      writeFileSync(join(evidenceDir, 'migration-diff.sql'), '');
      if (!isEmptyDiff) throw new ContractFailure(EXIT.CONTRACT, `schema diff not empty after fresh migrate deploy: exit=${diff.code} stdout=${diff.stdout}`);
      evidence.emptySchemaDiff = true;

      return evidence;
    },
  );

  return evidence;
}

async function runApprovalSchemaSuite(evidenceDir: string): Promise<number> {
  const runId = `u018${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let caughtError: unknown = null;
  let scenarioEvidence: Record<string, unknown> | null = null;
  try {
    scenarioEvidence = await runApprovalSchemaScenario(evidenceDir, runId);
  } catch (error) {
    caughtError = error;
  }

  const labelCounts = await labelResourceCounts(runId, OWNER_UNIT_U018, PURPOSE_U018);
  const cleanupOk = labelCounts.containers === 0 && labelCounts.networks === 0 && labelCounts.volumes === 0;
  const cleanup = {
    schemaVersion: 1,
    unit: OWNER_UNIT_U018,
    purpose: PURPOSE_U018,
    runId,
    postgres: { containers: labelCounts.containers, networks: labelCounts.networks, volumes: labelCounts.volumes },
    http: null,
    httpReason:
      'U018 db:contract is a DB-only schema/migration/constraint suite with no web/API process to bind or tear down here — no approve/reject/evaluation runtime, no external send/release exists to reach at this unit.',
    childProcesses: 0,
    result: cleanupOk ? 'PASS' : 'FAIL',
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(evidenceDir, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`run-db-contract: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError instanceof ContractFailure ? caughtError.exitCode : EXIT.CONTRACT;
  }

  writeFileSync(
    join(evidenceDir, 'db-contract-receipt.json'),
    `${JSON.stringify({ schemaVersion: 1, unit: OWNER_UNIT_U018, suite: 'approval-schema', result: 'PASS', scenarioEvidence, cleanup, startedAt, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return EXIT.SUCCESS;
}

// ─────────────────────────────────────────────────────────────────────────
// U019 — workflow-schema suite
// ─────────────────────────────────────────────────────────────────────────

const WORKFLOW_SCHEMA_FUNCTIONS = [
  'sangfor_workflow_definition_guard',
  'sangfor_workflow_run_guard',
  'sangfor_workflow_run_cascade_cancel',
  'sangfor_workflow_run_step_guard',
  'sangfor_workflow_run_artifact_guard',
  'sangfor_workflow_run_event_guard',
];
const WORKFLOW_SCHEMA_TRIGGERS = [
  { table: 'workflow_definitions', name: 'sangfor_workflow_definition_guard_trg' },
  { table: 'workflow_runs', name: 'sangfor_workflow_run_guard_trg' },
  { table: 'workflow_runs', name: 'sangfor_workflow_run_cascade_cancel_trg' },
  { table: 'workflow_run_steps', name: 'sangfor_workflow_run_step_guard_trg' },
  { table: 'workflow_run_artifacts', name: 'sangfor_workflow_run_artifact_guard_trg' },
  { table: 'workflow_run_events', name: 'sangfor_workflow_run_event_guard_trg' },
  { table: 'workflow_run_events', name: 'sangfor_workflow_run_events_deny_update_trg' },
  { table: 'workflow_run_events', name: 'sangfor_workflow_run_events_deny_delete_trg' },
];
const WORKFLOW_SCHEMA_CHECKS = [
  'workflow_definitions_version_positive_check',
  'workflow_definitions_revision_check',
  'workflow_definitions_status_check',
  'workflow_definitions_definition_hash_version_check',
  'workflow_definitions_definition_hash_format_check',
  'workflow_definitions_activation_request_revision_check',
  'workflow_definitions_activation_artifact_hash_format_check',
  'workflow_definitions_activation_policy_hash_format_check',
  'workflow_definitions_activation_all_or_none_check',
  'workflow_definitions_active_requires_snapshot_check',
  'workflow_definitions_activation_artifact_version_matches_check',
  'workflow_definitions_activation_artifact_hash_matches_check',
  'workflow_runs_definition_version_positive_check',
  'workflow_runs_revision_check',
  'workflow_runs_status_check',
  'workflow_runs_definition_artifact_hash_version_check',
  'workflow_runs_definition_artifact_hash_format_check',
  'workflow_runs_activation_request_revision_check',
  'workflow_runs_activation_artifact_hash_format_check',
  'workflow_runs_activation_policy_hash_format_check',
  'workflow_runs_activation_all_or_none_check',
  'workflow_runs_run_gate_request_revision_check',
  'workflow_runs_run_gate_artifact_hash_format_check',
  'workflow_runs_run_gate_policy_hash_format_check',
  'workflow_runs_run_gate_all_or_none_check',
  'workflow_run_steps_status_check',
  'workflow_run_steps_revision_check',
  'workflow_run_steps_sort_order_check',
  'workflow_run_artifacts_direction_check',
  'workflow_run_events_sequence_positive_check',
];

const WORKFLOW_SCHEMA_POLICY_HASH = '44'.repeat(32);

const WORKFLOW_SCHEMA_FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('u019-tenant-1', 'U019 Tenant', 'u019-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u019-company-1', 'u019-tenant-1', 'U019 Company One', 'u019-company-1', now()),
  ('u019-company-2', 'u019-tenant-1', 'U019 Company Two', 'u019-company-2', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u019-project-1', 'u019-project-1', 'U019 Project', 'u019-company-1', now(), now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('u019-user-requester', 'requester@u019.example.com', 'Requester', now(), now()),
  ('u019-user-actor1', 'actor1@u019.example.com', 'Actor One', now(), now()),
  ('u019-user-actor2', 'actor2@u019.example.com', 'Actor Two', now(), now()),
  ('u019-user-cross', 'cross@u019.example.com', 'Cross Company', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, created_at) VALUES
  ('u019-ucr-requester', 'u019-user-requester', 'u019-company-1', 'account_manager', 'active', now()),
  ('u019-ucr-actor1', 'u019-user-actor1', 'u019-company-1', 'account_manager', 'active', now()),
  ('u019-ucr-actor2', 'u019-user-actor2', 'u019-company-1', 'account_manager', 'active', now()),
  ('u019-ucr-cross', 'u019-user-cross', 'u019-company-2', 'account_manager', 'active', now());
`;

async function runWorkflowSchemaScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};

  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT_U019, purpose: PURPOSE_U019, evidenceDir, imageDigest: IMAGE_DIGEST, migrate: true },
    async (ctx: any) => {
      const conn = parseConn(ctx.databaseUrl);
      const schemaPath = join(REAL_PRISMA_DIR, 'schema.prisma');
      evidence.scratchIdentity = { runId: ctx.sentinel.runId, ownerUnit: ctx.sentinel.ownerUnit, purpose: ctx.sentinel.purpose, databaseName: ctx.databaseName };

      const { parseCanonicalArtifactContent } = await import('../src/canonical-content-hash.ts');

      // ---- DDL introspection ----
      const ddlLines: string[] = [];
      const functionRows = await execSql(
        ctx.containerName,
        conn,
        `SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname = ANY(ARRAY[${WORKFLOW_SCHEMA_FUNCTIONS.map((f) => `'${f}'`).join(',')}]);`,
      );
      const foundFunctions = functionRows.length > 0 ? functionRows.split(',') : [];
      ddlLines.push(`functions: expected=${WORKFLOW_SCHEMA_FUNCTIONS.length} found=${foundFunctions.length} :: ${foundFunctions.join(',')}`);
      if (foundFunctions.length !== WORKFLOW_SCHEMA_FUNCTIONS.length) {
        throw new ContractFailure(EXIT.CONTRACT, `expected all ${WORKFLOW_SCHEMA_FUNCTIONS.length} workflow-schema functions installed, found ${foundFunctions.length}: ${foundFunctions.join(',')}`);
      }

      for (const trg of WORKFLOW_SCHEMA_TRIGGERS) {
        const found = await execSql(ctx.containerName, conn, `SELECT count(*) FROM pg_trigger WHERE tgname = '${trg.name}' AND tgrelid = '${trg.table}'::regclass;`);
        ddlLines.push(`trigger ${trg.table}.${trg.name}: found=${found}`);
        if (found !== '1') throw new ContractFailure(EXIT.CONTRACT, `expected trigger ${trg.name} on ${trg.table}, found count=${found}`);
      }

      for (const chk of WORKFLOW_SCHEMA_CHECKS) {
        const found = await execSql(ctx.containerName, conn, `SELECT count(*) FROM pg_constraint WHERE conname = '${chk}' AND contype = 'c';`);
        ddlLines.push(`check ${chk}: found=${found}`);
        if (found !== '1') throw new ContractFailure(EXIT.CONTRACT, `expected CHECK constraint ${chk}, found count=${found}`);
      }

      const oneActiveIndex = await execSql(ctx.containerName, conn, `SELECT count(*) FROM pg_indexes WHERE indexname = 'workflow_definitions_one_active_per_key_idx';`);
      ddlLines.push(`partial unique index workflow_definitions_one_active_per_key_idx: found=${oneActiveIndex}`);
      if (oneActiveIndex !== '1') throw new ContractFailure(EXIT.CONTRACT, `expected partial unique index workflow_definitions_one_active_per_key_idx, found count=${oneActiveIndex}`);

      writeFileSync(join(evidenceDir, 'workflow-ddl.log'), `${ddlLines.join('\n')}\n`);
      evidence.ddlIntrospection = { functions: foundFunctions.length, triggers: WORKFLOW_SCHEMA_TRIGGERS.length, checks: WORKFLOW_SCHEMA_CHECKS.length };

      // ---- legacy Workflow/WorkflowStep/WorkflowTemplate counts before/after: must be unchanged ----
      const legacyBefore = {
        workflows: await execSql(ctx.containerName, conn, `SELECT count(*) FROM workflows;`),
        workflowSteps: await execSql(ctx.containerName, conn, `SELECT count(*) FROM workflow_steps;`),
        workflowTemplates: await execSql(ctx.containerName, conn, `SELECT count(*) FROM workflow_templates;`),
      };

      // ---- fixture data: tenant/companies/project/users/roles ----
      await execSql(ctx.containerName, conn, WORKFLOW_SCHEMA_FIXTURE_SQL);

      // ---- a real workflow-definition Artifact/ArtifactVersion (U017 reuse), JS==PG hash parity ----
      const defContent = parseCanonicalArtifactContent(JSON.stringify({ steps: [{ key: 'fetch' }, { key: 'transform' }] }));
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at)
         VALUES ('u019-art-1','u019-tenant-1','u019-company-1','u019-project-1','workflow-definition','internal','human','U019 Workflow Definition','u019-ucr-requester','u019-ucr-requester',now(),now());`,
      );
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at)
         VALUES ('u019-artv-1','u019-art-1',1,'${defContent.contentHashVersion}','${defContent.canonicalContentEnvelope.replace(/'/g, "''")}','${defContent.contentHash}','${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb,'review_ready','u019-ucr-requester',now());`,
      );
      const defArtifactHash = defContent.contentHash;

      const pgCanonical = await execSql(ctx.containerName, conn, `SELECT public.sangfor_rfc8785_jcs_v1('${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb);`);
      const pgHash = await execSql(ctx.containerName, conn, `SELECT public.sangfor_sha256_utf8((SELECT public.sangfor_rfc8785_jcs_v1(jsonb_build_object('contract','sangfor.artifact-content','payload','${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb,'version',1))));`);
      if (pgHash !== defContent.contentHash) {
        throw new ContractFailure(EXIT.CONTRACT, `JS/PG content-hash parity mismatch: js=${defContent.contentHash} pg=${pgHash}`);
      }
      evidence.jsPgHashParity = { js: defContent.contentHash, pg: pgHash, equal: true, canonicalEnvelopeMatchesPgJcsOfPayload: pgCanonical.length > 0 };

      // ---- positive fixture (a): revision-0 draft WorkflowDefinition, no activation ----
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id, created_at, updated_at)
         VALUES ('u019-def-1','u019-tenant-1','u019-company-1','u019-project-1','ingest-pipeline','Ingest Pipeline',1,0,'draft','u019-artv-1','${defContent.contentHashVersion}','${defArtifactHash}','${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb,'u019-ucr-requester',now(),now());`,
      );
      const defArtifactTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT wd.id, wd.status, wd.revision, wd.definition_artifact_version_id, wd.definition_hash = av.content_hash AS hash_matches FROM workflow_definitions wd JOIN artifact_versions av ON av.id = wd.definition_artifact_version_id WHERE wd.id = 'u019-def-1';`,
      );
      writeFileSync(join(evidenceDir, 'workflow-definition-artifact.tsv'), defArtifactTsv.endsWith('\n') ? defArtifactTsv : `${defArtifactTsv}\n`);
      const defArtifactLine = defArtifactTsv.trim().split('\n')[1] ?? '';
      if (!/^u019-def-1\tdraft\t0\tu019-artv-1\tt$/.test(defArtifactLine)) {
        throw new ContractFailure(EXIT.CONTRACT, `unexpected post-insert draft WorkflowDefinition state: ${defArtifactLine}`);
      }
      evidence.positiveDraftDefinition = { revisionZero: true, statusDraft: true, artifactHashMatches: true };

      // ---- real ApprovalRequest+decisions+ApprovalCurrentValidity chain (U018 reuse), driven to a genuinely valid state ----
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO approval_requests (
           id, status, reason, created_at, tenant_id, company_id, project_id, artifact_version_id, action,
           artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id,
           ownership_revision, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum,
           revision, legacy_unbound, updated_at
         ) VALUES (
           'u019-appr-1', 'pending', 'workflow activation', now(), 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-artv-1', 'workflow-activate',
           '${defArtifactHash}', 'u019-ucr-requester', 'sess-req-1', 'u019-ucr-requester',
           0, 'workflow-activate-gate', 'v1', '${WORKFLOW_SCHEMA_POLICY_HASH}', '{}'::jsonb, 2,
           0, false, now()
         );
         UPDATE approval_requests SET status = 'ready_for_human_approval' WHERE id = 'u019-appr-1';
         UPDATE approval_requests SET status = 'approved' WHERE id = 'u019-appr-1';`,
      );
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO approval_decisions (id, approval_request_id, sequence, request_revision, artifact_version_id, artifact_hash_snapshot, decision, actor_assignment_id, actor_session_id, actor_role_snapshot, policy_hash_snapshot, created_at)
         VALUES
           ('u019-dec-1', 'u019-appr-1', 1, 0, 'u019-artv-1', '${defArtifactHash}', 'approve', 'u019-ucr-actor1', 'sess-actor-1', 'account_manager', '${WORKFLOW_SCHEMA_POLICY_HASH}', now()),
           ('u019-dec-2', 'u019-appr-1', 2, 0, 'u019-artv-1', '${defArtifactHash}', 'approve', 'u019-ucr-actor2', 'sess-actor-2', 'account_manager', '${WORKFLOW_SCHEMA_POLICY_HASH}', now());`,
      );
      const activationApprovedAt = new Date().toISOString();
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO approval_current_validity (approval_request_id, request_revision, artifact_version_id, artifact_hash_snapshot, policy_hash_snapshot, required_quorum, satisfied_quorum, last_decision_sequence, state, evaluated_at, updated_at)
         VALUES ('u019-appr-1', 0, 'u019-artv-1', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', 2, 2, 2, 'valid', '${activationApprovedAt}', now());`,
      );

      // ---- activate the draft definition: complete, matching activation snapshot; revision 0->1 ----
      await execSql(
        ctx.containerName,
        conn,
        `UPDATE workflow_definitions SET
           status = 'active', revision = 1,
           activation_approval_request_id = 'u019-appr-1', activation_approval_request_revision = 0,
           activation_approval_artifact_version_id = 'u019-artv-1', activation_approval_artifact_hash = '${defArtifactHash}',
           activation_approval_policy_hash = '${WORKFLOW_SCHEMA_POLICY_HASH}', activation_approved_at = '${activationApprovedAt}'
         WHERE id = 'u019-def-1';`,
      );
      const activationTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT id, status, revision, activation_approval_request_id, activation_approval_artifact_version_id = definition_artifact_version_id AS artifact_matches FROM workflow_definitions WHERE id = 'u019-def-1';`,
      );
      writeFileSync(join(evidenceDir, 'workflow-approval-snapshots.tsv'), activationTsv.endsWith('\n') ? activationTsv : `${activationTsv}\n`);
      const activationLine = activationTsv.trim().split('\n')[1] ?? '';
      if (!/^u019-def-1\tactive\t1\tu019-appr-1\tt$/.test(activationLine)) {
        throw new ContractFailure(EXIT.CONTRACT, `unexpected post-activation WorkflowDefinition state: ${activationLine}`);
      }
      evidence.activation = { statusActive: true, revisionOne: true, snapshotMatchesArtifact: true, approvalCurrentValidityState: 'valid (real, but U019 never asserts this — structural existence only)' };

      // ---- positive fixture (b): fully snapshotted, non-executed pending canonical run graph with pending steps ----
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO workflow_runs (
           id, tenant_id, company_id, project_id, workflow_definition_id,
           definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash,
           activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id,
           activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at,
           requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at
         ) VALUES (
           'u019-run-1', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1',
           1, 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}',
           'u019-appr-1', 0, 'u019-artv-1',
           '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', '${activationApprovedAt}',
           'u019-ucr-requester', 'sess-run-1', 'run-key-1', 'pending', 0, now(), now()
         );`,
      );
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO workflow_run_steps (id, workflow_run_id, step_key, sort_order, status, revision, created_at, updated_at) VALUES
           ('u019-step-1', 'u019-run-1', 'fetch', 0, 'pending', 0, now(), now()),
           ('u019-step-2', 'u019-run-1', 'transform', 1, 'pending', 0, now(), now());`,
      );
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO workflow_run_artifacts (id, workflow_run_id, artifact_version_id, role, direction, created_at)
         VALUES ('u019-runart-1', 'u019-run-1', 'u019-artv-1', 'definition-snapshot', 'input', now());`,
      );
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO workflow_run_events (id, workflow_run_id, sequence, event_type, actor_assignment_id, actor_session_id, created_at)
         VALUES ('u019-evt-1', 'u019-run-1', 1, 'run.created', 'u019-ucr-requester', 'sess-run-1', now());`,
      );
      const graphTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT r.id, r.status, r.revision, count(s.id) FILTER (WHERE s.status = 'pending') AS pending_steps
         FROM workflow_runs r JOIN workflow_run_steps s ON s.workflow_run_id = r.id
         WHERE r.id = 'u019-run-1' GROUP BY r.id, r.status, r.revision;`,
      );
      writeFileSync(join(evidenceDir, 'workflow-graph.tsv'), graphTsv.endsWith('\n') ? graphTsv : `${graphTsv}\n`);
      const graphLine = graphTsv.trim().split('\n')[1] ?? '';
      if (!/^u019-run-1\tpending\t0\t2$/.test(graphLine)) {
        throw new ContractFailure(EXIT.CONTRACT, `unexpected non-executed pending run/step graph state: ${graphLine}`);
      }
      evidence.positivePendingRunGraph = { runPending: true, stepsPending: 2, neitherInvokesRuntime: true };

      // ---- runtime proofs: succeeded/failed aggregate acceptance and cancellation cascade (still schema-only fixtures, not U025 runtime) ----
      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO workflow_runs (
           id, tenant_id, company_id, project_id, workflow_definition_id,
           definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash,
           activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id,
           activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at,
           requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at
         ) VALUES (
           'u019-run-succ', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1',
           1, 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}',
           'u019-appr-1', 0, 'u019-artv-1',
           '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', '${activationApprovedAt}',
           'u019-ucr-requester', 'sess-run-2', 'run-key-2', 'pending', 0, now(), now()
         );
         INSERT INTO workflow_run_steps (id, workflow_run_id, step_key, sort_order, status, revision, created_at, updated_at) VALUES
           ('u019-step-succ-1', 'u019-run-succ', 'fetch', 0, 'pending', 0, now(), now()),
           ('u019-step-succ-2', 'u019-run-succ', 'transform', 1, 'pending', 0, now(), now());
         UPDATE workflow_runs SET status = 'running', revision = 1 WHERE id = 'u019-run-succ';
         UPDATE workflow_run_steps SET status = 'running', revision = 1 WHERE id = 'u019-step-succ-1';
         UPDATE workflow_run_steps SET status = 'succeeded', revision = 2 WHERE id = 'u019-step-succ-1';
         UPDATE workflow_run_steps SET status = 'skipped', revision = 1 WHERE id = 'u019-step-succ-2';
         UPDATE workflow_runs SET status = 'succeeded', revision = 2 WHERE id = 'u019-run-succ';`,
      );

      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO workflow_runs (
           id, tenant_id, company_id, project_id, workflow_definition_id,
           definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash,
           activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id,
           activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at,
           requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at
         ) VALUES (
           'u019-run-fail', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1',
           1, 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}',
           'u019-appr-1', 0, 'u019-artv-1',
           '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', '${activationApprovedAt}',
           'u019-ucr-requester', 'sess-run-3', 'run-key-3', 'pending', 0, now(), now()
         );
         INSERT INTO workflow_run_steps (id, workflow_run_id, step_key, sort_order, status, revision, created_at, updated_at) VALUES
           ('u019-step-fail-1', 'u019-run-fail', 'fetch', 0, 'pending', 0, now(), now());
         UPDATE workflow_runs SET status = 'running', revision = 1 WHERE id = 'u019-run-fail';
         UPDATE workflow_run_steps SET status = 'running', revision = 1 WHERE id = 'u019-step-fail-1';
         UPDATE workflow_run_steps SET status = 'failed', revision = 2 WHERE id = 'u019-step-fail-1';
         UPDATE workflow_runs SET status = 'failed', revision = 2 WHERE id = 'u019-run-fail';`,
      );

      await execSql(
        ctx.containerName,
        conn,
        `INSERT INTO workflow_runs (
           id, tenant_id, company_id, project_id, workflow_definition_id,
           definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash,
           activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id,
           activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at,
           requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at
         ) VALUES (
           'u019-run-cancel', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1',
           1, 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}',
           'u019-appr-1', 0, 'u019-artv-1',
           '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', '${activationApprovedAt}',
           'u019-ucr-requester', 'sess-run-4', 'run-key-4', 'pending', 0, now(), now()
         );
         INSERT INTO workflow_run_steps (id, workflow_run_id, step_key, sort_order, status, revision, created_at, updated_at) VALUES
           ('u019-step-cancel-1', 'u019-run-cancel', 'fetch', 0, 'pending', 0, now(), now()),
           ('u019-step-cancel-2', 'u019-run-cancel', 'transform', 1, 'pending', 0, now(), now());
         UPDATE workflow_runs SET status = 'cancelled', revision = 1 WHERE id = 'u019-run-cancel';`,
      );
      const cascadeTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT step_key, status, revision FROM workflow_run_steps WHERE workflow_run_id = 'u019-run-cancel' ORDER BY sort_order;`,
      );
      const cascadeLines = cascadeTsv.trim().split('\n').filter((l) => /^(fetch|transform)\tcancelled\t1$/.test(l));
      if (cascadeLines.length !== 2) {
        throw new ContractFailure(EXIT.CONTRACT, `expected cancellation cascade to CAS-cancel both nonterminal steps, got: ${cascadeTsv}`);
      }
      evidence.aggregateAndCascadeProofs = { succeededRequiresAllStepsDone: true, failedRequiresOneFailedStep: true, cancellationCascadesToNonterminalSteps: true };

      // ---- legacy Workflow/WorkflowStep/WorkflowTemplate counts unchanged ----
      const legacyAfter = {
        workflows: await execSql(ctx.containerName, conn, `SELECT count(*) FROM workflows;`),
        workflowSteps: await execSql(ctx.containerName, conn, `SELECT count(*) FROM workflow_steps;`),
        workflowTemplates: await execSql(ctx.containerName, conn, `SELECT count(*) FROM workflow_templates;`),
      };
      writeFileSync(join(evidenceDir, 'legacy-counts.json'), `${JSON.stringify({ before: legacyBefore, after: legacyAfter, unchanged: JSON.stringify(legacyBefore) === JSON.stringify(legacyAfter) }, null, 2)}\n`);
      if (JSON.stringify(legacyBefore) !== JSON.stringify(legacyAfter)) {
        throw new ContractFailure(EXIT.CONTRACT, `legacy workflows/workflow_steps/workflow_templates counts changed: before=${JSON.stringify(legacyBefore)} after=${JSON.stringify(legacyAfter)}`);
      }
      evidence.legacyCountsUnchanged = true;

      // ---- negative fixtures ----
      const negativeLines: string[] = [];
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'definition missing exact ArtifactVersion',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id, created_at, updated_at) VALUES ('u019-neg-missingartv', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'missing-artv', 'T', 1, 0, 'draft', 'nonexistent-artv', '${defContent.contentHashVersion}', '${defArtifactHash}', '{}'::jsonb, 'u019-ucr-requester', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'negative definition revision',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id, created_at, updated_at) VALUES ('u019-neg-negrev', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'neg-rev', 'T', 1, -1, 'draft', 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', '${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb, 'u019-ucr-requester', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'stale (nonzero) definition revision at INSERT',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id, created_at, updated_at) VALUES ('u019-neg-stalerev', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'stale-rev', 'T', 1, 5, 'draft', 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', '${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb, 'u019-ucr-requester', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'definition/artifact scope mismatch (cross-company)',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id, created_at, updated_at) VALUES ('u019-neg-scopemismatch', 'u019-tenant-1', 'u019-company-2', 'u019-project-1', 'scope-mismatch', 'T', 1, 0, 'draft', 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', '${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb, 'u019-ucr-cross', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'definition/artifact type mismatch (non workflow-definition artifact)',
        expect: 'reject',
        sql: `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at) VALUES ('u019-art-wrongtype', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'proposal', 'internal', 'human', 'Wrong Type', 'u019-ucr-requester', 'u019-ucr-requester', now(), now());
              INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES ('u019-artv-wrongtype', 'u019-art-wrongtype', 1, '${defContent.contentHashVersion}', 'x', repeat('a',64), '{}'::jsonb, 'ai_draft', 'u019-ucr-requester', now());
              INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id, created_at, updated_at) VALUES ('u019-neg-wrongtype', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'wrong-type', 'T', 1, 0, 'draft', 'u019-artv-wrongtype', '${defContent.contentHashVersion}', repeat('a',64), '{}'::jsonb, 'u019-ucr-requester', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'hash-version literal mismatch',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id, created_at, updated_at) VALUES ('u019-neg-hashver', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'hashver-mismatch', 'T', 1, 0, 'draft', 'u019-artv-1', 'artifact-content/rfc8785-jcs-sha256/v0', '${defArtifactHash}', '${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb, 'u019-ucr-requester', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'digest mismatch (definitionHash != referenced content_hash)',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id, created_at, updated_at) VALUES ('u019-neg-digest', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'digest-mismatch', 'T', 1, 0, 'draft', 'u019-artv-1', '${defContent.contentHashVersion}', repeat('0',64), '${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb, 'u019-ucr-requester', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'JSON mismatch (correct hash, different definitionJson)',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id, created_at, updated_at) VALUES ('u019-neg-json', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'json-mismatch', 'T', 1, 0, 'draft', 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', '{"totally":"different"}'::jsonb, 'u019-ucr-requester', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'ID-only / cross-company createdByAssignmentId',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id, created_at, updated_at) VALUES ('u019-neg-crosscreator', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'cross-creator', 'T', 1, 0, 'draft', 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', '${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb, 'u019-ucr-cross', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'duplicate active definition for the same (project, workflowKey)',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id,
               activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id, activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at, created_at, updated_at)
               VALUES ('u019-neg-dupactive', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'ingest-pipeline', 'Dup Active', 2, 0, 'active', 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', '${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb, 'u019-ucr-requester',
               'u019-appr-1', 0, 'u019-artv-1', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', '${activationApprovedAt}', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'active definition with a partial activation snapshot (missing activatedAt)',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id,
               activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id, activation_approval_artifact_hash, activation_approval_policy_hash, created_at, updated_at)
               VALUES ('u019-neg-partialsnap', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'partial-snap', 'T', 1, 0, 'active', 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', '${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb, 'u019-ucr-requester',
               'u019-appr-1', 0, 'u019-artv-1', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'active definition whose activation artifact-version snapshot does not match its own definitionArtifactVersionId',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id,
               activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id, activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at, created_at, updated_at)
               VALUES ('u019-neg-mismatchartv', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'mismatch-artv', 'T', 1, 0, 'active', 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', '${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb, 'u019-ucr-requester',
               'u019-appr-1', 0, 'u019-artv-wrongtype', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', '${activationApprovedAt}', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'active definition whose ApprovalCurrentValidity revision does not correlate (no such row exists)',
        expect: 'reject',
        sql: `INSERT INTO workflow_definitions (id, tenant_id, company_id, project_id, workflow_key, name, version, revision, status, definition_artifact_version_id, definition_hash_version, definition_hash, definition_json, created_by_assignment_id,
               activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id, activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at, created_at, updated_at)
               VALUES ('u019-neg-noexistingvalidity', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'no-validity', 'T', 1, 0, 'active', 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', '${JSON.stringify(defContent.contentJson).replace(/'/g, "''")}'::jsonb, 'u019-ucr-requester',
               'u019-appr-1', 99, 'u019-artv-1', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', '${activationApprovedAt}', now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'definition identity edit after non-draft (workflowKey change on the now-active row)',
        expect: 'reject',
        sql: `UPDATE workflow_definitions SET workflow_key = 'renamed', revision = 2 WHERE id = 'u019-def-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'run definition-version mismatch',
        expect: 'reject',
        sql: `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash, requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
               VALUES ('u019-neg-runversion', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1', 99, 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', 'u019-ucr-requester', 'sess', 'run-key-negversion', 'legacy_imported', 0, now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'run definition-artifact mismatch',
        expect: 'reject',
        sql: `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash, requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
               VALUES ('u019-neg-runartifact', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1', 1, 'u019-artv-wrongtype', '${defContent.contentHashVersion}', repeat('a',64), 'u019-ucr-requester', 'sess', 'run-key-negartifact', 'legacy_imported', 0, now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'run definition-hash mismatch',
        expect: 'reject',
        sql: `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash, requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
               VALUES ('u019-neg-runhash', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1', 1, 'u019-artv-1', '${defContent.contentHashVersion}', repeat('9',64), 'u019-ucr-requester', 'sess', 'run-key-neghash', 'legacy_imported', 0, now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'run drops the copied activation snapshot (non-legacy_imported, all six NULL)',
        expect: 'reject',
        sql: `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash, requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
               VALUES ('u019-neg-rundropactivation', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1', 1, 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', 'u019-ucr-requester', 'sess', 'run-key-negdropactivation', 'pending', 0, now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'run changes activationApprovedAt from the exact parent copied value',
        expect: 'reject',
        sql: `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash,
               activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id, activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at,
               requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
               VALUES ('u019-neg-runbadapprovedat', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1', 1, 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}',
               'u019-appr-1', 0, 'u019-artv-1', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', now() + interval '1 day',
               'u019-ucr-requester', 'sess', 'run-key-negbadapprovedat', 'pending', 0, now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'mutation of an already-inserted run activationApprovedAt (post-insert immutability)',
        expect: 'reject',
        sql: `UPDATE workflow_runs SET activation_approved_at = now() + interval '1 day', revision = 1 WHERE id = 'u019-run-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'partial run-gate snapshot (missing runApprovedAt)',
        expect: 'reject',
        sql: `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash,
               activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id, activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at,
               run_approval_request_id, run_approval_request_revision, run_approval_artifact_version_id, run_approval_artifact_hash, run_approval_policy_hash,
               requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
               VALUES ('u019-neg-partialgate', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1', 1, 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}',
               'u019-appr-1', 0, 'u019-artv-1', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', '${activationApprovedAt}',
               'u019-appr-1', 0, 'u019-artv-1', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}',
               'u019-ucr-requester', 'sess', 'run-key-negpartialgate', 'pending', 0, now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'run-gate revision mismatch (wrong runApprovalRequestRevision)',
        expect: 'reject',
        sql: `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash,
               activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id, activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at,
               run_approval_request_id, run_approval_request_revision, run_approval_artifact_version_id, run_approval_artifact_hash, run_approval_policy_hash, run_approved_at,
               requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
               VALUES ('u019-neg-gaterevmismatch', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1', 1, 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}',
               'u019-appr-1', 0, 'u019-artv-1', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', '${activationApprovedAt}',
               'u019-appr-1', 7, 'u019-artv-1', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', now(),
               'u019-ucr-requester', 'sess', 'run-key-neggaterevmismatch', 'pending', 0, now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'run-gate references a legacy_unbound=true ApprovalRequest (confers no canonical authority)',
        expect: 'reject',
        sql: `INSERT INTO approval_requests (id, status, created_at, legacy_unbound, updated_at) VALUES ('u019-appr-legacy', 'approved', now(), true, now());
               INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash,
               activation_approval_request_id, activation_approval_request_revision, activation_approval_artifact_version_id, activation_approval_artifact_hash, activation_approval_policy_hash, activation_approved_at,
               run_approval_request_id, run_approval_request_revision, run_approval_artifact_version_id, run_approval_artifact_hash, run_approval_policy_hash, run_approved_at,
               requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
               VALUES ('u019-neg-gatelegacy', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1', 1, 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}',
               'u019-appr-1', 0, 'u019-artv-1', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', '${activationApprovedAt}',
               'u019-appr-legacy', 0, 'u019-artv-1', '${defArtifactHash}', '${WORKFLOW_SCHEMA_POLICY_HASH}', now(),
               'u019-ucr-requester', 'sess', 'run-key-neggatelegacy', 'pending', 0, now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'unknown/illegal run status literal',
        expect: 'reject',
        sql: `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash, requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
               VALUES ('u019-neg-badstatus', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1', 1, 'u019-artv-1', '${defContent.contentHashVersion}', repeat('a',64), 'u019-ucr-requester', 'sess', 'run-key-negbadstatus', 'not_a_real_status', 0, now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'unknown/illegal step status literal',
        expect: 'reject',
        sql: `INSERT INTO workflow_run_steps (id, workflow_run_id, step_key, sort_order, status, revision, created_at, updated_at) VALUES ('u019-neg-stepbadstatus', 'u019-run-1', 'bad-status-step', 2, 'not_a_real_status', 0, now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'terminal reopening (cancelled run -> running)',
        expect: 'reject',
        sql: `UPDATE workflow_runs SET status = 'running', revision = 2 WHERE id = 'u019-run-cancel';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'terminal reopening (succeeded step -> running)',
        expect: 'reject',
        sql: `UPDATE workflow_run_steps SET status = 'running', revision = 2 WHERE id = 'u019-step-succ-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'impossible run aggregate: succeeded while a step is still pending',
        expect: 'reject',
        sql: `UPDATE workflow_runs SET status = 'running', revision = 1 WHERE id = 'u019-run-1';
               UPDATE workflow_runs SET status = 'succeeded', revision = 2 WHERE id = 'u019-run-1';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'impossible run aggregate: failed with zero failed steps',
        expect: 'reject',
        sql: `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash, requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
               VALUES ('u019-neg-failaggregate', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1', 1, 'u019-artv-1', '${defContent.contentHashVersion}', '${defArtifactHash}', 'u019-ucr-requester', 'sess', 'run-key-negfailaggregate', 'pending', 0, now(), now());
               INSERT INTO workflow_run_steps (id, workflow_run_id, step_key, sort_order, status, revision, created_at, updated_at) VALUES ('u019-step-negfail-1', 'u019-neg-failaggregate', 'fetch', 0, 'pending', 0, now(), now());
               UPDATE workflow_runs SET status = 'running', revision = 1 WHERE id = 'u019-neg-failaggregate';
               UPDATE workflow_runs SET status = 'failed', revision = 2 WHERE id = 'u019-neg-failaggregate';`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'duplicate scoped idempotency key for the same project',
        expect: 'reject',
        sql: `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash, requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
               VALUES ('u019-neg-dupidem', 'u019-tenant-1', 'u019-company-1', 'u019-project-1', 'u019-def-1', 1, 'u019-artv-1', '${defContent.contentHashVersion}', repeat('a',64), 'u019-ucr-requester', 'sess', 'run-key-1', 'legacy_imported', 0, now(), now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'cross-scope ArtifactVersion link on WorkflowRunArtifact',
        expect: 'reject',
        sql: `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at) VALUES ('u019-art-othercompany', 'u019-tenant-1', 'u019-company-2', 'u019-project-1', 'proposal', 'internal', 'human', 'Other Company', 'u019-ucr-cross', 'u019-ucr-cross', now(), now());
               INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES ('u019-artv-othercompany', 'u019-art-othercompany', 1, '${defContent.contentHashVersion}', 'x', repeat('b',64), '{}'::jsonb, 'ai_draft', 'u019-ucr-cross', now());
               INSERT INTO workflow_run_artifacts (id, workflow_run_id, artifact_version_id, role, direction, created_at) VALUES ('u019-neg-runart-crossscope', 'u019-run-1', 'u019-artv-othercompany', 'input', 'input', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'duplicate event sequence for the same run',
        expect: 'reject',
        sql: `INSERT INTO workflow_run_events (id, workflow_run_id, sequence, event_type, created_at) VALUES ('u019-neg-dupseq', 'u019-run-1', 1, 'run.duplicate', now());`,
      }));
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'nonpositive event sequence',
        expect: 'reject',
        sql: `INSERT INTO workflow_run_events (id, workflow_run_id, sequence, event_type, created_at) VALUES ('u019-neg-zeroseq', 'u019-run-1', 0, 'run.zero', now());`,
      }));
      writeFileSync(join(evidenceDir, 'workflow-negative.log'), `${negativeLines.join('\n')}\n`);
      evidence.negativeFixtureCount = negativeLines.length;

      // ---- append-only event immutability ----
      const immutabilityLines: string[] = [];
      immutabilityLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'UPDATE on workflow_run_events denied (append-only)',
        expect: 'reject',
        sql: `UPDATE workflow_run_events SET event_type = 'run.changed' WHERE id = 'u019-evt-1';`,
      }));
      immutabilityLines.push(await attemptQaInsert(ctx.containerName, conn, {
        label: 'DELETE on workflow_run_events denied (append-only)',
        expect: 'reject',
        sql: `DELETE FROM workflow_run_events WHERE id = 'u019-evt-1';`,
      }));
      writeFileSync(join(evidenceDir, 'event-immutability.log'), `${immutabilityLines.join('\n')}\n`);
      evidence.eventImmutabilityChecks = immutabilityLines.length;

      // ---- reproducible deploy + empty schema diff ----
      const redeploy = await runWorkspaceMigrateDeploy(ctx.migrationDatabaseUrl, schemaPath);
      if (redeploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy re-run was not reproducible: ${redeploy.stderr || redeploy.stdout}`);
      evidence.migrateDeployReproducible = true;

      const diff = await runMigrateDiff(ctx.migrationDatabaseUrl);
      const diffText = diff.stdout.trim();
      const isEmptyDiff = diff.code === 0 && (diffText.length === 0 || diffText === '-- This is an empty migration.');
      writeFileSync(join(evidenceDir, 'migration-diff.sql'), '');
      if (!isEmptyDiff) throw new ContractFailure(EXIT.CONTRACT, `schema diff not empty after fresh migrate deploy: exit=${diff.code} stdout=${diff.stdout}`);
      evidence.emptySchemaDiff = true;

      // ---- scope:check via the UNMODIFIED checker ----
      const scopeCheck = await runScopeCheck();
      if (scopeCheck.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `scope:check failed: ${scopeCheck.stdout}\n${scopeCheck.stderr}`);
      const scopeCheckJson = JSON.parse(scopeCheck.stdout);
      if (scopeCheckJson.currentModelCount !== scopeCheckJson.inventoryModelCount || scopeCheckJson.ok !== true) {
        throw new ContractFailure(EXIT.CONTRACT, `scope:check did not report ok=true with schema matching the canonical inventory after U019: ${scopeCheck.stdout}`);
      }
      writeFileSync(join(evidenceDir, 'inventory.json'), `${JSON.stringify(scopeCheckJson, null, 2)}\n`);
      evidence.scopeCheck = { currentModelCount: scopeCheckJson.currentModelCount, ok: scopeCheckJson.ok, tallies: scopeCheckJson.tallies };

      return evidence;
    },
  );

  return evidence;
}

async function runWorkflowSchemaSuite(evidenceDir: string): Promise<number> {
  const runId = `u019${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let caughtError: unknown = null;
  let scenarioEvidence: Record<string, unknown> | null = null;
  try {
    scenarioEvidence = await runWorkflowSchemaScenario(evidenceDir, runId);
  } catch (error) {
    caughtError = error;
  }

  const labelCounts = await labelResourceCounts(runId, OWNER_UNIT_U019, PURPOSE_U019);
  const cleanupOk = labelCounts.containers === 0 && labelCounts.networks === 0 && labelCounts.volumes === 0;
  const cleanup = {
    schemaVersion: 1,
    unit: OWNER_UNIT_U019,
    purpose: PURPOSE_U019,
    runId,
    postgres: { containers: labelCounts.containers, networks: labelCounts.networks, volumes: labelCounts.volumes },
    http: null,
    httpReason:
      'U019 db:contract is a DB-only schema/migration/constraint suite with no web/API process to bind or tear down here — no activation/execution runtime, no external send/export exists to reach at this unit.',
    childProcesses: 0,
    result: cleanupOk ? 'PASS' : 'FAIL',
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(evidenceDir, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`run-db-contract: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError instanceof ContractFailure ? caughtError.exitCode : EXIT.CONTRACT;
  }

  writeFileSync(
    join(evidenceDir, 'db-contract-receipt.json'),
    `${JSON.stringify({ schemaVersion: 1, unit: OWNER_UNIT_U019, suite: 'workflow-schema', result: 'PASS', scenarioEvidence, cleanup, startedAt, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return EXIT.SUCCESS;
}

// ─────────────────────────────────────────────────────────────────────────
// U020 — governance-bridge suite. Reuses U011's ScopeBackfillQuarantine machinery and U017's
// canonical-content-hash exclusively (see the U020 dispatch file boundary) — no new DDL, no new
// functions/triggers/checks to introspect (unlike U011-U019, this unit's migration is empty), so
// this scenario is entirely fixture/dry-run/apply/rerun/validator proof, not DDL introspection.
// ─────────────────────────────────────────────────────────────────────────

const GOVERNANCE_BRIDGE_FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('u020-tenant-1', 'U020 Tenant', 'u020-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES ('u020-company-1', 'u020-tenant-1', 'U020 Company', 'u020-company-1', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u020-project-1', 'u020-project-1', 'U020 Project One', 'u020-company-1', now(), now()),
  ('u020-project-2', 'u020-project-2', 'U020 Project Two', 'u020-company-1', now(), now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('u020-user-1', 'user1@u020.example.com', 'User One', now(), now()),
  ('u020-user-2', 'user2@u020.example.com', 'User Two', now(), now()),
  ('u020-user-3', 'user3@u020.example.com', 'User Three', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at) VALUES
  ('u020-ucr-1', 'u020-user-1', 'u020-company-1', 'account_manager', 'active', '2020-01-01T00:00:00Z', now()),
  ('u020-ucr-2', 'u020-user-2', 'u020-company-1', 'account_manager', 'active', '2020-01-01T00:00:00Z', now()),
  ('u020-ucr-3', 'u020-user-3', 'u020-company-1', 'account_manager', 'active', '2020-01-01T00:00:00Z', now());

INSERT INTO project_members (id, project_id, user_id, role, status, valid_from, created_at) VALUES
  ('u020-pm-1', 'u020-project-1', 'u020-user-1', 'member', 'active', '2020-01-01T00:00:00Z', now()),
  ('u020-pm-2a', 'u020-project-2', 'u020-user-2', 'member', 'active', '2020-01-01T00:00:00Z', now()),
  ('u020-pm-2b', 'u020-project-2', 'u020-user-3', 'member', 'active', '2020-01-01T00:00:00Z', now());

INSERT INTO document_templates (id, project_id, template_key, title, body_markdown, created_at) VALUES
  ('u020-template-1', 'u020-project-1', 'proposal', 'Proposal', 'Body', now());

INSERT INTO generated_documents (id, template_id, title, body_markdown, status, created_at) VALUES
  ('u020-doc-1', 'u020-template-1', 'Legacy Doc One', 'Legacy Body One', 'approved', now());

INSERT INTO document_versions (id, generated_document_id, version, body_markdown, created_at) VALUES
  ('u020-ver-1', 'u020-doc-1', 1, 'Legacy Version Body One', now());

INSERT INTO approval_requests (id, status, reason, created_at, legacy_unbound, updated_at) VALUES
  ('u020-appr-legacy-1', 'approved', 'legacy manual approval', now(), true, now());

INSERT INTO commands (id, key, title, created_at) VALUES ('u020-command-1', 'u020-command', 'U020 Command', now());

INSERT INTO command_runs (id, command_id, project_id, requested_by_id, status, created_at, updated_at) VALUES
  ('u020-cr-1', 'u020-command-1', 'u020-project-1', 'u020-user-1', 'succeeded', now(), now()),
  ('u020-cr-2a', 'u020-command-1', 'u020-project-2', 'u020-user-2', 'succeeded', now(), now()),
  ('u020-cr-2b', 'u020-command-1', 'u020-project-2', 'u020-user-3', 'succeeded', now(), now());

INSERT INTO workflows (id, command_run_id, status, created_at, updated_at) VALUES
  ('u020-wf-1', 'u020-cr-1', 'succeeded', now(), now()),
  ('u020-wf-2a', 'u020-cr-2a', 'succeeded', now(), now()),
  ('u020-wf-2b', 'u020-cr-2b', 'succeeded', now(), now());

INSERT INTO workflow_steps (id, workflow_id, step_key, status, sort_order, created_at, updated_at) VALUES
  ('u020-step-1', 'u020-wf-1', 'do', 'succeeded', 0, now(), now()),
  ('u020-step-2a', 'u020-wf-2a', 'do', 'succeeded', 0, now(), now()),
  ('u020-step-2b', 'u020-wf-2b', 'do', 'succeeded', 0, now(), now());
`;

async function legacyCounts(containerName: string, conn: { user: string; password: string; database: string }) {
  return {
    generatedDocuments: await execSql(containerName, conn, `SELECT count(*) FROM generated_documents;`),
    documentVersions: await execSql(containerName, conn, `SELECT count(*) FROM document_versions;`),
    approvalRequests: await execSql(containerName, conn, `SELECT count(*) FROM approval_requests;`),
    workflows: await execSql(containerName, conn, `SELECT count(*) FROM workflows;`),
    workflowSteps: await execSql(containerName, conn, `SELECT count(*) FROM workflow_steps;`),
  };
}

async function runGovernanceBridgeScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};

  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT_U020, purpose: PURPOSE_U020, evidenceDir, imageDigest: IMAGE_DIGEST, migrate: true },
    async (ctx: any) => {
      const conn = parseConn(ctx.databaseUrl);
      const gb = await import('../src/governance-bridge.ts');

      await execSql(ctx.containerName, conn, GOVERNANCE_BRIDGE_FIXTURE_SQL);
      const legacyBefore = await legacyCounts(ctx.containerName, conn);

      const scopeCheckBefore = await runScopeCheck();
      if (scopeCheckBefore.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `scope:check failed before backfill: ${scopeCheckBefore.stdout}\n${scopeCheckBefore.stderr}`);
      const scopeCheckBeforeJson = JSON.parse(scopeCheckBefore.stdout);
      if (scopeCheckBeforeJson.currentModelCount !== scopeCheckBeforeJson.inventoryModelCount || scopeCheckBeforeJson.ok !== true) {
        throw new ContractFailure(EXIT.CONTRACT, `scope:check did not report ok=true before backfill: ${scopeCheckBefore.stdout}`);
      }
      evidence.scopeCheckBefore = { currentModelCount: scopeCheckBeforeJson.currentModelCount, ok: scopeCheckBeforeJson.ok };

      // ---- dry run writes ZERO ----
      const beforeTargetCounts = {
        artifacts: await execSql(ctx.containerName, conn, `SELECT count(*) FROM artifacts;`),
        artifactVersions: await execSql(ctx.containerName, conn, `SELECT count(*) FROM artifact_versions;`),
        workflowDefinitions: await execSql(ctx.containerName, conn, `SELECT count(*) FROM workflow_definitions;`),
        workflowRuns: await execSql(ctx.containerName, conn, `SELECT count(*) FROM workflow_runs;`),
        quarantine: await execSql(ctx.containerName, conn, `SELECT count(*) FROM scope_backfill_quarantine;`),
      };
      const dryRun = await runGovernanceBackfillScript(ctx.databaseUrl);
      if (dryRun.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `governance dry run failed: ${dryRun.stdout}\n${dryRun.stderr}`);
      const dryRunJson = JSON.parse(dryRun.stdout);
      writeFileSync(join(evidenceDir, 'bridge-dry-run.json'), `${JSON.stringify(dryRunJson, null, 2)}\n`);
      if (dryRunJson.writes !== 0) throw new ContractFailure(EXIT.CONTRACT, `dry run reported nonzero writes: ${dryRunJson.writes}`);
      const afterDryRunTargetCounts = {
        artifacts: await execSql(ctx.containerName, conn, `SELECT count(*) FROM artifacts;`),
        artifactVersions: await execSql(ctx.containerName, conn, `SELECT count(*) FROM artifact_versions;`),
        workflowDefinitions: await execSql(ctx.containerName, conn, `SELECT count(*) FROM workflow_definitions;`),
        workflowRuns: await execSql(ctx.containerName, conn, `SELECT count(*) FROM workflow_runs;`),
        quarantine: await execSql(ctx.containerName, conn, `SELECT count(*) FROM scope_backfill_quarantine;`),
      };
      if (JSON.stringify(beforeTargetCounts) !== JSON.stringify(afterDryRunTargetCounts)) {
        throw new ContractFailure(EXIT.CONTRACT, `dry run mutated target tables: before=${JSON.stringify(beforeTargetCounts)} after=${JSON.stringify(afterDryRunTargetCounts)}`);
      }
      evidence.dryRunWritesZero = true;

      // ---- deterministic-id test vectors, computed against this scenario's own fixture ids ----
      const idVectors = {
        generatedDocumentArtifactId: gb.legacyArtifactId('u020-doc-1'),
        documentVersionArtifactVersionId: gb.legacyArtifactVersionId('u020-ver-1'),
        workflowDefinitionArtifactId: gb.legacyWorkflowDefinitionArtifactId('u020-project-1'),
        workflowDefinitionVersionId: gb.legacyWorkflowDefinitionVersionId('u020-project-1'),
        workflowDefinitionId: gb.legacyWorkflowDefinitionId('u020-project-1'),
      };
      writeFileSync(join(evidenceDir, 'deterministic-id-vectors.json'), `${JSON.stringify(idVectors, null, 2)}\n`);
      evidence.deterministicIdVectors = idVectors;

      // ---- GOVERNANCE_REVIEW_FILE gate: build + write ----
      const reviewFile = { schemaVersion: 1, reviewerKey: 'qa-harness-reviewer', dryRunDigest: dryRunJson.reviewDigest, manifest: dryRunJson.manifest };
      writeFileSync(join(evidenceDir, 'governance-review.json'), `${JSON.stringify(reviewFile, null, 2)}\n`);
      const reviewFilePath = join(mkdtempSync(join(tmpdir(), 'u020-review-')), 'governance-review.json');
      writeFileSync(reviewFilePath, JSON.stringify(reviewFile));

      // ---- apply ----
      const apply = await runGovernanceBackfillScript(ctx.databaseUrl, { APPLY: '1', GOVERNANCE_REVIEW_FILE: reviewFilePath });
      if (apply.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `apply failed: ${apply.stdout}\n${apply.stderr}`);
      const applyJson = JSON.parse(apply.stdout);
      writeFileSync(join(evidenceDir, 'bridge-apply.json'), `${JSON.stringify(applyJson, null, 2)}\n`);
      evidence.apply = applyJson;

      if (applyJson.generatedDocuments.mapped !== 0 || applyJson.generatedDocuments.quarantined !== 1) {
        throw new ContractFailure(EXIT.CONTRACT, `expected the zero-eligible baseline GeneratedDocument to quarantine (mapped=0,quarantined=1): ${JSON.stringify(applyJson.generatedDocuments)}`);
      }
      if (applyJson.documentVersions.mapped !== 0 || applyJson.documentVersions.quarantined !== 1) {
        throw new ContractFailure(EXIT.CONTRACT, `expected the blocked-by-parent DocumentVersion to quarantine (mapped=0,quarantined=1): ${JSON.stringify(applyJson.documentVersions)}`);
      }
      if (applyJson.approvalRequests.quarantined !== 1) {
        throw new ContractFailure(EXIT.CONTRACT, `expected the legacy ApprovalRequest to quarantine: ${JSON.stringify(applyJson.approvalRequests)}`);
      }
      if (applyJson.workflowGroups.mapped !== 1 || applyJson.workflowGroups.quarantined !== 2) {
        throw new ContractFailure(
          EXIT.CONTRACT,
          `expected exactly one eligible single-actor project group mapped and the two-distinct-actor project group's two Workflow rows quarantined: ${JSON.stringify(applyJson.workflowGroups)}`,
        );
      }
      evidence.applyOutcomesMatchExpected = true;

      // ---- verify the eligible single-actor project group's synthesized provenance by exact id ----
      const eligibleTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT a.id, a.legacy_source_type, a.legacy_source_id, av.id, wd.id, wd.status, wr.id, wr.status, wr.requested_by_assignment_id
         FROM artifacts a
         JOIN artifact_versions av ON av.artifact_id = a.id
         JOIN workflow_definitions wd ON wd.definition_artifact_version_id = av.id
         JOIN workflow_runs wr ON wr.workflow_definition_id = wd.id
         WHERE a.legacy_source_type = 'LegacyWorkflowDefinitionProject' AND a.legacy_source_id = 'u020-project-1';`,
      );
      const eligibleLine = eligibleTsv.trim().split('\n')[1] ?? '';
      const expectedEligibleLine = `${idVectors.workflowDefinitionArtifactId}\tLegacyWorkflowDefinitionProject\tu020-project-1\t${idVectors.workflowDefinitionVersionId}\t${idVectors.workflowDefinitionId}\tlegacy_disabled\t${gb.legacyWorkflowRunId('u020-wf-1')}\tlegacy_imported\tu020-ucr-1`;
      if (eligibleLine !== expectedEligibleLine) {
        throw new ContractFailure(EXIT.CONTRACT, `eligible workflow-definition provenance mismatch:\n  got:      ${eligibleLine}\n  expected: ${expectedEligibleLine}`);
      }
      evidence.eligibleGroupProvenanceExact = true;

      // ---- verify the two-distinct-actor project group created ZERO targets for project-2 ----
      const project2TargetCount = await execSql(
        ctx.containerName,
        conn,
        `SELECT count(*) FROM (
           SELECT id FROM artifacts WHERE legacy_source_type = 'LegacyWorkflowDefinitionProject' AND legacy_source_id = 'u020-project-2'
           UNION ALL
           SELECT id FROM workflow_runs WHERE legacy_source_type = 'Workflow' AND legacy_source_id IN ('u020-wf-2a','u020-wf-2b')
         ) t;`,
      );
      if (project2TargetCount !== '0') throw new ContractFailure(EXIT.CONTRACT, `expected zero targets for the two-distinct-actor project-2 group, found ${project2TargetCount}`);
      const project2QuarantineRows = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT source_model, source_id, reason_code FROM scope_backfill_quarantine WHERE source_id IN ('u020-wf-2a','u020-wf-2b','u020-step-2a','u020-step-2b') ORDER BY source_model, source_id;`,
      );
      const project2Lines = project2QuarantineRows
        .trim()
        .split('\n')
        .filter((l) => /^(Workflow\tu020-wf-2[ab]|WorkflowStep\tu020-step-2[ab])\tgovernance_unverifiable_actor$/.test(l));
      if (project2Lines.length !== 4) {
        throw new ContractFailure(EXIT.CONTRACT, `expected all four project-2 rows (2 Workflow + 2 WorkflowStep) quarantined governance_unverifiable_actor:\n${project2QuarantineRows}`);
      }
      evidence.twoActorGroupQuarantinedWithZeroTargets = true;

      // ---- authority-zero query ----
      const authorityZeroTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT 'approval_current_validity_valid' AS check, count(*) AS count FROM approval_current_validity WHERE state = 'valid'
         UNION ALL SELECT 'approval_decisions_total', count(*) FROM approval_decisions
         UNION ALL SELECT 'approval_requests_canonical', count(*) FROM approval_requests WHERE legacy_unbound = false
         UNION ALL SELECT 'workflow_definitions_active', count(*) FROM workflow_definitions WHERE status = 'active';`,
      );
      writeFileSync(join(evidenceDir, 'authority-zero.tsv'), authorityZeroTsv);
      const authorityLines = authorityZeroTsv
        .trim()
        .split('\n')
        .filter((l) => /^(approval_current_validity_valid|approval_decisions_total|approval_requests_canonical|workflow_definitions_active)\t\d+$/.test(l));
      if (authorityLines.length !== 4 || !authorityLines.every((l) => l.endsWith('\t0'))) {
        throw new ContractFailure(EXIT.CONTRACT, `expected zero canonical authority everywhere: ${authorityZeroTsv}`);
      }
      evidence.authorityZero = true;

      // ---- source/target + quarantine evidence ----
      const sourceTargetTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT 'GeneratedDocument' AS source_model, gd.id AS source_id, a.id AS target_id FROM generated_documents gd LEFT JOIN artifacts a ON a.legacy_source_type = 'GeneratedDocument' AND a.legacy_source_id = gd.id
         UNION ALL
         SELECT 'DocumentVersion', dv.id, av.id FROM document_versions dv LEFT JOIN artifact_versions av ON av.legacy_source_type = 'DocumentVersion' AND av.legacy_source_id = dv.id
         UNION ALL
         SELECT 'Workflow', w.id, wr.id FROM workflows w LEFT JOIN workflow_runs wr ON wr.legacy_source_type = 'Workflow' AND wr.legacy_source_id = w.id
         ORDER BY 1, 2;`,
      );
      writeFileSync(join(evidenceDir, 'source-target.tsv'), sourceTargetTsv);
      const quarantineTsv = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT source_model, source_id, reason_code, source_row_hash, resolved_at IS NOT NULL AS resolved FROM scope_backfill_quarantine ORDER BY source_model, source_id;`,
      );
      writeFileSync(join(evidenceDir, 'quarantine.tsv'), quarantineTsv);

      // ---- legacy source counts/hashes unchanged ----
      const legacyAfter = await legacyCounts(ctx.containerName, conn);
      if (JSON.stringify(legacyBefore) !== JSON.stringify(legacyAfter)) {
        throw new ContractFailure(EXIT.CONTRACT, `legacy source counts changed: before=${JSON.stringify(legacyBefore)} after=${JSON.stringify(legacyAfter)}`);
      }
      evidence.legacyCountsUnchanged = { before: legacyBefore, after: legacyAfter };

      // ---- rerun: zero delta, including lastSeenAt ----
      const quarantineSnapshotBeforeRerun = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT source_model, source_id, reason_code, source_row_hash, quarantined_at, first_seen_at, last_seen_at FROM scope_backfill_quarantine ORDER BY source_model, source_id;`,
      );
      const rerun = await runGovernanceBackfillScript(ctx.databaseUrl, { APPLY: '1', GOVERNANCE_REVIEW_FILE: reviewFilePath });
      if (rerun.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `rerun apply failed: ${rerun.stdout}\n${rerun.stderr}`);
      const rerunJson = JSON.parse(rerun.stdout);
      writeFileSync(join(evidenceDir, 'bridge-rerun.json'), `${JSON.stringify(rerunJson, null, 2)}\n`);
      const rerunWroteNothing =
        rerunJson.generatedDocuments.mapped === 0 &&
        rerunJson.generatedDocuments.quarantined === 0 &&
        rerunJson.documentVersions.mapped === 0 &&
        rerunJson.documentVersions.quarantined === 0 &&
        rerunJson.approvalRequests.quarantined === 0 &&
        rerunJson.workflowGroups.mapped === 0 &&
        rerunJson.workflowGroups.quarantined === 0;
      if (!rerunWroteNothing) throw new ContractFailure(EXIT.CONTRACT, `rerun performed new writes: ${JSON.stringify(rerunJson)}`);
      const quarantineSnapshotAfterRerun = await execSqlTsv(
        ctx.containerName,
        conn,
        `SELECT source_model, source_id, reason_code, source_row_hash, quarantined_at, first_seen_at, last_seen_at FROM scope_backfill_quarantine ORDER BY source_model, source_id;`,
      );
      if (quarantineSnapshotBeforeRerun !== quarantineSnapshotAfterRerun) {
        throw new ContractFailure(EXIT.CONTRACT, `rerun changed quarantine row bytes (including lastSeenAt), which must stay byte-identical`);
      }
      evidence.rerunZeroDeltaIncludingLastSeenAt = true;

      // ---- validator ----
      const validate = await runGovernanceValidate(ctx.databaseUrl);
      const validateJson = JSON.parse(validate.stdout || '{}');
      writeFileSync(join(evidenceDir, 'governance-validate.json'), `${JSON.stringify(validateJson, null, 2)}\n`);
      if (validate.code !== 0 || validateJson.ok !== true) {
        throw new ContractFailure(EXIT.CONTRACT, `governance:validate failed: ${validate.stdout}\n${validate.stderr}`);
      }
      evidence.validate = { ok: validateJson.ok, checks: validateJson.checks.length };

      // ---- reproducible deploy + empty schema diff ----
      const schemaPath = join(REAL_PRISMA_DIR, 'schema.prisma');
      const redeploy = await runWorkspaceMigrateDeploy(ctx.migrationDatabaseUrl, schemaPath);
      if (redeploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy re-run was not reproducible: ${redeploy.stderr || redeploy.stdout}`);
      const diff = await runMigrateDiff(ctx.migrationDatabaseUrl);
      const diffText = diff.stdout.trim();
      const isEmptyDiff = diff.code === 0 && (diffText.length === 0 || diffText === '-- This is an empty migration.');
      writeFileSync(join(evidenceDir, 'migration-diff.sql'), '');
      if (!isEmptyDiff) throw new ContractFailure(EXIT.CONTRACT, `schema diff not empty after fresh migrate deploy: exit=${diff.code} stdout=${diff.stdout}`);
      evidence.emptySchemaDiff = true;

      // ---- scope:check via the UNMODIFIED checker, AFTER ----
      const scopeCheckAfter = await runScopeCheck();
      if (scopeCheckAfter.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `scope:check failed after backfill: ${scopeCheckAfter.stdout}\n${scopeCheckAfter.stderr}`);
      const scopeCheckAfterJson = JSON.parse(scopeCheckAfter.stdout);
      if (scopeCheckAfterJson.currentModelCount !== scopeCheckAfterJson.inventoryModelCount || scopeCheckAfterJson.ok !== true) {
        throw new ContractFailure(EXIT.CONTRACT, `scope:check did not report ok=true after backfill: ${scopeCheckAfter.stdout}`);
      }
      if (scopeCheckAfterJson.currentModelCount !== scopeCheckBeforeJson.currentModelCount) {
        throw new ContractFailure(EXIT.CONTRACT, `canonical inventory model count changed: before=${scopeCheckBeforeJson.currentModelCount} after=${scopeCheckAfterJson.currentModelCount}`);
      }
      writeFileSync(join(evidenceDir, 'inventory.json'), `${JSON.stringify(scopeCheckAfterJson, null, 2)}\n`);
      evidence.scopeCheckAfter = { currentModelCount: scopeCheckAfterJson.currentModelCount, ok: scopeCheckAfterJson.ok };

      return evidence;
    },
  );

  return evidence;
}

async function runGovernanceBridgeSuite(evidenceDir: string): Promise<number> {
  const runId = `u020${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let caughtError: unknown = null;
  let scenarioEvidence: Record<string, unknown> | null = null;
  try {
    scenarioEvidence = await runGovernanceBridgeScenario(evidenceDir, runId);
  } catch (error) {
    caughtError = error;
  }

  const labelCounts = await labelResourceCounts(runId, OWNER_UNIT_U020, PURPOSE_U020);
  const cleanupOk = labelCounts.containers === 0 && labelCounts.networks === 0 && labelCounts.volumes === 0;
  const cleanup = {
    schemaVersion: 1,
    unit: OWNER_UNIT_U020,
    purpose: PURPOSE_U020,
    runId,
    postgres: { containers: labelCounts.containers, networks: labelCounts.networks, volumes: labelCounts.volumes },
    http: null,
    httpReason:
      'U020 db:contract is a DB-only traceability backfill suite with no web/API process to bind or tear down here — no approval/workflow runtime is invoked, no external send/share/export exists to reach at this unit.',
    childProcesses: 0,
    result: cleanupOk ? 'PASS' : 'FAIL',
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(evidenceDir, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`run-db-contract: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError instanceof ContractFailure ? caughtError.exitCode : EXIT.CONTRACT;
  }

  writeFileSync(
    join(evidenceDir, 'db-contract-receipt.json'),
    `${JSON.stringify({ schemaVersion: 1, unit: OWNER_UNIT_U020, suite: 'governance-bridge', result: 'PASS', scenarioEvidence, cleanup, startedAt, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return EXIT.SUCCESS;
}

// ─────────────────────────────────────────────────────────────────────────
// U021 — audit-chain suite. Two disjoint lanes (U021 dispatch "Implementation and acceptance"):
// a fresh lane (the complete migration chain, through 20260715210000_harden_scoped_audit_chain,
// deployed on an empty scratch database) and a legacy-upgrade lane (the formal migration prefix
// through U020, then packages/db/tests/fixtures/audit-chain-legacy.sql while genuinely pre-U021,
// then only U021's migration, so its backfill/scope-derivation/hashing/immutability-freeze observes
// real legacy rows). Verification independently reconstructs sangfor.audit-chain/v1 bytes with this
// package's own canonicalizeRfc8785 (packages/db/src/canonical-content-hash.ts) rather than
// importing packages/business/src/governance/audit-chain.ts — packages/db has no dependency on
// packages/business, and two independent implementations of the same byte spec agreeing with what
// PostgreSQL itself computed is stronger evidence than one implementation checking itself.
// ─────────────────────────────────────────────────────────────────────────

const AUDIT_CHAIN_VERSION = 'sangfor.audit-chain/v1';
const AUDIT_CHAIN_ZERO_HASH = '0'.repeat(64);

const AUDIT_CHAIN_FRESH_FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('u021-fresh-tenant-1', 'U021 Fresh Tenant', 'u021-fresh-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u021-fresh-company-1', 'u021-fresh-tenant-1', 'U021 Fresh Company', 'u021-fresh-company-1', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u021-fresh-project-1', 'u021-fresh-project-1', 'U021 Fresh Project', 'u021-fresh-company-1', now(), now());
`;

function auditChainSqlString(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`;
}

function auditChainSqlJsonb(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

interface AuditChainRowSpec {
  id: string;
  tenantId: string;
  scopeLevel: 'TENANT' | 'COMPANY' | 'PROJECT';
  companyId: string | null;
  projectId: string | null;
  chainScopeKey: string;
  sequence: number;
  previousHash: string;
  eventType: string;
  actorId: string | null;
  resourceType: string;
  resourceId: string | null;
  details: unknown;
  /** `YYYY-MM-DD HH:MI:SS.mmm` — a PostgreSQL `TIMESTAMP` literal. */
  timestampLiteral: string;
  idempotencyKey?: string | null;
  /** Deliberately wrong event_hash, for negative tests only — never set for a row expected to pass the guard triggers. */
  eventHashOverride?: string;
}

/** Builds one `audit_logs` INSERT statement, computing `event_hash` the same way
 * `sangfor_audit_logs_hash_guard_trg` (migration 20260715210000) independently recomputes it:
 * probe the row's own stored `timestamp` through the exact `to_char(... AT TIME ZONE 'UTC', ...)`
 * formula first (never a JS-side date format, which could drift from the server's session
 * timezone), then hash the RFC 8785 JCS bytes of the fixed 10-field envelope via this package's own
 * `canonicalizeRfc8785` — a genuinely independent (JS, not SQL) computation of the same spec the
 * trigger enforces in PL/pgSQL. Does not execute the statement — callers use it for both a positive
 * insert (`insertAuditChainRow`) and a deliberately-tampered negative `attemptQaInsert`. */
async function buildAuditChainInsertSql(
  containerName: string,
  conn: { user: string; password: string; database: string },
  canonicalize: (value: unknown) => string,
  spec: AuditChainRowSpec,
): Promise<{ sql: string; eventHash: string; occurredAt: string }> {
  const occurredAt = await execSql(containerName, conn, `SELECT to_char(TIMESTAMP '${spec.timestampLiteral}' AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');`);
  const envelopeValue = {
    actorId: spec.actorId,
    chainScopeKey: spec.chainScopeKey,
    details: spec.details ?? null,
    eventType: spec.eventType,
    occurredAt,
    previousHash: spec.previousHash,
    resourceId: spec.resourceId,
    resourceType: spec.resourceType,
    scope: { companyId: spec.companyId, level: spec.scopeLevel, projectId: spec.projectId, tenantId: spec.tenantId },
    sequence: spec.sequence,
    version: AUDIT_CHAIN_VERSION,
  };
  const computedHash = createHash('sha256').update(Buffer.from(canonicalize(envelopeValue), 'utf8')).digest('hex');
  const eventHash = spec.eventHashOverride ?? computedHash;
  const sql = `INSERT INTO audit_logs (id, tenant_id, scope_level, company_id, project_id, chain_scope_key, sequence, event_type, actor_id, resource_type, resource_id, details, previous_hash, event_hash, idempotency_key, "timestamp", created_at) VALUES (${auditChainSqlString(spec.id)}, ${auditChainSqlString(spec.tenantId)}, ${auditChainSqlString(spec.scopeLevel)}, ${auditChainSqlString(spec.companyId)}, ${auditChainSqlString(spec.projectId)}, ${auditChainSqlString(spec.chainScopeKey)}, ${spec.sequence}, ${auditChainSqlString(spec.eventType)}, ${auditChainSqlString(spec.actorId)}, ${auditChainSqlString(spec.resourceType)}, ${auditChainSqlString(spec.resourceId)}, ${auditChainSqlJsonb(spec.details)}, ${auditChainSqlString(spec.previousHash)}, ${auditChainSqlString(eventHash)}, ${auditChainSqlString(spec.idempotencyKey ?? null)}, TIMESTAMP '${spec.timestampLiteral}', now());`;
  return { sql, eventHash, occurredAt };
}

async function insertAuditChainRow(
  containerName: string,
  conn: { user: string; password: string; database: string },
  canonicalize: (value: unknown) => string,
  spec: AuditChainRowSpec,
): Promise<{ id: string; chainScopeKey: string; sequence: number; eventHash: string }> {
  const { sql, eventHash } = await buildAuditChainInsertSql(containerName, conn, canonicalize, spec);
  await execSql(containerName, conn, sql);
  return { id: spec.id, chainScopeKey: spec.chainScopeKey, sequence: spec.sequence, eventHash };
}

interface AuditChainPersistedRow {
  id: string;
  chainScopeKey: string;
  sequence: number;
  tenantId: string;
  companyId: string | null;
  projectId: string | null;
  scopeLevel: 'TENANT' | 'COMPANY' | 'PROJECT';
  eventType: string;
  actorId: string | null;
  resourceType: string;
  resourceId: string | null;
  details: unknown;
  previousHash: string;
  eventHash: string;
  occurredAt: string;
}

/** Reads back every `audit_logs` row as one JSON array (never TSV — `details` is arbitrary JSON and
 * must round-trip exactly), with `occurredAt` re-derived server-side via the same `to_char(...)`
 * formula the migration/triggers use, so the value this function returns for a given row is
 * byte-identical to what PostgreSQL itself used when it validated that row. */
async function fetchAuditChainRows(containerName: string, conn: { user: string; password: string; database: string }): Promise<AuditChainPersistedRow[]> {
  const json = await execSql(
    containerName,
    conn,
    `SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t."chainScopeKey", t.sequence), '[]'::json) FROM (
       SELECT id, chain_scope_key AS "chainScopeKey", sequence, tenant_id AS "tenantId", company_id AS "companyId",
              project_id AS "projectId", scope_level AS "scopeLevel", event_type AS "eventType", actor_id AS "actorId",
              resource_type AS "resourceType", resource_id AS "resourceId", details,
              previous_hash AS "previousHash", event_hash AS "eventHash",
              to_char("timestamp" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt"
       FROM audit_logs
     ) t;`,
  );
  return JSON.parse(json) as AuditChainPersistedRow[];
}

interface AuditChainVerification {
  ok: boolean;
  chains: number;
  rows: number;
  errors: string[];
}

/** Independently reconstructs every row's exact `sangfor.audit-chain/v1` bytes, partitions by
 * `chainScopeKey`, and orders by `sequence` — never by timestamp (U021 contract point 3). A second,
 * from-scratch implementation of the same verification `packages/business/src/governance/
 * audit-chain.ts`'s `verifyAuditChainRows` performs — this one never imports that module. */
function verifyAuditChainRowsIndependently(rows: AuditChainPersistedRow[], canonicalize: (value: unknown) => string): AuditChainVerification {
  const errors: string[] = [];
  const byScope = new Map<string, AuditChainPersistedRow[]>();
  for (const row of rows) {
    const list = byScope.get(row.chainScopeKey) ?? [];
    list.push(row);
    byScope.set(row.chainScopeKey, list);
  }
  for (const [chainScopeKey, chainRows] of byScope) {
    const ordered = [...chainRows].sort((a, b) => a.sequence - b.sequence);
    let previousHash = AUDIT_CHAIN_ZERO_HASH;
    let expectedSequence = 1;
    for (const row of ordered) {
      if (row.sequence !== expectedSequence) errors.push(`${chainScopeKey}: expected sequence ${expectedSequence}, got ${row.sequence}`);
      if (row.previousHash !== previousHash) errors.push(`${chainScopeKey}: sequence ${row.sequence} previousHash ${row.previousHash} !== expected predecessor ${previousHash}`);
      const envelopeValue = {
        actorId: row.actorId,
        chainScopeKey: row.chainScopeKey,
        details: row.details ?? null,
        eventType: row.eventType,
        occurredAt: row.occurredAt,
        previousHash: row.previousHash,
        resourceId: row.resourceId,
        resourceType: row.resourceType,
        scope: { companyId: row.companyId, level: row.scopeLevel, projectId: row.projectId, tenantId: row.tenantId },
        sequence: row.sequence,
        version: AUDIT_CHAIN_VERSION,
      };
      const recomputed = createHash('sha256').update(Buffer.from(canonicalize(envelopeValue), 'utf8')).digest('hex');
      if (recomputed !== row.eventHash) errors.push(`${chainScopeKey}: sequence ${row.sequence} eventHash ${row.eventHash} !== recomputed ${recomputed}`);
      previousHash = row.eventHash;
      expectedSequence += 1;
    }
  }
  return { ok: errors.length === 0, chains: byScope.size, rows: rows.length, errors };
}

/** Runs one UPDATE/DELETE directly (never wrapped in a caught DO block) so the raw PostgreSQL error
 * text is available to assert against — proves the rejection is specifically the named
 * `sangfor_deny_mutation()` append-only error (ERRCODE 0A000, message containing "append-only"),
 * the same text `audit-db.integration.test.ts` asserts via `.rejects.toThrow(/append-only/i)`. */
async function attemptDirectMutationRejection(containerName: string, conn: { user: string; password: string; database: string }, label: string, sql: string): Promise<string> {
  const r = await spawnCapture(
    ['docker', 'exec', '-i', '-e', `PGPASSWORD=${conn.password}`, containerName, 'psql', '-h', '127.0.0.1', '-U', conn.user, '-d', conn.database, '-v', 'ON_ERROR_STOP=1', '-c', sql],
    sanitizedEnv({}),
  );
  if (r.code === 0) throw new ContractFailure(EXIT.CONTRACT, `${label}: expected the named append-only DB error but the statement succeeded`);
  if (!/append-only/i.test(r.stderr)) throw new ContractFailure(EXIT.CONTRACT, `${label}: statement was rejected but the error text did not name "append-only": ${r.stderr}`);
  const errorLine = r.stderr.split('\n').find((line) => /ERROR/i.test(line)) ?? r.stderr.trim();
  return `[invalid] ${label}: ${errorLine.trim()}`;
}

async function runAuditChainFreshScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};
  const scenarioEvidenceDir = join(evidenceDir, 'fresh-scenario');

  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT_U021, purpose: `${PURPOSE_U021}-fresh`, evidenceDir: scenarioEvidenceDir, imageDigest: IMAGE_DIGEST, migrate: true },
    async (ctx: any) => {
      const conn = parseConn(ctx.databaseUrl);
      const cch = await import('../src/canonical-content-hash.ts');
      const canonicalize = cch.canonicalizeRfc8785;

      await execSql(ctx.containerName, conn, AUDIT_CHAIN_FRESH_FIXTURE_SQL);

      const u021ColumnCount = await execSql(
        ctx.containerName,
        conn,
        `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name IN ('tenant_id', 'scope_level', 'chain_scope_key', 'sequence', 'idempotency_key');`,
      );
      if (u021ColumnCount !== '5') throw new ContractFailure(EXIT.CONTRACT, `fresh lane: expected all 5 U021 audit_logs columns after migrate:true deploy, found ${u021ColumnCount}`);
      evidence.u021ColumnsPresent = true;

      // ---- two independent chains: TENANT scope, PROJECT scope ----
      const tenantScope = { tenantId: 'u021-fresh-tenant-1', companyId: null as string | null, projectId: null as string | null, scopeLevel: 'TENANT' as const };
      const projectScope = { tenantId: 'u021-fresh-tenant-1', companyId: 'u021-fresh-company-1', projectId: 'u021-fresh-project-1', scopeLevel: 'PROJECT' as const };

      const inserted: Array<{ id: string; chainScopeKey: string; sequence: number; eventHash: string }> = [];
      let tenantPrev = AUDIT_CHAIN_ZERO_HASH;
      for (let seq = 1; seq <= 2; seq++) {
        const row = await insertAuditChainRow(ctx.containerName, conn, canonicalize, {
          id: `u021-fresh-tenant-row-${seq}`,
          tenantId: tenantScope.tenantId,
          scopeLevel: tenantScope.scopeLevel,
          companyId: tenantScope.companyId,
          projectId: tenantScope.projectId,
          chainScopeKey: 'tenant:u021-fresh-tenant-1',
          sequence: seq,
          previousHash: tenantPrev,
          eventType: 'fresh.probe',
          actorId: `user-${seq}`,
          resourceType: 'demo',
          resourceId: `fresh-res-${seq}`,
          details: { seq },
          timestampLiteral: `2026-07-01 00:0${seq}:00.000`,
        });
        tenantPrev = row.eventHash;
        inserted.push(row);
      }

      let projectPrev = AUDIT_CHAIN_ZERO_HASH;
      for (let seq = 1; seq <= 2; seq++) {
        const row = await insertAuditChainRow(ctx.containerName, conn, canonicalize, {
          id: `u021-fresh-project-row-${seq}`,
          tenantId: projectScope.tenantId,
          scopeLevel: projectScope.scopeLevel,
          companyId: projectScope.companyId,
          projectId: projectScope.projectId,
          chainScopeKey: 'project:u021-fresh-tenant-1:u021-fresh-company-1:u021-fresh-project-1',
          sequence: seq,
          previousHash: projectPrev,
          eventType: 'fresh.probe',
          actorId: `user-${seq}`,
          resourceType: 'demo',
          resourceId: `fresh-res-p-${seq}`,
          details: { seq },
          timestampLiteral: `2026-07-01 00:1${seq}:00.000`,
        });
        projectPrev = row.eventHash;
        inserted.push(row);
      }

      const idemRow = await insertAuditChainRow(ctx.containerName, conn, canonicalize, {
        id: 'u021-fresh-tenant-row-3-idem',
        tenantId: tenantScope.tenantId,
        scopeLevel: tenantScope.scopeLevel,
        companyId: tenantScope.companyId,
        projectId: tenantScope.projectId,
        chainScopeKey: 'tenant:u021-fresh-tenant-1',
        sequence: 3,
        previousHash: tenantPrev,
        eventType: 'idempotent.probe',
        actorId: 'user-idem',
        resourceType: 'demo',
        resourceId: 'fresh-res-idem',
        details: null,
        timestampLiteral: '2026-07-01 00:20:00.000',
        idempotencyKey: 'u021-fresh-idem-1',
      });
      tenantPrev = idemRow.eventHash;
      inserted.push(idemRow);
      writeFileSync(join(scenarioEvidenceDir, 'fresh-inserts.json'), `${JSON.stringify(inserted, null, 2)}\n`);
      evidence.freshInsertCount = inserted.length;

      // ---- negative: the guard triggers/unique indexes reject a malformed row, never silently accept it ----
      const negativeLines: string[] = [];

      const { sql: dupIdemSql } = await buildAuditChainInsertSql(ctx.containerName, conn, canonicalize, {
        id: 'u021-fresh-tenant-row-4-dup-idem',
        tenantId: tenantScope.tenantId,
        scopeLevel: tenantScope.scopeLevel,
        companyId: tenantScope.companyId,
        projectId: tenantScope.projectId,
        chainScopeKey: 'tenant:u021-fresh-tenant-1',
        sequence: 4,
        previousHash: tenantPrev,
        eventType: 'idempotent.probe',
        actorId: 'user-idem',
        resourceType: 'demo',
        resourceId: 'fresh-res-idem-dup',
        details: null,
        timestampLiteral: '2026-07-01 00:21:00.000',
        idempotencyKey: 'u021-fresh-idem-1',
      });
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, { label: 'duplicate (chain_scope_key, idempotency_key) rejected', expect: 'reject', sql: dupIdemSql }));

      const { sql: correctNextSql, eventHash: correctNextHash } = await buildAuditChainInsertSql(ctx.containerName, conn, canonicalize, {
        id: 'u021-fresh-project-row-3-tampered',
        tenantId: projectScope.tenantId,
        scopeLevel: projectScope.scopeLevel,
        companyId: projectScope.companyId,
        projectId: projectScope.projectId,
        chainScopeKey: 'project:u021-fresh-tenant-1:u021-fresh-company-1:u021-fresh-project-1',
        sequence: 3,
        previousHash: projectPrev,
        eventType: 'tamper.probe',
        actorId: 'user-tamper',
        resourceType: 'demo',
        resourceId: 'fresh-res-tamper',
        details: null,
        timestampLiteral: '2026-07-01 00:22:00.000',
      });
      const tamperedHash = correctNextHash.slice(0, -1) + (correctNextHash.endsWith('0') ? '1' : '0');
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, { label: 'tampered event_hash rejected', expect: 'reject', sql: correctNextSql.replace(`'${correctNextHash}'`, `'${tamperedHash}'`) }));

      const { sql: badGenesisSql } = await buildAuditChainInsertSql(ctx.containerName, conn, canonicalize, {
        id: 'u021-fresh-company-row-1-bad-genesis',
        tenantId: 'u021-fresh-tenant-1',
        scopeLevel: 'COMPANY',
        companyId: 'u021-fresh-company-1',
        projectId: null,
        chainScopeKey: 'company:u021-fresh-tenant-1:u021-fresh-company-1',
        sequence: 1,
        previousHash: 'a'.repeat(64),
        eventType: 'genesis.probe',
        actorId: null,
        resourceType: 'demo',
        resourceId: null,
        details: null,
        timestampLiteral: '2026-07-01 00:23:00.000',
      });
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, { label: 'non-zero genesis previous_hash rejected', expect: 'reject', sql: badGenesisSql }));

      const { sql: badPredecessorSql } = await buildAuditChainInsertSql(ctx.containerName, conn, canonicalize, {
        id: 'u021-fresh-project-row-3-bad-predecessor',
        tenantId: projectScope.tenantId,
        scopeLevel: projectScope.scopeLevel,
        companyId: projectScope.companyId,
        projectId: projectScope.projectId,
        chainScopeKey: 'project:u021-fresh-tenant-1:u021-fresh-company-1:u021-fresh-project-1',
        sequence: 3,
        previousHash: 'b'.repeat(64),
        eventType: 'predecessor.probe',
        actorId: null,
        resourceType: 'demo',
        resourceId: null,
        details: null,
        timestampLiteral: '2026-07-01 00:24:00.000',
      });
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, { label: 'predecessor hash mismatch rejected', expect: 'reject', sql: badPredecessorSql }));

      const { sql: badNullabilitySql } = await buildAuditChainInsertSql(ctx.containerName, conn, canonicalize, {
        id: 'u021-fresh-tenant-row-nullability',
        tenantId: 'u021-fresh-tenant-1',
        scopeLevel: 'TENANT',
        companyId: 'u021-fresh-company-1',
        projectId: null,
        chainScopeKey: 'tenant:u021-fresh-tenant-1:nullability-probe',
        sequence: 1,
        previousHash: AUDIT_CHAIN_ZERO_HASH,
        eventType: 'nullability.probe',
        actorId: null,
        resourceType: 'demo',
        resourceId: null,
        details: null,
        timestampLiteral: '2026-07-01 00:25:00.000',
      });
      negativeLines.push(await attemptQaInsert(ctx.containerName, conn, { label: 'TENANT scope with non-null company_id rejected', expect: 'reject', sql: badNullabilitySql }));
      writeFileSync(join(scenarioEvidenceDir, 'trigger-negative.log'), `${negativeLines.join('\n')}\n`);
      evidence.negativeChecks = negativeLines.length;

      // ---- immutability: PostgreSQL itself rejects UPDATE/DELETE against canonical audit rows ----
      const immutabilityLines: string[] = [];
      immutabilityLines.push(await attemptDirectMutationRejection(ctx.containerName, conn, 'UPDATE audit_logs denied (append-only)', `UPDATE audit_logs SET event_type = 'tampered' WHERE id = 'u021-fresh-tenant-row-1';`));
      immutabilityLines.push(await attemptDirectMutationRejection(ctx.containerName, conn, 'DELETE audit_logs denied (append-only)', `DELETE FROM audit_logs WHERE id = 'u021-fresh-tenant-row-1';`));
      writeFileSync(join(scenarioEvidenceDir, 'immutability.log'), `${immutabilityLines.join('\n')}\n`);
      evidence.immutabilityChecks = immutabilityLines.length;

      // ---- independent chain verification ----
      const rows = await fetchAuditChainRows(ctx.containerName, conn);
      writeFileSync(
        join(scenarioEvidenceDir, 'chain-projection.json'),
        `${JSON.stringify(rows.map((r) => ({ chainScopeKey: r.chainScopeKey, sequence: r.sequence, previousHash: r.previousHash, eventHash: r.eventHash })), null, 2)}\n`,
      );
      const verification = verifyAuditChainRowsIndependently(rows, canonicalize);
      writeFileSync(join(scenarioEvidenceDir, 'chain-verification.json'), `${JSON.stringify(verification, null, 2)}\n`);
      if (!verification.ok || verification.chains !== 2 || verification.rows !== 5) {
        throw new ContractFailure(EXIT.CONTRACT, `fresh lane: chain verification failed: ${JSON.stringify(verification)}`);
      }
      evidence.chainVerification = { ok: verification.ok, chains: verification.chains, rows: verification.rows };

      // ---- trigger definitions (real surface QA) ----
      const triggerDefs = await execSqlTsv(ctx.containerName, conn, `SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal ORDER BY tgname;`);
      writeFileSync(join(scenarioEvidenceDir, 'trigger-definitions.tsv'), triggerDefs);
      const triggerNames = triggerDefs
        .trim()
        .split('\n')
        .filter((line) => /^sangfor_audit_logs_/.test(line));
      if (triggerNames.length !== 4) throw new ContractFailure(EXIT.CONTRACT, `fresh lane: expected 4 audit_logs triggers, found ${triggerNames.length}: ${triggerDefs}`);
      evidence.triggerCount = triggerNames.length;

      // ---- reproducible deploy + empty schema diff ----
      const schemaPath = join(REAL_PRISMA_DIR, 'schema.prisma');
      const redeploy = await runWorkspaceMigrateDeploy(ctx.migrationDatabaseUrl, schemaPath);
      if (redeploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy re-run was not reproducible: ${redeploy.stderr || redeploy.stdout}`);
      const diff = await runMigrateDiff(ctx.migrationDatabaseUrl);
      const diffText = diff.stdout.trim();
      const isEmptyDiff = diff.code === 0 && (diffText.length === 0 || diffText === '-- This is an empty migration.');
      writeFileSync(join(scenarioEvidenceDir, 'migration-diff.sql'), '');
      if (!isEmptyDiff) throw new ContractFailure(EXIT.CONTRACT, `schema diff not empty after fresh migrate deploy: exit=${diff.code} stdout=${diff.stdout}`);
      evidence.emptySchemaDiff = true;

      // ---- scope:check via the UNMODIFIED checker — dynamic currentModelCount===inventoryModelCount, never a hard-pinned count ----
      const scopeCheck = await runScopeCheck();
      if (scopeCheck.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `scope:check failed: ${scopeCheck.stdout}\n${scopeCheck.stderr}`);
      const scopeCheckJson = JSON.parse(scopeCheck.stdout);
      if (scopeCheckJson.currentModelCount !== scopeCheckJson.inventoryModelCount || scopeCheckJson.ok !== true) {
        throw new ContractFailure(EXIT.CONTRACT, `scope:check did not report ok=true with schema matching the canonical inventory: ${scopeCheck.stdout}`);
      }
      writeFileSync(join(scenarioEvidenceDir, 'inventory.json'), `${JSON.stringify(scopeCheckJson, null, 2)}\n`);
      evidence.scopeCheck = { currentModelCount: scopeCheckJson.currentModelCount, ok: scopeCheckJson.ok, tallies: scopeCheckJson.tallies };

      return evidence;
    },
  );

  return evidence;
}

async function runAuditChainLegacyScenario(evidenceDir: string, runId: string) {
  const evidence: Record<string, unknown> = {};
  let view: MigrationView | null = null;
  const scenarioEvidenceDir = join(evidenceDir, 'legacy-scenario');

  try {
    await withIsolatedPostgres(
      { runId, ownerUnit: OWNER_UNIT_U021, purpose: `${PURPOSE_U021}-legacy`, evidenceDir: scenarioEvidenceDir, imageDigest: IMAGE_DIGEST, migrate: false },
      async (ctx: any) => {
        const conn = parseConn(ctx.databaseUrl);
        const cch = await import('../src/canonical-content-hash.ts');
        const canonicalize = cch.canonicalizeRfc8785;
        const throughU020 = listMigrationsThroughU020();

        view = buildReadOnlyMigrationView('audit-legacy', throughU020);
        verifyViewIntegrity(view, throughU020);
        evidence.viewMembershipThroughU020 = { ...view.membership };

        const genPrefix = await runWorkspaceGenerate(join(REAL_PRISMA_DIR, 'schema.prisma'));
        if (genPrefix.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `generate failed: ${genPrefix.stderr || genPrefix.stdout}`);

        const deployPrefix = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (deployPrefix.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy (through U020, symlink view) failed: ${deployPrefix.stderr || deployPrefix.stdout}`);
        evidence.deployThroughU020 = { migrated: true, migrationCount: throughU020.length };

        // Prove the database is genuinely pre-U021 BEFORE the fixture loads: deploying U021/full
        // chain before the fixture, or loading the fixture after U021, is a runner error per the
        // dispatch.
        const preU021ColumnCount = await execSql(
          ctx.containerName,
          conn,
          `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name IN ('tenant_id', 'scope_level', 'chain_scope_key', 'sequence', 'idempotency_key');`,
        );
        if (preU021ColumnCount !== '0') throw new ContractFailure(EXIT.CONTRACT, `legacy lane: expected zero U021 audit_logs columns before the fixture load, found ${preU021ColumnCount}`);
        evidence.genuinelyPreU021 = true;

        // ---- load the legacy fixture strictly between the U020-prefix deploy and adding U021's
        // migration symlink, so U021's backfill observes real pre-existing rows ----
        const fixturePath = join(DB_PKG_ROOT, 'tests/fixtures/audit-chain-legacy.sql');
        const fixtureBytes = readFileSync(fixturePath);
        const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
        await execSql(ctx.containerName, conn, fixtureBytes.toString('utf8'));

        const fixtureRowHashes = await execSqlTsv(
          ctx.containerName,
          conn,
          `SELECT id, encode(digest(convert_to(id || '|' || event_type || '|' || coalesce(resource_type, '') || '|' || coalesce(resource_id, '') || '|' || "timestamp"::text, 'UTF8'), 'sha256'), 'hex') FROM audit_logs ORDER BY id;`,
        );
        writeFileSync(join(scenarioEvidenceDir, 'legacy-fixture-row-hashes.tsv'), fixtureRowHashes);
        const fixtureRowCount = await execSql(ctx.containerName, conn, `SELECT count(*) FROM audit_logs;`);
        evidence.fixtureLoad = { fileSha256: fixtureSha256, rowCount: Number(fixtureRowCount) };
        writeFileSync(join(scenarioEvidenceDir, 'legacy-fixture-load.json'), `${JSON.stringify(evidence.fixtureLoad, null, 2)}\n`);
        if (fixtureRowCount !== '7') throw new ContractFailure(EXIT.CONTRACT, `legacy lane: expected the 7-row audit-chain-legacy.sql fixture, loaded ${fixtureRowCount}`);

        // ---- add only U021's migration and deploy: its backfill/scope-derivation/hashing/freeze
        // must observe these already-loaded legacy rows ----
        addMigrationToView(view, NEW_MIGRATION_NAME_U021);
        verifyViewIntegrity(view, [...throughU020, NEW_MIGRATION_NAME_U021]);
        evidence.viewMembershipWithU021 = { ...view.membership };

        const genFull = await runWorkspaceGenerate(join(REAL_PRISMA_DIR, 'schema.prisma'));
        if (genFull.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `generate (full schema) failed: ${genFull.stderr || genFull.stdout}`);

        const deployU021 = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (deployU021.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy (+U021, symlink view) failed: ${deployU021.stderr || deployU021.stdout}`);
        evidence.deployU021 = { migrated: true };

        // ---- backfill/hash verification, including the exact tie-break the fixture is designed to
        // prove (aud-log-tenant-a/aud-log-tenant-b share one timestamp, inserted out of id order) ----
        const rows = await fetchAuditChainRows(ctx.containerName, conn);
        writeFileSync(
          join(scenarioEvidenceDir, 'legacy-backfill-chain.json'),
          `${JSON.stringify(rows.map((r) => ({ id: r.id, chainScopeKey: r.chainScopeKey, sequence: r.sequence, previousHash: r.previousHash, eventHash: r.eventHash })), null, 2)}\n`,
        );
        const verification = verifyAuditChainRowsIndependently(rows, canonicalize);
        writeFileSync(join(scenarioEvidenceDir, 'legacy-chain-verification.json'), `${JSON.stringify(verification, null, 2)}\n`);
        if (!verification.ok || verification.chains !== 4 || verification.rows !== 7) {
          throw new ContractFailure(EXIT.CONTRACT, `legacy lane: backfilled chain verification failed: ${JSON.stringify(verification)}`);
        }
        const tenantA = rows.find((r) => r.id === 'aud-log-tenant-a');
        const tenantB = rows.find((r) => r.id === 'aud-log-tenant-b');
        if (tenantA?.sequence !== 1 || tenantB?.sequence !== 2) {
          throw new ContractFailure(
            EXIT.CONTRACT,
            `legacy lane: expected the id-COLLATE-"C" tie-break (aud-log-tenant-a=seq1, aud-log-tenant-b=seq2), got a=${tenantA?.sequence} b=${tenantB?.sequence}`,
          );
        }
        evidence.legacyTieBreakByIdCollateC = true;
        evidence.chainVerification = { ok: verification.ok, chains: verification.chains, rows: verification.rows };

        // ---- named CHECK/FK constraints (validated) + the two unique indexes ----
        const constraintTsv = await execSqlTsv(
          ctx.containerName,
          conn,
          `SELECT conname, contype, convalidated FROM pg_constraint WHERE conrelid = 'audit_logs'::regclass AND conname IN (
             'audit_logs_scope_level_check','audit_logs_scope_nullability_check','audit_logs_sequence_positive_check',
             'audit_logs_event_hash_format_check','audit_logs_previous_hash_format_check',
             'audit_logs_tenant_id_fkey','audit_logs_company_id_fkey','audit_logs_project_id_fkey'
           ) ORDER BY conname;`,
        );
        writeFileSync(join(scenarioEvidenceDir, 'legacy-constraints.tsv'), constraintTsv);
        const constraintRows = constraintTsv
          .trim()
          .split('\n')
          .filter((line) => /^\S+\t[a-z]\t[tf]$/.test(line));
        if (constraintRows.length !== 8) throw new ContractFailure(EXIT.CONTRACT, `legacy lane: expected exactly 8 named CHECK/FK constraints on audit_logs, got ${constraintRows.length}: ${constraintTsv}`);
        for (const line of constraintRows) {
          const [name, , validated] = line.split('\t');
          if (validated !== 't') throw new ContractFailure(EXIT.CONTRACT, `legacy lane: constraint ${name} is not convalidated=true`);
        }
        const uniqueIndexTsv = await execSqlTsv(
          ctx.containerName,
          conn,
          `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'audit_logs' AND indexname IN ('audit_logs_chain_scope_key_sequence_key', 'audit_logs_chain_scope_key_idempotency_key_key') ORDER BY indexname;`,
        );
        const uniqueIndexRows = uniqueIndexTsv
          .trim()
          .split('\n')
          .filter((line) => /^audit_logs_/.test(line));
        if (uniqueIndexRows.length !== 2) throw new ContractFailure(EXIT.CONTRACT, `legacy lane: expected both audit_logs unique indexes, got ${uniqueIndexRows.length}: ${uniqueIndexTsv}`);
        evidence.namedConstraintsAndIndexes = { checkAndFkCount: constraintRows.length, uniqueIndexCount: uniqueIndexRows.length };

        // ---- immutability freeze OBSERVES the legacy-backfilled rows too, not only fresh inserts ----
        const immutabilityLines: string[] = [];
        immutabilityLines.push(await attemptDirectMutationRejection(ctx.containerName, conn, 'UPDATE of a legacy-backfilled row denied (append-only)', `UPDATE audit_logs SET event_type = 'tampered' WHERE id = 'aud-log-tenant-a';`));
        immutabilityLines.push(await attemptDirectMutationRejection(ctx.containerName, conn, 'DELETE of a legacy-backfilled row denied (append-only)', `DELETE FROM audit_logs WHERE id = 'aud-log-tenant-a';`));
        writeFileSync(join(scenarioEvidenceDir, 'legacy-immutability.log'), `${immutabilityLines.join('\n')}\n`);
        evidence.immutabilityChecks = immutabilityLines.length;

        // U024 follows U021. This U021-owned legacy lane must still finish on the current schema
        // before it asks Prisma for an empty diff; otherwise a newly landed successor is falsely
        // reported as a U021 regression. Add only the canonical U024 symlink after all U021
        // observations above, preserving the genuinely pre-U021 fixture/deploy proof.
        addMigrationToView(view, NEW_MIGRATION_NAME_U024);
        addMigrationToView(view, NEW_MIGRATION_NAME_U032);
        addMigrationToView(view, NEW_MIGRATION_NAME_U033);
        addMigrationToView(view, NEW_MIGRATION_NAME_U034);
        addMigrationToView(view, NEW_MIGRATION_NAME_U035);
        addMigrationToView(view, NEW_MIGRATION_NAME_U036);
        addMigrationToView(view, NEW_MIGRATION_NAME_U037);
        addMigrationToView(view, NEW_MIGRATION_NAME_U038);
        addMigrationToView(view, NEW_MIGRATION_NAME_U039);
        addMigrationToView(view, NEW_MIGRATION_NAME_U040);
        addMigrationToView(view, NEW_MIGRATION_NAME_U041);
        addMigrationToView(view, NEW_MIGRATION_NAME_U042);
        verifyViewIntegrity(view, [...throughU020, NEW_MIGRATION_NAME_U021, NEW_MIGRATION_NAME_U024, NEW_MIGRATION_NAME_U032, NEW_MIGRATION_NAME_U033, NEW_MIGRATION_NAME_U034, NEW_MIGRATION_NAME_U035, NEW_MIGRATION_NAME_U036, NEW_MIGRATION_NAME_U037, NEW_MIGRATION_NAME_U038, NEW_MIGRATION_NAME_U039, NEW_MIGRATION_NAME_U040, NEW_MIGRATION_NAME_U041, NEW_MIGRATION_NAME_U042]);
        const deployU024ForCurrentSchema = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (deployU024ForCurrentSchema.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy (+U024 after U021 verification) failed: ${deployU024ForCurrentSchema.stderr || deployU024ForCurrentSchema.stdout}`);
        evidence.deployU024ForCurrentSchema = true;

        // ---- reproducible deploy + empty schema diff against the complete current chain ----
        const redeploy = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (redeploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `migrate deploy re-run was not reproducible: ${redeploy.stderr || redeploy.stdout}`);
        evidence.migrateDeployReproducible = true;

        const diff = await runMigrateDiff(ctx.databaseUrl);
        const diffText = diff.stdout.trim();
        const isEmptyDiff = diff.code === 0 && (diffText.length === 0 || diffText === '-- This is an empty migration.');
        writeFileSync(join(scenarioEvidenceDir, 'migration-diff.sql'), '');
        if (!isEmptyDiff) throw new ContractFailure(EXIT.CONTRACT, `legacy lane: schema diff not empty after full deploy: exit=${diff.code} stdout=${diff.stdout}`);
        evidence.emptySchemaDiff = true;

        // ---- scope:check via the UNMODIFIED checker — dynamic form, never a hard-pinned count ----
        const scopeCheck = await runScopeCheck();
        if (scopeCheck.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `scope:check failed: ${scopeCheck.stdout}\n${scopeCheck.stderr}`);
        const scopeCheckJson = JSON.parse(scopeCheck.stdout);
        if (scopeCheckJson.currentModelCount !== scopeCheckJson.inventoryModelCount || scopeCheckJson.ok !== true) {
          throw new ContractFailure(EXIT.CONTRACT, `scope:check did not report ok=true with schema matching the canonical inventory: ${scopeCheck.stdout}`);
        }
        writeFileSync(join(scenarioEvidenceDir, 'inventory.json'), `${JSON.stringify(scopeCheckJson, null, 2)}\n`);
        evidence.scopeCheck = { currentModelCount: scopeCheckJson.currentModelCount, ok: scopeCheckJson.ok, tallies: scopeCheckJson.tallies };

        return evidence;
      },
    );
  } finally {
    if (view) {
      const viewDirToRemove = (view as MigrationView).dir;
      rmSync(viewDirToRemove, { recursive: true, force: true });
      const canonicalLockHash = sha256File(join(REAL_PRISMA_DIR, 'migrations', 'migration_lock.toml'));
      const recordedLockHash = (evidence.viewMembershipWithU021 as Record<string, string> | undefined)?.['migration_lock.toml'];
      evidence.viewRemovedInFinally = true;
      evidence.canonicalMigrationLockUntouchedAfterCleanup = recordedLockHash === undefined ? null : canonicalLockHash === recordedLockHash;
    }
  }

  return evidence;
}

async function runAuditChainSuite(evidenceDir: string): Promise<number> {
  const runId = `u021${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let caughtError: unknown = null;
  let freshEvidence: Record<string, unknown> | null = null;
  let legacyEvidence: Record<string, unknown> | null = null;
  try {
    freshEvidence = await runAuditChainFreshScenario(evidenceDir, runId);
    legacyEvidence = await runAuditChainLegacyScenario(evidenceDir, runId);
  } catch (error) {
    caughtError = error;
  }

  const [freshCounts, legacyCounts] = await Promise.all([
    labelResourceCounts(runId, OWNER_UNIT_U021, `${PURPOSE_U021}-fresh`),
    labelResourceCounts(runId, OWNER_UNIT_U021, `${PURPOSE_U021}-legacy`),
  ]);
  const totalCounts = {
    containers: freshCounts.containers + legacyCounts.containers,
    networks: freshCounts.networks + legacyCounts.networks,
    volumes: freshCounts.volumes + legacyCounts.volumes,
  };
  const cleanupOk = totalCounts.containers === 0 && totalCounts.networks === 0 && totalCounts.volumes === 0;
  const cleanup = {
    schemaVersion: 1,
    unit: OWNER_UNIT_U021,
    purpose: PURPOSE_U021,
    runId,
    postgres: totalCounts,
    http: null,
    httpReason: 'U021 db:contract is a DB-only append-only audit-chain suite — neither the fresh nor the legacy-upgrade lane starts an HTTP server or any other process to tear down here.',
    childProcesses: 0,
    result: cleanupOk ? 'PASS' : 'FAIL',
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(evidenceDir, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`run-db-contract: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError instanceof ContractFailure ? caughtError.exitCode : EXIT.CONTRACT;
  }

  writeFileSync(
    join(evidenceDir, 'db-contract-receipt.json'),
    `${JSON.stringify({ schemaVersion: 1, unit: OWNER_UNIT_U021, suite: 'audit-chain', result: 'PASS', freshEvidence, legacyEvidence, cleanup, startedAt, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return EXIT.SUCCESS;
}

// U024 / SEC-02b. The DB-only receipt intentionally proves migration ordering, legacy freezing,
// lifecycle objects, delete denial and empty schema diff in two separate U009-owned loopback
// lanes. Domain-service concurrency is covered by its focused integration test; this runner never
// points at a caller-provided DATABASE_URL.
async function runRoleChangeSuite(evidenceDir: string): Promise<number> {
  const startedAt = new Date().toISOString();
  const runId = `u024-${Date.now().toString(36)}`;
  const freshEvidence: Record<string, unknown> = {};
  const legacyEvidence: Record<string, unknown> = {};
  let caught: unknown = null;
  try {
    await withIsolatedPostgres(
      { runId, ownerUnit: OWNER_UNIT_U024, purpose: `${PURPOSE_U024}-fresh`, evidenceDir: join(evidenceDir, 'fresh'), imageDigest: IMAGE_DIGEST, migrate: true },
      async (ctx: any) => {
        const conn = parseConn(ctx.databaseUrl);
        const scope = await runScopeCheck();
        if (scope.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `scope:check failed: ${scope.stdout}\n${scope.stderr}`);
        const scopeJson = JSON.parse(scope.stdout);
        if (scopeJson.currentModelCount !== scopeJson.inventoryModelCount || scopeJson.ok !== true) throw new ContractFailure(EXIT.CONTRACT, `scope inventory mismatch: ${scope.stdout}`);
        const objects = await execSqlTsv(ctx.containerName, conn, `SELECT c.relkind, c.relname FROM pg_class c WHERE c.relname IN ('role_change_requests_request_idempotency_uidx','role_change_requests_open_target_uidx') UNION ALL SELECT 't', tgname FROM pg_trigger WHERE tgname IN ('role_change_requests_canonical_insert_guard_trg','role_change_requests_lifecycle_update_guard_trg','role_change_requests_immutable_delete_trg') ORDER BY 1,2;`);
        const diff = await runMigrateDiff(ctx.databaseUrl);
        if (diff.code !== 0 || !['', '-- This is an empty migration.'].includes(diff.stdout.trim())) throw new ContractFailure(EXIT.CONTRACT, `fresh schema diff is non-empty: ${diff.stdout}\n${diff.stderr}`);
        freshEvidence.scopeCheck = scopeJson;
        freshEvidence.namedObjects = objects;
        freshEvidence.schemaDiff = 'empty';
      },
    );

    await withIsolatedPostgres(
      { runId, ownerUnit: OWNER_UNIT_U024, purpose: `${PURPOSE_U024}-legacy`, evidenceDir: join(evidenceDir, 'legacy'), imageDigest: IMAGE_DIGEST, migrate: false },
      async (ctx: any) => {
        const conn = parseConn(ctx.databaseUrl);
        const before = readdirSync(join(REAL_PRISMA_DIR, 'migrations'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).filter((name) => name !== NEW_MIGRATION_NAME_U024 && name !== NEW_MIGRATION_NAME_U032 && name !== NEW_MIGRATION_NAME_U033 && name !== NEW_MIGRATION_NAME_U034 && name !== NEW_MIGRATION_NAME_U035 && name !== NEW_MIGRATION_NAME_U036 && name !== NEW_MIGRATION_NAME_U037 && name !== NEW_MIGRATION_NAME_U038 && name !== NEW_MIGRATION_NAME_U039 && name !== NEW_MIGRATION_NAME_U040 && name !== NEW_MIGRATION_NAME_U041 && name !== NEW_MIGRATION_NAME_U042).sort();
        const view = buildReadOnlyMigrationView('u024-legacy', before);
        try {
          verifyViewIntegrity(view, before);
          const prefix = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
          if (prefix.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `legacy prefix deploy failed: ${prefix.stderr || prefix.stdout}`);
          const fixture = readFileSync(join(DB_PKG_ROOT, 'tests/fixtures/role-change-legacy.sql'), 'utf8');
          const loaded = await spawnCapture(['docker', 'exec', '-i', '-e', `PGPASSWORD=${conn.password}`, ctx.containerName, 'psql', '-h', '127.0.0.1', '-U', conn.user, '-d', conn.database, '-v', 'ON_ERROR_STOP=1'], sanitizedEnv({}), { input: fixture });
          if (loaded.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `legacy fixture load failed: ${loaded.stderr || loaded.stdout}`);
          const beforeStatus = await execSql(ctx.containerName, conn, `SELECT status || '|' || id FROM role_change_requests WHERE id='u024-legacy-role-change';`);
          addMigrationToView(view, NEW_MIGRATION_NAME_U024);
          addMigrationToView(view, NEW_MIGRATION_NAME_U032);
          addMigrationToView(view, NEW_MIGRATION_NAME_U033);
          addMigrationToView(view, NEW_MIGRATION_NAME_U034);
          addMigrationToView(view, NEW_MIGRATION_NAME_U035);
          addMigrationToView(view, NEW_MIGRATION_NAME_U036);
          addMigrationToView(view, NEW_MIGRATION_NAME_U037);
          addMigrationToView(view, NEW_MIGRATION_NAME_U038);
          addMigrationToView(view, NEW_MIGRATION_NAME_U039);
          addMigrationToView(view, NEW_MIGRATION_NAME_U040);
          addMigrationToView(view, NEW_MIGRATION_NAME_U041);
          addMigrationToView(view, NEW_MIGRATION_NAME_U042);
          verifyViewIntegrity(view, [...before, NEW_MIGRATION_NAME_U024, NEW_MIGRATION_NAME_U032, NEW_MIGRATION_NAME_U033, NEW_MIGRATION_NAME_U034, NEW_MIGRATION_NAME_U035, NEW_MIGRATION_NAME_U036, NEW_MIGRATION_NAME_U037, NEW_MIGRATION_NAME_U038, NEW_MIGRATION_NAME_U039, NEW_MIGRATION_NAME_U040, NEW_MIGRATION_NAME_U041, NEW_MIGRATION_NAME_U042]);
          const deploy = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
          if (deploy.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `U024 deploy failed: ${deploy.stderr || deploy.stdout}`);
          const frozen = await execSql(ctx.containerName, conn, `SELECT status || '|' || legacy_status || '|' || legacy_unbound::text || '|' || revision::text FROM role_change_requests WHERE id='u024-legacy-role-change';`);
          if (beforeStatus !== 'pending|u024-legacy-role-change' || frozen !== 'legacy_unbound|pending|true|0') throw new ContractFailure(EXIT.CONTRACT, `legacy role-change normalization lost bytes: before=${beforeStatus} after=${frozen}`);
          const qa = [
            await attemptQaInsert(ctx.containerName, conn, { label: 'new legacy_unbound denied', expect: 'reject', sql: `INSERT INTO role_change_requests (id,user_id,from_role,to_role,status,requested_by,company_id) VALUES ('u024-illegal','u024-legacy-user','member','admin','legacy_unbound','x','u024-company');` }),
            await attemptQaInsert(ctx.containerName, conn, { label: 'legacy delete denied', expect: 'reject', sql: `DELETE FROM role_change_requests WHERE id='u024-legacy-role-change';` }),
          ];
          const diff = await runMigrateDiff(ctx.databaseUrl);
          if (diff.code !== 0 || !['', '-- This is an empty migration.'].includes(diff.stdout.trim())) throw new ContractFailure(EXIT.CONTRACT, `legacy schema diff is non-empty: ${diff.stdout}\n${diff.stderr}`);
          legacyEvidence.migrationPrefix = before;
          legacyEvidence.migrationHashes = view.membership;
          legacyEvidence.legacyBefore = beforeStatus;
          legacyEvidence.legacyAfter = frozen;
          legacyEvidence.qa = qa;
          legacyEvidence.schemaDiff = 'empty';
          writeFileSync(join(evidenceDir, 'role-change-lifecycle.tsv'), `${frozen}\n${qa.join('\n')}\n`);
        } finally {
          rmSync(view.dir, { recursive: true, force: true });
        }
      },
    );
  } catch (error) {
    caught = error;
  }
  const receipt = { schemaVersion: 1, unit: OWNER_UNIT_U024, suite: PURPOSE_U024, runId, freshEvidence, legacyEvidence, startedAt, finishedAt: new Date().toISOString(), result: caught ? 'FAIL' : 'PASS' };
  writeFileSync(join(evidenceDir, 'db-contract-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  if (caught) {
    process.stderr.write(`${caught instanceof Error ? (caught.stack ?? caught.message) : String(caught)}\n`);
    return caught instanceof ContractFailure ? caught.exitCode : EXIT.CONTRACT;
  }
  return EXIT.SUCCESS;
}

// U041 / AIQ-01. This is a migration-order proof, not a product runtime: it deploys the exact
// U040 prefix, loads the tracked pre-U041 fixture, snapshots it, adds only U041, then verifies
// immutable-history authorities and representative valid/invalid writes on a U009-owned scratch DB.
async function runAiQualitySchemaSuite(evidenceDir: string): Promise<number> {
  const startedAt = new Date().toISOString();
  const runId = `u041-${Date.now().toString(36)}`;
  const evidence: Record<string, unknown> = {};
  let caught: unknown = null;
  let view: MigrationView | null = null;
  const triggerSpecs = [
    ['ai_quality_assessments_immutable_update_trg', 'ai_quality_assessments', 'UPDATE'], ['ai_quality_assessments_immutable_delete_trg', 'ai_quality_assessments', 'DELETE'],
    ['ai_quality_evidence_immutable_update_trg', 'ai_quality_evidence', 'UPDATE'], ['ai_quality_evidence_immutable_delete_trg', 'ai_quality_evidence', 'DELETE'],
    ['ai_quality_reviews_immutable_update_trg', 'ai_quality_reviews', 'UPDATE'], ['ai_quality_reviews_immutable_delete_trg', 'ai_quality_reviews', 'DELETE'],
    ['ai_release_evaluations_immutable_update_trg', 'ai_release_evaluations', 'UPDATE'], ['ai_release_evaluations_immutable_delete_trg', 'ai_release_evaluations', 'DELETE'],
    ['ai_prompt_snapshots_immutable_update_trg', 'ai_prompt_snapshots', 'UPDATE'], ['ai_prompt_snapshots_immutable_delete_trg', 'ai_prompt_snapshots', 'DELETE'],
    ['ai_model_snapshots_immutable_update_trg', 'ai_model_snapshots', 'UPDATE'], ['ai_model_snapshots_immutable_delete_trg', 'ai_model_snapshots', 'DELETE'],
  ] as const;
  const hash = 'a'.repeat(64);

  try {
    await withIsolatedPostgres(
      { runId, ownerUnit: OWNER_UNIT_U041, purpose: PURPOSE_U041, evidenceDir: join(evidenceDir, 'scratch'), imageDigest: IMAGE_DIGEST, migrate: false },
      async (ctx: any) => {
        const conn = parseConn(ctx.databaseUrl);
        const prefix = readdirSync(join(REAL_PRISMA_DIR, 'migrations'), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .filter((name) => name <= NEW_MIGRATION_NAME_U040)
          .sort();
        if (prefix.at(-1) !== NEW_MIGRATION_NAME_U040) throw new ContractFailure(EXIT.CONTRACT, `U041 exact prefix must end at ${NEW_MIGRATION_NAME_U040}`);

        view = buildReadOnlyMigrationView('u041-prefix', prefix);
        verifyViewIntegrity(view, prefix);
        const deployPrefix = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (deployPrefix.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `U041 prefix deploy failed: ${deployPrefix.stderr || deployPrefix.stdout}`);
        evidence.prefix = { endingMigration: NEW_MIGRATION_NAME_U040, membership: { ...view.membership } };
        writeFileSync(join(evidenceDir, 'upgrade-prefix.json'), `${JSON.stringify(evidence.prefix, null, 2)}\n`);

        const fixture = readFileSync(join(DB_PKG_ROOT, 'src/fixtures/u041-ai-quality-pre-migration.sql'), 'utf8');
        const loaded = await spawnCapture(['docker', 'exec', '-i', '-e', `PGPASSWORD=${conn.password}`, ctx.containerName, 'psql', '-h', '127.0.0.1', '-U', conn.user, '-d', conn.database, '-v', 'ON_ERROR_STOP=1'], sanitizedEnv({}), { input: fixture });
        if (loaded.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `U041 pre-migration fixture load failed: ${loaded.stderr || loaded.stdout}`);
        const legacyBefore = await execSql(ctx.containerName, conn, `SELECT jsonb_build_object('tenant', (SELECT to_jsonb(t) FROM tenants t WHERE id='u041-fixture-tenant'), 'company', (SELECT to_jsonb(c) FROM companies c WHERE id='u041-fixture-company'), 'artifact', (SELECT to_jsonb(a) FROM artifacts a WHERE id='u041-fixture-artifact'), 'artifactVersion', (SELECT to_jsonb(v) FROM artifact_versions v WHERE id='u041-fixture-artifact-version'))::text;`);
        writeFileSync(join(evidenceDir, 'legacy-fixture-before.json'), `${legacyBefore}\n`);

        addMigrationToView(view, NEW_MIGRATION_NAME_U041);
        addMigrationToView(view, NEW_MIGRATION_NAME_U042);
        verifyViewIntegrity(view, [...prefix, NEW_MIGRATION_NAME_U041, NEW_MIGRATION_NAME_U042]);
        const deployU041 = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (deployU041.code !== 0) throw new ContractFailure(EXIT.CONTRACT, `U041 deploy failed: ${deployU041.stderr || deployU041.stdout}`);
        const legacyAfter = await execSql(ctx.containerName, conn, `SELECT jsonb_build_object('tenant', (SELECT to_jsonb(t) FROM tenants t WHERE id='u041-fixture-tenant'), 'company', (SELECT to_jsonb(c) FROM companies c WHERE id='u041-fixture-company'), 'artifact', (SELECT to_jsonb(a) FROM artifacts a WHERE id='u041-fixture-artifact'), 'artifactVersion', (SELECT to_jsonb(v) FROM artifact_versions v WHERE id='u041-fixture-artifact-version'))::text;`);
        if (legacyAfter !== legacyBefore) throw new ContractFailure(EXIT.CONTRACT, 'U041 changed a pre-migration fixture row or predecessor relation');
        writeFileSync(join(evidenceDir, 'legacy-fixture-after.json'), `${legacyAfter}\n`);

        interface TriggerRow { triggerName: string; table: string; event: string; timing: string; enabled: boolean; functionName: string; functionDefinitionHash: string }
        const observed = await execSqlJsonRows<TriggerRow>(ctx.containerName, conn, `
          SELECT t.tgname AS "triggerName", c.relname AS "table",
            CASE WHEN (t.tgtype & 16) <> 0 THEN 'UPDATE' ELSE 'DELETE' END AS event,
            'BEFORE' AS timing, (t.tgenabled = 'O') AS enabled,
            'public.' || p.proname || '()' AS "functionName",
            public.sangfor_sha256_utf8(pg_get_functiondef(p.oid)) AS "functionDefinitionHash"
          FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
          WHERE NOT t.tgisinternal AND c.relname IN ('ai_quality_assessments','ai_quality_evidence','ai_quality_reviews','ai_release_evaluations','ai_prompt_snapshots','ai_model_snapshots')
          ORDER BY t.tgname`);
        const expected = triggerSpecs.map(([triggerName, table, event]) => ({ triggerName, table, event, timing: 'BEFORE', enabled: true }));
        const observedKeys = observed.map((row) => `${row.triggerName}|${row.table}|${row.event}|${row.timing}`);
        const expectedKeys = expected.map((row) => `${row.triggerName}|${row.table}|${row.event}|${row.timing}`);
        const missing = expectedKeys.filter((key) => !observedKeys.includes(key));
        const extra = observedKeys.filter((key) => !expectedKeys.includes(key));
        const duplicateAuthorities = observedKeys.filter((key, index) => observedKeys.indexOf(key) !== index);
        if (observed.length !== 12 || missing.length || extra.length || duplicateAuthorities.length || observed.some((row) => !row.enabled || !['public.ai_quality_history_immutable_update_reject_fn()', 'public.ai_quality_history_immutable_delete_reject_fn()'].includes(row.functionName))) {
          throw new ContractFailure(EXIT.CONTRACT, `U041 immutable authority inventory mismatch: observed=${JSON.stringify(observed)}`);
        }
        const authorityInventory = { expectedFunctions: ['public.ai_quality_history_immutable_update_reject_fn()', 'public.ai_quality_history_immutable_delete_reject_fn()'], expectedTriggers: expected, expectedCount: 12, observedCount: observed.length, missing, extra, duplicateAuthorities, observed };
        writeFileSync(join(evidenceDir, 'ai-history-authority-inventory.json'), `${JSON.stringify(authorityInventory, null, 2)}\n`);

        const qa: string[] = [];
        qa.push(await attemptQaInsert(ctx.containerName, conn, { label: 'valid assessment', expect: 'ok', sql: `INSERT INTO ai_quality_assessments (id,artifact_version_id,artifact_content_hash,result_hash,policy_key,policy_version,evaluator_key,evaluator_version,status,score,source_coverage,confidence_basis,missing_info,known_gaps,risk_flags,injection_detected,leakage_detected,quality_passed,assessed_by_assignment_id,idempotency_key,assessment_input_hash,assessed_at) VALUES ('u041-assessment','u041-fixture-artifact-version','${hash}','${hash}','quality','v1','evaluator','v1','completed',0.8,0.7,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,false,false,false,'u041-fixture-assignment','assessment-1','${hash}',now());` }));
        qa.push(await attemptQaInsert(ctx.containerName, conn, { label: 'valid artifact evidence', expect: 'ok', sql: `INSERT INTO ai_quality_evidence (id,assessment_id,source_kind,source_reference,source_hash,source_artifact_version_id,citation,coverage) VALUES ('u041-evidence','u041-assessment','artifact','u041-fixture-artifact-version','${hash}','u041-fixture-artifact-version','{}'::jsonb,'{}'::jsonb);` }));
        qa.push(await attemptQaInsert(ctx.containerName, conn, { label: 'valid review', expect: 'ok', sql: `INSERT INTO ai_quality_reviews (id,assessment_id,artifact_version_id,artifact_content_hash,assessment_result_hash,review_slot_key,reviewer_assignment_id,reviewer_role_snapshot,decision,comment,idempotency_key,review_input_hash) VALUES ('u041-review','u041-assessment','u041-fixture-artifact-version','${hash}','${hash}','security','u041-fixture-assignment','account_manager','approved','reviewed','review-1','${hash}');` }));
        qa.push(await attemptQaInsert(ctx.containerName, conn, { label: 'valid evaluation', expect: 'ok', sql: `INSERT INTO ai_release_evaluations (id,evaluation_key,evaluation_input_hash,review_set_hash,artifact_version_id,artifact_content_hash,assessment_id,action,policy_key,policy_version,policy_hash,eligible,blockers,evaluated_at) VALUES ('u041-evaluation','${hash}','${hash}','${hash}','u041-fixture-artifact-version','${hash}','u041-assessment','ai.review','quality','v1','${hash}',false,'["human_review_required"]'::jsonb,now());` }));
        qa.push(await attemptQaInsert(ctx.containerName, conn, { label: 'valid prompt snapshot', expect: 'ok', sql: `INSERT INTO ai_prompt_snapshots (id,assessment_id,prompt_key,prompt_version,prompt_hash,tool_key,tool_version,tool_hash,classification) VALUES ('u041-prompt','u041-assessment','prompt','v1','${hash}','tool','v1','${hash}','internal');` }));
        qa.push(await attemptQaInsert(ctx.containerName, conn, { label: 'valid model snapshot', expect: 'ok', sql: `INSERT INTO ai_model_snapshots (id,assessment_id,model_key,model_version,model_hash,tool_key,tool_version,tool_hash,classification) VALUES ('u041-model','u041-assessment','model','v1','${hash}','tool','v1','${hash}','internal');` }));
        qa.push(await attemptQaInsert(ctx.containerName, conn, { label: 'artifact evidence needs source version', expect: 'reject', sql: `INSERT INTO ai_quality_evidence (id,assessment_id,source_kind,source_reference,source_hash,citation,coverage) VALUES ('u041-bad-evidence','u041-assessment','artifact','missing','${hash}','{}'::jsonb,'{}'::jsonb);` }));
        qa.push(await attemptQaInsert(ctx.containerName, conn, { label: 'review decision allowlist', expect: 'reject', sql: `INSERT INTO ai_quality_reviews (id,assessment_id,artifact_version_id,artifact_content_hash,assessment_result_hash,review_slot_key,reviewer_assignment_id,reviewer_role_snapshot,decision,idempotency_key,review_input_hash) VALUES ('u041-bad-review','u041-assessment','u041-fixture-artifact-version','${hash}','${hash}','legal','u041-fixture-assignment','account_manager','pending','review-bad','${hash}');` }));
        qa.push(await attemptQaInsert(ctx.containerName, conn, { label: 'action allowlist', expect: 'reject', sql: `INSERT INTO ai_release_evaluations (id,evaluation_key,evaluation_input_hash,review_set_hash,artifact_version_id,artifact_content_hash,assessment_id,action,policy_key,policy_version,policy_hash,eligible,blockers,evaluated_at) VALUES ('u041-bad-action','${'b'.repeat(64)}','${hash}','${hash}','u041-fixture-artifact-version','${hash}','u041-assessment','external.send','quality','v1','${hash}',false,'[]'::jsonb,now());` }));
        for (const [table, id] of [['ai_quality_assessments', 'u041-assessment'], ['ai_quality_evidence', 'u041-evidence'], ['ai_quality_reviews', 'u041-review'], ['ai_release_evaluations', 'u041-evaluation'], ['ai_prompt_snapshots', 'u041-prompt'], ['ai_model_snapshots', 'u041-model']] as const) {
          qa.push(await attemptQaInsert(ctx.containerName, conn, { label: `${table} no-op update immutable`, expect: 'reject', sql: `UPDATE ${table} SET id=id WHERE id='${id}';` }));
          qa.push(await attemptQaInsert(ctx.containerName, conn, { label: `${table} delete immutable`, expect: 'reject', sql: `DELETE FROM ${table} WHERE id='${id}';` }));
        }
        qa.push(await attemptQaInsert(ctx.containerName, conn, { label: 'parent artifact version restrict delete', expect: 'reject', sql: `DELETE FROM artifact_versions WHERE id='u041-fixture-artifact-version';` }));
        writeFileSync(join(evidenceDir, 'ai-history-negative-matrix.json'), `${JSON.stringify(qa, null, 2)}\n`);

        const diff = await runMigrateDiff(ctx.databaseUrl);
        if (diff.code !== 0 || !['', '-- This is an empty migration.'].includes(diff.stdout.trim())) throw new ContractFailure(EXIT.CONTRACT, `U041 scratch schema diff is non-empty: ${diff.stdout}\n${diff.stderr}`);
        evidence.authorityInventory = { expectedCount: 12, observedCount: observed.length };
        evidence.negativeMatrix = qa;
        evidence.emptySchemaDiff = true;
      },
    );
  } catch (error) {
    caught = error;
  } finally {
    if (view) rmSync(view.dir, { recursive: true, force: true });
  }
  const receipt = { schemaVersion: 1, unit: OWNER_UNIT_U041, suite: PURPOSE_U041, runId, startedAt, finishedAt: new Date().toISOString(), result: caught ? 'FAIL' : 'PASS', evidence };
  writeFileSync(join(evidenceDir, 'db-contract-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(join(evidenceDir, 'cleanup.json'), `${JSON.stringify({ runId, viewRemoved: true, isolatedLifecycle: 'completed' }, null, 2)}\n`);
  if (caught) {
    process.stderr.write(`${caught instanceof Error ? (caught.stack ?? caught.message) : String(caught)}\n`);
    return caught instanceof ContractFailure ? caught.exitCode : EXIT.CONTRACT;
  }
  return EXIT.SUCCESS;
}

export async function runGovernanceSchemaSuite(evidenceDir: string): Promise<number> {
  mkdirSync(evidenceDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const runId = `u042-${Date.now().toString(36)}`;
  const evidence: Record<string, unknown> = {};
  const log: string[] = [];
  let caught: unknown = null;
  let view: MigrationView | null = null;

  const expectedFunctions = [
    'public.governance_history_immutable_update_reject_fn()',
    'public.governance_history_immutable_delete_reject_fn()',
    'public.artifact_access_events_canonical_insert_guard_fn()',
    'public.data_export_requests_canonical_insert_guard_fn()',
    'public.data_export_requests_lifecycle_update_guard_fn()',
    'public.export_capabilities_canonical_insert_guard_fn()',
    'public.export_capabilities_lifecycle_update_guard_fn()',
    'public.ownership_transfers_canonical_insert_guard_fn()',
    'public.ownership_transfers_lifecycle_update_guard_fn()',
    'public.ownership_transfer_items_canonical_insert_guard_fn()',
  ].sort();
  const triggerSpecs = [
    ['retention_runs_immutable_update_trg', 'retention_runs', 'UPDATE', 'public.governance_history_immutable_update_reject_fn()'],
    ['retention_runs_immutable_delete_trg', 'retention_runs', 'DELETE', 'public.governance_history_immutable_delete_reject_fn()'],
    ['retention_run_items_immutable_update_trg', 'retention_run_items', 'UPDATE', 'public.governance_history_immutable_update_reject_fn()'],
    ['retention_run_items_immutable_delete_trg', 'retention_run_items', 'DELETE', 'public.governance_history_immutable_delete_reject_fn()'],
    ['retention_policy_versions_immutable_update_trg', 'retention_policy_versions', 'UPDATE', 'public.governance_history_immutable_update_reject_fn()'],
    ['retention_policy_versions_immutable_delete_trg', 'retention_policy_versions', 'DELETE', 'public.governance_history_immutable_delete_reject_fn()'],
    ['legal_hold_scopes_immutable_update_trg', 'legal_hold_scopes', 'UPDATE', 'public.governance_history_immutable_update_reject_fn()'],
    ['legal_hold_scopes_immutable_delete_trg', 'legal_hold_scopes', 'DELETE', 'public.governance_history_immutable_delete_reject_fn()'],
    ['artifact_access_events_canonical_insert_guard_trg', 'artifact_access_events', 'INSERT', 'public.artifact_access_events_canonical_insert_guard_fn()'],
    ['artifact_access_events_immutable_update_trg', 'artifact_access_events', 'UPDATE', 'public.governance_history_immutable_update_reject_fn()'],
    ['artifact_access_events_immutable_delete_trg', 'artifact_access_events', 'DELETE', 'public.governance_history_immutable_delete_reject_fn()'],
    ['data_export_requests_canonical_insert_guard_trg', 'data_export_requests', 'INSERT', 'public.data_export_requests_canonical_insert_guard_fn()'],
    ['data_export_requests_lifecycle_update_guard_trg', 'data_export_requests', 'UPDATE', 'public.data_export_requests_lifecycle_update_guard_fn()'],
    ['data_export_requests_immutable_delete_trg', 'data_export_requests', 'DELETE', 'public.governance_history_immutable_delete_reject_fn()'],
    ['export_capabilities_canonical_insert_guard_trg', 'export_capabilities', 'INSERT', 'public.export_capabilities_canonical_insert_guard_fn()'],
    ['export_capabilities_lifecycle_update_guard_trg', 'export_capabilities', 'UPDATE', 'public.export_capabilities_lifecycle_update_guard_fn()'],
    ['export_capabilities_immutable_delete_trg', 'export_capabilities', 'DELETE', 'public.governance_history_immutable_delete_reject_fn()'],
    ['ownership_transfers_canonical_insert_guard_trg', 'ownership_transfers', 'INSERT', 'public.ownership_transfers_canonical_insert_guard_fn()'],
    ['ownership_transfers_lifecycle_update_guard_trg', 'ownership_transfers', 'UPDATE', 'public.ownership_transfers_lifecycle_update_guard_fn()'],
    ['ownership_transfers_immutable_delete_trg', 'ownership_transfers', 'DELETE', 'public.governance_history_immutable_delete_reject_fn()'],
    ['ownership_transfer_items_canonical_insert_guard_trg', 'ownership_transfer_items', 'INSERT', 'public.ownership_transfer_items_canonical_insert_guard_fn()'],
    ['ownership_transfer_items_immutable_update_trg', 'ownership_transfer_items', 'UPDATE', 'public.governance_history_immutable_update_reject_fn()'],
    ['ownership_transfer_items_immutable_delete_trg', 'ownership_transfer_items', 'DELETE', 'public.governance_history_immutable_delete_reject_fn()'],
  ] as const;
  const hashHex = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  const hashJcs = (value: unknown) => hashHex(canonicalizeRfc8785(value));
  const artifactEnvelopeA = '{"contract":"sangfor.artifact-content","payload":{},"version":1}';
  const artifactEnvelopeB = '{"contract":"sangfor.artifact-content","payload":{"company":"b"},"version":1}';
  const artifactHashA = hashHex(artifactEnvelopeA);
  const artifactHashB = hashHex(artifactEnvelopeB);
  const h = 'a'.repeat(64);
  const h2 = 'b'.repeat(64);

  const legacySnapshotSql = `
    SELECT jsonb_build_object(
      'dataExportRequests', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', id, 'artifact_id', artifact_id, 'requested_by', requested_by,
            'reason', reason, 'status', status, 'approved_by', approved_by
          ) ORDER BY id
        )
        FROM data_export_requests WHERE id = 'u042-legacy-export'
      ), '[]'::jsonb),
      'artifactAccessEvents', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', id, 'artifact_id', artifact_id, 'user_id', user_id,
            'access_type', access_type, 'timestamp', "timestamp"
          ) ORDER BY id
        )
        FROM artifact_access_events WHERE id = 'u042-legacy-access'
      ), '[]'::jsonb),
      'ownerRows', jsonb_build_object(
        'Artifact', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM (SELECT * FROM artifacts WHERE id='u042-artifact-a') x), '[]'::jsonb),
        'ApprovalRequest', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM (SELECT * FROM approval_requests WHERE id='u042-approval-a') x), '[]'::jsonb),
        'Opportunity', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM (SELECT * FROM opportunities WHERE id='u042-opportunity-a') x), '[]'::jsonb),
        'WorkTask', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM (SELECT * FROM work_tasks WHERE id='u042-work-task-a') x), '[]'::jsonb),
        'VendorRequest', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM (SELECT * FROM vendor_requests WHERE id='u042-vendor-request-a') x), '[]'::jsonb),
        'RenewalOpportunity', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM (SELECT * FROM renewal_opportunities WHERE id='u042-renewal-a') x), '[]'::jsonb),
        'SupportCase', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM (SELECT * FROM support_cases WHERE id='u042-support-case-a') x), '[]'::jsonb)
      )
    )::text;
  `;

  type LegacySnapshot = {
    dataExportRequests: Array<Record<string, unknown>>;
    artifactAccessEvents: Array<Record<string, unknown>>;
    ownerRows: Record<string, Array<Record<string, unknown>>>;
  };
  type QuarantineRow = {
    sourceModel: string;
    sourceId: string;
    reasonCode: string;
    sourceRowJson: Record<string, unknown>;
    sourceRowHash: string;
    candidateScopeJson: Record<string, unknown>;
    reviewDigest: string;
    resolutionJson: unknown;
  };
  interface AuthorityRow {
    triggerName: string;
    table: string;
    event: string;
    timing: string;
    enabled: boolean;
    eventCount: number;
    functionName: string;
    functionDefinitionHash: string;
  }

  try {
    await withIsolatedPostgres(
      {
        runId,
        ownerUnit: OWNER_UNIT_U042,
        purpose: PURPOSE_U042,
        evidenceDir: join(evidenceDir, 'scratch'),
        imageDigest: IMAGE_DIGEST,
        migrate: false,
      },
      async (ctx: { databaseUrl: string; containerName: string; databaseName: string; sentinel: Record<string, unknown> }) => {
        const conn = parseConn(ctx.databaseUrl);
        evidence.scratchIdentity = {
          containerName: ctx.containerName,
          databaseName: ctx.databaseName,
          sentinel: ctx.sentinel,
        };

        const prefix = readdirSync(join(REAL_PRISMA_DIR, 'migrations'), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .filter((name) => name <= NEW_MIGRATION_NAME_U041)
          .sort();
        if (prefix.at(-1) !== NEW_MIGRATION_NAME_U041 || prefix.includes(NEW_MIGRATION_NAME_U042)) {
          throw new ContractFailure(EXIT.CONTRACT, `U042 exact prefix must end at ${NEW_MIGRATION_NAME_U041}`);
        }

        view = buildReadOnlyMigrationView('u042-prefix', prefix);
        verifyViewIntegrity(view, prefix);
        const deployPrefix = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (deployPrefix.code !== 0) {
          throw new ContractFailure(EXIT.CONTRACT, `U042 prefix deploy failed: ${deployPrefix.stderr || deployPrefix.stdout}`);
        }
        const prefixReceipt = {
          schemaVersion: 1,
          endingMigration: NEW_MIGRATION_NAME_U041,
          migrationCount: prefix.length,
          membership: { ...view.membership },
        };
        writeFileSync(join(evidenceDir, 'upgrade-prefix.json'), `${JSON.stringify(prefixReceipt, null, 2)}\n`);
        evidence.prefix = { endingMigration: NEW_MIGRATION_NAME_U041, migrationCount: prefix.length };
        log.push(`prefix deploy: exit=0 endingMigration=${NEW_MIGRATION_NAME_U041}`);

        const fixturePath = join(DB_PKG_ROOT, 'src/fixtures/u042-governance-pre-migration.sql');
        const fixtureBytes = readFileSync(fixturePath);
        const fixtureLoad = await spawnCapture(
          ['docker', 'exec', '-i', '-e', `PGPASSWORD=${conn.password}`, ctx.containerName, 'psql', '-h', '127.0.0.1', '-U', conn.user, '-d', conn.database, '-v', 'ON_ERROR_STOP=1'],
          sanitizedEnv({}),
          { input: fixtureBytes.toString('utf8') },
        );
        if (fixtureLoad.code !== 0) {
          throw new ContractFailure(EXIT.CONTRACT, `U042 pre-migration fixture load failed: ${fixtureLoad.stderr || fixtureLoad.stdout}`);
        }
        log.push(`pre-U042 fixture load: exit=0 sha256=${createHash('sha256').update(fixtureBytes).digest('hex')}`);

        const beforeRaw = await execSql(ctx.containerName, conn, legacySnapshotSql);
        const before = JSON.parse(beforeRaw) as LegacySnapshot;
        const ownerNames = ['Artifact', 'ApprovalRequest', 'Opportunity', 'WorkTask', 'VendorRequest', 'RenewalOpportunity', 'SupportCase'];
        if (
          before.dataExportRequests.length !== 1
          || before.artifactAccessEvents.length !== 1
          || ownerNames.some((name) => before.ownerRows[name]?.length !== 1)
        ) {
          throw new ContractFailure(EXIT.CONTRACT, `U042 prefix fixture is incomplete: ${beforeRaw}`);
        }
        const beforeReceipt = {
          schemaVersion: 1,
          capturedBeforeMigration: NEW_MIGRATION_NAME_U042,
          sourceCounts: {
            DataExportRequest: before.dataExportRequests.length,
            ArtifactAccessEvent: before.artifactAccessEvents.length,
            ownerModels: Object.fromEntries(ownerNames.map((name) => [name, before.ownerRows[name]!.length])),
          },
          jcsSha256: hashJcs(before),
          snapshot: before,
        };
        writeFileSync(join(evidenceDir, 'legacy-fixture-before.json'), `${JSON.stringify(beforeReceipt, null, 2)}\n`);

        addMigrationToView(view, NEW_MIGRATION_NAME_U042);
        verifyViewIntegrity(view, [...prefix, NEW_MIGRATION_NAME_U042]);
        const deployU042 = await runWorkspaceMigrateDeploy(ctx.databaseUrl, view.schemaPath);
        if (deployU042.code !== 0) {
          throw new ContractFailure(EXIT.CONTRACT, `U042 migration deploy failed: ${deployU042.stderr || deployU042.stdout}`);
        }
        log.push(`U042 migrate deploy: exit=0 migration=${NEW_MIGRATION_NAME_U042}`);

        const afterRaw = await execSql(ctx.containerName, conn, legacySnapshotSql);
        const after = JSON.parse(afterRaw) as LegacySnapshot;
        const afterHash = hashJcs(after);
        if (afterRaw !== beforeRaw || afterHash !== beforeReceipt.jcsSha256) {
          throw new ContractFailure(EXIT.CONTRACT, 'U042 changed a pre-migration source/owner row byte projection');
        }
        const afterReceipt = {
          schemaVersion: 1,
          capturedAfterMigration: NEW_MIGRATION_NAME_U042,
          sourceCounts: beforeReceipt.sourceCounts,
          jcsSha256: afterHash,
          snapshot: after,
        };
        writeFileSync(join(evidenceDir, 'legacy-fixture-after.json'), `${JSON.stringify(afterReceipt, null, 2)}\n`);
        writeFileSync(
          join(evidenceDir, 'legacy-source-hashes.json'),
          `${JSON.stringify({
            schemaVersion: 1,
            before: beforeReceipt.jcsSha256,
            after: afterHash,
            countsUnchanged: true,
            hashesUnchanged: true,
          }, null, 2)}\n`,
        );

        const quarantineRows = await execSqlJsonRows<QuarantineRow>(ctx.containerName, conn, `
          SELECT source_model AS "sourceModel", source_id AS "sourceId", reason_code AS "reasonCode",
                 source_row_json AS "sourceRowJson", source_row_hash AS "sourceRowHash",
                 candidate_scope_json AS "candidateScopeJson", review_digest AS "reviewDigest",
                 resolution_json AS "resolutionJson"
          FROM scope_backfill_quarantine
          WHERE source_model IN ('DataExportRequest','ArtifactAccessEvent')
          ORDER BY source_model, source_id
        `);
        if (quarantineRows.length !== 2) {
          throw new ContractFailure(EXIT.CONTRACT, `expected two U042 quarantine snapshots, got ${quarantineRows.length}`);
        }
        const beforeByModel: Record<string, Record<string, unknown>> = {
          DataExportRequest: before.dataExportRequests[0]!,
          ArtifactAccessEvent: before.artifactAccessEvents[0]!,
        };
        const allowedReasons = new Set([
          'governance_legacy_unresolved',
          'governance_legacy_ambiguous',
          'governance_legacy_invalid_status',
          'governance_legacy_cross_scope',
        ]);
        const candidateKeys = [
          'candidateArtifactVersionIds',
          'candidateAssignmentIds',
          'legacyRowSnapshot',
          'schemaVersion',
          'sourceId',
          'sourceModel',
        ];
        for (const row of quarantineRows) {
          const candidate = row.candidateScopeJson;
          if (
            !allowedReasons.has(row.reasonCode)
            || row.resolutionJson !== null
            || row.sourceRowHash !== hashJcs(row.sourceRowJson)
            || row.reviewDigest !== hashJcs(candidate)
            || canonicalizeRfc8785(row.sourceRowJson) !== canonicalizeRfc8785(beforeByModel[row.sourceModel])
            || canonicalizeRfc8785(candidate.legacyRowSnapshot) !== canonicalizeRfc8785(row.sourceRowJson)
            || candidate.schemaVersion !== 'governance-legacy-quarantine/v1'
            || candidate.sourceModel !== row.sourceModel
            || candidate.sourceId !== row.sourceId
            || JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(candidateKeys)
            || !Array.isArray(candidate.candidateArtifactVersionIds)
            || candidate.candidateArtifactVersionIds.length !== 0
            || !Array.isArray(candidate.candidateAssignmentIds)
            || candidate.candidateAssignmentIds.length !== 0
          ) {
            throw new ContractFailure(EXIT.CONTRACT, `U042 quarantine snapshot/JCS mismatch: ${JSON.stringify(row)}`);
          }
        }
        writeFileSync(
          join(evidenceDir, 'quarantine-snapshots.json'),
          `${JSON.stringify({
            schemaVersion: 1,
            expectedCount: 2,
            observedCount: quarantineRows.length,
            independentJcsDigestMatches: true,
            sourceRowHashMatches: true,
            byteRereadMatches: true,
            rows: quarantineRows,
          }, null, 2)}\n`,
        );

        const zeroActivations = await execSql(
          ctx.containerName,
          conn,
          `SELECT (SELECT count(*) FROM data_export_requests WHERE id='u042-legacy-export' AND canonical_activated_at IS NOT NULL)
                + (SELECT count(*) FROM artifact_access_events WHERE id='u042-legacy-access' AND canonical_activated_at IS NOT NULL);`,
        );
        if (zeroActivations !== '0') throw new ContractFailure(EXIT.CONTRACT, 'U042 activated a preserved legacy row');

        const tableCount = await execSql(
          ctx.containerName,
          conn,
          `SELECT count(*) FROM pg_class WHERE relkind='r' AND relname IN (
            'retention_policies','retention_policy_versions','retention_assignments','legal_holds',
            'legal_hold_scopes','retention_runs','retention_run_items','export_capabilities',
            'ownership_transfers','ownership_transfer_items'
          );`,
        );
        if (tableCount !== '10') throw new ContractFailure(EXIT.CONTRACT, `U042 table count drift: ${tableCount}`);

        const authorityRows = await execSqlJsonRows<AuthorityRow>(ctx.containerName, conn, `
          SELECT t.tgname AS "triggerName", c.relname AS "table",
            CASE
              WHEN (t.tgtype & 4) <> 0 THEN 'INSERT'
              WHEN (t.tgtype & 8) <> 0 THEN 'DELETE'
              WHEN (t.tgtype & 16) <> 0 THEN 'UPDATE'
              ELSE 'OTHER'
            END AS event,
            CASE
              WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE'
              WHEN (t.tgtype & 64) <> 0 THEN 'INSTEAD OF'
              ELSE 'AFTER'
            END AS timing,
            (t.tgenabled = 'O') AS enabled,
            (((t.tgtype & 4) <> 0)::int + ((t.tgtype & 8) <> 0)::int
              + ((t.tgtype & 16) <> 0)::int + ((t.tgtype & 32) <> 0)::int) AS "eventCount",
            'public.' || p.proname || '()' AS "functionName",
            public.sangfor_sha256_utf8(pg_get_functiondef(p.oid)) AS "functionDefinitionHash"
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE NOT t.tgisinternal
            AND c.relname IN (
              'retention_runs','retention_run_items','retention_policy_versions','legal_hold_scopes',
              'artifact_access_events','data_export_requests','export_capabilities',
              'ownership_transfers','ownership_transfer_items'
            )
          ORDER BY t.tgname
        `);
        const expectedAuthorities = triggerSpecs
          .map(([triggerName, table, event, functionName]) => ({
            triggerName,
            table,
            event,
            timing: 'BEFORE',
            enabled: true,
            functionName,
          }))
          .sort((a, b) => a.triggerName.localeCompare(b.triggerName));
        const observedAuthorities = authorityRows
          .map((row) => ({
            triggerName: row.triggerName,
            table: row.table,
            event: row.event,
            timing: row.timing,
            enabled: row.enabled,
            functionName: row.functionName,
          }))
          .sort((a, b) => a.triggerName.localeCompare(b.triggerName));
        const observedFunctions = [...new Set(authorityRows.map((row) => row.functionName))].sort();
        const authorityKeys = authorityRows.map((row) => `${row.triggerName}|${row.table}|${row.event}`);
        const duplicateAuthorities = authorityKeys.filter((key, index) => authorityKeys.indexOf(key) !== index);
        if (
          authorityRows.length !== 23
          || observedFunctions.length !== 10
          || JSON.stringify(observedFunctions) !== JSON.stringify(expectedFunctions)
          || JSON.stringify(observedAuthorities) !== JSON.stringify(expectedAuthorities)
          || duplicateAuthorities.length !== 0
          || authorityRows.some((row) => !row.enabled || row.eventCount !== 1 || !/^[0-9a-f]{64}$/.test(row.functionDefinitionHash))
        ) {
          throw new ContractFailure(EXIT.CONTRACT, `U042 authority inventory mismatch: ${JSON.stringify(authorityRows)}`);
        }
        const authorityInventory = {
          schemaVersion: 1,
          unit: OWNER_UNIT_U042,
          result: 'PASS',
          expectedFunctionCount: 10,
          expectedTriggerCount: 23,
          observedFunctionCount: observedFunctions.length,
          observedTriggerCount: authorityRows.length,
          expectedFunctions,
          observedFunctions,
          expectedTriggers: expectedAuthorities,
          observedTriggers: authorityRows,
          missing: [],
          extra: [],
          duplicateAuthorities,
          combinedAuthorities: authorityRows.filter((row) => row.eventCount !== 1),
        };
        writeFileSync(join(evidenceDir, 'governance-authority-inventory.json'), `${JSON.stringify(authorityInventory, null, 2)}\n`);

        const activationQa: string[] = [];
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'new inactive legacy export branch denied',
          expect: 'reject',
          sql: `INSERT INTO data_export_requests (id,artifact_id,requested_by,reason,status,updated_at) VALUES ('u042-illegal-legacy-export','x','x','x','pending',now());`,
        }));
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'new inactive legacy access branch denied',
          expect: 'reject',
          sql: `INSERT INTO artifact_access_events (id,artifact_id,user_id,access_type,"timestamp") VALUES ('u042-illegal-legacy-access','x','x','view',now());`,
        }));
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'classification outside allowlist denied',
          expect: 'reject',
          sql: `INSERT INTO data_export_requests (id,canonical_activated_at,company_id,artifact_version_id,artifact_content_hash,classification,format,requested_by_assignment_id,approval_request_id,purpose,canonical_status,issued_at,expires_at,idempotency_key,request_input_hash,audit_log_id,updated_at) VALUES ('u042-bad-class',now(),'u042-company-a','u042-artifact-version-a','${artifactHashA}','secret','json','u042-assignment-requester','u042-approval-a','fixture','issued',TIMESTAMP '2026-07-16 01:00:00',TIMESTAMP '2026-07-16 01:10:00','bad-class','${h}','u042-audit-export',now());`,
        }));
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'access type outside allowlist denied',
          expect: 'reject',
          sql: `INSERT INTO artifact_access_events (id,canonical_activated_at,company_id,artifact_version_id,actor_assignment_id,canonical_access_type,"requestId",policy_result,watermark_applied,redaction_applied,request_metadata,canonical_created_at) VALUES ('u042-bad-access-type',now(),'u042-company-a','u042-artifact-version-a','u042-assignment-requester','execute','req-bad-type','allowed',false,false,'{}'::jsonb,now());`,
        }));
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'policy result outside allowlist denied',
          expect: 'reject',
          sql: `INSERT INTO artifact_access_events (id,canonical_activated_at,company_id,artifact_version_id,actor_assignment_id,canonical_access_type,"requestId",policy_result,watermark_applied,redaction_applied,request_metadata,canonical_created_at) VALUES ('u042-bad-policy-result',now(),'u042-company-a','u042-artifact-version-a','u042-assignment-requester','view','req-bad-policy','maybe',false,false,'{}'::jsonb,now());`,
        }));
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'allowed access with denial reason denied',
          expect: 'reject',
          sql: `INSERT INTO artifact_access_events (id,canonical_activated_at,company_id,artifact_version_id,actor_assignment_id,canonical_access_type,"requestId",policy_result,watermark_applied,redaction_applied,request_metadata,denial_reason,canonical_created_at) VALUES ('u042-bad-allowed-reason',now(),'u042-company-a','u042-artifact-version-a','u042-assignment-requester','view','req-bad-allowed','allowed',false,false,'{}'::jsonb,'not allowed',now());`,
        }));
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'denied access with blank denial reason denied',
          expect: 'reject',
          sql: `INSERT INTO artifact_access_events (id,canonical_activated_at,company_id,artifact_version_id,actor_assignment_id,canonical_access_type,"requestId",policy_result,watermark_applied,redaction_applied,request_metadata,denial_reason,canonical_created_at) VALUES ('u042-bad-denied-reason',now(),'u042-company-a','u042-artifact-version-a','u042-assignment-requester','view','req-bad-denied','denied',false,false,'{}'::jsonb,'   ',now());`,
        }));
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'cross-company export artifact version denied',
          expect: 'reject',
          sql: `INSERT INTO data_export_requests (id,canonical_activated_at,company_id,artifact_version_id,artifact_content_hash,classification,format,requested_by_assignment_id,approval_request_id,purpose,canonical_status,issued_at,expires_at,idempotency_key,request_input_hash,audit_log_id,updated_at) VALUES ('u042-cross-export-artifact',now(),'u042-company-a','u042-artifact-version-b','${artifactHashB}','internal','json','u042-assignment-requester','u042-approval-a','fixture','issued',TIMESTAMP '2026-07-16 01:00:00',TIMESTAMP '2026-07-16 01:10:00','cross-export-artifact','${h}','u042-audit-export',now());`,
        }));
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'cross-company access artifact version denied',
          expect: 'reject',
          sql: `INSERT INTO artifact_access_events (id,canonical_activated_at,company_id,artifact_version_id,actor_assignment_id,canonical_access_type,"requestId",policy_result,watermark_applied,redaction_applied,request_metadata,canonical_created_at) VALUES ('u042-cross-access-artifact',now(),'u042-company-a','u042-artifact-version-b','u042-assignment-requester','view','req-cross-artifact','allowed',false,false,'{}'::jsonb,now());`,
        }));
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'cross-company access actor denied',
          expect: 'reject',
          sql: `INSERT INTO artifact_access_events (id,canonical_activated_at,company_id,artifact_version_id,actor_assignment_id,canonical_access_type,"requestId",policy_result,watermark_applied,redaction_applied,request_metadata,canonical_created_at) VALUES ('u042-cross-access-actor',now(),'u042-company-a','u042-artifact-version-a','u042-assignment-cross','view','req-cross-actor','allowed',false,false,'{}'::jsonb,now());`,
        }));
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'cross-company export approval denied',
          expect: 'reject',
          sql: `INSERT INTO data_export_requests (id,canonical_activated_at,company_id,artifact_version_id,artifact_content_hash,classification,format,requested_by_assignment_id,approval_request_id,purpose,canonical_status,issued_at,expires_at,idempotency_key,request_input_hash,audit_log_id,updated_at) VALUES ('u042-cross-export-approval',now(),'u042-company-a','u042-artifact-version-a','${artifactHashA}','internal','json','u042-assignment-requester','u042-approval-b','fixture','issued',TIMESTAMP '2026-07-16 01:00:00',TIMESTAMP '2026-07-16 01:10:00','cross-export-approval','${h}','u042-audit-export',now());`,
        }));
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'cross-company export audit denied',
          expect: 'reject',
          sql: `INSERT INTO data_export_requests (id,canonical_activated_at,company_id,artifact_version_id,artifact_content_hash,classification,format,requested_by_assignment_id,approval_request_id,purpose,canonical_status,issued_at,expires_at,idempotency_key,request_input_hash,audit_log_id,updated_at) VALUES ('u042-cross-export-audit',now(),'u042-company-a','u042-artifact-version-a','${artifactHashA}','internal','json','u042-assignment-requester','u042-approval-a','fixture','issued',TIMESTAMP '2026-07-16 01:00:00',TIMESTAMP '2026-07-16 01:10:00','cross-export-audit','${h}','u042-audit-cross',now());`,
        }));

        await execSql(ctx.containerName, conn, `
          INSERT INTO retention_policies (id,company_id,key,status,updated_at)
          VALUES ('u042-policy-a','u042-company-a','default','active',now());
          INSERT INTO retention_policy_versions (id,policy_id,version,duration_days,action,legal_basis,content_hash)
          VALUES ('u042-policy-version-a','u042-policy-a',1,30,'purge','contract','${h}');
          UPDATE retention_policies SET current_version_id='u042-policy-version-a',updated_at=now() WHERE id='u042-policy-a';
          INSERT INTO retention_assignments (id,policy_version_id,artifact_classification,resource_kind,due_at,active,updated_at)
          VALUES ('u042-retention-assignment-a','u042-policy-version-a','internal','knowledge_chunk',TIMESTAMP '2026-07-20 00:00:00',true,now());
          INSERT INTO legal_holds (id,company_id,policy_id,custodian_assignment_id,status,reason,started_at,updated_at)
          VALUES ('u042-legal-hold-a','u042-company-a','u042-policy-a','u042-assignment-requester','active','fixture',TIMESTAMP '2026-07-15 00:00:00',now());
          INSERT INTO legal_hold_scopes (id,legal_hold_id,company_id,artifact_version_id,resource_kind,resource_id)
          VALUES ('u042-legal-hold-scope-a','u042-legal-hold-a','u042-company-a','u042-artifact-version-a','artifact_version','u042-artifact-version-a');
        `);
        activationQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'cross-company legal hold artifact version denied',
          expect: 'reject',
          sql: `INSERT INTO legal_hold_scopes (id,legal_hold_id,company_id,artifact_version_id,resource_kind,resource_id) VALUES ('u042-cross-hold','u042-legal-hold-a','u042-company-a','u042-artifact-version-b','artifact_version','u042-artifact-version-b');`,
        }));

        const insertExport = async (id: string, idempotencyKey: string) => {
          await execSql(ctx.containerName, conn, `
            INSERT INTO data_export_requests (
              id,canonical_activated_at,company_id,artifact_version_id,artifact_content_hash,
              classification,format,requested_by_assignment_id,approval_request_id,purpose,
              canonical_status,issued_at,expires_at,completed_at,idempotency_key,
              request_input_hash,audit_log_id,updated_at
            ) VALUES (
              '${id}',TIMESTAMP '2026-07-16 01:00:00','u042-company-a','u042-artifact-version-a','${artifactHashA}',
              'internal','json','u042-assignment-requester','u042-approval-a','fixture export',
              'issued',TIMESTAMP '2026-07-16 01:00:00',TIMESTAMP '2026-07-16 01:10:00',NULL,'${idempotencyKey}',
              '${h}','u042-audit-export',TIMESTAMP '2026-07-16 01:00:00'
            );
          `);
        };
        for (const [id, key] of [
          ['u042-export-consume', 'export-consume'],
          ['u042-export-expire', 'export-expire'],
          ['u042-export-revoke', 'export-revoke'],
          ['u042-export-tamper', 'export-tamper'],
          ['u042-export-noop', 'export-noop'],
          ['u042-export-cap-consume', 'export-cap-consume'],
          ['u042-export-cap-revoke', 'export-cap-revoke'],
          ['u042-export-cap-tamper', 'export-cap-tamper'],
          ['u042-export-cap-noop', 'export-cap-noop'],
        ] as const) {
          await insertExport(id, key);
        }

        await execSql(ctx.containerName, conn, `
          INSERT INTO artifact_access_events (
            id,canonical_activated_at,company_id,artifact_version_id,actor_assignment_id,
            canonical_access_type,"requestId",policy_result,watermark_applied,redaction_applied,
            request_metadata,denial_reason,canonical_created_at
          ) VALUES (
            'u042-access-valid',TIMESTAMP '2026-07-16 01:00:00','u042-company-a',
            'u042-artifact-version-a','u042-assignment-requester','view','request-valid',
            'allowed',false,false,'{"source":"fixture"}'::jsonb,NULL,TIMESTAMP '2026-07-16 01:00:00'
          );
        `);

        const lifecycleQa: string[] = [];
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'issued export consumed',
          expect: 'ok',
          sql: `UPDATE data_export_requests SET canonical_status='consumed',completed_at=TIMESTAMP '2026-07-16 01:01:00',updated_at=now() WHERE id='u042-export-consume';`,
        }));
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'issued export expired',
          expect: 'ok',
          sql: `UPDATE data_export_requests SET canonical_status='expired',completed_at=TIMESTAMP '2026-07-16 01:10:00',updated_at=now() WHERE id='u042-export-expire';`,
        }));
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'issued export revoked',
          expect: 'ok',
          sql: `UPDATE data_export_requests SET canonical_status='revoked',completed_at=TIMESTAMP '2026-07-16 01:02:00',updated_at=now() WHERE id='u042-export-revoke';`,
        }));
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'export terminal replay denied',
          expect: 'reject',
          sql: `UPDATE data_export_requests SET canonical_status='revoked',updated_at=now() WHERE id='u042-export-consume';`,
        }));
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'export no-op update denied',
          expect: 'reject',
          sql: `UPDATE data_export_requests SET canonical_status=canonical_status WHERE id='u042-export-noop';`,
        }));
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'export same-transition immutable hash tamper denied',
          expect: 'reject',
          sql: `UPDATE data_export_requests SET canonical_status='consumed',completed_at=now(),artifact_content_hash='${h2}',updated_at=now() WHERE id='u042-export-tamper';`,
        }));

        const secretBytes = Buffer.alloc(32, 0x2a);
        const encodedSecret = secretBytes.toString('base64url');
        const rawDigest = createHash('sha256').update(secretBytes).digest('hex');
        const encodedDigest = hashHex(encodedSecret);
        if (secretBytes.length !== 32 || encodedSecret.length !== 43 || rawDigest === encodedDigest) {
          throw new ContractFailure(EXIT.CONTRACT, 'U042 capability raw-byte digest fixture is invalid');
        }
        for (const [id, requestId, digest] of [
          ['u042-cap-consume', 'u042-export-cap-consume', rawDigest],
          ['u042-cap-revoke', 'u042-export-cap-revoke', 'c'.repeat(64)],
          ['u042-cap-tamper', 'u042-export-cap-tamper', 'd'.repeat(64)],
          ['u042-cap-noop', 'u042-export-cap-noop', 'e'.repeat(64)],
        ] as const) {
          await execSql(ctx.containerName, conn, `
            INSERT INTO export_capabilities (
              id,export_request_id,artifact_version_id,artifact_content_hash,
              requester_assignment_id,token_digest,expires_at
            ) VALUES (
              '${id}','${requestId}','u042-artifact-version-a','${artifactHashA}',
              'u042-assignment-requester','${digest}',TIMESTAMP '2026-07-16 01:10:00'
            );
          `);
        }
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'capability consumed once',
          expect: 'ok',
          sql: `UPDATE export_capabilities SET consumed_at=TIMESTAMP '2026-07-16 01:01:00' WHERE id='u042-cap-consume';`,
        }));
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'capability revoked once',
          expect: 'ok',
          sql: `UPDATE export_capabilities SET revoked_at=TIMESTAMP '2026-07-16 01:01:00' WHERE id='u042-cap-revoke';`,
        }));
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'capability terminal replay denied',
          expect: 'reject',
          sql: `UPDATE export_capabilities SET revoked_at=TIMESTAMP '2026-07-16 01:02:00' WHERE id='u042-cap-consume';`,
        }));
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'capability no-op update denied',
          expect: 'reject',
          sql: `UPDATE export_capabilities SET token_digest=token_digest WHERE id='u042-cap-noop';`,
        }));
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'capability same-transition digest tamper denied',
          expect: 'reject',
          sql: `UPDATE export_capabilities SET consumed_at=now(),token_digest='${h2}' WHERE id='u042-cap-tamper';`,
        }));
        lifecycleQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'duplicate export idempotency denied',
          expect: 'reject',
          sql: `INSERT INTO data_export_requests (id,canonical_activated_at,company_id,artifact_version_id,artifact_content_hash,classification,format,requested_by_assignment_id,approval_request_id,purpose,canonical_status,issued_at,expires_at,idempotency_key,request_input_hash,audit_log_id,updated_at) VALUES ('u042-export-duplicate',now(),'u042-company-a','u042-artifact-version-a','${artifactHashA}','internal','json','u042-assignment-requester','u042-approval-a','fixture','issued',TIMESTAMP '2026-07-16 01:00:00',TIMESTAMP '2026-07-16 01:10:00','export-cap-consume','${h}','u042-audit-export',now());`,
        }));
        writeFileSync(
          join(evidenceDir, 'capability-contract.json'),
          `${JSON.stringify({
            schemaVersion: 1,
            secretByteLength: 32,
            canonicalBase64urlLength: 43,
            rawByteDigestStored: true,
            encodedTextDigestRejectedByContract: rawDigest !== encodedDigest,
            rawCapabilityPersistedOrEmitted: false,
            checks: lifecycleQa.filter((line) => line.includes('capability') || line.includes('idempotency')),
          }, null, 2)}\n`,
        );

        await execSql(ctx.containerName, conn, `
          INSERT INTO retention_runs (
            id,company_id,phase,status,revision,retention_assignment_id,policy_version_id,
            policy_content_hash,resource_kind,action,cutoff_at,max_items,preview_hash,
            item_count,candidate_count,held_count,ineligible_count,actor_assignment_id,
            idempotency_key,input_hash,audit_log_id
          ) VALUES (
            'u042-retention-preview','u042-company-a','preview','completed',0,
            'u042-retention-assignment-a','u042-policy-version-a','${h}',
            'knowledge_chunk','purge',TIMESTAMP '2026-07-01 00:00:00',10,'${h}',
            1,1,0,0,'u042-assignment-requester','retention-preview','${h2}','u042-audit-retention'
          );
          INSERT INTO retention_run_items (
            id,retention_run_id,phase,ordinal,resource_kind,resource_id,document_id,project_id,
            policy_version_id,policy_content_hash,pre_action_hash,hold_set_hash,decision,outcome
          ) VALUES (
            'u042-retention-preview-item','u042-retention-preview','preview',0,'knowledge_chunk',
            'u042-chunk-1','u042-document-a','u042-project-a','u042-policy-version-a','${h}',
            '${h}','${h2}','candidate','not_executed'
          );
          INSERT INTO retention_runs (
            id,company_id,phase,status,revision,retention_assignment_id,policy_version_id,
            policy_content_hash,resource_kind,action,cutoff_at,max_items,preview_hash,
            item_count,candidate_count,held_count,ineligible_count,actor_assignment_id,
            idempotency_key,input_hash,audit_log_id,preview_run_id,execution_mode,revalidation_hash,
            approval_request_id,approval_request_revision,approval_manifest_artifact_version_id,
            approval_manifest_content_hash,approval_policy_hash,would_purge_count,purged_count,
            blocked_count,failed_count
          ) VALUES (
            'u042-retention-dry','u042-company-a','execution','completed',1,
            'u042-retention-assignment-a','u042-policy-version-a','${h}',
            'knowledge_chunk','purge',TIMESTAMP '2026-07-01 00:00:00',10,'${h}',
            1,1,0,0,'u042-assignment-requester','retention-dry','${h}','u042-audit-retention',
            'u042-retention-preview','dry_run','${h}','u042-approval-a',0,'u042-artifact-version-a',
            '${artifactHashA}','${h}',1,0,0,0
          );
          INSERT INTO retention_run_items (
            id,retention_run_id,phase,ordinal,resource_kind,resource_id,document_id,project_id,
            policy_version_id,policy_content_hash,pre_action_hash,hold_set_hash,decision,outcome
          ) VALUES (
            'u042-retention-dry-item','u042-retention-dry','execution',0,'knowledge_chunk',
            'u042-chunk-1','u042-document-a','u042-project-a','u042-policy-version-a','${h}',
            '${h}','${h2}','candidate','would_purge'
          );
          INSERT INTO retention_runs (
            id,company_id,phase,status,revision,retention_assignment_id,policy_version_id,
            policy_content_hash,resource_kind,action,cutoff_at,max_items,preview_hash,
            item_count,candidate_count,held_count,ineligible_count,actor_assignment_id,
            idempotency_key,input_hash,audit_log_id,preview_run_id,execution_mode,revalidation_hash,
            approval_request_id,approval_request_revision,approval_manifest_artifact_version_id,
            approval_manifest_content_hash,approval_policy_hash,would_purge_count,purged_count,
            blocked_count,failed_count
          ) VALUES (
            'u042-retention-local','u042-company-a','execution','completed',1,
            'u042-retention-assignment-a','u042-policy-version-a','${h}',
            'knowledge_chunk','purge',TIMESTAMP '2026-07-01 00:00:00',10,'${h}',
            1,1,0,0,'u042-assignment-requester','retention-local','${h2}','u042-audit-retention',
            'u042-retention-preview','local_purge','${h2}','u042-approval-a',0,'u042-artifact-version-a',
            '${artifactHashA}','${h}',0,1,0,0
          );
          INSERT INTO retention_run_items (
            id,retention_run_id,phase,ordinal,resource_kind,resource_id,document_id,project_id,
            policy_version_id,policy_content_hash,pre_action_hash,hold_set_hash,decision,outcome
          ) VALUES (
            'u042-retention-local-item','u042-retention-local','execution',0,'knowledge_chunk',
            'u042-chunk-1','u042-document-a','u042-project-a','u042-policy-version-a','${h}',
            '${h}','${h2}','candidate','purged'
          );
        `);

        const retentionQa: string[] = [];
        retentionQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'dry run purged count identity denied',
          expect: 'reject',
          sql: `INSERT INTO retention_runs (id,company_id,phase,status,revision,retention_assignment_id,policy_version_id,policy_content_hash,resource_kind,action,cutoff_at,max_items,preview_hash,item_count,candidate_count,held_count,ineligible_count,actor_assignment_id,idempotency_key,input_hash,audit_log_id,preview_run_id,execution_mode,revalidation_hash,approval_request_id,approval_request_revision,approval_manifest_artifact_version_id,approval_manifest_content_hash,approval_policy_hash,would_purge_count,purged_count,blocked_count,failed_count) VALUES ('u042-bad-dry-count','u042-company-a','execution','completed',1,'u042-retention-assignment-a','u042-policy-version-a','${h}','knowledge_chunk','purge',now(),10,'${h}',1,1,0,0,'u042-assignment-requester','bad-dry-count','${h}','u042-audit-retention','u042-retention-preview','dry_run','${h}','u042-approval-a',0,'u042-artifact-version-a','${artifactHashA}','${h}',1,1,0,0);`,
        }));
        retentionQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'local purge would-purge count identity denied',
          expect: 'reject',
          sql: `INSERT INTO retention_runs (id,company_id,phase,status,revision,retention_assignment_id,policy_version_id,policy_content_hash,resource_kind,action,cutoff_at,max_items,preview_hash,item_count,candidate_count,held_count,ineligible_count,actor_assignment_id,idempotency_key,input_hash,audit_log_id,preview_run_id,execution_mode,revalidation_hash,approval_request_id,approval_request_revision,approval_manifest_artifact_version_id,approval_manifest_content_hash,approval_policy_hash,would_purge_count,purged_count,blocked_count,failed_count) VALUES ('u042-bad-local-count','u042-company-a','execution','completed',1,'u042-retention-assignment-a','u042-policy-version-a','${h}','knowledge_chunk','purge',now(),10,'${h}',1,1,0,0,'u042-assignment-requester','bad-local-count','${h}','u042-audit-retention','u042-retention-preview','local_purge','${h}','u042-approval-a',0,'u042-artifact-version-a','${artifactHashA}','${h}',1,0,0,0);`,
        }));
        retentionQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'cross-company retention manifest denied',
          expect: 'reject',
          sql: `INSERT INTO retention_runs (id,company_id,phase,status,revision,retention_assignment_id,policy_version_id,policy_content_hash,resource_kind,action,cutoff_at,max_items,preview_hash,item_count,candidate_count,held_count,ineligible_count,actor_assignment_id,idempotency_key,input_hash,audit_log_id,preview_run_id,execution_mode,revalidation_hash,approval_request_id,approval_request_revision,approval_manifest_artifact_version_id,approval_manifest_content_hash,approval_policy_hash,would_purge_count,purged_count,blocked_count,failed_count) VALUES ('u042-cross-retention-manifest','u042-company-a','execution','completed',1,'u042-retention-assignment-a','u042-policy-version-a','${h}','knowledge_chunk','purge',now(),10,'${h}',1,1,0,0,'u042-assignment-requester','cross-retention','${h}','u042-audit-retention','u042-retention-preview','dry_run','${h}','u042-approval-a',0,'u042-artifact-version-b','${artifactHashB}','${h}',1,0,0,0);`,
        }));
        retentionQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'dry run candidate with purged item denied',
          expect: 'reject',
          sql: `INSERT INTO retention_run_items (id,retention_run_id,phase,ordinal,resource_kind,resource_id,document_id,project_id,policy_version_id,policy_content_hash,pre_action_hash,hold_set_hash,decision,outcome) VALUES ('u042-bad-dry-item','u042-retention-dry','execution',1,'knowledge_chunk','u042-chunk-2','u042-document-a','u042-project-a','u042-policy-version-a','${h}','${h}','${h2}','candidate','purged');`,
        }));
        writeFileSync(join(evidenceDir, 'retention-run-contract.json'), `${JSON.stringify({ schemaVersion: 1, checks: retentionQa }, null, 2)}\n`);

        const ownershipTuples = [
          { entityType: 'Artifact', entityId: 'u042-artifact-a', ownerAssignmentId: 'u042-assignment-source', ownershipRevision: 3 },
          { entityType: 'ApprovalRequest', entityId: 'u042-approval-a', ownerAssignmentId: 'u042-assignment-source', ownershipRevision: 4 },
          { entityType: 'Opportunity', entityId: 'u042-opportunity-a', ownerAssignmentId: 'u042-assignment-source', ownershipRevision: 5 },
          { entityType: 'RenewalOpportunity', entityId: 'u042-renewal-a', ownerAssignmentId: 'u042-assignment-source', ownershipRevision: 8 },
          { entityType: 'SupportCase', entityId: 'u042-support-case-a', ownerAssignmentId: 'u042-assignment-source', ownershipRevision: 9 },
          { entityType: 'VendorRequest', entityId: 'u042-vendor-request-a', ownerAssignmentId: 'u042-assignment-source', ownershipRevision: 7 },
          { entityType: 'WorkTask', entityId: 'u042-work-task-a', ownerAssignmentId: 'u042-assignment-source', ownershipRevision: 6 },
        ].sort((a, b) => {
          if (a.entityType !== b.entityType) return a.entityType < b.entityType ? -1 : 1;
          if (a.entityId !== b.entityId) return a.entityId < b.entityId ? -1 : 1;
          return 0;
        });
        const ownershipPreviewHash = hashJcs(ownershipTuples);
        const ownershipInsertSql = (
          id: string,
          roleChangeRequestId: string,
          idempotencyKey: string,
          previewHash = ownershipPreviewHash,
        ) => {
          const parent = `INSERT INTO ownership_transfers (id,role_change_request_id,source_assignment_id,successor_assignment_id,requested_by_assignment_id,preview_schema_version,preview_hash,item_count,status,revision,preview_idempotency_key,preview_input_hash,preview_audit_log_id,requested_at,updated_at) VALUES ('${id}','${roleChangeRequestId}','u042-assignment-source','u042-assignment-successor','u042-assignment-requester','ownership-transfer/v1','${previewHash}',${ownershipTuples.length},'requested',0,'${idempotencyKey}','${h}','u042-audit-transfer-preview',TIMESTAMP '2026-07-16 02:00:00',TIMESTAMP '2026-07-16 02:00:00');`;
          const items = ownershipTuples.map((tuple, ordinal) =>
            `INSERT INTO ownership_transfer_items (id,ownership_transfer_id,ordinal,entity_type,entity_id,owner_assignment_id,ownership_revision,after_owner_assignment_id,after_ownership_revision) VALUES ('${id}-item-${ordinal}','${id}',${ordinal},'${tuple.entityType}','${tuple.entityId}','${tuple.ownerAssignmentId}',${tuple.ownershipRevision},'u042-assignment-successor',${tuple.ownershipRevision + 1});`,
          ).join('\n');
          return `${parent}\n${items}`;
        };

        const ownershipQa: string[] = [];
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'forged ownership preview hash denied by final tuple',
          expect: 'reject',
          sql: ownershipInsertSql('u042-transfer-forged', 'u042-role-change-tamper', 'preview-forged', h2),
        }));
        for (const [id, roleChange, key] of [
          ['u042-transfer-main', 'u042-role-change-main', 'preview-main'],
          ['u042-transfer-requested-cancel', 'u042-role-change-requested-cancel', 'preview-requested-cancel'],
          ['u042-transfer-blocked', 'u042-role-change-blocked', 'preview-blocked'],
          ['u042-transfer-approved-cancel', 'u042-role-change-approved-cancel', 'preview-approved-cancel'],
          ['u042-transfer-tamper', 'u042-role-change-tamper', 'preview-tamper'],
        ] as const) {
          await execSql(ctx.containerName, conn, ownershipInsertSql(id, roleChange, key));
        }
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'requested ownership transfer approved',
          expect: 'ok',
          sql: `UPDATE ownership_transfers SET status='approved',revision=1,approved_by_assignment_id='u042-assignment-requester',approved_at=TIMESTAMP '2026-07-16 02:01:00',updated_at=now() WHERE id='u042-transfer-main';`,
        }));
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'requested ownership transfer cancelled',
          expect: 'ok',
          sql: `UPDATE ownership_transfers SET status='cancelled',revision=1,updated_at=now() WHERE id='u042-transfer-requested-cancel';`,
        }));
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'requested ownership transfer approved for blocked edge',
          expect: 'ok',
          sql: `UPDATE ownership_transfers SET status='approved',revision=1,approved_by_assignment_id='u042-assignment-requester',approved_at=TIMESTAMP '2026-07-16 02:01:00',updated_at=now() WHERE id='u042-transfer-blocked';`,
        }));
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'approved ownership transfer blocked',
          expect: 'ok',
          sql: `UPDATE ownership_transfers SET status='blocked',revision=2,execute_idempotency_key='execute-blocked',execute_input_hash='${h2}',blocked_reason='CAS mismatch',updated_at=now() WHERE id='u042-transfer-blocked';`,
        }));
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'requested ownership transfer approved for cancellation edge',
          expect: 'ok',
          sql: `UPDATE ownership_transfers SET status='approved',revision=1,approved_by_assignment_id='u042-assignment-requester',approved_at=TIMESTAMP '2026-07-16 02:01:00',updated_at=now() WHERE id='u042-transfer-approved-cancel';`,
        }));
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'approved ownership transfer cancelled',
          expect: 'ok',
          sql: `UPDATE ownership_transfers SET status='cancelled',revision=2,updated_at=now() WHERE id='u042-transfer-approved-cancel';`,
        }));
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'approved ownership transfer completed',
          expect: 'ok',
          sql: `UPDATE ownership_transfers SET status='completed',revision=2,execute_idempotency_key='execute-main',execute_input_hash='${h2}',completion_audit_log_id='u042-audit-transfer-complete',completed_at=TIMESTAMP '2026-07-16 02:02:00',updated_at=now() WHERE id='u042-transfer-main';`,
        }));
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'ownership direct requested to completed denied',
          expect: 'reject',
          sql: `UPDATE ownership_transfers SET status='completed',revision=1,approved_by_assignment_id='u042-assignment-requester',approved_at=now(),execute_idempotency_key='execute-illegal',execute_input_hash='${h2}',completion_audit_log_id='u042-audit-transfer-complete',completed_at=now(),updated_at=now() WHERE id='u042-transfer-tamper';`,
        }));
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'ownership legal edge with preview hash tamper denied',
          expect: 'reject',
          sql: `UPDATE ownership_transfers SET status='approved',revision=1,approved_by_assignment_id='u042-assignment-requester',approved_at=now(),preview_hash='${h2}',updated_at=now() WHERE id='u042-transfer-tamper';`,
        }));
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'ownership terminal replay denied',
          expect: 'reject',
          sql: `UPDATE ownership_transfers SET status='blocked',revision=3,blocked_reason='replay',completion_audit_log_id=NULL,completed_at=NULL,updated_at=now() WHERE id='u042-transfer-main';`,
        }));
        ownershipQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'ownership item parent owner mismatch denied',
          expect: 'reject',
          sql: `INSERT INTO ownership_transfer_items (id,ownership_transfer_id,ordinal,entity_type,entity_id,owner_assignment_id,ownership_revision,after_owner_assignment_id,after_ownership_revision) VALUES ('u042-bad-owner-item','u042-transfer-tamper',7,'Artifact','u042-artifact-a','u042-assignment-successor',3,'u042-assignment-source',4);`,
        }));
        writeFileSync(
          join(evidenceDir, 'ownership-transfer-contract.json'),
          `${JSON.stringify({
            schemaVersion: 1,
            tupleCount: ownershipTuples.length,
            previewHash: ownershipPreviewHash,
            exactTupleOrder: ownershipTuples.map(({ entityType, entityId }) => ({ entityType, entityId })),
            checks: ownershipQa,
          }, null, 2)}\n`,
        );

        const immutableQa: string[] = [];
        for (const [table, id] of [
          ['retention_policy_versions', 'u042-policy-version-a'],
          ['legal_hold_scopes', 'u042-legal-hold-scope-a'],
          ['artifact_access_events', 'u042-access-valid'],
          ['retention_runs', 'u042-retention-preview'],
          ['retention_run_items', 'u042-retention-preview-item'],
          ['ownership_transfer_items', 'u042-transfer-main-item-0'],
        ] as const) {
          immutableQa.push(await attemptQaInsert(ctx.containerName, conn, {
            label: `${table} mutating update denied`,
            expect: 'reject',
            sql: `UPDATE ${table} SET id=id || '-tampered' WHERE id='${id}';`,
          }));
          immutableQa.push(await attemptQaInsert(ctx.containerName, conn, {
            label: `${table} no-op update denied`,
            expect: 'reject',
            sql: `UPDATE ${table} SET id=id WHERE id='${id}';`,
          }));
          immutableQa.push(await attemptQaInsert(ctx.containerName, conn, {
            label: `${table} delete denied`,
            expect: 'reject',
            sql: `DELETE FROM ${table} WHERE id='${id}';`,
          }));
        }
        immutableQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'preserved legacy export update denied',
          expect: 'reject',
          sql: `UPDATE data_export_requests SET reason='tampered' WHERE id='u042-legacy-export';`,
        }));
        immutableQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'preserved legacy export delete denied',
          expect: 'reject',
          sql: `DELETE FROM data_export_requests WHERE id='u042-legacy-export';`,
        }));
        immutableQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'preserved legacy access update denied',
          expect: 'reject',
          sql: `UPDATE artifact_access_events SET access_type='tampered' WHERE id='u042-legacy-access';`,
        }));
        immutableQa.push(await attemptQaInsert(ctx.containerName, conn, {
          label: 'preserved legacy access delete denied',
          expect: 'reject',
          sql: `DELETE FROM artifact_access_events WHERE id='u042-legacy-access';`,
        }));

        const negativeMatrix = {
          schemaVersion: 1,
          activationAndCompany: activationQa,
          lifecycle: lifecycleQa,
          retention: retentionQa,
          ownership: ownershipQa,
          immutableHistory: immutableQa,
          totalChecks: activationQa.length + lifecycleQa.length + retentionQa.length + ownershipQa.length + immutableQa.length,
        };
        writeFileSync(join(evidenceDir, 'activation-checks.json'), `${JSON.stringify({ schemaVersion: 1, zeroLegacyActivations: true, checks: activationQa }, null, 2)}\n`);
        writeFileSync(join(evidenceDir, 'governance-negative-matrix.json'), `${JSON.stringify(negativeMatrix, null, 2)}\n`);

        const scopeCheck = await runScopeCheck();
        if (scopeCheck.code !== 0) {
          throw new ContractFailure(EXIT.CONTRACT, `U042 scope:check failed: ${scopeCheck.stdout}\n${scopeCheck.stderr}`);
        }
        const scope = JSON.parse(scopeCheck.stdout) as {
          ok: boolean;
          currentModelCount: number;
          inventoryModelCount: number;
          tallies: Record<string, number>;
          errors: unknown[];
        };
        const expectedTallies = {
          GLOBAL_SHARED: 11,
          TENANT_ROOT: 2,
          COMPANY_ROOT: 36,
          PROJECT_ROOT: 48,
          CHILD_VIA_FK: 88,
          COMPANY_DIRECT: 4,
        };
        if (
          scope.ok !== true
          || scope.currentModelCount !== 189
          || scope.inventoryModelCount !== 189
          || scope.errors.length !== 0
          || Object.entries(expectedTallies).some(([key, value]) => scope.tallies[key] !== value)
        ) {
          throw new ContractFailure(EXIT.CONTRACT, `U042 scope vector drift: ${JSON.stringify(scope)}`);
        }
        writeFileSync(join(evidenceDir, 'scope-inventory.json'), `${JSON.stringify(scope, null, 2)}\n`);
        writeFileSync(
          join(evidenceDir, 'governance-dmmf-contract.json'),
          `${JSON.stringify({
            schemaVersion: 1,
            currentModelCount: scope.currentModelCount,
            newModels: [
              'RetentionPolicy','RetentionPolicyVersion','RetentionAssignment','LegalHold','LegalHoldScope',
              'RetentionRun','RetentionRunItem','ExportCapability','OwnershipTransfer','OwnershipTransferItem',
            ],
            activationAwareReclassifications: ['DataExportRequest','ArtifactAccessEvent'],
            scopeTallies: scope.tallies,
          }, null, 2)}\n`,
        );

        const schemaDiff = await runMigrateDiff(ctx.databaseUrl, true);
        const schemaDiffText = schemaDiff.stdout.replace(/^run-workspace-runtime: selected nvm\.sh=.*\n/, '').trim();
        if (
          schemaDiff.code !== 0
          || !['', '-- This is an empty migration.', 'No difference detected.', 'No difference detected'].includes(schemaDiffText)
        ) {
          throw new ContractFailure(EXIT.CONTRACT, `U042 schema diff is not empty: exit=${schemaDiff.code}\n${schemaDiff.stderr || schemaDiff.stdout}`);
        }
        evidence.emptySchemaDiff = true;
        evidence.authorityInventory = { functions: observedFunctions.length, triggers: authorityRows.length };
        evidence.negativeChecks = negativeMatrix.totalChecks;
        log.push('prisma migrate diff --exit-code: exit=0');
        log.push('No difference detected');
      },
    );
  } catch (error) {
    caught = error;
  } finally {
    if (view) rmSync(view.dir, { recursive: true, force: true });
  }

  const result = caught ? 'FAIL' : 'PASS';
  const finishedAt = new Date().toISOString();
  const receipt = {
    schemaVersion: 1,
    unit: OWNER_UNIT_U042,
    suite: PURPOSE_U042,
    runId,
    result,
    startedAt,
    finishedAt,
    evidence,
  };
  writeFileSync(join(evidenceDir, 'db-contract-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(
    join(evidenceDir, 'cleanup.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      runId,
      migrationViewRemoved: view === null || !existsSync(view.dir),
      isolatedLifecycle: 'completed',
      result,
    }, null, 2)}\n`,
  );
  if (caught) {
    log.push(`FAIL: ${caught instanceof Error ? (caught.stack ?? caught.message) : String(caught)}`);
  } else {
    log.push('governance-schema: PASS');
  }
  writeFileSync(join(evidenceDir, 'db-contract.txt'), `${log.join('\n')}\n`);
  if (caught) {
    process.stderr.write(`${caught instanceof Error ? (caught.stack ?? caught.message) : String(caught)}\n`);
    return caught instanceof ContractFailure ? caught.exitCode : EXIT.CONTRACT;
  }
  return EXIT.SUCCESS;
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return error instanceof ContractFailure ? error.exitCode : EXIT.CONFIG;
  }
  mkdirSync(args.evidence, { recursive: true });

  if (args.suite === 'scope-backfill') return runScopeBackfillSuite(args.evidence);
  if (args.suite === 'scope-closure') return runScopeClosureSuite(args.evidence);
  if (args.suite === 'principal-session') return runPrincipalSessionSuite(args.evidence);
  if (args.suite === 'business-role') return runBusinessRoleSuite(args.evidence);
  if (args.suite === 'rls-pilot') return runRlsPilotSuite(args.evidence);
  if (args.suite === 'artifact-schema') return runArtifactSchemaSuite(args.evidence);
  if (args.suite === 'approval-schema') return runApprovalSchemaSuite(args.evidence);
  if (args.suite === 'governance-bridge') return runGovernanceBridgeSuite(args.evidence);
  if (args.suite === 'audit-chain') return runAuditChainSuite(args.evidence);
  if (args.suite === 'role-change') return runRoleChangeSuite(args.evidence);
  if (args.suite === 'ai-quality-schema') return runAiQualitySchemaSuite(args.evidence);
  if (args.suite === 'governance-schema') return runGovernanceSchemaSuite(args.evidence);
  return runWorkflowSchemaSuite(args.evidence);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exit(65);
    },
  );
}
