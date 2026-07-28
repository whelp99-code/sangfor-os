#!/usr/bin/env node
/**
 * U030 — exact dead-code removal boundary.
 *
 * This is deliberately a post-removal contract. Before the exact removal it
 * fails while still reporting the consumer evidence needed by the RED receipt.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DELETION_SET = [
  "apps/web/src/components/cfo/dashboard-charts.tsx",
  "apps/web/src/components/cfo/runway-gauge.tsx",
  "apps/web/src/components/color-agents/color-agent-dashboard.tsx",
  "apps/web/src/components/companies/customer-hub-header.tsx",
  "apps/web/src/components/customers/customer-search-form.tsx",
  "apps/web/src/components/dashboard/aios-v3-status-card.tsx",
  "apps/web/src/components/dashboard/charts/index.ts",
  "apps/web/src/components/dashboard/daily-report-section.tsx",
  "apps/web/src/components/opportunities/pipeline-board.tsx",
  "apps/web/src/components/portal/portal-actions.tsx",
  "apps/web/src/components/shell/skeleton-page.tsx",
  "apps/web/src/components/ui/avatar.tsx",
  "apps/web/src/components/ui/page-header.tsx",
  "apps/web/src/components/views/record-layout.tsx",
  "apps/web/src/lib/mail-adapter.ts",
  "apps/web/src/lib/auth/api-key.ts",
  "apps/web/src/lib/status-display.ts",
  "packages/shared/src/tracing/otel.ts",
];
const PROTECTED_FIXTURES = {
  "apps/web/src/components/customers/customers-data-table.tsx": "U062",
  "apps/web/src/components/dashboard/role-dashboard.tsx": "U063",
  "apps/web/src/components/opportunities/edit-opportunity-form.tsx": "U043",
};
const OTEL_DIRECT_DEPS = [
  "@opentelemetry/api",
  "@opentelemetry/exporter-jaeger",
  "@opentelemetry/resources",
  "@opentelemetry/sdk-trace-base",
  "@opentelemetry/sdk-trace-node",
  "@opentelemetry/semantic-conventions",
];

function read(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function gitGrep(needle) {
  try {
    const output = execFileSync(
      "git",
      ["grep", "-n", "-F", needle, "--", ":(exclude)scripts/check-u030-structural.mjs"],
      { cwd: ROOT, encoding: "utf8" },
    );
    return output.trim().split("\n").filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

function sourceConsumerLines(needle) {
  return gitGrep(needle).filter((line) =>
    /^(apps\/[^/]+\/src|packages\/[^/]+\/src|services\/[^/]+\/[^/]+\/src)/.test(line),
  );
}

const failures = [];
const presentTargets = DELETION_SET.filter((path) => existsSync(resolve(ROOT, path)));
if (presentTargets.length) failures.push(`U030 targets still present: ${presentTargets.join(", ")}`);

const missingProtectedFixtures = Object.keys(PROTECTED_FIXTURES).filter((path) => !existsSync(resolve(ROOT, path)));
if (missingProtectedFixtures.length) failures.push(`protected fixtures missing: ${missingProtectedFixtures.join(", ")}`);

const packageUiPresent = existsSync(resolve(ROOT, "packages/ui"));
if (packageUiPresent) failures.push("packages/ui still exists");

const sharedPackage = JSON.parse(read("packages/shared/package.json"));
if (sharedPackage.exports?.["./tracing"]) failures.push("@sangfor/shared ./tracing export remains");
const remainingOtelDependencies = OTEL_DIRECT_DEPS.filter((name) => sharedPackage.dependencies?.[name]);
if (remainingOtelDependencies.length) failures.push(`shared direct OTel dependencies remain: ${remainingOtelDependencies.join(", ")}`);

const webPackage = JSON.parse(read("apps/web/package.json"));
if (webPackage.dependencies?.["@sangfor/ui"] || webPackage.devDependencies?.["@sangfor/ui"]) {
  failures.push("apps/web still declares @sangfor/ui");
}

const lockfile = read("pnpm-lock.yaml");
if (lockfile.includes("packages/ui:") || lockfile.includes("link:../../packages/ui")) {
  failures.push("pnpm-lock.yaml still contains packages/ui importer or link");
}

const currentGuides = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "apps/web/AGENTS.md",
  "packages/shared/AGENTS.md",
  "docs/DEV_REFERENCE.md",
  "docs/ONBOARDING.md",
  "docs/12_VERIFICATION/entrypoint-inventory.md",
];
const staleGuideRefs = currentGuides.flatMap((path) => {
  const text = read(path);
  return ["@sangfor/ui", "packages/ui"].filter((needle) => text.includes(needle)).map((needle) => `${path}: ${needle}`);
});
if (staleGuideRefs.length) failures.push(`stale current-guide UI references: ${staleGuideRefs.join("; ")}`);

const inventory = JSON.parse(read("docs/12_VERIFICATION/entrypoint-inventory.json"));
const staleInventoryEntries = (inventory.entries ?? []).filter((entry) =>
  DELETION_SET.includes(entry.path) || entry.name === "@sangfor/ui" || String(entry.path).startsWith("packages/ui/"),
);
if (staleInventoryEntries.length) failures.push("entrypoint inventory retains a deleted U030 candidate or UI export");
const receipt = inventory.removalReceipts?.U030;
if (!receipt || receipt.deletedSourceCount !== 18 || receipt.plannedOwnerConflicts?.length !== 0) {
  failures.push("entrypoint inventory lacks the U030 no-conflict removal receipt");
}
for (const [fixture, owner] of Object.entries(PROTECTED_FIXTURES)) {
  if (receipt?.protectedFixtures?.[fixture] !== owner) failures.push(`U030 receipt lacks protected fixture owner ${fixture}=${owner}`);
}

if (!existsSync(resolve(ROOT, "packages/infra/src/tracing.ts"))) failures.push("active packages/infra tracing path missing");
if (!existsSync(resolve(ROOT, "packages/health/src"))) failures.push("active packages/health path missing");

const consumerEvidence = {
  ui: sourceConsumerLines("@sangfor/ui"),
  tracing: ["@sangfor/shared/tracing", "tracing/otel"].flatMap((needle) => sourceConsumerLines(needle)),
  deletionImportSuffixes: Object.fromEntries(
    DELETION_SET.map((path) => {
      const extensionless = path.replace(/\.[^.]+$/, "");
      const alias = extensionless.startsWith("apps/web/src/")
        ? `@/${extensionless.slice("apps/web/src/".length)}`
        : extensionless;
      return [path, sourceConsumerLines(alias)];
    }),
  ),
};
const liveConsumerHits = [
  ...consumerEvidence.ui,
  ...consumerEvidence.tracing,
  ...Object.values(consumerEvidence.deletionImportSuffixes).flat(),
];
if (liveConsumerHits.length) failures.push(`tracked consumer references remain: ${liveConsumerHits.join("; ")}`);

process.stdout.write(`${JSON.stringify({
  unit: "U030",
  deletionSet: DELETION_SET,
  protectedFixtures: PROTECTED_FIXTURES,
  presentTargets,
  packageUiPresent,
  remainingOtelDependencies,
  consumerEvidence,
  failures,
}, null, 2)}\n`);
process.exitCode = failures.length ? 1 : 0;
