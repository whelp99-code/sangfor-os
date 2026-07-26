#!/usr/bin/env node
/** U040 isolated fresh+upgrade proof. All emitted receipts are credential-redacted. */
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { withIsolatedPostgres, withIsolatedPostgresPair, assertSafeLocalDocker } from '../../../scripts/lib/isolated-postgres.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const DB = resolve(HERE, '..');
const PRISMA = join(DB, 'prisma');
const U032 = '20260716003200_u032_crm_scope_archive_owner_expand';
const U040 = '20260716004000_u040_domain_backfill_validate_tighten';
const LATEST_MIGRATION = readdirSync(join(PRISMA, 'migrations')).filter((name) => /^\d/.test(name)).sort().at(-1);
const DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const TOMBSTONE = 'DIRECT_RESTORE_QUARANTINED_USE_U009';
function die(message) { const error = new Error(message); error.exitCode = 64; throw error; }
function args() { const a = process.argv.slice(2); const i = a.indexOf('--evidence-dir'); if (i < 0 || !a[i + 1] || !resolve(a[i + 1]).startsWith('/')) die('usage: verify-domain-migrations.mjs --evidence-dir <absolute-path> [--failure-scenario <kind>|--skip-failure-injection]'); const failureScenario = a.includes('--failure-scenario') ? a[a.indexOf('--failure-scenario') + 1] : null; if (failureScenario && !['ambiguous_owner_mapping','key_collision','renewal_asset_orphan'].includes(failureScenario)) die('unknown failure scenario'); return { evidenceDir: resolve(a[i + 1]), failureScenario, skipFailureInjection: a.includes('--skip-failure-injection') }; }
function env(extra = {}) { const out = {}; for (const key of ['PATH','HOME','LANG','LC_ALL','TERM','NVM_DIR','COREPACK_HOME','PNPM_HOME','TMPDIR']) if (process.env[key]) out[key] = process.env[key]; return { ...out, ...extra }; }
function run(argv, options = {}) { return new Promise((ok, bad) => { const child = spawn(argv[0], argv.slice(1), { cwd: options.cwd ?? ROOT, env: env(options.env), stdio: ['pipe','pipe','pipe'] }); let stdout=''; let stderr=''; child.stdout.on('data', x => stdout += x); child.stderr.on('data', x => stderr += x); if (options.input) child.stdin.write(options.input); child.stdin.end(); child.on('error', bad); child.on('close', code => ok({ code: code ?? 1, stdout, stderr })); }); }
function redact(text) { return String(text).replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '<redacted-database-url>').replace(/password=[^\s]+/gi, 'password=<redacted>'); }
function write(dir, name, value) { writeFileSync(join(dir, name), typeof value === 'string' ? redact(value) : `${JSON.stringify(value, null, 2)}\n`); }
function manifestReceipt() {
  const manifest = JSON.parse(readFileSync(join(DB, 'package.json'), 'utf8'));
  const tombstone = readFileSync(join(DB, 'scripts/cfo-restore.ts'), 'utf8');
  const contained = tombstone.includes(TOMBSTONE) && !/^\s*import/m.test(tombstone) && !/process\.(?:env|argv)|\b(?:spawn|exec|PrismaClient)\b/.test(tombstone);
  if (Object.hasOwn(manifest.scripts, 'db:push') || Object.hasOwn(manifest.scripts, 'db:push:safe')) die('unsafe db:push manifest key present');
  if (manifest.scripts['cfo:restore'] !== 'tsx scripts/cfo-restore.ts' || !contained) die('cfo:restore is neither absent nor a U002 contained tombstone');
  const u040 = ['backfill:domain-foundation','check:domain-integrity','verify:domain-migrations'];
  if (u040.some((key) => !Object.hasOwn(manifest.scripts, key))) die('U040 manifest additions missing');
  return { schemaVersion: 1, manifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), dbPush: 'absent', dbPushSafe: 'absent', cfoRestore: { value: manifest.scripts['cfo:restore'], containment: 'U002 tombstone', code: TOMBSTONE }, u040Additions: u040 };
}
function copyPrefix(label, includeThrough) { const target = mkdtempSync(join(tmpdir(), `u040-${label}-`)); cpSync(PRISMA, target, { recursive: true }); for (const name of readdirSync(join(target, 'migrations'))) if (name >= includeThrough) rmSync(join(target, 'migrations', name), { recursive: true, force: true }); return target; }
function addRange(target, from, through) { for (const name of readdirSync(join(PRISMA, 'migrations')).sort()) if (name >= from && name <= through) cpSync(join(PRISMA, 'migrations', name), join(target, 'migrations', name), { recursive: true }); }
async function prismaCommand(databaseUrl, schema, argv) { return run(['bash', join(ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'prisma', ...argv, '--schema', schema], { env: { DATABASE_URL: databaseUrl } }); }
async function backfill(databaseUrl, mode, receipt) { return run(['bash', join(ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'tsx', 'scripts/backfill-domain-foundation.ts', '--mode', mode, '--receipt', receipt], { env: { DATABASE_URL: databaseUrl } }); }
async function loadFixture(target, fixture) { const u = new URL(target.databaseUrl); const sql = readFileSync(fixture, 'utf8'); return run(['docker','exec','-i','-e',`PGPASSWORD=${decodeURIComponent(u.password)}`,target.containerName,'psql','-h','127.0.0.1','-U',decodeURIComponent(u.username),'-d',u.pathname.slice(1),'-v','ON_ERROR_STOP=1'], { input: sql }); }
async function loadSql(target, sql) { const u = new URL(target.databaseUrl); return run(['docker','exec','-i','-e',`PGPASSWORD=${decodeURIComponent(u.password)}`,target.containerName,'psql','-h','127.0.0.1','-U',decodeURIComponent(u.username),'-d',u.pathname.slice(1),'-v','ON_ERROR_STOP=1'], { input: sql }); }
async function scalar(target, sql) { const u = new URL(target.databaseUrl); const result = await run(['docker','exec','-i','-e',`PGPASSWORD=${decodeURIComponent(u.password)}`,target.containerName,'psql','-h','127.0.0.1','-U',decodeURIComponent(u.username),'-d',u.pathname.slice(1),'-tAc',sql]); await ensureSuccess(result, 'isolated scalar'); return result.stdout.trim(); }
async function ensureSuccess(result, label) { if (result.code !== 0) throw new Error(`${label} failed: ${redact(result.stderr || result.stdout)}`); }
function failureFixture(kind) {
  const base = readFileSync(join(DB, 'test-fixtures/domain-legacy-fixture.sql'), 'utf8');
  if (kind === 'ambiguous_owner_mapping') return `${base}\nINSERT INTO users (id,email,name,updated_at) VALUES ('u040_failure_user','u040-failure@example.invalid','Synthetic owner',CURRENT_TIMESTAMP);\nINSERT INTO user_company_roles (id,user_id,company_id,role,status,revision) VALUES ('u040_failure_role_a','u040_failure_user','u040_company','account_manager','active',0),('u040_failure_role_b','u040_failure_user','u040_company','sales_manager','active',0);\nINSERT INTO opportunities (id,project_id,title,owner_id,updated_at) VALUES ('u040_failure_opportunity','u040_project','Synthetic ambiguous owner','u040_failure_user',CURRENT_TIMESTAMP);\n`;
  if (kind === 'key_collision') return `${base}\nINSERT INTO product_families (id,vendor,name) VALUES ('u040_collision_a','Synthetic Vendor','Collision Family'),('u040_collision_b','Synthetic Vendor','Collision Family');\n`;
  if (kind === 'renewal_asset_orphan') return `${base}\nINSERT INTO customers (id,project_id,name,updated_at) VALUES ('u040_failure_customer','u040_project','Synthetic customer',CURRENT_TIMESTAMP);\nINSERT INTO renewal_opportunities (id,customer_id,asset_id,renewal_type,updated_at) VALUES ('u040_failure_renewal','u040_failure_customer','u040_missing_asset','synthetic',CURRENT_TIMESTAMP);\n`;
  die(`unknown failure fixture ${kind}`);
}
async function runFailureScenario({ kind, evidenceDir }) {
  const scenarioDir = join(evidenceDir, 'failure-injection', kind); rmSync(scenarioDir, { recursive: true, force: true }); mkdirSync(scenarioDir, { recursive: true });
  const runId = `u040_${kind}_${randomUUID().slice(0, 8)}`;
  let result;
  try { result = await withIsolatedPostgres({ runId, ownerUnit: 'U040', purpose: `U040-domain-failure-${kind}`, evidenceDir: scenarioDir, imageDigest: DIGEST }, async (target) => {
    const prefix = copyPrefix(`failure-${kind}`, U032);
    try {
      const before = await prismaCommand(target.databaseUrl, join(prefix, 'schema.prisma'), ['migrate','deploy']); await ensureSuccess(before, `${kind} pre-U032 deploy`);
      const fixture = await loadSql(target, failureFixture(kind)); await ensureSuccess(fixture, `${kind} pre-U032 failure fixture`);
      addRange(prefix, U032, '20260716003900_u039_support_sla_rca_expand'); const expanded = await prismaCommand(target.databaseUrl, join(prefix, 'schema.prisma'), ['migrate','deploy']); await ensureSuccess(expanded, `${kind} U032-U039 deploy`);
      const receiptPath = join(scenarioDir, 'backfill-blocking.json'); const blocked = await backfill(target.databaseUrl, 'apply', receiptPath);
      if (blocked.code === 0) throw new Error(`${kind} expected a non-zero blocking backfill receipt`);
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      let migrationCode = null; let fkValidated = null; let sourceAssetPreserved = null;
      if (kind === 'key_collision' || kind === 'renewal_asset_orphan') {
        addRange(prefix, U040, U040); const migration = await prismaCommand(target.databaseUrl, join(prefix, 'schema.prisma'), ['migrate','deploy']); migrationCode = migration.code;
        if (migration.code === 0) throw new Error(`${kind} expected U040 validation/tightening to block`);
      }
      if (kind === 'renewal_asset_orphan') {
        fkValidated = await scalar(target, "SELECT convalidated::text FROM pg_constraint WHERE conname='renewal_opportunities_asset_id_fkey'");
        sourceAssetPreserved = await scalar(target, "SELECT count(*) FROM renewal_opportunities WHERE id='u040_failure_renewal' AND asset_id='u040_missing_asset'");
        if (fkValidated !== 'false' || sourceAssetPreserved !== '1') { write(scenarioDir, 'orphan-diagnostic.json', { fkValidated, sourceAssetPreserved }); throw new Error('orphan fixture incorrectly validated FK or rewrote source asset id'); }
      }
      const report = { schemaVersion: 1, kind, phaseOrder: ['pre-U032','failure-fixture-before-U032','U032-U039','backfill-nonzero', ...(kind === 'ambiguous_owner_mapping' ? [] : ['U040-blocked'])], backfillExitCode: blocked.code, quarantined: receipt.quarantined, renewal_asset_orphan: receipt.renewal_asset_orphan, migrationExitCode: migrationCode, renewalFkConvalidated: fkValidated, sourceAssetPreserved: sourceAssetPreserved === '1' ? true : sourceAssetPreserved, redacted: true };
      write(scenarioDir, 'failure-receipt.json', report); return report;
    } finally { rmSync(prefix, { recursive: true, force: true }); }
  }); } catch (error) { write(scenarioDir, 'failure-error.json', { kind, message: redact(error instanceof Error ? error.message : String(error)) }); throw error; }
  const cleanup = JSON.parse(readFileSync(join(scenarioDir, 'postgres-cleanup.json'), 'utf8'));
  write(scenarioDir, 'cleanup.json', { lifecycle: 'withIsolatedPostgres finally', status: cleanup.status, cleaned: cleanup.status === 'PASS' });
  return result;
}
function updateFailureSummary(evidenceDir, item) {
  const path = join(evidenceDir, 'failure-injection.json');
  let prior = [];
  if (existsSync(path)) { try { const parsed = JSON.parse(readFileSync(path, 'utf8')); if (Array.isArray(parsed)) prior = parsed; } catch {} }
  write(evidenceDir, 'failure-injection.json', [...prior.filter((entry) => entry.kind !== item.kind), item].sort((a, b) => a.kind.localeCompare(b.kind)));
}
async function main() {
  const { evidenceDir, failureScenario, skipFailureInjection } = args(); mkdirSync(evidenceDir, { recursive: true });
  if (process.env.DATABASE_URL) die('caller DATABASE_URL is forbidden');
  await assertSafeLocalDocker({});
  write(evidenceDir, 'db-manifest-serialization.json', { authorizedDeviation: 'U031 sealed U002 tombstone accepted by owner', ...manifestReceipt() });
  if (failureScenario) { updateFailureSummary(evidenceDir, await runFailureScenario({ kind: failureScenario, evidenceDir })); return; }
  const runId = `u040_${randomUUID().slice(0, 12)}`;
  const outcome = await withIsolatedPostgresPair({ runId, ownerUnit: 'U040', purpose: 'U040-domain-migration', evidenceDir, imageDigest: DIGEST }, async ({ primary, secondary }) => {
    const fresh = await prismaCommand(primary.databaseUrl, join(PRISMA, 'schema.prisma'), ['migrate','deploy']); await ensureSuccess(fresh, 'fresh migrate'); write(evidenceDir, 'fresh-migrate.log', fresh.stdout + fresh.stderr);
    const prefix = copyPrefix('prefix', U032); try {
      const before = await prismaCommand(secondary.databaseUrl, join(prefix, 'schema.prisma'), ['migrate','deploy']); await ensureSuccess(before, 'pre-U032 deploy');
      const fixture = await loadFixture(secondary, join(DB, 'test-fixtures/domain-legacy-fixture.sql')); await ensureSuccess(fixture, 'pre-U032 fixture');
      addRange(prefix, U032, '20260716003900_u039_support_sla_rca_expand'); const expanded = await prismaCommand(secondary.databaseUrl, join(prefix, 'schema.prisma'), ['migrate','deploy']); await ensureSuccess(expanded, 'U032-U039 deploy'); write(evidenceDir, 'upgrade-prefix.log', before.stdout + expanded.stdout);
      const dry = await backfill(secondary.databaseUrl, 'dry-run', join(evidenceDir, 'backfill-dry-run.json')); await ensureSuccess(dry, 'backfill dry-run');
      const first = await backfill(secondary.databaseUrl, 'apply', join(evidenceDir, 'backfill-first.json')); await ensureSuccess(first, 'backfill apply');
      addRange(prefix, U040, U040); const finalDeploy = await prismaCommand(secondary.databaseUrl, join(prefix, 'schema.prisma'), ['migrate','deploy']); await ensureSuccess(finalDeploy, 'U040 deploy'); write(evidenceDir, 'migration-deploy.log', finalDeploy.stdout + finalDeploy.stderr);
      const integrity = await run(['bash', join(ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack','pnpm','--filter','@sangfor/db','exec','tsx','scripts/check-domain-integrity.ts'], { env: { DATABASE_URL: secondary.databaseUrl } }); write(evidenceDir, 'integrity.json', integrity.stdout); write(evidenceDir, 'integrity.stderr.log', integrity.stderr); await ensureSuccess(integrity, 'integrity');
      const second = await backfill(secondary.databaseUrl, 'apply', join(evidenceDir, 'backfill-second.json')); await ensureSuccess(second, 'second backfill');
      const parsed = JSON.parse(readFileSync(join(evidenceDir, 'backfill-second.json'), 'utf8')); if (parsed.applied !== 0) throw new Error('second backfill changed rows');
      if (!LATEST_MIGRATION) throw new Error('no formal migrations found');
      addRange(prefix, '20260716004100_u041_ai_quality_artifact_expand', LATEST_MIGRATION); const continuation = await prismaCommand(secondary.databaseUrl, join(prefix, 'schema.prisma'), ['migrate','deploy']); await ensureSuccess(continuation, 'post-U040 deploy'); write(evidenceDir, 'post-u040-migration-deploy.log', continuation.stdout + continuation.stderr);
      const diff = await run(['bash', join(ROOT, 'scripts/run-workspace-runtime.sh'), 'root', '--', 'corepack', 'pnpm', '--filter', '@sangfor/db', 'exec', 'prisma', 'migrate', 'diff', '--exit-code', '--from-url', secondary.databaseUrl, '--to-schema-datamodel', join(PRISMA, 'schema.prisma')], { env: { DATABASE_URL: secondary.databaseUrl } }); write(evidenceDir, 'empty-diff.log', diff.stdout + diff.stderr); if (diff.code !== 0) throw new Error(`empty migrate diff failed: ${redact(diff.stderr || diff.stdout)}`);
      return { phaseOrder: ['fresh','pre-U032','fixture-before-U032','U032-U039','dry-run','apply','U040','integrity','second-zero','post-U040','empty-diff'], failureInjection: { ambiguous_owner_mapping: 'blocked receipt contract', key_collision: 'blocked receipt contract', renewal_asset_orphan: 'blocked before FK validate' } };
    } finally { rmSync(prefix, { recursive: true, force: true }); }
  });
  if (!skipFailureInjection) for (const kind of ['ambiguous_owner_mapping', 'key_collision', 'renewal_asset_orphan']) updateFailureSummary(evidenceDir, await runFailureScenario({ kind, evidenceDir }));
  write(evidenceDir, 'cleanup.json', { lifecycle: 'withIsolatedPostgresPair finally', result: 'cleaned by U009 lifecycle' }); write(evidenceDir, 'phase-order.json', outcome.phaseOrder);
}
main().catch(error => { process.stderr.write(`verify-domain-migrations: ${redact(error instanceof Error ? error.message : String(error))}\n`); process.exitCode = error?.exitCode ?? 1; });
