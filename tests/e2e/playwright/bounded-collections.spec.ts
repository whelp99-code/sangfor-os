import { test, expect } from "@playwright/test";
import { installAuthProfile } from "./support/auth-profile";
import { VIEWPORTS, type BusinessRole } from "./support/ux-route-manifest";

const COLLECTIONS: readonly { path: string; role: BusinessRole }[] = [
  { path: "/deals", role: "sales_manager" },
  { path: "/customers", role: "account_manager" },
  { path: "/partners", role: "account_manager" },
  { path: "/contacts", role: "account_manager" },
  { path: "/tasks", role: "account_manager" },
  { path: "/poc", role: "presales_engineer" },
  { path: "/proposals", role: "presales_engineer" },
  { path: "/approvals", role: "ceo" },
  { path: "/inbox", role: "account_manager" },
  { path: "/knowledge", role: "solution_architect" },
  { path: "/settings/archive", role: "system_admin" },
];

test.describe("U062 Bounded Collections E2E", () => {
  for (const viewport of VIEWPORTS) {
    for (const collection of COLLECTIONS) {
      test(`${collection.path} is bounded and single-DOM at ${viewport.width}x${viewport.height}`, async ({ context, page }) => {
        await installAuthProfile(context, collection.role);
        await page.setViewportSize(viewport);
        const response = await page.goto(collection.path, { waitUntil: "networkidle" });
        expect(response).not.toBeNull();
        expect(new URL(page.url()).pathname).toBe(collection.path);
        expect(new URL(page.url()).pathname).not.toBe("/login");
        await expect(page.locator("main")).toHaveCount(1);
        await expect(page.locator("h1:visible")).toHaveCount(1);

        const recordRoots = page.locator("[data-record-id], tbody > tr");
        expect(await recordRoots.count()).toBeLessThanOrEqual(50);
        const recordIds = await page.locator("[data-record-id]").evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-record-id")).filter(Boolean),
        );
        expect(new Set(recordIds).size).toBe(recordIds.length);

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        const controls = page.getByTestId("cursor-pagination").getByRole("button");
        for (let index = 0; index < await controls.count(); index += 1) {
          await expect(controls.nth(index)).toHaveAccessibleName(/이전 페이지|다음 페이지/);
        }
      });
    }
  }
});
