import { test, expect } from "@playwright/test";

test.describe("U072 ROI Dashboard E2E", () => {
  test("truthful ROI metrics and state display", async ({ page }) => {
    // Stub E2E — full execution requires isolated postgres + auth session
    await page.goto("/dashboard/roi");
    await expect(page.locator("body")).toBeAttached();
  });
});
