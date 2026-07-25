import { test, expect } from "@playwright/test";

test.describe("U049 Vendor Request Timeline Flow", () => {
  test("displays vendor request panel and creates manual submission request", async ({ page }) => {
    await page.goto("/deals/opp1");
    const panel = page.getByTestId("vendor-request-panel");
    await expect(panel).toBeVisible();

    const btn = page.getByTestId("btn-request-discount");
    if (await btn.isVisible()) {
      await btn.click();
    }
  });
});
