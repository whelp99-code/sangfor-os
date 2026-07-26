import { defineConfig } from "@playwright/test";
import path from "node:path";

const evidenceDir =
  process.env.ACCEPTANCE_EVIDENCE_DIR ??
  path.join(process.cwd(), "test-results", "acceptance");
const webPort = process.env.PORT ?? "3101";
const apiPort = process.env.API_PORT ?? "3200";
process.env.BASE_URL ??= `http://127.0.0.1:${webPort}`;
process.env.API_BASE_URL ??= `http://127.0.0.1:${apiPort}`;

/**
 * U007 acceptance config — exact workers/retries/parallelism/trace/reporter.
 */
export default defineConfig({
  testDir: "tests/e2e/playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(evidenceDir, "playwright-report.json"),
      },
    ],
  ],
  use: {
    trace: "on",
    baseURL: process.env.BASE_URL,
  },
  webServer: [
    {
      command:
        "bash scripts/run-workspace-runtime.sh root -- corepack pnpm --filter @sangfor/api start",
      url: `${process.env.API_BASE_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        API_PORT: process.env.API_PORT ?? "",
        PORT: process.env.PORT ?? "",
      },
    },
    {
      command:
        "bash scripts/run-workspace-runtime.sh root -- corepack pnpm --filter @sangfor/web start",
      url: process.env.BASE_URL,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        ...process.env,
        PORT: process.env.PORT ?? "",
        API_PORT: process.env.API_PORT ?? "",
      },
    },
  ],
});
