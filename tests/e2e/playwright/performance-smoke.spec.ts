import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES = ["/customers", "/deals", "/dashboard/roi"];
const VIEWPORTS = [
  { width: 375, height: 812, label: "mobile" },
  { width: 768, height: 1024, label: "tablet" },
  { width: 1280, height: 800, label: "desktop" },
];
const readySamples: number[] = [];
const transitionSamples: number[] = [];
const nodeSamples: number[] = [];

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)] ?? 0;
}

function sample(name: string, values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    name,
    samples: sorted,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    mean: sorted.reduce((total, value) => total + value, 0) / Math.max(1, sorted.length),
    warmupSamples: 0,
  };
}

test.describe("U075 isolated browser performance", () => {
  test.beforeEach(async ({ request, context }) => {
    const password = process.env.AUTH_DEMO_PASSWORD;
    expect(password, "AUTH_DEMO_PASSWORD").toBeTruthy();
    const response = await request.post("/api/auth/login", { data: { password } });
    expect(response.ok(), `login status ${response.status()}`).toBeTruthy();
    const sessionCookie = (await response.headersArray()).find((header) => header.name.toLowerCase() === "set-cookie");
    expect(sessionCookie, "login session cookie").toBeTruthy();
    const token = sessionCookie!.value.match(/session=([^;]+)/)?.[1];
    expect(token, "session token").toBeTruthy();
    await context.addCookies([{ name: "session", value: decodeURIComponent(token!), url: `http://127.0.0.1:${process.env.PORT}` }]);
  });

  for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${viewport.label} ${route} is bounded and ready`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const started = performance.now();
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page.locator("body")).toBeVisible();
        const ready = performance.now() - started;
        readySamples.push(ready);
        expect(ready).toBeLessThanOrEqual(2_500);
        const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
        const records = await page.locator("[data-testid='collection-record']").count();
        if (route !== "/dashboard/roi") nodeSamples.push(records);
        expect(records).toBeLessThanOrEqual(50);
        expect(await page.locator("[data-responsive-duplicate]").count()).toBe(0);
      });
    }
  }

  test("client transition remains within budget", async ({ page }) => {
    await page.goto("/deals", { waitUntil: "domcontentloaded" });
    for (let index = 0; index < 10; index += 1) {
      const target = index % 2 === 0 ? "/customers" : "/deals";
      const started = performance.now();
      await page.goto(target, { waitUntil: "domcontentloaded" });
      transitionSamples.push(performance.now() - started);
    }
    expect(percentile(transitionSamples, 95)).toBeLessThanOrEqual(750);
  });

  test.afterAll(() => {
    const evidenceDir = process.env.ACCEPTANCE_EVIDENCE_DIR;
    if (!evidenceDir) throw new Error("ACCEPTANCE_EVIDENCE_DIR is required");
    writeFileSync(join(evidenceDir, "browser-measurements.json"), `${JSON.stringify({
      "browser-ready": sample("browser-ready", readySamples),
      "browser-transition": sample("browser-transition", transitionSamples),
      "dom-nodes": sample("dom-nodes", nodeSamples),
    }, null, 2)}\n`, { flag: "wx" });
  });
});
