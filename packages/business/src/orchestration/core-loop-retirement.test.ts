import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const CORE_LOOP = path.join(
  REPO_ROOT,
  "packages/business/src/orchestration/core-loop.ts",
);
const LEAF_INDEX = path.join(
  REPO_ROOT,
  "packages/business/src/orchestration/index.ts",
);
const ROOT_INDEX = path.join(REPO_ROOT, "packages/business/src/index.ts");
const EVIDENCE_DIR = path.join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U043/attempt-1",
);

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "output",
  "vendor",
]);

function productionSources(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    if (EXCLUDED_DIRECTORIES.has(entry)) continue;
    const absolute = path.join(root, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...productionSources(absolute));
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/.test(entry)) continue;
    if (
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry) ||
      /(?:fixture|verify|audit|check|smoke)/i.test(entry)
    ) {
      continue;
    }
    files.push(absolute);
  }
  return files;
}

describe("U043 core-loop retirement", () => {
  it("removes the file and its exact leaf export while preserving the root orchestration barrel", () => {
    expect(existsSync(CORE_LOOP)).toBe(false);
    const leaf = readFileSync(LEAF_INDEX, "utf8");
    const root = readFileSync(ROOT_INDEX, "utf8");
    expect(leaf).not.toMatch(/export\s+\*\s+from\s+["']\.\/core-loop["']/);
    expect(root).toContain('export * from "./orchestration/index";');
  });

  it("has zero exact imports, calls, definitions, or compatibility wrappers", () => {
    const sources = ["apps", "packages", "services", "scripts"]
      .map((root) => path.join(REPO_ROOT, root))
      .filter(existsSync)
      .flatMap(productionSources);
    const exactSymbols = [
      "convertMailToOpportunity",
      "advanceOpportunity",
      "processMailApproval",
    ];
    const findings: Array<{ file: string; symbol: string }> = [];

    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      for (const symbol of exactSymbols) {
        if (new RegExp(`\\b${symbol}\\b`).test(source)) {
          findings.push({
            file: path.relative(REPO_ROOT, file),
            symbol,
          });
        }
      }
      if (
        /from\s+["'][^"']*(?:orchestration\/)?core-loop["']/.test(source) ||
        /import\s*\(\s*["'][^"']*(?:orchestration\/)?core-loop["']\s*\)/.test(
          source,
        )
      ) {
        findings.push({
          file: path.relative(REPO_ROOT, file),
          symbol: "core-loop import",
        });
      }
    }

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      path.join(EVIDENCE_DIR, "core-loop-absence.json"),
      `${JSON.stringify(
        {
          coreLoopExists: existsSync(CORE_LOOP),
          leafExportCount: (
            readFileSync(LEAF_INDEX, "utf8").match(
              /export\s+\*\s+from\s+["']\.\/core-loop["']/g,
            ) ?? []
          ).length,
          rootOrchestrationExportCount: (
            readFileSync(ROOT_INDEX, "utf8").match(
              /export\s+\*\s+from\s+["']\.\/orchestration\/index["']/g,
            ) ?? []
          ).length,
          productionSourceCount: sources.length,
          findings,
        },
        null,
        2,
      )}\n`,
    );

    expect(findings).toEqual([]);
  });
});
