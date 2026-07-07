import { describe, it, expect, vi, beforeEach } from "vitest";

import { prisma } from "@sangfor/db";

import type { AiRevalidationResult } from "./classify-ai";
import { revalidateMailDerivedCandidate } from "./classify-ai";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@sangfor/db", () => ({
  prisma: {
    mailDerivedCandidate: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
    },
    partner: {
      findFirst: vi.fn(),
    },
    workTask: {
      findFirst: vi.fn(),
    },
    opportunity: {
      findFirst: vi.fn(),
    },
    pocProject: {
      findFirst: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-id",
    candidateType: "customer",
    title: "Customer: Acme Corp",
    summary: "Acme Corp is interested in Sangfor products.",
    sourceTitle: "RE: Product inquiry",
    sourceSender: "buyer@acme.com",
    sourceReceivedAt: new Date("2026-07-01"),
    confidence: 75,
    status: "proposed",
    knowledgeDocumentId: null,
    mailInsightThreadId: "thread-1",
    createdEntityType: null,
    createdEntityId: null,
    createdAt: new Date("2026-07-01"),
    updatedAt: new Date("2026-07-01"),
    metadata: {
      messageId: "msg-1",
      threadKey: "thread-key-1",
      matchedKeywords: ["keyword1"],
      evidenceItems: ["Evidence of customer interest"],
      nextActions: [{ recommendedAction: "Send quote" }],
      attachments: ["quote.pdf"],
      mailIntelligence: {
        threadInsightId: "ti-1",
        aiEnhanced: true,
        summary: "Product inquiry from Acme Corp",
      },
      policyDecision: {
        decision: "candidate",
        entityRole: "customer",
        candidateName: "Acme Corp",
        reason: "customer domain match",
        matchedPolicyMemories: [],
        participantDomains: ["acme.com"],
      },
      confidenceBreakdown: {
        base: 40,
        policySignal: 10,
        evidenceBonus: 8,
        aiEnhanced: 8,
        total: 75,
      },
    },
    ...overrides,
  };
}

function makePartnerCandidate(overrides: Record<string, unknown> = {}) {
  return makeCandidate({
    candidateType: "partner",
    title: "Partner: Nexias",
    summary: "Nexias proposes joint collaboration.",
    sourceSender: "partner@nexias.co.kr",
    metadata: {
      messageId: "msg-2",
      threadKey: "thread-key-2",
      matchedKeywords: ["partner keyword"],
      evidenceItems: ["Co-proposal request"],
      nextActions: [{ recommendedAction: "Review partnership" }],
      attachments: [],
      mailIntelligence: {
        threadInsightId: "ti-2",
        aiEnhanced: true,
        summary: "Partnership proposal from Nexias",
      },
      policyDecision: {
        decision: "candidate",
        entityRole: "partner",
        candidateName: "Nexias",
        reason: "partner domain match",
        matchedPolicyMemories: [],
        participantDomains: ["nexias.co.kr"],
      },
    },
    ...overrides,
  });
}

