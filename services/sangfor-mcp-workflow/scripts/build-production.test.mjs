/**
 * Production packaging validator + failing-first fixtures.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';
import { buildWorkspaceSourceMap, createWorkspaceSourcePlugin, workflowRoot } from './workspace-source-plugin.mjs';

const root = workflowRoot;
const require = createRequire(import.meta.url);

const EXACT_REQUIRE_SCAN_SOURCES = [
  'packages/shared/src/index.ts',
  'packages/wiki-sync/src/github-wiki-sync.ts',
  'packages/health-checker/src/health-checker.ts',
  'apps/mcp-server/src/tools/integration-tools.ts',
];

const MCP_OUT = 'apps/mcp-server/dist/index.mjs';
const OPERATOR_OUT = 'apps/operator-console/dist/server.mjs';
const MCP_META = 'apps/mcp-server/dist/esbuild-meta.json';
const OPERATOR_META = 'apps/operator-console/dist/esbuild-meta.json';
const VENDOR_JSON_SPEC = '../../../../data/vendors/vendor-database.json';
const VENDOR_JSON_ABS = join(root, 'data/vendors/vendor-database.json');
const INTEGRATION_TOOLS = join(root, 'apps/mcp-server/src/tools/integration-tools.ts');

const NODE_BUILTINS = new Set([
  ...require('node:module').builtinModules,
  ...require('node:module').builtinModules.map((m) => `node:${m}`),
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function listWorkflowLocalInputs(metafile) {
  return Object.keys(metafile.inputs)
    .map((input) => resolve(root, input))
    .filter((abs) => {
      try {
        const real = realpathSync(abs);
        return real.startsWith(realpathSync(root) + '/') || real === realpathSync(root);
      } catch {
        return false;
      }
    })
    .sort();
}

function countLiteralRequire(sourceText) {
  const matches = sourceText.match(/require\(/g);
  return matches ? matches.length : 0;
}

function collectExternalPaths(metafile) {
  /** @type {Set<string>} */
  const externals = new Set();
  // Only output imports reflect the final bundle external surface.
  // Input-level external flags include type-only / tree-shaken paths and are not authoritative.
  for (const output of Object.values(metafile.outputs)) {
    for (const imp of output.imports ?? []) {
      if (imp.external) externals.add(imp.path);
    }
  }
  return externals;
}

/**
 * Validate a production metafile against the U004 contract.
 * @returns {{ ok: true, report: object } | { ok: false, errors: string[] }}
 */
