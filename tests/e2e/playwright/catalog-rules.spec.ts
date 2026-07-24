import { test, expect } from "@playwright/test";

test.describe("Catalog Rules & Sizing Registry E2E Spec", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to catalog rules page
    await page.goto("/registry/rules");
  });

  test("renders sizing templates tab and rule workspace", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Catalog Rule Engine & Sizing Registry" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sizing Templates" })).toBeVisible();
    await expect(page.getByText("Sizing Rule Workspace")).toBeVisible();
  });

  test("switches to compatibility rules tab", async ({ page }) => {
    await page.getByRole("button", { name: "Compatibility Rules" }).click();
    await expect(page.getByText("Compatibility Rule Workspace")).toBeVisible();
  });

  test("runs interactive rule evaluation simulation", async ({ page }) => {
    await expect(page.getByText("Rule Evaluation Simulator")).toBeVisible();
    await page.getByRole("button", { name: "Evaluate Rule" }).click();
    await expect(page.getByText("Evaluation Success")).toBeVisible();
  });
});
