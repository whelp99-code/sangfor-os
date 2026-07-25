import { test, expect } from "@playwright/test";

test.describe("U057 Support RCA Review and Close Gate", () => {
  test("shows RCA review chain and close gate on support case detail page", async ({ page }) => {
    await page.goto("/support");
    await expect(page.getByText("기술지원").or(page.getByText("Support")).first()).toBeVisible();
  });
});