export function validateMetafile(metafile, options) {
  const {
    expectedOutfile,
    appManifestPath,
    label,
  } = options;
  /** @type {string[]} */
  const errors = [];
  const realRoot = realpathSync(root);

  const outputs = Object.keys(metafile.outputs);
  const expectedOutAbs = resolve(root, expectedOutfile);
  const expectedMapAbs = `${expectedOutAbs}.map`;
  const jsOutputs = outputs.filter((o) => o.endsWith('.mjs') || o.endsWith('.js'));
  const mapOutputs = outputs.filter((o) => o.endsWith('.map'));

  if (!outputs.some((o) => resolve(root, o) === expectedOutAbs)) {
    errors.push(`${label}: missing exact outfile ${expectedOutfile}`);
  }
  if (!existsSync(expectedOutAbs)) {
    errors.push(`${label}: outfile not on disk: ${expectedOutfile}`);
  }
  if (!existsSync(expectedMapAbs)) {
    errors.push(`${label}: missing sourcemap for ${expectedOutfile}`);
  }
  for (const o of jsOutputs) {
    if (resolve(root, o) !== expectedOutAbs) {
      errors.push(`${label}: unexpected JS entrypoint ${o}`);
    }
  }

  for (const input of Object.keys(metafile.inputs)) {
    const abs = resolve(root, input);
    let real;
    try {
      real = realpathSync(abs);
    } catch {
      errors.push(`${label}: unreadable input ${input}`);
      continue;
    }
    if (!real.startsWith(realRoot + '/') && real !== realRoot) {
      errors.push(`${label}: input outside workflow root: ${input}`);
    }
    if (real.includes(`${realpathSync(root)}/`) && /\/dist\//.test(real) && !real.includes('/node_modules/')) {
      // Workspace package dist must not be an input (source only).
      if (!real.includes('/apps/mcp-server/dist/') && !real.includes('/apps/operator-console/dist/')) {
        errors.push(`${label}: workspace dist input forbidden: ${input}`);
      }
    }
  }

  const externals = collectExternalPaths(metafile);
  for (const path of externals) {
    if (path.startsWith('@sangfor/')) {
      errors.push(`${label}: external workflow @sangfor/* forbidden: ${path}`);
    }
  }

  // unresolved relative / source-TS imports should not appear as external
  for (const path of externals) {
    if (path.startsWith('.') || path.endsWith('.ts') || path.endsWith('.tsx')) {
      errors.push(`${label}: unresolved relative/source-TS external: ${path}`);
    }
  }

  const appManifest = readJson(appManifestPath);
  const productionDeps = {
    ...(appManifest.dependencies ?? {}),
  };
  const unresolved = [];
  for (const path of externals) {
    const base = path.startsWith('node:') ? path : path.split('/')[0].startsWith('@')
      ? path.split('/').slice(0, 2).join('/')
      : path.split('/')[0];
    if (NODE_BUILTINS.has(path) || NODE_BUILTINS.has(base) || path.startsWith('node:')) {
      continue;
    }
    // Skip package-internal subpath of known deps
    const depName = base;
    if (!(depName in productionDeps)) {
      // Try resolve from app dir via createRequire
      try {
        createRequire(join(dirname(appManifestPath), 'package.json')).resolve(depName);
      } catch {
        unresolved.push(path);
        errors.push(`${label}: undeclared/unresolvable external: ${path}`);
      }
    }
  }

  // Static require scan of exact sources
  for (const rel of EXACT_REQUIRE_SCAN_SOURCES) {
    const text = readFileSync(join(root, rel), 'utf8');
    const count = countLiteralRequire(text);
    if (count !== 0) {
      errors.push(`${label}: literal require( count=${count} in ${rel}`);
    }
    if (text.includes('createRequire')) {
      errors.push(`${label}: createRequire present in ${rel}`);
    }
  }

  // All workflow-local metafile inputs: literal require( == 0
  for (const abs of listWorkflowLocalInputs(metafile)) {
    if (!abs.endsWith('.ts') && !abs.endsWith('.tsx') && !abs.endsWith('.js') && !abs.endsWith('.mjs')) {
      continue;
    }
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (countLiteralRequire(text) !== 0) {
      errors.push(`${label}: literal require( in workflow-local input ${relative(root, abs)}`);
    }
  }

  // Vendor JSON static import path must resolve to exact data file
  const integrationText = readFileSync(INTEGRATION_TOOLS, 'utf8');
  if (!integrationText.includes(VENDOR_JSON_SPEC) || !integrationText.includes('with { type: "json" }') && !integrationText.includes("with { type: 'json' }")) {
    errors.push(`${label}: missing exact static vendor JSON import in integration-tools.ts`);
  }
  const resolvedVendor = realpathSync(resolve(dirname(INTEGRATION_TOOLS), VENDOR_JSON_SPEC));
  if (resolvedVendor !== realpathSync(VENDOR_JSON_ABS)) {
    errors.push(`${label}: vendor JSON realpath mismatch`);
  }
  if (!existsSync(join(root, 'apps/operator-console/dist/public/index.html'))) {
    if (label === 'operator') {
      errors.push(`${label}: missing dist/public static assets`);
    }
  }

  const report = {
    label,
    expectedOutfile,
    inputCount: Object.keys(metafile.inputs).length,
    externalCount: externals.size,
    externals: [...externals].sort(),
    unresolved,
    productionDeps: Object.keys(productionDeps).sort(),
  };

  if (errors.length > 0) {
    return { ok: false, errors, report };
  }
  return { ok: true, report };
}

