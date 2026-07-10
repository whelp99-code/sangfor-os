import { describe, expect, it, afterAll } from "vitest";

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("rejectMailDerivedCandidate — A-8 rejection learning", () => {
  const tag = `test_REJ_${Date.now()}`;
  let candidateId: string | undefined;

  afterAll(async () => {
    const { prisma } = await import("@sangfor/db");
    if (candidateId) {
      await prisma.domainMemory.deleteMany({ where: { key: { contains: candidateId } } });
      await prisma.domainDecisionLog.deleteMany({ where: { caseRef: `mail_candidate:${candidateId}` } });
      await prisma.mailDerivedCandidate.deleteMany({ where: { id: candidateId } });
      await prisma.improvementCandidate.deleteMany({ where: { sourceId: candidateId } });
    }
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
