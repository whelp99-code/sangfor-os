import { defineConfig } from "@playwright/test";

// Overridable so a lane other than the default 3101/3200 pair can run this
// suite without colliding with another local instance (e.g. another worktree's
// dev servers). Every spec under tests/e2e/playwright reads BASE_URL /
// API_BASE_URL (falling back to :3101 / :3200), so deriving them here from
// PORT / API_PORT keeps `PORT=3102 API_PORT=3201 pnpm test:e2e` sufficient —
// callers don't also have to set BASE_URL / API_BASE_URL by hand.
const WEB_PORT = process.env.PORT ?? "3101";
const API_PORT = process.env.API_PORT ?? "3200";
process.env.BASE_URL ??= `http://localhost:${WEB_PORT}`;
process.env.API_BASE_URL ??= `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e/playwright",
  timeout: 90_000,
  workers: 1,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL,
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  // apps/api's own "start" script (node dist/index.js) hits a pre-existing
  // ESM directory-import failure in its tsc output, unrelated to this suite —
  // run it the same way `pnpm dev` does (tsx over source) instead.
  webServer: [
    {
      command: "pnpm --filter @sangfor/api exec tsx src/index.ts",
      port: Number(API_PORT),
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: { API_PORT },
    },
    {
      command: "pnpm --filter @sangfor/web start",
      port: Number(WEB_PORT),
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: { PORT: WEB_PORT },
    },
  ],
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: "test-results/results.json",
      },
    ],
  ],
  expect: {
    timeout: 10_000,
  },
});
