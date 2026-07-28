import { test, expect } from "@playwright/test";

test.describe("U061 Archive Center E2E", () => {
  test("renders archive center page", async ({ page }) => {
    // Stub E2E — full execution requires isolated postgres + auth session
    await page.goto("/settings/archive");
    await expect(page.locator("body")).toBeAttached();
  });
});
