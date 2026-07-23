import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DB_ROOT = resolve(import.meta.dirname, '../..');
const migrationPath = resolve(DB_ROOT, 'prisma/migrations/20260716004000_u040_domain_backfill_validate_tighten/migration.sql');
const runnerPath = resolve(DB_ROOT, 'scripts/verify-domain-migrations.mjs');

function runnerEnv() {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  return env;
}

function runMain(args: string[]) {
  const evidence = mkdtempSync(join(tmpdir(), 'u040-runner-vitest-'));
  try {
    execFileSync(process.execPath, [runnerPath, '--evidence-dir', evidence, ...args], {
      cwd: DB_ROOT,
      env: runnerEnv(),
      stdio: 'pipe',
      timeout: 120_000,
    });
    return { evidence, receipt: JSON.parse(readFileSync(join(evidence, 'backfill-first.json'), 'utf8')) as Record<string, any> };
  } catch (error) {
    rmSync(evidence, { recursive: true, force: true });
    throw error;
  }
}

describe('U040 isolated domain migration runner contract', () => {
  it('ships the formal validation/tightening migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it('uses separate U009 lifecycles for each negative scenario and recognizes the U002-contained restore tombstone', () => {
    const source = readFileSync(runnerPath, 'utf8');
    expect(source).toContain('withIsolatedPostgresPair');
    expect(source).toContain('withIsolatedPostgres');
    expect(source).toContain('DIRECT_RESTORE_QUARANTINED_USE_U009');
    expect(source).toContain('sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777');
    expect(source).toContain('ambiguous_owner_mapping');
    expect(source).toContain('key_collision');
    expect(source).toContain('renewal_asset_orphan');
    expect(source).toContain('renewalFkConvalidated');
  });

  it('drives the real main upgrade path over representative legacy rows', () => {
    const { evidence, receipt } = runMain(['--skip-failure-injection']);
    try {
      expect(receipt.applied).toBeGreaterThan(0);
      expect(receipt.counts.ownerAssignment).toMatchObject({ candidate: 1, applied: 1, quarantined: 0 });
      expect(receipt.counts.productFamily.applied).toBe(1);
      expect(receipt.counts.licenseMetric.applied).toBeGreaterThan(0);
      expect(receipt.counts.quote.applied).toBe(1);
      expect(receipt.counts.supportSnapshot.applied).toBe(1);
      expect(JSON.parse(readFileSync(join(evidence, 'backfill-second.json'), 'utf8')).applied).toBe(0);
      expect(JSON.parse(readFileSync(join(evidence, 'integrity.json'), 'utf8')).ok).toBe(true);
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
  }, 120_000);

  it('drives the real main failure scenario and records ambiguous owner quarantine', () => {
    const evidence = mkdtempSync(join(tmpdir(), 'u040-runner-ambiguous-vitest-'));
    try {
      execFileSync(process.execPath, [runnerPath, '--evidence-dir', evidence, '--failure-scenario', 'ambiguous_owner_mapping'], {
        cwd: DB_ROOT,
        env: runnerEnv(),
        stdio: 'pipe',
        timeout: 120_000,
      });
      const failure = JSON.parse(readFileSync(join(evidence, 'failure-injection', 'ambiguous_owner_mapping', 'failure-receipt.json'), 'utf8'));
      const blocking = JSON.parse(readFileSync(join(evidence, 'failure-injection', 'ambiguous_owner_mapping', 'backfill-blocking.json'), 'utf8'));
      const cleanup = JSON.parse(readFileSync(join(evidence, 'failure-injection', 'ambiguous_owner_mapping', 'cleanup.json'), 'utf8'));
      expect(failure.backfillExitCode).not.toBe(0);
      expect(blocking.counts.ownerAssignment.quarantined).toBeGreaterThan(0);
      expect(cleanup).toMatchObject({ status: 'PASS', cleaned: true });
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
  }, 120_000);
});
