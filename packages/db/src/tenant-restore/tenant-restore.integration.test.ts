import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runTenantSelectiveRestoreDrill } from './drill';

const integration = process.env.CI_INTEGRATION === '1';
const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

describe.runIf(integration)('U074 tenant-selective restore drill', () => {
  it('executes the complete isolated export/import/remap/hash/idempotence lifecycle', async () => {
    const evidenceDir = join(REPO_ROOT, `.omo/evidence/sangfor-system-refactor-2026-07-15/U074/test-${Date.now().toString(36)}`);
    mkdirSync(evidenceDir, { recursive: true });

    const result = await runTenantSelectiveRestoreDrill({
      runId: `u074-test-${Date.now().toString(36)}`,
      evidenceDir,
      imageDigest: IMAGE_DIGEST,
    });

    expect(result.imported).toBe(true);
    expect(result.idempotentReplay).toBe(true);
    expect(result.targetCounts).toEqual({ companies: 1, projects: 1, customers: 2, customer_activity_logs: 1 });
    expect(result.tableCounts.customer_activity_logs).toBe(1);
    expect(result.tamperRejected).toBe(true);
    expect(result.crossScopeRejected).toBe(true);
  }, 240_000);
});
