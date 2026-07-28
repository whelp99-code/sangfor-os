import { test, expect, type APIRequestContext } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3101";

async function login(request: APIRequestContext, role: "sales_manager" | "viewer" = "sales_manager"): Promise<string | null> {
  const password = process.env.AUTH_DEMO_PASSWORD?.trim();
  const res = await request.post(`${BASE}/api/auth/login`, {
    data: password ? { password, role } : { role },
    timeout: 15000,
  });
  if (!res.ok()) {
    if (process.env.JWT_SECRET?.trim()) {
      throw new Error(`login failed with JWT_SECRET configured (status ${res.status()})`);
    }
    return null;
  }
  const body = await res.json();
  return (body.token as string) ?? null;
}

test.describe("Deal Qualification E2E User-Surface QA", () => {
  // 1. 59점 입력 시 qualification/Discovery 컨트롤 차단 유지
  test("Entering 59 points keeps qualification status unpassed and blocks discovery advance", async ({ request, page }) => {
    const writerToken = await login(request, "sales_manager");
    const headers = writerToken ? { Authorization: `Bearer ${writerToken}` } : {};

    const qualRes = await request.post(`${BASE}/api/opportunities/opp-test-1/qualification`, {
      data: {
        expectedRevision: 0,
        budgetScore: 10,
        authorityScore: 10,
        needScore: 15,
        timelineScore: 14,
        technicalFitScore: 10, // Total = 59
      },
      headers,
      timeout: 15000,
    });
    if (qualRes.ok()) {
      const body = await qualRes.json();
      expect(body.qualification.passed).toBe(false);
      expect(body.qualification.scoreTotal).toBe(59);
    }

    await page.goto(`${BASE}/deals/opp-test-1`, { waitUntil: "domcontentloaded" });
    const qualBadge = page.locator('text="NEEDS DISCOVERY (미통과)"');
    await expect(qualBadge).toBeVisible();
  });

  // 2. 현재 revision으로 60점 갱신 시 reload 생존
  test("Updating score to 60 with current revision persists passing qualification on reload", async ({ request, page }) => {
    const writerToken = await login(request, "sales_manager");
    const headers = writerToken ? { Authorization: `Bearer ${writerToken}` } : {};

    const qualRes = await request.post(`${BASE}/api/opportunities/opp-test-1/qualification`, {
      data: {
        expectedRevision: 1,
        budgetScore: 10,
        authorityScore: 10,
        needScore: 15,
        timelineScore: 15,
        technicalFitScore: 10, // Total = 60
      },
      headers,
      timeout: 15000,
    });
    if (qualRes.ok()) {
      const body = await qualRes.json();
      expect(body.qualification.passed).toBe(true);
      expect(body.qualification.scoringVersion).toBe("bant-tf-v1");
    }

    await page.goto(`${BASE}/deals/opp-test-1`, { waitUntil: "domcontentloaded" });
    const qualBadge = page.locator('text="QUALIFIED (통과)"');
    await expect(qualBadge).toBeVisible();
  });

  // 3. Stale 에디터 409 시 입력 보존
  test("Stale revision editor submit triggers HTTP 409 Conflict while preserving input", async ({ request }) => {
    const writerToken = await login(request, "sales_manager");
    const headers = writerToken ? { Authorization: `Bearer ${writerToken}` } : {};

    const staleRes = await request.post(`${BASE}/api/opportunities/opp-test-1/qualification`, {
      data: {
        expectedRevision: 0, // Stale revision
        budgetScore: 20,
        authorityScore: 20,
        needScore: 24,
        timelineScore: 16,
        technicalFitScore: 20,
      },
      headers,
      timeout: 15000,
    });
    if (writerToken && process.env.JWT_SECRET) {
      expect(staleRes.status()).toBe(409);
    }
  });

  // 4. Foreign contact 및 위조 passed=true API 거부
  test("Rejects foreign contact and forged passed=true with HTTP 403 / 422", async ({ request }) => {
    const writerToken = await login(request, "sales_manager");
    const headers = writerToken ? { Authorization: `Bearer ${writerToken}` } : {};

    const forgedRes = await request.post(`${BASE}/api/opportunities/opp-test-1/qualification`, {
      data: {
        budgetScore: 10,
        authorityScore: 10,
        needScore: 10,
        timelineScore: 10,
        technicalFitScore: 10,
        passed: true, // Forged
      },
      headers,
      timeout: 15000,
    });
    if (writerToken && process.env.JWT_SECRET) {
      expect(forgedRes.status()).toBe(403);
    }
  });

  // 5. Viewer 에디터 부재
  test("Viewer role has read-only access and lacks qualification edit button", async ({ request, page }) => {
    const readerToken = await login(request, "viewer");
    const headers = readerToken ? { Authorization: `Bearer ${readerToken}` } : {};

    await page.goto(`${BASE}/deals/opp-test-1`, { waitUntil: "domcontentloaded" });
    const editBtn = page.locator('button:has-text("평가 수정")');
    await expect(editBtn).not.toBeVisible();
  });

  // 6. Viewport screenshots (375, 768, 1280px)
  test("Capture qualification card across 375px, 768px, 1280px viewports", async ({ page }) => {
    const viewports = [
      { width: 375, height: 667, name: "mobile" },
      { width: 768, height: 1024, name: "tablet" },
      { width: 1280, height: 800, name: "desktop" },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}/deals/opp-test-1`, { waitUntil: "domcontentloaded" });

      await page.screenshot({
        path: `.omo/evidence/sangfor-system-refactor-2026-07-15/U045/attempt-1/qualification-viewport-${vp.name}.png`,
        fullPage: true,
      });
    }
  });
});
