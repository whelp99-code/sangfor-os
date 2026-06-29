import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Integration tests (CI_INTEGRATION=1) hit a single shared dev database and
    // share fixtures (the sample NTS issueId, the CompanySettings singleton), so
    // they must run serially. Unit tests stay parallel by default.
    fileParallelism: process.env.CI_INTEGRATION !== "1",
  },
});
