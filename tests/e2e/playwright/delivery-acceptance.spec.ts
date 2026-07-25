import { test, expect } from "@playwright/test";

test.describe("U051 Delivery Acceptance Flow", () => {
  test("displays delivery acceptance panel and accepts projection", async ({ page }) => {
    await page.goto("/projects/u051-proj-1");
    await expect(page.getByTestId("delivery-acceptance-panel")).toBeVisible();
    await page.getByTestId("btn-accept-delivery").click();
  });
});
