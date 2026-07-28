import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "../../..");
const repositoryRoot = resolve(webRoot, "../..");
const toastPath = join(here, "toast.tsx");
const uiPackage = "@sangfor/" + "ui";
const uiPath = "packages/" + "ui";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function listFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return listFiles(child);
    return statSync(child).isFile() ? [child] : [];
  });
}

describe("app-local toast and health ownership (U029)", () => {
  it("owns the ToastProvider/useToast contract with deterministic IDs, a labelled live region, a bounded queue, and cleanup", () => {
    expect(existsSync(toastPath)).toBe(true);

    const source = existsSync(toastPath) ? read(toastPath) : "";
    expect(source).toMatch(/export\s+function\s+ToastProvider/);
    expect(source).toMatch(/export\s+function\s+useToast/);
    expect(source).toMatch(/useId/);
    expect(source).toMatch(/MAX_TOASTS/);
    expect(source).toMatch(/slice\(/);
    expect(source).toMatch(/aria-label=["']알림["']/);
    expect(source).toMatch(/aria-live=/);
    expect(source).toMatch(/role=["']status["']/);
    expect(source).toMatch(/clearTimeout/);
    expect(source).toMatch(/<button/);
    expect(source).not.toMatch(/[✅❌⚠️ℹ️✕]/u);
  });

  it("adapts the portal error boundary to the app-local ErrorState message/action API", () => {
    const source = read(join(webRoot, "src/app/(portal)/error.tsx"));

    expect(source).toContain('from "@/components/ui/states"');
    expect(source).toMatch(/<ErrorState[\s\S]*message=/);
    expect(source).toMatch(/<ErrorState[\s\S]*action=/);
    expect(source).not.toMatch(/<ErrorState[\s\S]*(?:\berror=|\bdetails=|\bretry=)/);
  });

  it("makes every public web health route a direct U006 canonical-health consumer", () => {
    for (const relativePath of [
      "src/app/api/health/route.ts",
      "src/app/api/unified-health/route.ts",
      "src/app/api/integrations/health/route.ts",
    ]) {
      expect(read(join(webRoot, relativePath))).toContain('from "@sangfor/health"');
    }
  });

  it("contains no remaining web source, stylesheet, test, or manifest dependency on the retired package", () => {
    const candidates = [
      ...listFiles(join(webRoot, "src")),
      ...listFiles(join(repositoryRoot, "tests/e2e/playwright")),
      join(webRoot, "package.json"),
    ];
    const offenders = candidates.filter((path) => {
      const source = read(path);
      return source.includes(uiPackage) || source.includes(uiPath);
    });

    expect(offenders).toEqual([]);
  });
});
