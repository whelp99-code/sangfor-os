import { describe, expect, it, beforeAll, afterAll } from "vitest";

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("convertApprovedMailCandidates — opportunity dedup & createdEntityId", () => {
  const tag = `test_OPP_${Date.now()}`;
  let candidateIds: string[] = [];
  let cleanProjectId = "";

  beforeAll(async () => {
    const { prisma } = await import("@sangfor/db");
    const { resolveDefaultProjectId } = await import("./default-project");
    cleanProjectId = await resolveDefaultProjectId(prisma);
  });

  afterAll(async () => {
    const { prisma } = await import("@sangfor/db");
    await prisma.opportunity.deleteMany({ where: { title: { startsWith: tag } } });
    await prisma.workTask.deleteMany({ where: { title: { startsWith: tag } } });
    if (candidateIds.length) {
      await prisma.mailDerivedCandidate.deleteMany({ where: { id: { in: candidateIds } } });
    }
  });

  it("strips 'Opportunity: ' prefix, deduplicates, and sets createdEntityId", async () => {
    const { prisma } = await import("@sangfor/db");
    const { convertApprovedMailCandidates } = await import("./mail-candidates-convert");

    const title = `${tag} 중복 방지`;
    const c1 = await prisma.mailDerivedCandidate.create({
      data: {
        candidateType: "opportunity",
        title: `Opportunity: ${title}`,
        summary: "Test candidate 1",
        status: "approved",
        confidence: 80,
      },
    });
    const c2 = await prisma.mailDerivedCandidate.create({
      data: {
        candidateType: "opportunity",
        title: `Opportunity: ${title}`,
        summary: "Test candidate 2 (duplicate)",
        status: "approved",
        confidence: 80,
      },
    });
    candidateIds = [c1.id, c2.id];

    const r1 = await convertApprovedMailCandidates();
    expect(r1.opportunitiesCreated).toBe(1);

    const opp = await prisma.opportunity.findFirst({
      where: { title, projectId: cleanProjectId },
    });
    expect(opp).not.toBeNull();
    expect(opp!.title).toBe(title);
    expect(opp!.stage).toBe("LEAD");

    const updated1 = await prisma.mailDerivedCandidate.findUniqueOrThrow({ where: { id: c1.id } });
    const updated2 = await prisma.mailDerivedCandidate.findUniqueOrThrow({ where: { id: c2.id } });
    expect(updated1.status).toBe("converted");
    expect(updated1.createdEntityType).toBe("opportunity");
    expect(updated1.createdEntityId).toBe(opp!.id);
    expect(updated2.status).toBe("converted");
    expect(updated2.createdEntityType).toBe("opportunity");
    expect(updated2.createdEntityId).toBe(opp!.id);

    const r2 = await convertApprovedMailCandidates();
    expect(r2.opportunitiesCreated).toBe(0);
  });

  it("sets createdEntityType/createdEntityId on task conversion (new and existing)", async () => {
    const { prisma } = await import("@sangfor/db");
    const { convertApprovedMailCandidates } = await import("./mail-candidates-convert");

    const title = `${tag} 태스크 링크`;
    const t1 = await prisma.mailDerivedCandidate.create({
      data: {
        candidateType: "task",
        title,
        summary: "Test task candidate 1",
        status: "approved",
        confidence: 80,
      },
    });
    const t2 = await prisma.mailDerivedCandidate.create({
      data: {
        candidateType: "task",
        title,
        summary: "Test task candidate 2 (duplicate)",
        status: "approved",
        confidence: 80,
      },
    });
    candidateIds.push(t1.id, t2.id);

    const r = await convertApprovedMailCandidates();
    expect(r.tasksCreated).toBe(1);

    const task = await prisma.workTask.findFirst({
      where: { title, projectId: cleanProjectId },
    });
    expect(task).not.toBeNull();

    const updated1 = await prisma.mailDerivedCandidate.findUniqueOrThrow({ where: { id: t1.id } });
    const updated2 = await prisma.mailDerivedCandidate.findUniqueOrThrow({ where: { id: t2.id } });
    expect(updated1.status).toBe("converted");
    expect(updated1.createdEntityType).toBe("task");
    expect(updated1.createdEntityId).toBe(task!.id);
    expect(updated2.status).toBe("converted");
    expect(updated2.createdEntityType).toBe("task");
    expect(updated2.createdEntityId).toBe(task!.id);
  });
});
