import { test, expect } from "@playwright/test";

test.describe("U053 Delivery People Eligibility Flow", () => {
  test("displays delivery roster and eligibility matrix", async ({ page }) => {
    await page.goto("/delivery/people");
    await expect(page.getByTestId("eligibility-matrix")).toBeVisible();
  });
});