function makeOpportunityCandidate(overrides: Record<string, unknown> = {}) {
  return makeCandidate({
    candidateType: "opportunity",
    title: "Opportunity: Acme License Deal",
    summary: "Acme Corp requests license quote.",
    metadata: {
      messageId: "msg-3",
      threadKey: "thread-key-3",
      matchedKeywords: ["license", "quote"],
      evidenceItems: ["License quote request"],
      nextActions: [{ recommendedAction: "Send quote" }],
      attachments: ["requirements.pdf"],
      mailIntelligence: {
        threadInsightId: "ti-3",
        aiEnhanced: true,
        summary: "License deal inquiry",
      },
      policyDecision: {
        decision: "candidate",
        entityRole: "customer",
        candidateName: "Acme Corp",
        reason: "license keyword match",
        matchedPolicyMemories: [],
        participantDomains: ["acme.com"],
      },
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests: customer/partner revalidation
// ---------------------------------------------------------------------------

describe("revalidateMailDerivedCandidate — customer/partner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no matching entity in DB
    (prisma.customer.findFirst as any).mockResolvedValue(null);
    (prisma.partner.findFirst as any).mockResolvedValue(null);
    // Default: update succeeds
    (prisma.mailDerivedCandidate.update as any).mockImplementation(
      async (_args: unknown) => _args,
    );
  });

  // -----------------------------------------------------------------------
  // 1. Customer candidate + LLM says confident (90) → blend → approve
  // -----------------------------------------------------------------------
  it("customer candidate + LLM confident (90) → blended confidence, approve_candidate", async () => {
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeCandidate({ candidateType: "customer", confidence: 72 }),
    );

    const result = await revalidateMailDerivedCandidate("test-id", {
      callLLM: async () =>
        JSON.stringify({
          decision: "approve_candidate",
          reasoningSummary: "Valid customer inquiry with clear buying intent",
          missingFields: [],
          riskFlags: [],
          confidence: 90,
        }),
    });

    // blend = round(72*0.3 + 90*0.7) = round(21.6 + 63) = round(84.6) = 85
    expect(result.revalidation).not.toBeNull();
    expect(result.revalidation!.confidence).toBe(85);
    expect(result.revalidation!.decision).toBe("approve_candidate");
    expect(result.revalidation!.mode).toBe("llm");
  });

  // -----------------------------------------------------------------------
  // 2. Partner candidate + existing canonical partner match → dedup flagged
  // -----------------------------------------------------------------------
  it("partner candidate + existing partner match → dedup flagged, merge semantics", async () => {
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makePartnerCandidate(),
    );
    // Simulate existing partner match
    (prisma.partner.findFirst as any).mockResolvedValue({
      id: "partner-1",
      name: "Nexias",
    });

    const result = await revalidateMailDerivedCandidate("test-id", {
      callLLM: async () =>
        JSON.stringify({
          decision: "needs_human_review",
          reasoningSummary: "Existing partner found; verify before creating duplicate",
          missingFields: ["duplication check"],
          riskFlags: ["possible_duplicate"],
          confidence: 65,
        }),
    });

    const reval = result.revalidation as AiRevalidationResult | null;
    expect(reval).not.toBeNull();
    expect(reval!.duplicateCheck.possibleDuplicate).toBe(true);
    expect(reval!.duplicateCheck.matchedObjectType).toBe("partner");
    expect(reval!.duplicateCheck.matchedObjectId).toBe("partner-1");
    expect(reval!.decision).toBe("needs_human_review");
  });

  // -----------------------------------------------------------------------
  // 3. LLM failure → template fallback for ALL types
  // -----------------------------------------------------------------------
  it("LLM failure → template fallback (old behavior) for customer", async () => {
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeCandidate({
        candidateType: "customer",
        confidence: 70,
        metadata: {
          messageId: "msg-1",
          matchedKeywords: ["keyword"],
          evidenceItems: ["Evidence"],
          nextActions: [{ recommendedAction: "Send info" }],
          attachments: [],
        },
      }),
    );

    // LLM throws → fallback to template
    const result = await revalidateMailDerivedCandidate("test-id", {
      callLLM: async () => {
        throw new Error("LLM unavailable");
      },
    });

    // Template fallback: confidence = max(40, min(95, 70 + 0)) = 70
    expect(result.revalidation).not.toBeNull();
    expect(result.revalidation!.mode).toBe("template");
    expect(typeof result.revalidation!.fallbackReason).toBe("string");
    // Template keeps its own confidence logic
    expect(result.revalidation!.confidence).toBeGreaterThanOrEqual(40);
  });

  // -----------------------------------------------------------------------
  // 4. LLM failure for project type → template fallback
  // -----------------------------------------------------------------------
  it("LLM failure for opportunity → template fallback", async () => {
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeOpportunityCandidate(),
    );

    const result = await revalidateMailDerivedCandidate("test-id", {
      callLLM: async () => {
        throw new Error("openai_timeout");
      },
    });

    expect(result.revalidation).not.toBeNull();
    expect(result.revalidation!.mode).toBe("template");
    expect(result.revalidation!.fallbackReason).toContain("openai_timeout");
  });

  // -----------------------------------------------------------------------
  // 5. Project-type candidate: LLM confidence now blended
  // -----------------------------------------------------------------------
  it("opportunity candidate: LLM confidence blended into result", async () => {
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeOpportunityCandidate({ confidence: 80 }),
    );

    const result = await revalidateMailDerivedCandidate("test-id", {
      callLLM: async () =>
        JSON.stringify({
          decision: "approve_candidate",
          reasoningSummary: "Valid opportunity with clear requirements",
          missingFields: [],
          riskFlags: [],
          confidence: 88,
        }),
    });

    // blend = round(80*0.3 + 88*0.7) = round(24 + 61.6) = round(85.6) = 86
    expect(result.revalidation).not.toBeNull();
    expect(result.revalidation!.confidence).toBe(86);
    expect(result.revalidation!.mode).toBe("llm");
    expect(result.revalidation!.decision).toBe("approve_candidate");
  });

  // -----------------------------------------------------------------------
  // 6. Garbage/no-signal customer + LLM low (30) → confidence drops, NOT approve
  // -----------------------------------------------------------------------
  it("garbage/no-signal customer + LLM low (30) → blended confidence drops, NOT approve", async () => {
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeCandidate({
        candidateType: "customer",
        confidence: 55,
        metadata: {
          messageId: "msg-low",
          matchedKeywords: [],
          evidenceItems: [],
          nextActions: [],
          attachments: [],
        },
      }),
    );

    const result = await revalidateMailDerivedCandidate("test-id", {
      callLLM: async () =>
        JSON.stringify({
          decision: "knowledge_only",
          reasoningSummary: "No clear customer signal; possible spam",
          missingFields: ["customer confirmation"],
          riskFlags: ["low_confidence"],
          confidence: 30,
        }),
    });

    // blend = round(55*0.3 + 30*0.7) = round(16.5 + 21) = round(37.5) = 38 → clamped to 40
    expect(result.revalidation).not.toBeNull();
    expect(result.revalidation!.confidence).toBe(40);
    expect(result.revalidation!.decision).not.toBe("approve_candidate");
    expect(result.revalidation!.mode).toBe("llm");
  });

  // -----------------------------------------------------------------------
  // 7. Customer dedup: existing customer found in DB
  // -----------------------------------------------------------------------
  it("customer candidate + existing customer in DB → dedup flagged", async () => {
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeCandidate({ candidateType: "customer" }),
    );
    (prisma.customer.findFirst as any).mockResolvedValue({
      id: "customer-1",
      name: "Acme Corp",
    });

    const result = await revalidateMailDerivedCandidate("test-id", {
      callLLM: async () =>
        JSON.stringify({
          decision: "needs_human_review",
          reasoningSummary: "Existing customer found",
          missingFields: [],
          riskFlags: ["possible_duplicate"],
          confidence: 70,
        }),
    });

    const reval = result.revalidation as AiRevalidationResult | null;
    expect(reval).not.toBeNull();
    expect(reval!.duplicateCheck.possibleDuplicate).toBe(true);
    expect(reval!.duplicateCheck.matchedObjectType).toBe("customer");
    expect(reval!.duplicateCheck.matchedObjectId).toBe("customer-1");
  });

  // -----------------------------------------------------------------------
  // 8. No dedup match for customer
  // -----------------------------------------------------------------------
  it("customer candidate + no existing customer in DB → no dedup", async () => {
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeCandidate({ candidateType: "customer" }),
    );

    const result = await revalidateMailDerivedCandidate("test-id", {
      callLLM: async () =>
        JSON.stringify({
          decision: "approve_candidate",
          reasoningSummary: "New customer",
          missingFields: [],
          riskFlags: [],
          confidence: 85,
        }),
    });

    const reval = result.revalidation as AiRevalidationResult | null;
    expect(reval).not.toBeNull();
    expect(reval!.duplicateCheck.possibleDuplicate).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 9. TargetObject preserved correctly for customer/partner
  // -----------------------------------------------------------------------
  it("customer revalidation sets targetObject to customer", async () => {
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeCandidate({ candidateType: "customer" }),
    );

    const result = await revalidateMailDerivedCandidate("test-id", {
      callLLM: async () =>
        JSON.stringify({
          decision: "approve_candidate",
          reasoningSummary: "Good customer lead",
          missingFields: [],
          riskFlags: [],
          confidence: 80,
        }),
    });

    expect(result.revalidation).not.toBeNull();
    expect(result.revalidation!.targetObject).toBe("customer");
  });

