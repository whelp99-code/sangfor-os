/** U066 exact 56-entry / 65-auth-case / 195-cell checkpoint. */

import { test, expect, type Page } from "@playwright/test";
import { runAxeAudit, assertAxeClean } from "./support/axe";
import { installAuthProfile } from "./support/auth-profile";
import {
  EXPANDED_ROUTE_CASES,
  ROLE_LANDING_MAP,
  VIEWPORTS,
  cellKey,
  resolveFixturePath,
  type ExpandedRouteCase,
  type Viewport,
} from "./support/ux-route-manifest";
import { writeCellEvidence } from "./support/ux-evidence";

async function assertBaseContract(page: Page, route: ExpandedRouteCase, viewport: Viewport) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const resolved = resolveFixturePath(route);
  const response = await page.goto(resolved.path, { waitUntil: "networkidle" });
  expect(response, `navigation response for ${resolved.path}`).not.toBeNull();

  const url = new URL(page.url());
  const expectedRoute = route.id === "S01" && route.auth !== "anonymous"
    ? ROLE_LANDING_MAP[route.auth]
    : resolved.expectedRoute;
  const expected = new URL(expectedRoute, url.origin);
  expect(url.pathname).toBe(expected.pathname);
  expect(url.search).toBe(expected.search);
  if (route.auth !== "anonymous") {
    expect(url.pathname, "authenticated routes must never false-green on login").not.toBe("/login");
  }

  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("h1:visible")).toHaveCount(1);
  const expectedNavigation404 = route.id === "D14"
    ? consoleErrors.filter((message) => message === "Failed to load resource: the server responded with a status of 404 (Not Found)")
    : [];
  expect(consoleErrors).toEqual(expectedNavigation404);
  expect(pageErrors).toEqual([]);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  const axeResult = await runAxeAudit(page);
  assertAxeClean(axeResult);

  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveCount(1);
  await expect(focused).toBeVisible();
  const focusStyle = await focused.evaluate((element) => {
    const style = getComputedStyle(element);
    return `${style.outlineStyle}|${style.outlineWidth}|${style.boxShadow}`;
  });
  expect(focusStyle).not.toBe("none|0px|none");

  const screenshot = await page.screenshot({ fullPage: false, animations: "disabled", caret: "hide" });
  writeCellEvidence(cellKey(route, viewport), screenshot, axeResult);
}

for (const viewport of VIEWPORTS) {
  test.describe(`viewport ${viewport.width}x${viewport.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    });

    for (const route of EXPANDED_ROUTE_CASES) {
      test(`${cellKey(route, viewport)} ${route.auth} ${route.path}`, async ({ context, page }) => {
        await installAuthProfile(context, route.auth);
        await assertBaseContract(page, route, viewport);
      });
    }
  });
}
