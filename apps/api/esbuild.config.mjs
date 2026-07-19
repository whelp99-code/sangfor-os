/**
 * U007 — API production esbuild config (Node 20 ESM single bundle).
 * sangforWorkspaceSourcePlugin resolves all @sangfor/* to workspace source .ts.
 */
import { readdirSync, readFileSync, realpathSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = dirname(fileURLToPath(import.meta.url));
export const monorepoRoot = resolve(apiRoot, "../..");

/**
 * Build deterministic map: package name and export subpaths → absolute .ts source.
 * @param {string} [root]
 * @returns {Map<string, string>}
 */
export function buildWorkspaceSourceMap(root = monorepoRoot) {
  const packagesDir = join(root, "packages");
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
    const pkgDir = join(packagesDir, dirName);
    const manifestPath = join(pkgDir, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    const name = manifest.name;
    if (typeof name !== "string" || !name.startsWith("@sangfor/")) continue;

    const setUnique = (key, absPath) => {
      if (map.has(key) && map.get(key) !== absPath) {
        throw new Error(
          `sangforWorkspaceSourcePlugin: ambiguous mapping for ${key}`,
        );
      }
      map.set(key, absPath);
    };

    // Root entry: prefer src/index.ts when present (production typecheck contract)
    const srcIndex = join(pkgDir, "src/index.ts");
    if (existsSync(srcIndex)) {
      setUnique(name, realpathSync(srcIndex));
    } else if (manifest.exports?.["."]) {
      const exp = manifest.exports["."];
      const rel =
        typeof exp === "string"
          ? exp
          : exp?.import ?? exp?.default ?? exp?.require;
      if (typeof rel === "string") {
        // map dist → src when possible
        const candidate = rel
          .replace(/^\.\//, "")
          .replace(/^dist\//, "src/")
          .replace(/\.js$/, ".ts");
        const abs = join(pkgDir, candidate);
        if (existsSync(abs)) setUnique(name, realpathSync(abs));
      }
    }

    // Subpath exports from package.json
    if (manifest.exports && typeof manifest.exports === "object") {
      for (const [sub, exp] of Object.entries(manifest.exports)) {
        if (sub === ".") continue;
        const key = `${name}${sub.startsWith("/") ? sub : `/${sub.replace(/^\.\//, "")}`}`;
        // normalize @sangfor/foo/bar
        const normalized = key.replace(/\/\.\//g, "/");
        let rel =
          typeof exp === "string"
            ? exp
            : exp && typeof exp === "object"
              ? exp.import ?? exp.default ?? exp.types ?? exp.require
              : null;
        if (typeof rel !== "string") continue;
        rel = rel
          .replace(/^\.\//, "")
          .replace(/^dist\//, "src/")
          .replace(/\.d\.ts$/, ".ts")
          .replace(/\.js$/, ".ts");
        const abs = join(pkgDir, rel);
        if (existsSync(abs)) {
          setUnique(
            normalized.replace(`${name}/`, `${name}/`).replace(/\/+/g, "/"),
            realpathSync(abs),
          );
        }
      }
    }
  }

  // Exact production typecheck path contracts (always win)
  const exact = {
    "@sangfor/api-utils": "packages/api-utils/src/index.ts",
    "@sangfor/auth": "packages/auth/src/index.ts",
    "@sangfor/business": "packages/business/src/index.ts",
    "@sangfor/business/openai-config":
      "packages/business/src/platform/openai-config.ts",
    "@sangfor/config": "packages/config/src/index.ts",
    "@sangfor/db": "packages/db/src/index.ts",
    "@sangfor/infra": "packages/infra/src/index.ts",
    "@sangfor/persona": "packages/persona/src/index.ts",
    "@sangfor/shared": "packages/shared/src/index.ts",
    "@sangfor/shared/modes": "packages/shared/src/modes.ts",
  };
  for (const [key, rel] of Object.entries(exact)) {
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      throw new Error(`sangforWorkspaceSourcePlugin: missing source ${rel}`);
    }
    map.set(key, realpathSync(abs));
  }

  return map;
}

/**
 * @param {Map<string, string>} [sourceMap]
 * @returns {import('esbuild').Plugin}
 */
export function sangforWorkspaceSourcePlugin(
  sourceMap = buildWorkspaceSourceMap(),
) {
  return {
    name: "sangfor-workspace-source",
    setup(build) {
      build.onResolve({ filter: /^@sangfor\// }, (args) => {
        const mapped = sourceMap.get(args.path);
        if (mapped) {
          return { path: mapped };
        }
        // Try longest-prefix subpath match is already in map keys
        return {
          errors: [
            {
              text: `sangforWorkspaceSourcePlugin: unmapped or ambiguous @sangfor import: ${args.path}`,
            },
          ],
        };
      });
    },
  };
}

/** Exact esbuild options per U007 point 18 */
export const productionBuildOptions = {
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  sourcemap: "external",
  metafile: true,
  logLevel: "info",
  plugins: [sangforWorkspaceSourcePlugin()],
  absWorkingDir: apiRoot,
};

export default productionBuildOptions;
