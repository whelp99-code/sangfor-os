import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";
const dbIntegrationEnabled =
  integrationEnabled && Boolean(process.env.DATABASE_URL?.trim());

describe("phase14 context pack unit", () => {
  it("produces deterministic template output without OpenAI", async () => {
    const { renderDeterministicTemplate } = await import("./template-registry");
    const pack = {
      sourceEntityType: null,
      sourceEntityId: null,
      templateKey: "dev-implementation-plan" as const,
      summaryText: "sample",
      sections: [
        {
          key: "linkedTasks" as const,
          title: "Linked tasks",
          empty: true,
          content: "(no data)",
        },
      ],
    };
    const output = renderDeterministicTemplate(
      "dev-implementation-plan",
      pack,
      "Add context pack engine",
    );
    expect(output.deterministic).toBe(true);
    expect(output.bodyMarkdown).toContain("Development implementation plan");
    expect(output.bodyMarkdown).toContain("Add context pack engine");
    expect(output.bodyMarkdown).toMatch(/Mail OAuth/i);
  });

  it("infers template key from source entity type", async () => {
    const { inferTemplateKeyFromSource } = await import("./context-pack-builder");
    expect(inferTemplateKeyFromSource("proposal")).toBe("proposal-prd");
    expect(inferTemplateKeyFromSource("poc")).toBe("poc-experiment-plan");
    expect(inferTemplateKeyFromSource("opportunity")).toBe("dev-implementation-plan");
    expect(inferTemplateKeyFromSource(undefined, "release-closeout-plan")).toBe(
      "release-closeout-plan",
    );
  });

  it("lists all template registry keys", async () => {
    const { listTemplateKeys, TEMPLATE_REGISTRY } = await import("./template-registry");
    const keys = listTemplateKeys();
    expect(keys).toHaveLength(5);
    for (const key of keys) {
      expect(TEMPLATE_REGISTRY[key].title.length).toBeGreaterThan(2);
    }
  });
});

describe.skipIf(!dbIntegrationEnabled)("phase14 context pack integration", () => {
  it("renders empty sections when entity is missing", async () => {
    const { buildContextPack } = await import("./context-pack-builder");
    const pack = await buildContextPack({
      projectSlug: "demo-project",
      sourceEntityType: "opportunity",
      sourceEntityId: `non-existent-opportunity-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
    });
    expect(pack.sections).toHaveLength(7);
    const entitySections = pack.sections.filter(
      (section) => section.key !== "knowledgeCitations",
    );
    expect(entitySections.every((s) => s.empty)).toBe(true);
  }, 30_000);

  it("builds opportunity context pack with non-empty opportunity section", async () => {
    const { createOpportunity } = await import("../opportunity-center");
    const { buildContextPack } = await import("./context-pack-builder");
    const opp = await createOpportunity({
      title: "Phase 14 context pack test opp",
      customerId: undefined,
    });
    const pack = await buildContextPack({
      projectSlug: "demo-project",
      sourceEntityType: "opportunity",
      sourceEntityId: opp.id,
    });
    const opportunitySection = pack.sections.find((s) => s.key === "opportunity");
    expect(opportunitySection?.empty).toBe(false);
    expect(opportunitySection?.content).toContain("Phase 14");
  }, 30_000);

  it("builds poc context pack", async () => {
    const { createPocProject } = await import("../poc-center");
    const { buildContextPack } = await import("./context-pack-builder");
    const poc = await createPocProject({
      projectSlug: "demo-project",
      title: "Phase 14 PoC pack test",
    });
    expect(poc).not.toBeNull();
    const pack = await buildContextPack({
      projectSlug: "demo-project",
      sourceEntityType: "poc",
      sourceEntityId: poc!.id,
    });
    const pocSection = pack.sections.find((s) => s.key === "poc");
    expect(pocSection?.empty).toBe(false);
  }, 30_000);

  it("builds proposal context pack", async () => {
    const { generateProposal } = await import("../proposal-generator");
    const { buildContextPack } = await import("./context-pack-builder");
    const doc = await generateProposal({
      projectSlug: "demo-project",
      title: "Phase 14 proposal pack",
      templateKey: "standard-proposal",
      variables: {},
    });
    expect(doc).not.toBeNull();
    const pack = await buildContextPack({
      projectSlug: "demo-project",
      sourceEntityType: "proposal",
      sourceEntityId: doc!.id,
    });
    const proposalSection = pack.sections.find((s) => s.key === "proposal");
    expect(proposalSection?.empty).toBe(false);
  }, 30_000);

  it("handles missing task links with empty linkedTasks section", async () => {
    const { createOpportunity } = await import("../opportunity-center");
    const { buildContextPack } = await import("./context-pack-builder");
    const opp = await createOpportunity({ title: "No links opp" });
    const pack = await buildContextPack({
      projectSlug: "demo-project",
      sourceEntityType: "opportunity",
      sourceEntityId: opp.id,
    });
    const tasks = pack.sections.find((s) => s.key === "linkedTasks");
    expect(tasks?.empty).toBe(true);
  }, 30_000);

  it("enriches phase13 run with contextPack in response", async () => {
    const { createOpportunity } = await import("../opportunity-center");
    const { runPhase13Orchestrator } = await import("../skills/phase13-orchestrator");
    const opp = await createOpportunity({ title: "Phase 14 orchestrator enrich" });
    const result = await runPhase13Orchestrator({
      projectSlug: "demo-project",
      inputSummary: "Implement context pack on orchestrator",
      sourceEntityType: "opportunity",
      sourceEntityId: opp.id,
      templateKey: "dev-implementation-plan",
    });
    expect(result.contextPack).not.toBeNull();
    expect(result.handoffDraft?.contextPackSummary).toBeTruthy();
    expect(result.templateOutput?.deterministic).toBe(true);
  }, 60_000);
});