// ---------------------------------------------------------------------------
// Cache behaviour tests
// ---------------------------------------------------------------------------

describe("revalidateMailDerivedCandidate — cache behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.customer.findFirst as any).mockResolvedValue(null);
    (prisma.partner.findFirst as any).mockResolvedValue(null);
    (prisma.mailDerivedCandidate.update as any).mockImplementation(
      async (_args: unknown) => _args,
    );
  });

  // -----------------------------------------------------------------------
  // 10. Cached fresh LLM result → returned from cache (no LLM call)
  // -----------------------------------------------------------------------
  it("cached fresh LLM result + no force → returned from cache (no LLM call)", async () => {
    const cachedKey =
      "mail-ai-revalidation-v2:thread-key-1:quote.pdf:Evidence of customer interest:customer:Customer: Acme Corp:75";
    const cachedRevalidation: AiRevalidationResult = {
      decision: "approve_candidate",
      targetObject: "customer",
      confidence: 85,
      reasoningSummary: "Previously validated customer lead",
      evidence: [],
      duplicateCheck: { possibleDuplicate: false },
      missingFields: [],
      suggestedFields: {},
      riskFlags: [],
      mode: "llm",
      model: "gpt-4",
      llmConfidence: 88,
      revalidatedAt: "2026-07-01T00:00:00.000Z",
      cacheKey: cachedKey,
    };

    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeCandidate({
        metadata: {
          ...makeCandidate().metadata,
          aiRevalidation: cachedRevalidation,
        },
      }),
    );

    const callLLM = vi.fn();
    const result = await revalidateMailDerivedCandidate("test-id", { callLLM });

    expect(callLLM).not.toHaveBeenCalled();
    expect(result.revalidation!.decision).toBe("approve_candidate");
    expect(result.revalidation!.mode).toBe("llm");
    expect(result.revalidation!.cacheKey).toBe(cachedKey);
  });

  // -----------------------------------------------------------------------
  // 11. Cached template + fallbackReason → re-runs LLM despite no force
  // -----------------------------------------------------------------------
  it("cached template + fallbackReason → re-runs LLM (stale fallback not cached)", async () => {
    const cachedKey =
      "mail-ai-revalidation-v2:thread-key-1:quote.pdf:Evidence of customer interest:customer:Customer: Acme Corp:75";
    const cachedFallback: AiRevalidationResult = {
      decision: "needs_human_review",
      targetObject: "customer",
      confidence: 70,
      reasoningSummary: "Template fallback from LLM outage",
      evidence: [],
      duplicateCheck: { possibleDuplicate: false },
      missingFields: [],
      suggestedFields: {},
      riskFlags: [],
      mode: "template",
      fallbackReason: "openai_timeout",
      revalidatedAt: "2026-07-01T00:00:00.000Z",
      cacheKey: cachedKey,
    };

    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeCandidate({
        metadata: {
          ...makeCandidate().metadata,
          aiRevalidation: cachedFallback,
        },
      }),
    );

    const callLLM = vi.fn().mockResolvedValue(
      JSON.stringify({
        decision: "approve_candidate",
        reasoningSummary: "Valid customer after retry",
        missingFields: [],
        riskFlags: [],
        confidence: 85,
      }),
    );

    const result = await revalidateMailDerivedCandidate("test-id", { callLLM });

    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(result.revalidation!.mode).toBe("llm");
    expect(result.revalidation!.decision).toBe("approve_candidate");
  });

  // -----------------------------------------------------------------------
  // 12. force: true → re-runs LLM even over fresh LLM cache
  // -----------------------------------------------------------------------
  it("force: true → re-runs LLM even over fresh LLM cache", async () => {
    const cachedKey =
      "mail-ai-revalidation-v2:thread-key-1:quote.pdf:Evidence of customer interest:customer:Customer: Acme Corp:75";
    const cachedRevalidation: AiRevalidationResult = {
      decision: "needs_human_review",
      targetObject: "customer",
      confidence: 70,
      reasoningSummary: "Previously cached — needs recheck",
      evidence: [],
      duplicateCheck: { possibleDuplicate: false },
      missingFields: [],
      suggestedFields: {},
      riskFlags: [],
      mode: "llm",
      model: "gpt-4",
      llmConfidence: 65,
      revalidatedAt: "2026-07-01T00:00:00.000Z",
      cacheKey: cachedKey,
    };

    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeCandidate({
        metadata: {
          ...makeCandidate().metadata,
          aiRevalidation: cachedRevalidation,
        },
      }),
    );

    const callLLM = vi.fn().mockResolvedValue(
      JSON.stringify({
        decision: "approve_candidate",
        reasoningSummary: "Re-validated with fresh LLM call",
        missingFields: [],
        riskFlags: [],
        confidence: 92,
      }),
    );

    const result = await revalidateMailDerivedCandidate("test-id", { callLLM }, { force: true });

    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(result.revalidation!.mode).toBe("llm");
    expect(result.revalidation!.decision).toBe("approve_candidate");
  });
});

