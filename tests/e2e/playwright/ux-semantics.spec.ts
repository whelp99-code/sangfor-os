import { test, expect } from "@playwright/test";
import { installAuthProfile } from "./support/auth-profile";

test.describe("U065 UX Semantics E2E", () => {
  test("anonymous login has one H1 and named controls", async ({ context, page }) => {
    await installAuthProfile(context, "anonymous");
    await page.goto("/login", { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).toBe("/login");
    await expect(page.locator("h1:visible")).toHaveCount(1);
    const controls = page.locator("input, select, textarea, button, a[href]");
    for (let index = 0; index < await controls.count(); index += 1) {
      await expect(controls.nth(index)).toHaveAccessibleName(/\S/);
    }
  });

  test("authenticated task surface has deterministic headings and named controls", async ({ context, page }) => {
    await installAuthProfile(context, "account_manager");
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto("/tasks", { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).toBe("/tasks");
    expect(new URL(page.url()).pathname).not.toBe("/login");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("h1:visible")).toHaveCount(1);
    expect(consoleErrors.filter((message) => /hydration/i.test(message))).toEqual([]);

    const controls = page.locator("input, select, textarea, button, a[href]");
    for (let index = 0; index < await controls.count(); index += 1) {
      await expect(controls.nth(index)).toHaveAccessibleName(/\S/);
    }
  });

  test("root not-found remains localized and distinct from empty/error", async ({ context, page }) => {
    await installAuthProfile(context, "system_admin");
    const response = await page.goto("/__ux-missing-route__", { waitUntil: "networkidle" });
    expect(response?.status()).toBe(404);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("h1:visible")).toHaveCount(1);
    await expect(page.getByText(/찾을 수 없|존재하지 않/)).toBeVisible();
    await expect(page.getByText("불러오는 중…")).toHaveCount(0);
    await expect(page.getByText("오류가 발생했습니다")).toHaveCount(0);
  });
});
