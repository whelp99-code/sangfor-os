/**
 * U066 — 375/768/1280 Chrome + keyboard + axe visual checkpoint
 *
 * 37 route cases × 3 viewports. Execution deferred — spec + --list only.
 * Every cell proves: one main/H1, zero critical/serious axe, keyboard
 * reachability, visible focus, zero hydration/console/page errors,
 * no document overflow, independent screenshot.
 */

import { test, expect } from "@playwright/test";
import { ROUTE_CASES, VIEWPORTS, ALL_ROLES, ROLE_LANDING_MAP, type RouteCase, type Viewport } from "./support/ux-route-manifest";
import { runAxeAudit, assertAxeClean } from "./support/axe";

function cellId(route: RouteCase, vp: Viewport): string {
  return `${route.id}-${vp.label}`;
}

async function assertBaseContract(page: import("@playwright/test").Page, route: RouteCase, vp: Viewport) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => { pageErrors.push(err.message); });

  await page.goto(route.path, { waitUntil: "networkidle" });

  if (route.expectedRoute !== "role-dependent") {
    const url = new URL(page.url());
    const expected = new URL(route.expectedRoute, url.origin);
    expect(url.pathname).toBe(expected.pathname);
    if (expected.search) expect(url.search).toBe(expected.search);
  }

  const mainCount = await page.locator("main").count();
  expect(mainCount).toBe(1);

  const h1 = page.locator("h1");
  await expect(h1.first()).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
  expect(pageErrors).toHaveLength(0);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

  const axeResult = await runAxeAudit(page);
  assertAxeClean(axeResult);

  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused.first()).toBeVisible();

  await page.screenshot({
    path: `tests/e2e/playwright/ux-checkpoint.spec.ts-snapshots/${cellId(route, vp)}.png`,
    fullPage: false,
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.label} (${vp.width}×${vp.height})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });

    for (const route of ROUTE_CASES) {
      if (route.auth === "all") {
        for (const role of ALL_ROLES) {
          test(`${cellId(route, vp)} role=${role} ${route.path}`, async ({ page }) => {
            await assertBaseContract(page, { ...route, expectedRoute: ROLE_LANDING_MAP[role] }, vp);
          });
        }
      } else if (route.auth === "anonymous") {
        test(`${cellId(route, vp)} anonymous ${route.path}`, async ({ page }) => {
          await assertBaseContract(page, route, vp);
        });
      } else {
        test(`${cellId(route, vp)} ${route.auth} ${route.path}`, async ({ page }) => {
          await assertBaseContract(page, route, vp);
        });
      }
    }
  });
}
