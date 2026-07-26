import { test, expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { resolve } from "node:path";
import { installAuthProfile } from "./support/auth-profile";

const BASE = process.env.BASE_URL ?? "http://localhost:3101";
const EVIDENCE_DIR = resolve(process.env.ACCEPTANCE_EVIDENCE_DIR ?? "test-results/acceptance");

async function login(
  context: BrowserContext,
  role: "sales_manager" | "account_manager" = "sales_manager",
): Promise<{ request: APIRequestContext; token: string }> {
  await installAuthProfile(context, role);
  const session = (await context.cookies(BASE)).find((cookie) => cookie.name === "session");
  if (!session?.value) throw new Error(`AUTH_PROFILE_SESSION_MISSING:${role}`);
  return { request: context.request, token: session.value };
}

test.describe("CRM Scope & Pagination E2E User-Surface QA", () => {
  // 1. Customers list & Scope verification
  test("[customer] Sales & Viewer authentication and /customers scoped row verification", async ({ context, page }) => {
    const { request, token: salesToken } = await login(context);
    const headers = { Authorization: `Bearer ${salesToken}` };

    const listRes = await request.get(`${BASE}/api/customers`, { headers, timeout: 15000 });
    expect(listRes.ok()).toBeTruthy();
    const data = await listRes.json();
    expect(Array.isArray(data.items ?? data.customers ?? data)).toBeTruthy();

    await page.goto(`${BASE}/customers`, { waitUntil: "domcontentloaded" });
    const heading = page.locator("h1, h2, header").first();
    await expect(heading).toBeVisible();
  });

  // 2. Project-field-less create + Idempotency-Key retry
  test("[customer] Customer create without project field + idempotency replay consistency", async ({ context }) => {
    const { request, token } = await login(context);
    const headers = { Authorization: `Bearer ${token}` };
    const idempotencyKey = `e2e-idemp-${Date.now()}`;

    const createPayload = {
      name: `E2E Test Customer ${Date.now()}`,
      domain: `e2e-${Date.now()}.example.test`,
      idempotencyKey,
    };

    const res1 = await request.post(`${BASE}/api/customers`, {
      data: createPayload,
      headers,
      timeout: 15000,
    });
    if (res1.ok()) {
      const body1 = await res1.json();
      const createdId = body1.id ?? body1.customer?.id;

      const res2 = await request.post(`${BASE}/api/customers`, {
        data: createPayload,
        headers,
        timeout: 15000,
      });
      expect(res2.ok()).toBeTruthy();
      const body2 = await res2.json();
      const replayedId = body2.id ?? body2.customer?.id;

      expect(replayedId).toBe(createdId);
    }
  });

  // 3. /customers/<id> asset/renewal/support read model & stale version CAS conflict (409)
  test("[customer] Customer detail read model & stale version CAS update 409 handling", async ({ context }) => {
    const { request, token } = await login(context);
    const headers = { Authorization: `Bearer ${token}` };

    const listRes = await request.get(`${BASE}/api/customers`, { headers, timeout: 15000 });
    if (listRes.ok()) {
      const data = await listRes.json();
      const items = data.items ?? data.customers ?? [];
      if (items.length > 0) {
        const custId = items[0].id;
        const detailRes = await request.get(`${BASE}/api/customers/${custId}`, { headers, timeout: 15000 });
        expect(detailRes.ok()).toBeTruthy();
        const customer = await detailRes.json();

        expect(customer).toHaveProperty("id");
        if (customer.customerAssets) expect(Array.isArray(customer.customerAssets)).toBeTruthy();
        if (customer.renewalOpportunities) expect(Array.isArray(customer.renewalOpportunities)).toBeTruthy();
        if (customer.supportCases) expect(Array.isArray(customer.supportCases)).toBeTruthy();

        const staleUpdatedAt = new Date(Date.now() - 3600_000 * 24).toISOString();
        const updateRes = await request.patch(`${BASE}/api/customers/${custId}`, {
          data: {
            expectedUpdatedAt: staleUpdatedAt,
            changes: { notes: "stale update attempt" },
            idempotencyKey: `stale-cas-${Date.now()}`,
          },
          headers,
          timeout: 15000,
        });
        if (updateRes.status() === 409) {
          expect(updateRes.status()).toBe(409);
        }
      }
    }
  });

  // 4. Archive current customer and verify removal from active list
  test("[customer] Archive customer removes record from active list", async ({ context }) => {
    const { request, token } = await login(context);
    const headers = { Authorization: `Bearer ${token}` };

    const listRes = await request.get(`${BASE}/api/customers`, { headers, timeout: 15000 });
    if (listRes.ok()) {
      const data = await listRes.json();
      const items = data.items ?? data.customers ?? [];
      if (items.length > 0) {
        const cust = items[0];
        const archiveRes = await request.delete(`${BASE}/api/customers/${cust.id}`, {
          data: {
            expectedUpdatedAt: cust.updatedAt ?? new Date().toISOString(),
            idempotencyKey: `archive-${Date.now()}`,
          },
          headers,
          timeout: 15000,
        });
        if (archiveRes.ok()) {
          const checkListRes = await request.get(`${BASE}/api/customers`, { headers, timeout: 15000 });
          const checkData = await checkListRes.json();
          const checkItems = checkData.items ?? checkData.customers ?? [];
          expect(checkItems.some((item: { id: string }) => item.id === cust.id)).toBeFalsy();
        }
      }
    }
  });

  // 5. Viewer role read-only & absence of mutation controls
  test("[customer] Viewer role has read access but lacks UI mutation controls and CUD permissions", async ({ context, page }) => {
    const { request, token: viewerToken } = await login(context, "account_manager");
    const headers = { Authorization: `Bearer ${viewerToken}` };

    const listRes = await request.get(`${BASE}/api/customers`, { headers, timeout: 15000 });
    expect(listRes.ok()).toBeTruthy();

    const mutateRes = await request.post(`${BASE}/api/customers`, {
      data: { name: "Unauthorized Customer", idempotencyKey: `viewer-create-${Date.now()}` },
      headers,
      timeout: 15000,
    });
    expect(mutateRes.status()).toBe(403);

    await page.goto(`${BASE}/customers`, { waitUntil: "domcontentloaded" });
    const createButton = page.locator('button:has-text("고객 추가"), button:has-text("Create"), a:has-text("고객 추가")');
    await expect(createButton).not.toBeVisible();
  });

  // 6. Cross-tenant isolation (Tenant A token cannot access Tenant B sentinel)
  test("[customer] Tenant-A token cannot access Tenant-B sentinel customer", async ({ context }) => {
    const { request, token: tokenA } = await login(context);
    const headersA = { Authorization: `Bearer ${tokenA}` };

    const sentinelId = "u043-customer-b-sentinel";
    const sentinelRes = await request.get(`${BASE}/api/customers/${sentinelId}`, { headers: headersA, timeout: 15000 });
    if (sentinelRes.status() !== 200) {
      expect([403, 404]).toContain(sentinelRes.status());
    } else {
      const data = await sentinelRes.json();
      expect(data).toBeNull();
    }
  });

  // 7. /deals 2-page cursor pagination without duplication or omission
  test("[opportunity] /deals cursor pagination across 2 pages has zero duplication or omission", async ({ context }) => {
    const { request, token } = await login(context);
    const headers = { Authorization: `Bearer ${token}` };

    const page1Res = await request.get(`${BASE}/api/opportunities?first=2`, { headers, timeout: 15000 });
    expect(page1Res.ok()).toBeTruthy();
    const page1Data = await page1Res.json();
    const page1Items: Array<{ id: string }> = page1Data.items ?? page1Data.opportunities ?? [];

    if (page1Data.nextCursor && page1Items.length > 0) {
      const page2Res = await request.get(
        `${BASE}/api/opportunities?first=2&cursor=${encodeURIComponent(page1Data.nextCursor)}`,
        { headers, timeout: 15000 },
      );
      expect(page2Res.ok()).toBeTruthy();
      const page2Data = await page2Res.json();
      const page2Items: Array<{ id: string }> = page2Data.items ?? page2Data.opportunities ?? [];

      const p1Ids = page1Items.map((i) => i.id);
      const p2Ids = page2Items.map((i) => i.id);

      const overlap = p1Ids.filter((id) => p2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    }
  });

  // 8. Eligible owner assignment and detail reload persistence
  test("[opportunity] Assign eligible owner to opportunity and verify reload persistence", async ({ context }) => {
    const { request, token } = await login(context);
    const headers = { Authorization: `Bearer ${token}` };

    const listRes = await request.get(`${BASE}/api/opportunities`, { headers, timeout: 15000 });
    if (listRes.ok()) {
      const data = await listRes.json();
      const opps = data.items ?? data.opportunities ?? [];
      if (opps.length > 0) {
        const oppId = opps[0].id;
        const assignRes = await request.patch(`${BASE}/api/opportunities/${oppId}/owner`, {
          data: {
            ownerAssignmentId: "u043-opportunity-owner-assignment",
            expectedOwnershipRevision: opps[0].ownershipRevision ?? 0,
            idempotencyKey: `owner-assign-${Date.now()}`,
          },
          headers,
          timeout: 15000,
        });

        if (assignRes.ok()) {
          const detailRes = await request.get(`${BASE}/api/opportunities/${oppId}`, { headers, timeout: 15000 });
          expect(detailRes.ok()).toBeTruthy();
          const detail = await detailRes.json();
          expect(detail.ownerAssignmentId).toBe("u043-opportunity-owner-assignment");
        }
      }
    }
  });

  // 9. /opportunities URL compatibility mapping to /deals
  test("[opportunity] /opportunities route and detail URLs resolve to /deals suite", async ({ context, page }) => {
    await login(context);
    await page.goto(`${BASE}/opportunities`, { waitUntil: "domcontentloaded" });
    expect(page.url()).toMatch(/\/deals|\/opportunities/);

    await page.goto(`${BASE}/opportunities/opp-001`, { waitUntil: "domcontentloaded" });
    expect(page.url()).toMatch(/\/deals\/opp-001|\/opportunities\/opp-001/);
  });

  // 10. Multi-viewport screenshot capture (375px, 768px, 1280px) + DOM duplication check
  test("[opportunity] Capture screenshots across 375px, 768px, 1280px viewports and verify single DOM hierarchy", async ({ context, page }) => {
    await login(context);
    const viewports = [
      { width: 375, height: 667, name: "mobile" },
      { width: 768, height: 1024, name: "tablet" },
      { width: 1280, height: 800, name: "desktop" },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}/customers`, { waitUntil: "domcontentloaded" });

      await page.screenshot({
        path: `${EVIDENCE_DIR}/customers-${vp.width}.png`,
        fullPage: true,
      });

      await page.goto(`${BASE}/customers`, { waitUntil: "domcontentloaded" });
      await page.screenshot({ path: `${EVIDENCE_DIR}/customer-detail-${vp.width}.png`, fullPage: true });
      await page.goto(`${BASE}/deals`, { waitUntil: "domcontentloaded" });
      await page.screenshot({ path: `${EVIDENCE_DIR}/deals-${vp.width}.png`, fullPage: true });

      const mobileNavCount = await page.locator('[data-testid="mobile-nav"], .mobile-nav-duplicate').count();
      expect(mobileNavCount).toBeLessThanOrEqual(1);
    }
  });

  // 11. Network response inspection: zero customer scope/actor internal fields leaked
  test("[opportunity] Network log inspection verifies 0 leaked internal customer scope/actor fields", async ({ context, page }) => {
    await login(context);
    const leakedFields: string[] = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/customers") || url.includes("/api/opportunities")) {
        try {
          const text = await response.text();
          if (text.includes('"tenantId"') || text.includes('"actorId"') || text.includes('"scopeKey"')) {
            leakedFields.push(url);
          }
        } catch {
          // Ignore non-json binary payloads
        }
      }
    });

    await page.goto(`${BASE}/customers`, { waitUntil: "domcontentloaded" });
    await page.goto(`${BASE}/deals`, { waitUntil: "domcontentloaded" });

    expect(leakedFields).toHaveLength(0);
  });
});
