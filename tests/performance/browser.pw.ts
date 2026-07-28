import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { PERFORMANCE_ROUTES, PERFORMANCE_VIEWPORTS } from "./browser-contract";

const readySamples: number[] = [];
const transitionSamples: number[] = [];
const nodeSamples: number[] = [];
let sessionToken = "";

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

test.describe("U075 production browser performance", () => {
  test.beforeAll(async ({ request }) => {
    const password = process.env.AUTH_DEMO_PASSWORD;
    const authEmail = process.env.PERF_AUTH_EMAIL;
    expect(password, "AUTH_DEMO_PASSWORD").toBeTruthy();
    expect(authEmail, "PERF_AUTH_EMAIL").toBeTruthy();
    const response = await request.post("/api/auth/login", { data: { email: authEmail, password } });
    expect(response.ok(), `login status ${response.status()}`).toBeTruthy();
    const sessionCookie = (await response.headersArray()).find((header) => header.name.toLowerCase() === "set-cookie");
    const token = sessionCookie?.value.match(/(?:^|[,;]\s*)session=([^;]+)/)?.[1];
    expect(token, "login session token").toBeTruthy();
    sessionToken = decodeURIComponent(token!);
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: "session", value: sessionToken, url: `http://127.0.0.1:${process.env.PORT}` }]);
  });

  for (const viewport of PERFORMANCE_VIEWPORTS) {
    for (const route of PERFORMANCE_ROUTES) {
      test(`${viewport.label} ${route} is bounded and ready`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const started = performance.now();
        const response = await page.goto(route, { waitUntil: "domcontentloaded" });
        expect(response?.ok(), `${route} navigation status ${response?.status()}`).toBeTruthy();
        await expect(page.locator("body")).toBeVisible();
        const ready = performance.now() - started;
        readySamples.push(ready);
        expect(ready).toBeLessThanOrEqual(3_500);
        const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
        const records = await page.locator("[data-testid='collection-record']").count();
        nodeSamples.push(records);
        expect(records).toBeLessThanOrEqual(50);
        expect(await page.locator("[data-responsive-duplicate]").count()).toBe(0);
      });
    }
  }

  test("client transitions remain within budget", async ({ page }) => {
    await page.goto(PERFORMANCE_ROUTES[0], { waitUntil: "domcontentloaded" });
    for (let index = 0; index < 10; index += 1) {
      const started = performance.now();
      await page.goto(PERFORMANCE_ROUTES[(index + 1) % PERFORMANCE_ROUTES.length], { waitUntil: "domcontentloaded" });
      transitionSamples.push(performance.now() - started);
    }
    expect(percentile(transitionSamples, 99)).toBeLessThanOrEqual(1_200);
  });

  test.afterAll(() => {
    const evidenceDir = process.env.ACCEPTANCE_EVIDENCE_DIR;
    if (!evidenceDir) throw new Error("ACCEPTANCE_EVIDENCE_DIR is required");
    if (readySamples.length !== PERFORMANCE_ROUTES.length * PERFORMANCE_VIEWPORTS.length) throw new Error("incomplete browser-ready sample set");
    if (nodeSamples.length !== PERFORMANCE_ROUTES.length * PERFORMANCE_VIEWPORTS.length) throw new Error("incomplete DOM sample set");
    writeFileSync(join(evidenceDir, "browser-measurements.json"), `${JSON.stringify({
      "browser-ready": sample("browser-ready", readySamples),
      "browser-transition": sample("browser-transition", transitionSamples),
      "dom-nodes": sample("dom-nodes", nodeSamples),
    }, null, 2)}\n`, { flag: "wx" });
  });
});
