import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectOperationalEntrypointViolations } from './verify-operational-entrypoints.mjs';

function write(root, relativePath, source) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function unsafeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'u031-operational-entrypoints-'));
  const manifest = JSON.stringify({ scripts: { 'db:push': 'prisma db push', 'cfo:restore': 'tsx cfo-restore.ts' } });
  write(root, 'package.json', manifest);
  write(root, 'packages/db/package.json', manifest);
  write(root, 'services/sangfor-engineer-mcp/package.json', manifest);
  write(root, 'scripts/backup-db.sh', '#!/usr/bin/env bash');
  write(root, 'scripts/restore-db.sh', '#!/usr/bin/env bash');
  write(root, 'scripts/apply-rls.sql', 'CREATE POLICY unsafe ON t USING (true);');
  write(root, 'packages/db/scripts/cfo-restore.ts', 'restore()');
  write(root, 'scripts/uxtest-stack.sh', 'source /Users/x/main-fork/.env');
  write(root, 'services/sangfor-engineer-mcp/automation/com.jmpark.sangfor.learnall.plist', '/Users/x/whelp99-code-sangfor-engineer-mcp');
  write(root, 'services/sangfor-engineer-mcp/automation/com.jmpark.sangfor.learnkb.plist', '/Users/x/whelp99-code-sangfor-engineer-mcp');
  write(root, 'services/sangfor-mcp-workflow/scripts/run-mcp-device-learn.mjs', 'process.env.HOME + "/whelp99-code-sangfor-engineer-mcp"');
  for (const path of [
    'packages/business/scripts/fill-uninvoiced-deals.ts',
    'packages/business/scripts/fix-purchase-price-deals.ts',
    'packages/business/scripts/regroup-chosun-deals.ts',
  ]) write(root, path, 'await prisma.quote.updateMany({ where: {}, data: {} });');
  return root;
}

describe('verify-operational-entrypoints', () => {
  it('reports each U031 unsafe-entrypoint category without executing it', () => {
    const root = unsafeFixture();
    try {
      const codes = new Set(collectOperationalEntrypointViolations(root).map((violation) => violation.code));
      for (const code of [
        'UNSAFE_DB_PUSH_MANIFEST',
        'DIRECT_RESTORE_MANIFEST',
        'LEGACY_DB_SCRIPT_SURVIVES',
        'UNSAFE_RLS_USING_TRUE',
        'STALE_ENGINEER_LAUNCHD_PATH',
        'CROSS_WORKTREE_SECRET_SOURCE',
        'WORKFLOW_OLD_CLONE_FALLBACK',
        'LEGACY_QUOTE_MUTATOR_UNQUARANTINED',
      ]) expect(codes).toContain(code);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps every retired legacy quote mutator as an import-time tombstone', async () => {
    for (const path of [
      '../packages/business/scripts/fill-uninvoiced-deals.ts',
      '../packages/business/scripts/fix-purchase-price-deals.ts',
      '../packages/business/scripts/regroup-chosun-deals.ts',
    ]) {
      await expect(import(path)).rejects.toThrow('is retired');
    }
  });
});