// ---------------------------------------------------------------------------
// Prompt content tests
// ---------------------------------------------------------------------------

describe("revalidation prompt content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.customer.findFirst as any).mockResolvedValue(null);
    (prisma.partner.findFirst as any).mockResolvedValue(null);
    (prisma.mailDerivedCandidate.findUniqueOrThrow as any).mockResolvedValue(
      makeCandidate(),
    );
    (prisma.mailDerivedCandidate.update as any).mockImplementation(
      async (_args: unknown) => _args,
    );
  });

  it("system prompt includes ground-truth calibration", async () => {
    let capturedSystem = "";
    const callLLM = vi.fn().mockImplementation((system: string, _user: string) => {
      capturedSystem = system;
      return Promise.resolve(
        JSON.stringify({
          decision: "approve_candidate",
          reasoningSummary: "Valid",
          missingFields: [],
          riskFlags: [],
          confidence: 85,
        }),
      );
    });

    await revalidateMailDerivedCandidate("test-id", { callLLM });

    expect(capturedSystem).toContain("GROUND_TRUTH");
    expect(capturedSystem).toContain("고객=우리가 파는");
    expect(capturedSystem).toContain("파트너=총판");
  });

  it("system prompt includes self-domain and internal company rules", async () => {
    let capturedSystem = "";
    const callLLM = vi.fn().mockImplementation((system: string, _user: string) => {
      capturedSystem = system;
      return Promise.resolve(
        JSON.stringify({
          decision: "approve_candidate",
          reasoningSummary: "Valid",
          missingFields: [],
          riskFlags: [],
          confidence: 85,
        }),
      );
    });

    await revalidateMailDerivedCandidate("test-id", { callLLM });

    expect(capturedSystem).toContain("sangfor.com");
    expect(capturedSystem).toContain("blro.co.kr");
    expect(capturedSystem).toContain("베를로");
    expect(capturedSystem).toContain("decision=reject");
  });

  it("system prompt includes relay/vendor guidance", async () => {
    let capturedSystem = "";
    const callLLM = vi.fn().mockImplementation((system: string, _user: string) => {
      capturedSystem = system;
      return Promise.resolve(
        JSON.stringify({
          decision: "approve_candidate",
          reasoningSummary: "Valid",
          missingFields: [],
          riskFlags: [],
          confidence: 85,
        }),
      );
    });

    await revalidateMailDerivedCandidate("test-id", { callLLM });

    expect(capturedSystem).toContain("팝빌");
    expect(capturedSystem).toContain("eformsign");
    expect(capturedSystem).toContain("RELAYS");
    expect(capturedSystem).toContain("bill36524");
  });

  it("system prompt includes parser artifact / garbage entity rules", async () => {
    let capturedSystem = "";
    const callLLM = vi.fn().mockImplementation((system: string, _user: string) => {
      capturedSystem = system;
      return Promise.resolve(
        JSON.stringify({
          decision: "approve_candidate",
          reasoningSummary: "Valid",
          missingFields: [],
          riskFlags: [],
          confidence: 85,
        }),
      );
    });

    await revalidateMailDerivedCandidate("test-id", { callLLM });

    expect(capturedSystem).toContain("Example");
    expect(capturedSystem).toContain("<1 min");
    expect(capturedSystem).toContain("decision=reject");
    expect(capturedSystem).toContain("confidence<=50");
  });

  it("user policy clarifies approve_candidate semantics", async () => {
    let capturedUser = "";
    const callLLM = vi.fn().mockImplementation((_system: string, user: string) => {
      capturedUser = user;
      return Promise.resolve(
        JSON.stringify({
          decision: "approve_candidate",
          reasoningSummary: "Valid",
          missingFields: [],
          riskFlags: [],
          confidence: 85,
        }),
      );
    });

    await revalidateMailDerivedCandidate("test-id", { callLLM });

    const parsed = JSON.parse(capturedUser);
    const policyJoined = (parsed.policy as string[]).join(" ");
    expect(policyJoined).toContain("approve_candidate");
    expect(policyJoined).toContain("real external company");
    expect(policyJoined).toContain("NOT auto-creation");
  });
});
});
