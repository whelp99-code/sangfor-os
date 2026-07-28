import { test, expect } from "@playwright/test";

test.describe("U050 Deal Workflow Gates Flow", () => {
  test("displays deal workflow panel and starts run", async ({ page }) => {
    await page.goto("/deals/u050-deal-1");
    await expect(page.getByTestId("deal-workflow-panel")).toBeVisible();
    await page.getByTestId("btn-start-workflow").click();
  });
});
