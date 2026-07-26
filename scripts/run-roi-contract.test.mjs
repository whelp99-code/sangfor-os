import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("run-roi-contract test", () => {
  it("emits the strict ROI success contract", () => {
    const result = spawnSync(process.execPath, ["scripts/run-roi-contract.mjs"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("ROI contract runner executed\n");
  });
});
