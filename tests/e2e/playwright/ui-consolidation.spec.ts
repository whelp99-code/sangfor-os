import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const evidenceDir = process.env.ACCEPTANCE_EVIDENCE_DIR;
const baseURL = `http://127.0.0.1:${process.env.PORT ?? "3101"}`;

function requireEvidenceDir(): string {
  if (!evidenceDir) throw new Error("ACCEPTANCE_EVIDENCE_DIR is required for U029 evidence");
  mkdirSync(evidenceDir, { recursive: true });
  return evidenceDir;
}

async function assertHealthResponses(page: Page) {
  const responses: Record<string, unknown> = {};
  for (const path of ["/api/health", "/api/unified-health", "/api/integrations/health"]) {
    const response = await page.request.get(`${baseURL}${path}`);
    expect([200, 503]).toContain(response.status());
    const body = await response.json();
    expect(["ok", "degraded", "error"]).toContain(body.overall);
    expect(body.summary).toBeTruthy();
    expect(Array.isArray(body.services)).toBeTruthy();
    if (body.overall !== "ok") {
      expect(body.summary.ok).not.toBe(body.summary.total);
    }
    responses[path] = { status: response.status(), body };
  }
  writeFileSync(
    join(requireEvidenceDir(), "health-response.json"),
    `${JSON.stringify(responses, null, 2)}\n`,
  );
}

test("U029 app-local primitives and canonical health are honest at all required viewports", async ({ page }) => {
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });

    await page.goto(`${baseURL}/login`);
    await expect(page.getByText("SANGFOR Partner OS")).toBeVisible();

    await page.goto(`${baseURL}/`);
    await expect(page.locator("#main-content")).toBeVisible();

    // This is a real portal action. The intercepted response only makes its
    // failure deterministic; SlipActions still calls the app-local useToast.
    await page.goto(`${baseURL}/inbox`);
    const action = page.getByRole("button", { name: "거부" }).first();
    await expect(action).toBeVisible();
    await page.route("**/api/mail-candidates/**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "검증용 처리 실패" }),
      });
    });
    await action.click();

    const toast = page.getByRole("status").filter({ hasText: "검증용 처리 실패" });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute("aria-live", "assertive");
    expect((await toast.innerText()).trim()).toContain("검증용 처리 실패");
    const close = toast.getByRole("button", { name: /알림 닫기/ });
    await close.focus();
    await page.keyboard.press("Enter");
    await expect(toast).toHaveCount(0);
    await page.unroute("**/api/mail-candidates/**");

    // The portal boundary's loading/error UI is rendered during a real route
    // transition. Its capture is retained even when the server resolves fast.
    await page.goto(`${baseURL}/inbox`, { waitUntil: "commit" });
    await page.screenshot({
      path: join(requireEvidenceDir(), `ui-consolidation-${width}.png`),
      fullPage: true,
    });
  }

  await assertHealthResponses(page);
});
