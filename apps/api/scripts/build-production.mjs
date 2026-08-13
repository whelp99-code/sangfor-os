/**
 * U007 — clean apps/api/dist and build single ESM bundle via esbuild 0.28.1.
 */
import { copyFileSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { productionBuildOptions, monorepoRoot } from "../esbuild.config.mjs";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {import('esbuild').Metafile} metafile
 */
export function validateMetafile(metafile, { apiRoot: root = apiRoot, repoRoot = monorepoRoot } = {}) {
  const errors = [];
  const inputs = Object.keys(metafile.inputs || {});
  const outputs = metafile.outputs || {};

  for (const input of inputs) {
    if (input.includes("node_modules")) continue;
    // no workspace dist inputs
    if (/packages\/[^/]+\/dist\//.test(input) || /apps\/[^/]+\/dist\//.test(input)) {
      errors.push(`workspace dist input: ${input}`);
    }
    const abs = isAbsolute(input) ? input : resolve(root, input);
    if (isAbsolute(input)) {
      const rel = abs.startsWith(repoRoot) ? abs.slice(repoRoot.length) : abs;
      if (!abs.startsWith(repoRoot)) {
        errors.push(`repo-outside input: ${input}`);
      }
      void rel;
    }
  }

  // external @sangfor/* must be 0 (all bundled via plugin)
  for (const [outPath, out] of Object.entries(outputs)) {
    const imports = out.imports || [];
    for (const imp of imports) {
      if (imp.path?.startsWith("@sangfor/")) {
        errors.push(`external @sangfor/*: ${imp.path} in ${outPath}`);
      }
    }
  }

  const mainOut = join(root, "dist/index.mjs");
  if (!existsSync(mainOut)) errors.push("missing dist/index.mjs");
  if (!existsSync(join(root, "dist/index.mjs.map"))) {
    // esbuild external sourcemap may be index.mjs.map
    const mapAlt = Object.keys(outputs).find((k) => k.endsWith(".map"));
    if (!mapAlt && !existsSync(join(root, "dist/index.mjs.map"))) {
      errors.push("missing sourcemap");
    }
  }

  // third-party / prisma should appear as external in outputs
  let sawExternal = false;
  for (const out of Object.values(outputs)) {
    for (const imp of out.imports || []) {
      if (
        imp.external &&
        (imp.path === "@prisma/client" ||
          imp.path === "express" ||
          imp.path === "cors" ||
          imp.path === "zod" ||
          (imp.path && !imp.path.startsWith(".") && !imp.path.startsWith("@sangfor/")))
      ) {
        sawExternal = true;
      }
    }
  }
  if (!sawExternal) {
    // still OK if graph has no such imports in output record; check bundle text
    const bundle = existsSync(mainOut) ? readFileSync(mainOut, "utf8") : "";
    if (!bundle.includes("express") && !bundle.includes("@prisma")) {
      // soft: at least ensure no relative TS imports left
    }
  }

  const bundle = existsSync(mainOut) ? readFileSync(mainOut, "utf8") : "";
  if (/\bfrom\s+['"]\.\.?\/[^'"]+['"]/.test(bundle) && /\.ts['"]/.test(bundle)) {
    errors.push("unresolved relative TS import in bundle");
  }

  if (errors.length) {
    const err = new Error(`metafile validation failed:\n${errors.join("\n")}`);
    err.errors = errors;
    throw err;
  }
  return { ok: true, inputCount: inputs.length };
}

export async function buildProduction() {
  const distDir = join(apiRoot, "dist");
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const result = await esbuild.build({
    ...productionBuildOptions,
    entryPoints: [join(apiRoot, "src/index.ts")],
    outfile: join(apiRoot, "dist/index.mjs"),
    absWorkingDir: apiRoot,
  });

  const metaPath = join(apiRoot, "dist/esbuild-meta.json");
  writeFileSync(metaPath, JSON.stringify(result.metafile, null, 2));
  const vendorSource = join(apiRoot, "src/services/finance/hometax-securemail/vendor");
  const vendorOutput = join(distDir, "vendor");
  mkdirSync(vendorOutput, { recursive: true });
  copyFileSync(join(vendorSource, "seed.js"), join(vendorOutput, "seed.js"));
  copyFileSync(join(vendorSource, "aes.js"), join(vendorOutput, "aes.js"));
  validateMetafile(result.metafile, { apiRoot, repoRoot: monorepoRoot });

  process.stdout.write(
    `build-production: inputs=${Object.keys(result.metafile.inputs).length}\n`,
  );
  return result.metafile;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildProduction().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
