import { test, expect } from "@playwright/test";

const PERF_ROUTES = ["/deals", "/approvals", "/registry/products", "/support", "/dashboard", "/dashboard/roi"];
const VIEWPORTS = [
  { width: 375, height: 812, label: "mobile" },
  { width: 768, height: 1024, label: "tablet" },
  { width: 1280, height: 800, label: "desktop" },
];

test.describe("U075 performance smoke — browser contracts", () => {
  for (const vp of VIEWPORTS) {
    test.describe(`${vp.label} (${vp.width}x${vp.height})`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
      });

      for (const route of PERF_ROUTES) {
        test(`${route} renders within budget`, async ({ page }) => {
          const start = Date.now();
          await page.goto(route, { waitUntil: "networkidle" });
          const readyTime = Date.now() - start;

          expect(readyTime).toBeLessThanOrEqual(2500);

          const body = page.locator("body");
          await expect(body).toBeVisible();

          const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
          const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
          expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
        });
      }

      test("collection record nodes <= 50", async ({ page }) => {
        await page.goto("/deals", { waitUntil: "networkidle" });
        const recordNodes = await page.locator("[data-testid='collection-record']").count();
        expect(recordNodes).toBeLessThanOrEqual(50);
      });

      test("no hidden responsive duplicate DOM", async ({ page }) => {
        await page.goto("/deals", { waitUntil: "networkidle" });
        const hiddenDuplicates = await page.evaluate(() => {
          const all = document.querySelectorAll("[data-responsive-duplicate]");
          return Array.from(all).filter((el) => {
            const style = window.getComputedStyle(el);
            return style.display === "none" || style.visibility === "hidden";
          }).length;
        });
        expect(hiddenDuplicates).toBe(0);
      });
    });
  }

  test("page transition <= 750ms", async ({ page }) => {
    await page.goto("/deals", { waitUntil: "networkidle" });
    const start = Date.now();
    await page.click("a[href='/dashboard']");
    await page.waitForLoadState("networkidle");
    const transitionTime = Date.now() - start;
    expect(transitionTime).toBeLessThanOrEqual(750);
  });
});
