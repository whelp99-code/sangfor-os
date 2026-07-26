import { test, expect } from "@playwright/test";
import { installAuthProfile } from "./support/auth-profile";
import { VIEWPORTS, type BusinessRole } from "./support/ux-route-manifest";

const SHELL_ROUTES: readonly { path: string; role: BusinessRole }[] = [
  { path: "/home", role: "account_manager" },
  { path: "/deals", role: "sales_manager" },
  { path: "/approvals", role: "ceo" },
  { path: "/operator/workflows", role: "system_admin" },
  { path: "/cfo/dashboard", role: "finance_manager" },
  { path: "/cfo/invoices", role: "finance_manager" },
  { path: "/cfo/settings", role: "finance_manager" },
];

test.describe("U064 Shell Contract E2E", () => {
  for (const viewport of VIEWPORTS) {
    for (const route of SHELL_ROUTES) {
      test(`${route.path} owns one landmark and skip target at ${viewport.width}x${viewport.height}`, async ({ context, page }) => {
        await installAuthProfile(context, route.role);
        await page.setViewportSize(viewport);
        await page.goto(route.path, { waitUntil: "networkidle" });
        expect(new URL(page.url()).pathname).toBe(route.path);
        expect(new URL(page.url()).pathname).not.toBe("/login");

        const main = page.locator("main#main-content");
        await expect(page.locator("main")).toHaveCount(1);
        await expect(main).toHaveCount(1);
        await expect(page.locator("h1:visible")).toHaveCount(1);

        await page.keyboard.press("Tab");
        const skipLink = page.locator('a[href="#main-content"]');
        await expect(skipLink).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(main).toBeFocused();

        const dimensions = await page.evaluate(() => ({
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          bodyOverflowY: getComputedStyle(document.body).overflowY,
          mainOverflowY: getComputedStyle(document.querySelector("main#main-content")!).overflowY,
        }));
        expect(dimensions.documentOverflow).toBeLessThanOrEqual(1);
        expect(dimensions.bodyOverflowY).not.toBe("scroll");
        expect(["auto", "scroll"]).toContain(dimensions.mainOverflowY);
      });
    }
  }
});
