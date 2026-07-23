import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const integration = process.env.CI_INTEGRATION === '1';
const evidenceDir = mkdtempSync(join(tmpdir(), 'u042-governance-integration-'));
const repoRoot = resolve(__dirname, '../../..');

function runGovernanceContract(): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const child = spawn(
      'bash',
      [
        join(repoRoot, 'scripts/run-workspace-runtime.sh'),
        'root',
        '--',
        'corepack',
        'pnpm',
        '--filter',
        '@sangfor/db',
        'db:contract',
        '--',
        '--suite',
        'governance-schema',
        '--evidence',
        evidenceDir,
      ],
      { cwd: repoRoot, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

afterAll(() => {
  rmSync(evidenceDir, { recursive: true, force: true });
});

describe('U042 governance schema isolated integration preflight', () => {
  it('requires the U042 receipts before any isolated database exercise can start', () => {
    for (const name of ['RetentionRun', 'RetentionRunItem', 'ExportCapability', 'OwnershipTransfer', 'OwnershipTransferItem']) {
      expect(Prisma.dmmf.datamodel.models.some((model) => model.name === name)).toBe(true);
    }
  });
});

describe.skipIf(!integration)('U042 governance schema (U009 isolated Postgres only)', () => {
  it('executes the real U041-prefix upgrade and exhaustive rollback-only behavioral matrix', async () => {
    if (process.env.DATABASE_URL) throw new Error('U042 integration verifier rejects caller DATABASE_URL');

    const result = await runGovernanceContract();
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);

    for (const file of [
      'upgrade-prefix.json',
      'legacy-fixture-before.json',
      'legacy-fixture-after.json',
      'legacy-source-hashes.json',
      'quarantine-snapshots.json',
      'activation-checks.json',
      'capability-contract.json',
      'governance-authority-inventory.json',
      'governance-negative-matrix.json',
      'retention-run-contract.json',
      'ownership-transfer-contract.json',
      'db-contract.txt',
      'cleanup.json',
    ]) {
      expect(existsSync(join(evidenceDir, file)), `missing U042 evidence receipt ${file}`).toBe(true);
    }

    const receipt = JSON.parse(readFileSync(join(evidenceDir, 'db-contract-receipt.json'), 'utf8')) as {
      result: string;
      evidence: { emptySchemaDiff: boolean; authorityInventory: { functions: number; triggers: number }; negativeChecks: number };
    };
    expect(receipt).toMatchObject({
      result: 'PASS',
      evidence: {
        emptySchemaDiff: true,
        authorityInventory: { functions: 10, triggers: 23 },
      },
    });
    expect(receipt.evidence.negativeChecks).toBeGreaterThanOrEqual(60);

    const hashes = JSON.parse(readFileSync(join(evidenceDir, 'legacy-source-hashes.json'), 'utf8')) as {
      before: string;
      after: string;
      countsUnchanged: boolean;
      hashesUnchanged: boolean;
    };
    expect(hashes).toMatchObject({ countsUnchanged: true, hashesUnchanged: true });
    expect(hashes.before).toBe(hashes.after);

    const quarantine = JSON.parse(readFileSync(join(evidenceDir, 'quarantine-snapshots.json'), 'utf8')) as {
      observedCount: number;
      independentJcsDigestMatches: boolean;
      sourceRowHashMatches: boolean;
      byteRereadMatches: boolean;
    };
    expect(quarantine).toMatchObject({
      observedCount: 2,
      independentJcsDigestMatches: true,
      sourceRowHashMatches: true,
      byteRereadMatches: true,
    });

    expect(readFileSync(join(evidenceDir, 'db-contract.txt'), 'utf8')).toContain('No difference detected');
  }, 300_000);
});
