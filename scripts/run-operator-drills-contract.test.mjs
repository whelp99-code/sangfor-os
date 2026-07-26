import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("run-operator-drills-contract test", () => {
  it("emits the strict operator drills success contract", () => {
    const result = spawnSync(process.execPath, ["scripts/run-operator-drills-contract.mjs"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("Operator drills contract runner executed\n");
  });
});
