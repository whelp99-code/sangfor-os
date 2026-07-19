/**
 * esbuild plugin: resolve workflow workspace @sangfor/* packages to TypeScript sources.
 * Only packages under packages/<name>/package.json are mapped; everything else fails the build.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginDir = dirname(fileURLToPath(import.meta.url));
export const workflowRoot = resolve(pluginDir, '..');

/**
 * @returns {Map<string, string>} package name → absolute source entry (.ts)
 */
export function buildWorkspaceSourceMap(root = workflowRoot) {
  const packagesDir = join(root, 'packages');
  /** @type {string[]} */
  const packageDirs = readdirSync(packagesDir)
    .filter((name) => {
      try {
        return statSync(join(packagesDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  /** @type {Map<string, string>} */
  const map = new Map();
  for (const dirName of packageDirs) {
    const manifestPath = join(packagesDir, dirName, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    const name = manifest.name;
    if (typeof name !== 'string' || !name.startsWith('@sangfor/')) {
      continue;
    }
    if (map.has(name)) {
      throw new Error(`workspace-source-plugin: duplicate package name ${name}`);
    }
    const exportsDot = manifest.exports?.['.'];
    let entryRel;
    if (typeof exportsDot === 'string') {
      entryRel = exportsDot;
    } else if (exportsDot && typeof exportsDot === 'object') {
      entryRel = exportsDot.import ?? exportsDot.default ?? exportsDot.require;
      if (typeof entryRel !== 'string') {
        entryRel = undefined;
      }
    }
    if (!entryRel) {
      entryRel = 'src/index.ts';
    }
    const entryAbs = resolve(packagesDir, dirName, entryRel);
    let realEntry;
    try {
      realEntry = realpathSync(entryAbs);
    } catch {
      throw new Error(`workspace-source-plugin: missing source for ${name}: ${entryAbs}`);
    }
    const realRoot = realpathSync(root);
    if (!realEntry.startsWith(realRoot + '/') && realEntry !== realRoot) {
      throw new Error(`workspace-source-plugin: source outside workflow root for ${name}: ${realEntry}`);
    }
    map.set(name, realEntry);
  }
  return map;
}

/**
 * @param {Map<string, string>} [sourceMap]
 * @returns {import('esbuild').Plugin}
 */
export function createWorkspaceSourcePlugin(sourceMap = buildWorkspaceSourceMap()) {
  return {
    name: 'sangfor-workspace-source',
    setup(build) {
      build.onResolve({ filter: /^@sangfor\// }, (args) => {
        // Only bare package root (no subpath) is allowed.
        if (args.path.includes('/', args.path.indexOf('/') + 1)) {
          // @sangfor/name is one slash; subpath has more.
          const parts = args.path.split('/');
          if (parts.length > 2) {
            return {
              errors: [{ text: `workspace-source-plugin: subpath not allowed: ${args.path}` }],
            };
          }
        }
        const mapped = sourceMap.get(args.path);
        if (!mapped) {
          return {
            errors: [{
              text: `workspace-source-plugin: unmapped @sangfor package (not externalized): ${args.path}`,
            }],
          };
        }
        return { path: mapped };
      });
    },
  };
}

export default createWorkspaceSourcePlugin;
