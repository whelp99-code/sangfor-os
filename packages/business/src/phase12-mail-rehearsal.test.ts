import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("Phase 12 mail rehearsal", () => {
  it("reads mail overview without send/delete", async () => {
    const { getMailOverview } = await import("@sangfor/mail-intelligence");
    const overview = await getMailOverview();
    expect(overview.accounts).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(overview.taskCandidates)).toBe(true);
  }, 15_000);
});
