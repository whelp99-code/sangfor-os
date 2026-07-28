import { test, expect } from "@playwright/test";

test.describe("U048 commercial quote approval gate", () => {
  test("shows commercial approval status on quote detail", async ({ page }) => {
    await page.goto("/deals/u048-opp-1");
    await expect(page.locator("[data-testid='quote-commercial-status']")).toBeVisible();
  });

  test("shows auto_failed blocker for missing cost quote", async ({ page }) => {
    await page.goto("/deals/u048-opp-1");
    await expect(page.locator("[data-testid='cost-coverage-blocker']")).toContainText("auto_failed");
  });

  test("labels internal release as pending U055", async ({ page }) => {
    await page.goto("/deals/u048-opp-1");
    await expect(page.locator("[data-testid='release-status']")).toContainText("pending");
  });

  test("commercial gate renders at 375px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/deals/u048-opp-1");
    await expect(page.locator("[data-testid='quote-commercial-status']")).toBeVisible();
  });

  test("commercial gate renders at 768px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/deals/u048-opp-1");
    await expect(page.locator("[data-testid='quote-commercial-status']")).toBeVisible();
  });

  test("commercial gate renders at 1280px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/deals/u048-opp-1");
    await expect(page.locator("[data-testid='quote-commercial-status']")).toBeVisible();
  });
});
