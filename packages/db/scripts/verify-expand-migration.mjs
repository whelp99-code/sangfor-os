import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';

const DB_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO_ROOT = resolve(DB_ROOT, '../..');
const MIGRATIONS_ROOT = join(DB_ROOT, 'prisma', 'migrations');
const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const SUITES = new Map([
  ['crm-owner-guards', 'src/schema-contracts/crm-domain-schema.integration.test.ts'],
  ['vendor-owner-guards', 'src/schema-contracts/vendor-domain-schema.integration.test.ts'],
  ['renewal-owner-guards', 'src/schema-contracts/delivery-lifecycle-schema.integration.test.ts'],
  ['support-owner-guards', 'src/schema-contracts/support-domain-schema.integration.test.ts'],
  ['commercial-history-guards', 'src/schema-contracts/commercial-domain-schema.integration.test.ts'],
  ['people-credential-guards', 'src/schema-contracts/people-domain-schema.integration.test.ts'],
]);

function usage(message) {
  throw new Error(`${message}\nusage: verify-expand-migration.mjs --through <migration-directory> --evidence-dir <absolute-dir> [--suite <allowlisted-suite>]`);
}

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!['--through', '--evidence-dir', '--suite'].includes(key) || values[key]) usage(`invalid argument: ${key}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) usage(`missing value for ${key}`);
    values[key] = value;
    i += 1;
  }
  if (!values['--through'] || !values['--evidence-dir']) usage('both --through and --evidence-dir are required');
  if (values['--suite'] && !SUITES.has(values['--suite'])) usage(`suite is not allowlisted: ${values['--suite']}`);
  if (process.env.DATABASE_URL || process.env.DIRECT_URL) usage('caller database URL is forbidden; the U009 scratch URL is injected internally');
  const evidenceDir = resolve(values['--evidence-dir']);
  if (evidenceDir !== values['--evidence-dir'] || !values['--evidence-dir'].startsWith('/')) usage('--evidence-dir must be absolute');
  return { through: values['--through'], evidenceDir, suite: values['--suite'] };
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8', ...options });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function redact(value) {
  return value.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/g, 'postgresql://[redacted]');
}

function parsePostgresUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  return { host: url.hostname, port: url.port || '5432', user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) };
}

function writeJson(evidenceDir, name, value) {
  writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const { through, evidenceDir, suite } = parseArgs(process.argv.slice(2));
  const migrations = readdirSync(MIGRATIONS_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const targetIndex = migrations.indexOf(through);
  if (targetIndex === -1 || !/^\d{14}_[a-z0-9_]+$/.test(through)) usage(`missing or non-formal migration prefix target: ${through}`);
  mkdirSync(evidenceDir, { recursive: true });
  const tmpRoot = mkdtempSync(join(tmpdir(), 'sangfor-expand-migration-'));
  const tmpPrisma = join(tmpRoot, 'prisma');
  const prefix = migrations.slice(0, targetIndex + 1);
  const membership = [];
  let lifecycleCompleted = false;
  let callbackCompleted = false;
  try {
    mkdirSync(join(tmpPrisma, 'migrations'), { recursive: true });
    writeFileSync(join(tmpPrisma, 'schema.prisma'), 'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n');
    for (const migration of prefix) {
      const source = join(MIGRATIONS_ROOT, migration);
      const sql = join(source, 'migration.sql');
      if (!readFileSync(sql, 'utf8')) throw new Error(`empty migration SQL: ${migration}`);
      cpSync(source, join(tmpPrisma, 'migrations', migration), { recursive: true });
      const copiedSql = join(tmpPrisma, 'migrations', migration, 'migration.sql');
      const checksum = sha256(sql);
      if (checksum !== sha256(copiedSql)) throw new Error(`modified checksum while copying ${migration}`);
      membership.push({ migration, checksum });
    }
    writeJson(evidenceDir, 'migration-safety.json', { result: 'PASS', through, migrationCount: prefix.length, membership, callerDatabaseUrlRejected: true, envLoading: 'not used', dockerLifecycle: 'U009 withIsolatedPostgres only' });
    await withIsolatedPostgres(
      { runId: `u032-${Date.now().toString(36)}`, ownerUnit: 'U032', purpose: 'expand-migration', evidenceDir: join(evidenceDir, 'u009-lifecycle'), imageDigest: IMAGE_DIGEST, migrate: false },
      async (ctx) => {
        const deploy = run('corepack', ['pnpm', '--filter', '@sangfor/db', 'exec', 'prisma', 'migrate', 'deploy', '--schema', join(tmpPrisma, 'schema.prisma')], { env: { PATH: process.env.PATH, DATABASE_URL: ctx.databaseUrl } });
        writeJson(evidenceDir, 'migration-scratch.json', { deploy: { code: deploy.code, stdout: redact(deploy.stdout), stderr: redact(deploy.stderr) }, through, database_runtime_verification: deploy.code === 0 ? 'PENDING_CALLBACK' : 'FAIL' });
        if (deploy.code !== 0) throw new Error(`prisma migrate deploy failed: ${deploy.stderr || deploy.stdout}`);
        const diff = run('corepack', ['pnpm', '--filter', '@sangfor/db', 'exec', 'prisma', 'migrate', 'diff', '--from-url', ctx.databaseUrl, '--to-schema-datamodel', join(DB_ROOT, 'prisma', 'schema.prisma'), '--script'], { env: { PATH: process.env.PATH } });
        const emptyDiff = diff.code === 0 && ['', '-- This is an empty migration.'].includes(diff.stdout.trim());
        if (!emptyDiff) throw new Error(`prisma migrate diff is non-empty: ${diff.stderr || diff.stdout}`);
        for (const entry of membership) {
          if (entry.checksum !== sha256(join(MIGRATIONS_ROOT, entry.migration, 'migration.sql')) || entry.checksum !== sha256(join(tmpPrisma, 'migrations', entry.migration, 'migration.sql'))) throw new Error(`modified checksum detected for ${entry.migration}`);
        }
        const connection = parsePostgresUrl(ctx.databaseUrl);
        const receipt = run('docker', ['exec', '-e', `PGPASSWORD=${connection.password}`, ctx.containerName, 'psql', '-h', '127.0.0.1', '-U', connection.user, '-d', connection.database, '-At', '-c', `SELECT migration_name FROM _prisma_migrations WHERE migration_name = '${through}' AND finished_at IS NOT NULL;`], { env: { PATH: process.env.PATH } });
        if (receipt.code !== 0 || receipt.stdout.trim() !== through) throw new Error(`_prisma_migrations lacks completed ${through}`);
        let test = null;
        if (suite) {
          const testPath = SUITES.get(suite);
          test = run('corepack', ['pnpm', '--filter', '@sangfor/db', 'exec', 'vitest', 'run', testPath], { env: { PATH: process.env.PATH, CI_INTEGRATION: '1', DATABASE_URL: ctx.databaseUrl } });
          if (test.code !== 0) throw new Error(`integration suite ${suite} failed: ${test.stderr || test.stdout}`);
        }
        callbackCompleted = true;
        writeJson(evidenceDir, 'migration-scratch.json', { deploy: { code: deploy.code, stdout: redact(deploy.stdout), stderr: redact(deploy.stderr) }, schemaDiff: { code: diff.code, stdout: redact(diff.stdout), stderr: redact(diff.stderr), empty: emptyDiff }, prismaMigrationsReceipt: through, suite: suite ? { id: suite, path: SUITES.get(suite), code: test.code, stdout: redact(test.stdout), stderr: redact(test.stderr) } : null, database_runtime_verification: 'PENDING_CLEANUP' });
      },
    );
    lifecycleCompleted = true;
    const pendingReceipt = JSON.parse(readFileSync(join(evidenceDir, 'migration-scratch.json'), 'utf8'));
    writeJson(evidenceDir, 'migration-scratch.json', { ...pendingReceipt, database_runtime_verification: 'ISOLATED_SCRATCH_PASS' });
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    writeJson(evidenceDir, 'cleanup.json', { temporaryCopyRemoved: true, u009CallbackPassed: callbackCompleted, u009CleanupPassed: lifecycleCompleted, result: callbackCompleted && lifecycleCompleted ? 'PASS' : 'FAIL' });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 67;
});
