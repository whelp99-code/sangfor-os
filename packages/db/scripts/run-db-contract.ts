import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const ALLOWED_SUITES = new Set(['scope-backfill']);

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
  }
  return dir;
}

function addNewMigrationTo(tmpPrismaDir: string) {
  cpSync(join(REAL_PRISMA_DIR, 'migrations', NEW_MIGRATION_NAME), join(tmpPrismaDir, 'migrations', NEW_MIGRATION_NAME), { recursive: true });
}

async function runWorkspaceGenerate(schemaPath: string): Promise<CaptureResult> {
  const argv = ['bash', join(REPO_ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'prisma', 'generate', '--schema', schemaPath];
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

async function labelResourceCounts(runId: string) {
  const filters = [`label=${LABEL_RUN}=${runId}`, `label=${LABEL_UNIT}=${OWNER_UNIT}`, `label=${LABEL_PURPOSE}=${PURPOSE}`];
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
      if (scopeCheckJson.currentModelCount !== 151 || scopeCheckJson.ok !== true) {
        throw new ContractFailure(EXIT.CONTRACT, `scope:check did not report ok=true currentModelCount=151: ${scopeCheck.stdout}`);
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
  await withIsolatedPostgres(
    { runId, ownerUnit: OWNER_UNIT, purpose: `${PURPOSE}-empty`, evidenceDir: join(evidenceDir, 'empty-scenario'), imageDigest: IMAGE_DIGEST, migrate: true },
    async (ctx: any) => {
      const conn = parseConn(ctx.databaseUrl);
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

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return error instanceof ContractFailure ? error.exitCode : EXIT.CONFIG;
  }
  mkdirSync(args.evidence, { recursive: true });
  const runId = `u011${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  let caughtError: unknown = null;
  let fixtureEvidence: Record<string, unknown> | null = null;
  let emptyEvidence: Record<string, unknown> | null = null;
  try {
    fixtureEvidence = await runFixtureScenario(args.evidence, runId);
    emptyEvidence = await runEmptyDatabaseScenario(args.evidence, runId);
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
  writeFileSync(join(args.evidence, 'cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`run-db-contract: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError instanceof ContractFailure ? caughtError.exitCode : EXIT.CONTRACT;
  }

  writeFileSync(
    join(args.evidence, 'db-contract-receipt.json'),
    `${JSON.stringify({ schemaVersion: 1, unit: OWNER_UNIT, suite: args.suite, result: 'PASS', fixtureEvidence, emptyEvidence, cleanup, startedAt, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return EXIT.SUCCESS;
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
