#!/usr/bin/env node
/**
 * U031 production verifier. It only reads the current checkout and reports
 * unsafe operational entrypoints; it never runs an operational command.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEGACY_DB_SCRIPTS = [
  'scripts/backup-db.sh',
  'scripts/restore-db.sh',
  'scripts/apply-rls.sql',
  'packages/db/scripts/cfo-restore.ts',
];
const ENGINEER_PLISTS = [
  'services/sangfor-engineer-mcp/automation/com.jmpark.sangfor.learnall.plist',
  'services/sangfor-engineer-mcp/automation/com.jmpark.sangfor.learnkb.plist',
];
const LEGACY_QUOTE_MUTATORS = [
  'packages/business/scripts/fill-uninvoiced-deals.ts',
  'packages/business/scripts/fix-purchase-price-deals.ts',
  'packages/business/scripts/regroup-chosun-deals.ts',
];

function readUtf8(root, relativePath) {
  const path = resolve(root, relativePath);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * A legacy DB script counts as CONTAINED — a U002 quarantine tombstone, not a surviving hazard —
 * only when it carries the DIRECT_RESTORE_QUARANTINED_USE_U009 code AND performs no dangerous
 * operation. This mirrors U002's own tombstone validation (scripts/check-u002-containment-surface.mjs)
 * so both containment gates agree on the definition: U002 deliberately TOMBSTONES restore-db.sh /
 * cfo-restore.ts (exit 64, neutered) rather than deleting them, and U031 recognizes that containment
 * instead of duplicating it by deletion. A legacy DB script that actually reads a dump / opens psql /
 * restores to $DATABASE_URL is NOT a tombstone and is still flagged LEGACY_DB_SCRIPT_SURVIVES.
 */
