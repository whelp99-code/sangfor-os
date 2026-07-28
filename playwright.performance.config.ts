import { defineConfig } from "@playwright/test";
import path from "node:path";

const evidenceDir = process.env.ACCEPTANCE_EVIDENCE_DIR;
if (!evidenceDir) throw new Error("ACCEPTANCE_EVIDENCE_DIR is required");

export default defineConfig({
  testDir: "tests/performance",
  testMatch: "browser.pw.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"], ["json", { outputFile: path.join(evidenceDir, "playwright-performance-report.json") }]],
  use: {
    baseURL: `http://127.0.0.1:${process.env.PORT}`,
    trace: "on",
  },
  webServer: [
    {
      command: "bash scripts/run-workspace-runtime.sh root -- corepack pnpm --filter @sangfor/api start",
      url: `http://127.0.0.1:${process.env.API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: "bash scripts/run-workspace-runtime.sh root -- corepack pnpm --filter @sangfor/web start",
      url: `http://127.0.0.1:${process.env.PORT}`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
