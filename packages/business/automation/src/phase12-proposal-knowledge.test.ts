import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("Phase 12 proposal generator", () => {
  it("generates multi-template proposal with versions", async () => {
    const { generateProposal, saveDocumentVersion, getGeneratedDocumentDetail } =
      await import("./proposal-generator");

    const doc = await generateProposal({
      projectSlug: "demo-project",
      templateKey: "poc-summary",
      title: `Proposal ${Date.now()}`,
      variables: {},
    });
    expect(doc?.versions.length).toBe(1);

    await saveDocumentVersion(doc!.id, `${doc!.bodyMarkdown}\n\n## Revision`);
    const detail = await getGeneratedDocumentDetail(doc!.id);
    expect(detail?.versions.length).toBeGreaterThanOrEqual(2);
  }, 20_000);
});

describe.skipIf(!integrationEnabled)("Phase 12 knowledge search", () => {
  it("chunks documents and returns citations", async () => {
    const {
      createKnowledgeDocument,
      searchKnowledgeWithCitations,
      buildContextPack,
    } = await import("./knowledge-search");

    const uniqueQuery = `Sangfor HCI ${Date.now()}`;
    const doc = await createKnowledgeDocument({
      projectSlug: "demo-project",
      title: `KB ${Date.now()}`,
      body: `${uniqueQuery} virtualization platform for enterprise workloads.`,
      tags: ["hci"],
      source: "test",
    });

    const citations = await searchKnowledgeWithCitations({
      projectSlug: "demo-project",
      q: uniqueQuery,
    });
    expect(citations.some((c) => c.documentId === doc.id)).toBe(true);

    const pack = await buildContextPack(uniqueQuery);
    expect(pack.length).toBeGreaterThan(0);
  }, 20_000);
});

describe.skipIf(!integrationEnabled)("Phase 12 executive dashboard widgets", () => {
  it("returns widget lists with seed data", async () => {
    const { getDashboardWidgets } = await import("./executive-dashboard");
    const widgets = await getDashboardWidgets();
    expect(widgets.devStatus).toBeDefined();
    expect(Array.isArray(widgets.todayTasks)).toBe(true);
  }, 15_000);
});
