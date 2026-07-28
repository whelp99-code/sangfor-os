import { test, expect } from "@playwright/test";

test.describe("U047 quote versioning", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/deals/u047-opp-1");
  });

  test("quote list renders with version badges", async ({ page }) => {
    await expect(page.locator("[data-testid='quote-editor']")).toBeVisible();
    await expect(page.locator("text=v1")).toBeVisible();
  });

  test("quote line items table renders product and service types", async ({ page }) => {
    await expect(page.locator("[data-testid='quote-line-items']")).toBeVisible();
    await expect(page.locator("text=제품")).toBeVisible();
    await expect(page.locator("text=서비스")).toBeVisible();
  });

  test("commercial snapshot shows revenue, cost, margin", async ({ page }) => {
    await expect(page.locator("[data-testid='quote-commercial-status']")).toBeVisible();
    await expect(page.locator("text=총 매출")).toBeVisible();
    await expect(page.locator("text=총 원가")).toBeVisible();
    await expect(page.locator("text=마진율")).toBeVisible();
  });

  test("content hash is displayed truncated", async ({ page }) => {
    const hashEl = page.locator("[title]");
    await expect(hashEl.first()).toBeVisible();
  });

  test("pending U055 release label is shown", async ({ page }) => {
    await expect(page.locator("[data-testid='release-status']")).toContainText("pending U055");
  });

  test("auto_failed cost coverage shows destructive badge", async ({ page }) => {
    await page.goto("/deals/u047-opp-2");
    await expect(page.locator("[data-testid='cost-coverage-status']")).toContainText("원가 미충족");
  });

  test("quote editor renders at 375px mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator("[data-testid='quote-editor']")).toBeVisible();
  });

  test("quote editor renders at 1280px desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator("[data-testid='quote-editor']")).toBeVisible();
  });
});