function isContainedTombstoneAbs(absolutePath) {
  const source = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null;
  if (source == null || !source.includes('DIRECT_RESTORE_QUARANTINED_USE_U009')) return false;
  if (absolutePath.endsWith('.ts')) {
    return !/^\s*import\s/mu.test(source)
      && !/process\.(?:env|argv)/u.test(source)
      && !/\b(?:spawn|exec|PrismaClient)\b/u.test(source);
  }
  if (absolutePath.endsWith('.sh')) {
    return !/\b(?:DATABASE_URL|psql)\b/u.test(source) && !/\$[@*#?0-9]/u.test(source);
  }
  return false;
}

function isContainedTombstone(root, relativePath) {
  return isContainedTombstoneAbs(resolve(root, relativePath));
}

function parseJson(root, relativePath, violations) {
  const source = readUtf8(root, relativePath);
  if (source == null) {
    violations.push({ code: 'MISSING_MANIFEST', path: relativePath });
    return null;
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    violations.push({ code: 'INVALID_MANIFEST_JSON', path: relativePath, detail: String(error) });
    return null;
  }
}

function add(violations, code, path, detail) {
  violations.push({ code, path, ...(detail ? { detail } : {}) });
}

function inspectManifest(violations, relativePath, forbiddenScripts) {
  const manifest = parseJson(this.root, relativePath, violations);
  if (!manifest?.scripts) return;
  for (const [name, code] of Object.entries(manifest.scripts)) {
    if (forbiddenScripts.has(name) || /\bprisma\s+db\s+push\b/i.test(String(code))) {
      add(violations, 'UNSAFE_DB_PUSH_MANIFEST', relativePath, `${name}=${code}`);
    }
    if (name === 'cfo:restore' || /cfo-restore|restore-db\.sh/i.test(String(code))) {
      // A manifest entry that invokes a U002 quarantine tombstone (exit-64, neutered) is contained,
      // not a direct-restore hazard; only flag when it invokes a genuinely dangerous restore target.
      const target = String(code).match(/(\S+\.(?:ts|sh))/u);
      const invokesTombstone = target != null
        && isContainedTombstoneAbs(resolve(this.root, dirname(relativePath), target[1]));
      if (!invokesTombstone) {
        add(violations, 'DIRECT_RESTORE_MANIFEST', relativePath, `${name}=${code}`);
      }
    }
  }
}

/** Exported solely for scripts/verify-operational-entrypoints.test.mjs. */
export function collectOperationalEntrypointViolations(root) {
  const violations = [];
  const context = { root };
  inspectManifest.call(context, violations, 'package.json', new Set(['db:push', 'db:push:safe']));
  inspectManifest.call(context, violations, 'packages/db/package.json', new Set(['db:push']));
  inspectManifest.call(context, violations, 'services/sangfor-engineer-mcp/package.json', new Set(['db:push']));

  for (const relativePath of LEGACY_DB_SCRIPTS) {
    const source = readUtf8(root, relativePath);
    if (source != null && !isContainedTombstone(root, relativePath)) {
      add(violations, 'LEGACY_DB_SCRIPT_SURVIVES', relativePath);
      if (/USING\s*\(\s*true\s*\)/i.test(source)) {
        add(violations, 'UNSAFE_RLS_USING_TRUE', relativePath, 'USING(true)');
      }
    }
  }

  for (const relativePath of ENGINEER_PLISTS) {
    const source = readUtf8(root, relativePath);
    if (source == null) {
      add(violations, 'MISSING_ENGINEER_PLIST', relativePath);
    } else if (/\/Users\/|whelp99-code-sangfor-engineer-mcp/.test(source)) {
      add(violations, 'STALE_ENGINEER_LAUNCHD_PATH', relativePath);
    }
  }

  const uxtest = readUtf8(root, 'scripts/uxtest-stack.sh');
  if (uxtest == null) add(violations, 'MISSING_UXTEST_PREFLIGHT', 'scripts/uxtest-stack.sh');
  else {
    if (/main-fork\/\.env|orca\/workspaces\/sangfor-os\/main-fork/i.test(uxtest)) {
      add(violations, 'CROSS_WORKTREE_SECRET_SOURCE', 'scripts/uxtest-stack.sh');
    }
    if (!/\bpreflight\)/.test(uxtest) || !/UXTEST_CONFIG_MISSING/.test(uxtest)) {
      add(violations, 'UXTEST_PREFLIGHT_NOT_FAIL_CLOSED', 'scripts/uxtest-stack.sh');
    }
  }

  const workflowLauncher = readUtf8(root, 'services/sangfor-mcp-workflow/scripts/run-mcp-device-learn.mjs');
  if (workflowLauncher == null) add(violations, 'MISSING_WORKFLOW_RESOLVER', 'services/sangfor-mcp-workflow/scripts/run-mcp-device-learn.mjs');
  else if (/whelp99-code-sangfor-engineer-mcp|\/Users\/jmpark|process\.env\.HOME/.test(workflowLauncher)) {
    add(violations, 'WORKFLOW_OLD_CLONE_FALLBACK', 'services/sangfor-mcp-workflow/scripts/run-mcp-device-learn.mjs');
  } else if (!/SANGFOR_ENGINEER_MCP_DIR/.test(workflowLauncher)) {
    add(violations, 'WORKFLOW_RESOLVER_NOT_VALIDATED', 'services/sangfor-mcp-workflow/scripts/run-mcp-device-learn.mjs');
  }

  for (const relativePath of LEGACY_QUOTE_MUTATORS) {
    const source = readUtf8(root, relativePath);
    if (source == null) {
      add(violations, 'MISSING_LEGACY_QUOTE_MUTATOR', relativePath);
      continue;
    }
    const retiredTombstone = /throw new Error\(["'][^"']+ is retired:/.test(source)
      && !/@sangfor\/db|\bprisma\s*\./.test(source);
    if (retiredTombstone) continue;
    const requirements = [
      ['legacy_quote_mutator', /legacy_quote_mutator/],
      ['explicit --apply-legacy-only', /--apply-legacy-only/],
      ['canonical preflight', /CANONICAL_QUOTE_IMMUTABLE/],
      ['legacy predicate', /contentHash\s*:\s*null/],
      ['redacted reporting', /redact(?:ed)?/i],
    ];
    for (const [name, expression] of requirements) {
      if (!expression.test(source)) add(violations, 'LEGACY_QUOTE_MUTATOR_UNQUARANTINED', relativePath, name);
    }
  }

  return violations;
}

export function buildOperationalEntrypointReport(root) {
  const violations = collectOperationalEntrypointViolations(root);
  return {
    schemaVersion: 1,
    verifier: 'verify-operational-entrypoints',
    root,
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violations,
  };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const root = resolve(dirname(modulePath), '..');
  const report = buildOperationalEntrypointReport(root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}