export function validateProductionBuild() {
  assert.ok(existsSync(join(root, MCP_META)), 'mcp metafile missing — run pnpm build first');
  assert.ok(existsSync(join(root, OPERATOR_META)), 'operator metafile missing — run pnpm build first');

  const mcp = validateMetafile(readJson(join(root, MCP_META)), {
    expectedOutfile: MCP_OUT,
    appManifestPath: join(root, 'apps/mcp-server/package.json'),
    label: 'mcp',
  });
  const operator = validateMetafile(readJson(join(root, OPERATOR_META)), {
    expectedOutfile: OPERATOR_OUT,
    appManifestPath: join(root, 'apps/operator-console/package.json'),
    label: 'operator',
  });

  const errors = [
    ...(mcp.ok ? [] : mcp.errors),
    ...(operator.ok ? [] : operator.errors),
  ];
  const report = {
    mcp: mcp.report,
    operator: operator.report,
    validatedAt: new Date().toISOString(),
  };

  const evidenceHint = process.env.U004_EVIDENCE_DIR;
  if (evidenceHint) {
    mkdirSync(evidenceHint, { recursive: true });
    writeFileSync(join(evidenceHint, 'production-dependency-resolution.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(evidenceHint, 'mcp-esbuild-meta.json'), readFileSync(join(root, MCP_META)));
    writeFileSync(join(evidenceHint, 'operator-esbuild-meta.json'), readFileSync(join(root, OPERATOR_META)));
  }

  if (errors.length > 0) {
    const err = new Error(`production validation failed:\n${errors.join('\n')}`);
    err.report = report;
    throw err;
  }
  return report;
}

test('workspace source map covers exact workflow packages', () => {
  const map = buildWorkspaceSourceMap();
  for (const name of [
    '@sangfor/workflow-shared',
    '@sangfor/workflow-core',
    '@sangfor/workflow-engine',
    '@sangfor/health-checker',
    '@sangfor/wiki-sync',
  ]) {
    assert.ok(map.has(name), `missing ${name}`);
    assert.ok(map.get(name).endsWith('.ts'));
  }
  assert.equal(map.has('@sangfor/chrome'), false);
});

test('workspace plugin rejects unmapped @sangfor and subpaths', async () => {
  const esbuild = await import('esbuild');
  const plugin = createWorkspaceSourcePlugin(buildWorkspaceSourceMap());
  await assert.rejects(
    () => esbuild.build({
      stdin: { contents: 'import x from "@sangfor/chrome";\nconsole.log(x);\n', resolveDir: root, sourcefile: 'fixture.ts' },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      plugins: [plugin],
      logLevel: 'silent',
    }),
    /unmapped @sangfor|workspace-source-plugin/,
  );
  await assert.rejects(
    () => esbuild.build({
      stdin: { contents: 'import x from "@sangfor/workflow-shared/extra";\nconsole.log(x);\n', resolveDir: root, sourcefile: 'fixture.ts' },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      plugins: [plugin],
      logLevel: 'silent',
    }),
    /subpath not allowed|workspace-source-plugin/,
  );
});

test('exact sources have zero literal require(', () => {
  for (const rel of EXACT_REQUIRE_SCAN_SOURCES) {
    const text = readFileSync(join(root, rel), 'utf8');
    assert.equal(countLiteralRequire(text), 0, rel);
  }
});

test('vendor JSON import specifier resolves to workflow data file', () => {
  const text = readFileSync(INTEGRATION_TOOLS, 'utf8');
  assert.match(text, /vendor-database\.json/);
  assert.match(text, /with \{ type: ['"]json['"] \}/);
  assert.equal(
    realpathSync(resolve(dirname(INTEGRATION_TOOLS), VENDOR_JSON_SPEC)),
    realpathSync(VENDOR_JSON_ABS),
  );
});

test('production metafiles validate after build', () => {
  // If build artifacts missing, this is a soft skip for unit-only runs;
  // acceptance always runs after build.
  if (!existsSync(join(root, MCP_META)) || !existsSync(join(root, OPERATOR_META))) {
    // Force failure — production test must run after build
    assert.fail('metafiles missing; run pnpm build before test:production');
  }
  const report = validateProductionBuild();
  assert.ok(report.mcp.inputCount > 0);
  assert.ok(report.operator.inputCount > 0);
});

test('fixture: reinjected require( in shared source fails scan', () => {
  const sample = "import { mkdirSync } from 'node:fs';\nconst { x } = require('node:fs');\n";
  assert.equal(countLiteralRequire(sample), 1);
});
