#!/usr/bin/env tsx
import { resolve } from 'node:path';

import { runTenantSelectiveRestoreDrill } from '../src/tenant-restore/drill';

const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const REPO_ROOT = resolve(import.meta.dirname, '../../..');

async function main(): Promise<void> {
  const runId = `u074-drill-${Date.now().toString(36)}`;
  const evidenceDir = process.env.U074_EVIDENCE_DIR
    ? resolve(process.env.U074_EVIDENCE_DIR)
    : resolve(REPO_ROOT, `.omo/evidence/sangfor-system-refactor-2026-07-15/U074/${runId}`);

  console.log('[U074] Starting fixture-only tenant-selective restore drill.');
  const result = await runTenantSelectiveRestoreDrill({ runId, evidenceDir, imageDigest: IMAGE_DIGEST });
  console.log(`[U074] PASS ${JSON.stringify({ evidenceDir, ...result })}`);
}

main().catch((error) => {
  console.error('[U074] Drill failed:', error);
  process.exitCode = 1;
});
