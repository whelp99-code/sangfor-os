import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright",
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
      "allure-playwright",
      {
        outputFolder: "allure-results",
        detail: true,
        suiteTitle: false,
      },
    ],
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
  projects: [
    {
      name: "smoke",
      testMatch: /smoke\.spec\.ts$/,
    },
    {
      name: "functional",
      testMatch: /portal-full-functional\.spec\.ts$/,
    },
    {
      name: "trace-verification",
      testMatch: /trace-verification\.spec\.ts$/,
    },
  ],
});
