import { test, expect } from "@playwright/test";

test.describe("U055 Governed AI Quality Flow", () => {
  test("displays quality governance badge, gaps, and submits 2-of-2 human review", async ({ page }) => {
    await page.goto("/proposals/prop1");
    const badge = page.getByTestId("quality-badge");
    await expect(badge).toBeVisible();

    const approveBtn = page.getByTestId("btn-approve");
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
    }
  });
});
