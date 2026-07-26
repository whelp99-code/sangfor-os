import { describe, expect, it, afterAll, beforeAll } from "vitest";

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("rejectMailDerivedCandidate — A-8 rejection learning", () => {
  const tag = `test_REJ_${Date.now()}`;
  const tenantId = `${tag}_tenant`;
  const companyId = `${tag}_company`;
  const projectId = `${tag}_project`;
  let candidateId: string | undefined;

  beforeAll(async () => {
    const { prisma } = await import("@sangfor/db");
    await prisma.tenant.create({ data: { id: tenantId, slug: tenantId, name: tag, status: "active" } });
    await prisma.company.create({ data: { id: companyId, tenantId, slug: companyId, name: tag } });
    await prisma.project.create({ data: { id: projectId, companyId, slug: projectId, name: tag } });
  });

  afterAll(async () => {
    const { prisma } = await import("@sangfor/db");
    if (candidateId) {
      await prisma.domainMemory.deleteMany({ where: { key: { contains: candidateId } } });
      await prisma.domainDecisionLog.deleteMany({ where: { caseRef: `mail_candidate:${candidateId}` } });
      await prisma.mailDerivedCandidate.deleteMany({ where: { id: candidateId } });
      await prisma.improvementCandidate.deleteMany({ where: { sourceId: candidateId } });
    }
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it("records a rejected-outcome DomainMemory for ANY reasonCode (negative learning)", async () => {
    const { prisma } = await import("@sangfor/db");
    const { rejectMailDerivedCandidate } = await import("./candidates-update");

    const candidate = await prisma.mailDerivedCandidate.create({
      data: {
        candidateType: "customer",
        title: `Customer: ${tag}`,
        summary: "Test rejection-learning candidate",
        status: "proposed",
        confidence: 70,
        sourceSender: "someone@test-rejection.example",
      },
    });
    candidateId = candidate.id;

    await rejectMailDerivedCandidate(candidate.id, { reasonCode: "not_business" });

    const memory = await prisma.domainMemory.findFirst({
      where: { key: `mail_candidate:${candidate.id}:sales` },
    });
    expect(memory).not.toBeNull();
    expect(memory!.outcome).toBe("rejected");
    expect(memory!.source).toBe("human");
    expect(memory!.tags).toContain("intent:rejected");
    expect(memory!.tags).toContain("sender:test-rejection.example");
  });
});
