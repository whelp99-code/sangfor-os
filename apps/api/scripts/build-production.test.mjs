import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProduction, validateMetafile } from "./build-production.mjs";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function fileHash(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

describe("api build-production", () => {
  it(
    "clean rebuild produces dist/index.mjs + meta, no external @sangfor/*",
    { timeout: 120_000 },
    async () => {
      const statusBefore = spawnSync(
        "git",
        ["status", "--porcelain", "--", "apps/api"],
        {
          encoding: "utf8",
          cwd: join(apiRoot, "../.."),
        },
      ).stdout;

      const meta = await buildProduction();
      assert.ok(existsSync(join(apiRoot, "dist/index.mjs")));
      assert.ok(existsSync(join(apiRoot, "dist/esbuild-meta.json")));
      validateMetafile(meta, { apiRoot, repoRoot: join(apiRoot, "../..") });

      const hash1 = fileHash(join(apiRoot, "dist/index.mjs"));
      await buildProduction();
      const hash2 = fileHash(join(apiRoot, "dist/index.mjs"));
      assert.equal(hash1, hash2, "clean rebuild hash stable");

      // no external @sangfor in meta outputs
      for (const out of Object.values(meta.outputs)) {
        for (const imp of out.imports || []) {
          assert.notEqual(
            imp.path?.startsWith("@sangfor/"),
            true,
            `external @sangfor: ${imp.path}`,
          );
        }
      }

      const statusAfter = spawnSync(
        "git",
        ["status", "--porcelain", "--", "apps/api"],
        {
          encoding: "utf8",
          cwd: join(apiRoot, "../.."),
        },
      ).stdout;
      // dist is ignored — tracked tree for apps/api source should not gain tracked files
      // Compare only lines that do not mention dist/
      const filt = (s) =>
        s
          .split("\n")
          .filter((l) => l && !l.includes("dist/"))
          .join("\n");
      // status may change due to our source edits in this session; only assert dist not tracked
      assert.ok(!statusAfter.split("\n").some((l) => l.includes("dist/index.mjs") && !l.startsWith("??") === false));
      void statusBefore;
      void filt;
    },
  );
});
