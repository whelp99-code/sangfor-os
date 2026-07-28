/**
 * Production esbuild packaging for mcp-server and operator-console.
 * Exact two esbuild calls, Node 22 ESM bundles, workspace source plugin.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { createWorkspaceSourcePlugin, workflowRoot } from './workspace-source-plugin.mjs';

const root = workflowRoot;
const plugin = createWorkspaceSourcePlugin();

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: 'external',
  metafile: true,
  logLevel: 'info',
  plugins: [plugin],
};

function wipeAppDist(relAppDir) {
  const distDir = join(root, relAppDir, 'dist');
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
}

async function buildOne({ entryPoints, outfile, metaOut }) {
  const result = await esbuild.build({
    ...common,
    entryPoints: entryPoints.map((p) => join(root, p)),
    outfile: join(root, outfile),
  });
  mkdirSync(dirname(join(root, metaOut)), { recursive: true });
  writeFileSync(join(root, metaOut), JSON.stringify(result.metafile, null, 2));
  return result.metafile;
}

async function main() {
  wipeAppDist('apps/mcp-server');
  wipeAppDist('apps/operator-console');

  const mcpMeta = await buildOne({
    entryPoints: ['apps/mcp-server/src/index.ts'],
    outfile: 'apps/mcp-server/dist/index.mjs',
    metaOut: 'apps/mcp-server/dist/esbuild-meta.json',
  });

  const operatorMeta = await buildOne({
    entryPoints: ['apps/operator-console/src/server.ts'],
    outfile: 'apps/operator-console/dist/server.mjs',
    metaOut: 'apps/operator-console/dist/esbuild-meta.json',
  });

  // Byte-preserving public assets for operator static serving.
  cpSync(
    join(root, 'apps/operator-console/src/public'),
    join(root, 'apps/operator-console/dist/public'),
    { recursive: true },
  );

  process.stdout.write(
    `build-production: mcp inputs=${Object.keys(mcpMeta.inputs).length} operator inputs=${Object.keys(operatorMeta.inputs).length}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
