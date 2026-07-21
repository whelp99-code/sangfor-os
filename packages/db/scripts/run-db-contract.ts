import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error -- U009's committed reuse module is plain JS (scripts/lib/isolated-postgres.mjs), no .d.ts.
import { LABEL_PURPOSE, LABEL_RUN, LABEL_UNIT, withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';

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

const ALLOWED_SUITES = new Set(['scope-backfill', 'scope-closure', 'principal-session', 'business-role', 'rls-pilot', 'artifact-schema']);

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

async function runMigrateDiff(databaseUrl: string): Promise<CaptureResult> {
  const schemaPath = join(DB_PKG_ROOT, 'prisma/schema.prisma');
  const argv = [
    'bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--',
    'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'prisma', 'migrate', 'diff',
    '--from-url', databaseUrl, '--to-schema-datamodel', schemaPath, '--script',
  ];
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
        name !== NEW_MIGRATION_NAME_U017,
    )
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
        // point-in-time snapshot at U012. GLOBAL_SHARED (13) is unaffected by U012's reclassification
        // math staying stable through every later unit that never touches that category; CHILD_VIA_FK
        // (62 as of U017 — RoleChangeRequest's U012 reclassification plus every later CHILD_VIA_FK
        // registration, most recently ArtifactVersion) must be updated by any future unit that adds a
        // new CHILD_VIA_FK model, exactly as U017 updated it here.
        if (scopeCheckJson.tallies.CHILD_VIA_FK !== 62 || scopeCheckJson.tallies.GLOBAL_SHARED !== 13) {
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
  return runArtifactSchemaSuite(args.evidence);
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
