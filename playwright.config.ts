import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/playwright",
  timeout: 90_000,
  workers: 1,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3101",
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
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
