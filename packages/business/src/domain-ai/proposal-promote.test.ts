import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

// src/domain-ai → repo root is four levels up (domain-ai → src → business → packages → root).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";

// DB-backed: promote reads a real engagement→opportunity→project chain. Shared DB, so
// every created row carries an IT_PROMOTE_ tag and afterAll deletes them in reverse order.
describe.skipIf(!integrationEnabled)("promoteDomainProposalToDocument", () => {
  const tag = `IT_PROMOTE_${Date.now()}`;
  let projectId = "";
  let customerId = "";
  let opportunityId = "";
  let engagementId = "";

  beforeAll(async () => {
    const { prisma } = await import("@sangfor/db");
    const { convertOpportunityToProject } = await import("../engagement-center");
    const project = await prisma.project.findFirstOrThrow();
    projectId = project.id;
    const customer = await prisma.customer.create({
      data: { projectId, name: `${tag} 고객` },
    });
    customerId = customer.id;
    const opp = await prisma.opportunity.create({
      data: { projectId, customerId, title: `${tag} 기회`, stage: "POC", amount: "100" },
    });
    opportunityId = opp.id;
    // force bypasses stage+POC gates; we only need an engagement with the project chain.
    const conv = await convertOpportunityToProject({ opportunityId, force: true });
    engagementId = conv.engagement.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@sangfor/db");
    const docs = await prisma.generatedDocument.findMany({
      where: { engagementId },
      select: { id: true },
    });
    const docIds = docs.map((d) => d.id);
    if (docIds.length) {
      await prisma.documentVersion.deleteMany({ where: { generatedDocumentId: { in: docIds } } });
    }
    await prisma.generatedDocument.deleteMany({ where: { engagementId } });
    // domain-ai template is a shared per-project resource (upserted) — other real
    // documents reference it, so we must NOT delete it here.
    await prisma.engagement.deleteMany({ where: { id: engagementId } });
    await prisma.opportunity.deleteMany({ where: { id: opportunityId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
  });

  it("승인 시 GeneratedDocument + DocumentVersion(v1)을 만든다", async () => {
    const { prisma } = await import("@sangfor/db");
    const { promoteDomainProposalToDocument } = await import("./proposal-promote");
    const r = await promoteDomainProposalToDocument({
      engagementId,
      domain: "presales",
      title: `${tag} 제안`,
      bodyMarkdown: "# 본문",
    });
    expect(r).not.toBeNull();
    const doc = await prisma.generatedDocument.findUnique({ where: { id: r!.documentId } });
    expect(doc?.status).toBe("approved");
    expect(doc?.engagementId).toBe(engagementId);
    const v = await prisma.documentVersion.findFirst({
      where: { generatedDocumentId: r!.documentId },
    });
    expect(v?.version).toBe(1);
  });

  it("같은 프로젝트 2회 승격 시 domain-ai 템플릿은 1개만 upsert된다", async () => {
    const { prisma } = await import("@sangfor/db");
    const { promoteDomainProposalToDocument } = await import("./proposal-promote");
    await promoteDomainProposalToDocument({
      engagementId,
      domain: "presales",
      title: `${tag} 2`,
      bodyMarkdown: "본문2",
    });
    const templates = await prisma.documentTemplate.findMany({
      where: { projectId, templateKey: "domain-ai" },
    });
    expect(templates.length).toBe(1);
  });

  it("체인이 없으면(가짜 engagementId) null 반환, 아무것도 만들지 않는다", async () => {
    const { prisma } = await import("@sangfor/db");
    const { promoteDomainProposalToDocument } = await import("./proposal-promote");
    const before = await prisma.generatedDocument.count();
    const r = await promoteDomainProposalToDocument({
      engagementId: "nonexistent-id",
      domain: "sales",
      title: "x",
      bodyMarkdown: "y",
    });
    expect(r).toBeNull();
    expect(await prisma.generatedDocument.count()).toBe(before);
  });
});
