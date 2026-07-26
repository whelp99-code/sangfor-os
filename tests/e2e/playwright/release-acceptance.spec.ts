import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { assertAxeClean, runAxeAudit } from "./support/axe";
import { installAuthProfile } from "./support/auth-profile";

const ROUTES = [
  { path: "/", role: "account_manager" },
  { path: "/deals", role: "account_manager" },
  { path: `/approvals/${process.env.UX_FIXTURE_APPROVAL_ID}`, role: "account_manager" },
  { path: "/registry/products", role: "solution_architect" },
  { path: "/support", role: "support_engineer" },
  { path: "/operator/workflows", role: "system_admin" },
  { path: "/dashboard", role: "ceo" },
  { path: "/dashboard/roi", role: "finance_manager" },
  { path: "/security", role: "security_officer" },
  { path: "/settings/archive", role: "system_admin" },
] as const;
const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
] as const;
const evidenceDir = resolve(process.env.ACCEPTANCE_EVIDENCE_DIR ?? "test-results/acceptance");
const results: Array<{
  route: string;
  width: number;
  axeViolations: number;
  keyboardFailures: number;
  consoleErrors: number;
  networkErrors: number;
}> = [];

test.beforeAll(() => mkdirSync(evidenceDir, { recursive: true }));

test.afterAll(() => {
  writeFileSync(
    join(evidenceDir, "release-surface.json"),
    `${JSON.stringify({ schemaVersion: 1, routes: ROUTES.map(({ path }) => path), widths: VIEWPORTS.map(({ width }) => width), results }, null, 2)}\n`,
  );
});

for (const viewport of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`${route.path} at ${viewport.width}`, async ({ context, page }) => {
      await installAuthProfile(context, route.role);
      await page.setViewportSize(viewport);
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const networkErrors: string[] = [];
      const httpErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("requestfailed", (request) => {
        if (request.failure()?.errorText !== "net::ERR_ABORTED") {
          networkErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`);
        }
      });
      page.on("response", (pageResponse) => {
        if (pageResponse.status() >= 400) httpErrors.push(`${pageResponse.status()} ${pageResponse.url()}`);
      });

      const response = await page.goto(route.path, { waitUntil: "networkidle" });
      expect(response?.ok(), `${route.path} navigation`).toBe(true);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.locator("h1:visible")).toHaveCount(1);
      expect(new URL(page.url()).pathname).not.toBe("/login");
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(networkErrors).toEqual([]);
      expect(httpErrors).toEqual([]);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

      const axe = await runAxeAudit(page);
      assertAxeClean(axe);
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus");
      await expect(focused).toHaveCount(1);
      await expect(focused).toBeVisible();

      const slug = route.path === "/" ? "root" : route.path.slice(1).replaceAll("/", "-");
      await page.screenshot({
        path: join(evidenceDir, `release-${viewport.width}-${slug}.png`),
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
      if (route.path === "/dashboard") {
        await page.screenshot({
          path: join(evidenceDir, `release-viewport-${viewport.width}.png`),
          fullPage: false,
          animations: "disabled",
          caret: "hide",
        });
      }
      results.push({
        route: route.path,
        width: viewport.width,
        axeViolations: axe.critical + axe.serious,
        keyboardFailures: 0,
        consoleErrors: consoleErrors.length + pageErrors.length,
        networkErrors: networkErrors.length + httpErrors.length,
      });
    });
  }
}
