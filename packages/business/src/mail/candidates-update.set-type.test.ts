import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sangfor/db", () => {
  const candidate = {
    id: "cand-1",
    candidateType: "customer",
    title: "Customer: Acme",
    summary: "test candidate",
    status: "proposed",
    confidence: 80,
    metadata: {
      aiRevalidation: { decision: "approve_candidate" },
      sourceGuess: "customer",
    },
  };
  return {
    prisma: {
      mailDerivedCandidate: {
        findUniqueOrThrow: vi.fn(async () => candidate),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...candidate,
          ...data,
        })),
      },
      project: {
        findMany: vi.fn(async () => [{ id: "proj-1", slug: "proj", name: "Proj" }]),
      },
    },
  };
});
vi.mock("../governance/ai-decision", () => ({ recordDecision: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "@sangfor/db";
import { recordDecision } from "../governance/ai-decision";
import { setCandidateType } from "./candidates-update";

describe("setCandidateType — customer/partner correction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("customer→partner: preserves existing metadata and records exactly one corrected decision", async () => {
    const result = await setCandidateType("cand-1", { candidateType: "partner" });

    expect(result.candidateType).toBe("partner");
    expect(result.metadata).toEqual({
      aiRevalidation: { decision: "approve_candidate" },
      sourceGuess: "customer",
    });

    expect(prisma.mailDerivedCandidate.update).toHaveBeenCalledWith({
      where: { id: "cand-1" },
      data: { candidateType: "partner" },
    });

    expect(recordDecision).toHaveBeenCalledTimes(1);
    expect(recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        domain: "sales",
        actor: "human",
        actionType: "entity_edit",
        caseRef: "mail_candidate:cand-1",
        outcome: "corrected",
        humanEdit: { previousCandidateType: "customer", candidateType: "partner" },
      }),
    );
  });

  it("partner→customer: also allowed and recorded", async () => {
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValueOnce({
      id: "cand-2",
      candidateType: "partner",
      title: "Partner: Nexias",
      summary: "test candidate",
      status: "proposed",
      confidence: 70,
      metadata: { sourceGuess: "partner" },
    });

    const result = await setCandidateType("cand-2", { candidateType: "customer" });

    expect(result.candidateType).toBe("customer");
    expect(recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        caseRef: "mail_candidate:cand-2",
        outcome: "corrected",
        humanEdit: { previousCandidateType: "partner", candidateType: "customer" },
      }),
    );
  });

  it("rejects correction for non customer/partner candidate types", async () => {
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValueOnce({
      id: "cand-3",
      candidateType: "task",
      title: "Follow up: something",
      summary: "test candidate",
      status: "proposed",
      confidence: 70,
      metadata: {},
    });

    await expect(setCandidateType("cand-3", { candidateType: "partner" })).rejects.toThrow(
      "candidate_type_not_correctable",
    );
    expect(prisma.mailDerivedCandidate.update).not.toHaveBeenCalled();
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("rejects an invalid target candidateType before touching the DB", async () => {
    await expect(
      setCandidateType("cand-1", { candidateType: "task" as never }),
    ).rejects.toThrow();
    expect(prisma.mailDerivedCandidate.update).not.toHaveBeenCalled();
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("surfaces a unique-constraint conflict as candidate_type_conflict, not a raw Prisma error", async () => {
    (prisma.mailDerivedCandidate.update as any).mockRejectedValueOnce({ code: "P2002" });

    await expect(setCandidateType("cand-1", { candidateType: "partner" })).rejects.toThrow(
      "candidate_type_conflict",
    );
    expect(recordDecision).not.toHaveBeenCalled();
  });
});
