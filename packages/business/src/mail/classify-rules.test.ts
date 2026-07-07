import { describe, it, expect } from "vitest";

import {
  computeCustomerPartnerConfidence,
  classifyMailInsightThread,
  classifyMailCandidateDocument,
} from "./classify-rules";
import type { ThreadLike } from "./classify-rules";

// ---------------------------------------------------------------------------
// computeCustomerPartnerConfidence — unit tests for the new scoring function
// ---------------------------------------------------------------------------

describe("computeCustomerPartnerConfidence", () => {
  // --- known partner domain ---
  it("known-partner-domain partner reaches ≥85", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: true,
      knownPartnerDomain: true,
      knownDomainMap: false,
      freeMailDomain: false,
      policySignal: 18,
      evidenceCount: 2,
      aiEnhanced: true,
    });
    expect(r.confidence).toBeGreaterThanOrEqual(85);
    expect(r.confidence).toBeLessThanOrEqual(94);
  });

  it("known-partner-domain partner with no extra evidence still scores ≥82 (replaces old literal)", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: true,
      knownPartnerDomain: true,
      knownDomainMap: false,
      freeMailDomain: false,
      policySignal: 18,
      evidenceCount: 0,
      aiEnhanced: false,
    });
    expect(r.confidence).toBeGreaterThanOrEqual(82);
  });

  // --- customer with evidence ---
  it("known-domain-map customer with multi-mail evidence scores 75~90", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: false,
      knownPartnerDomain: false,
      knownDomainMap: true,
      freeMailDomain: false,
      policySignal: 10,
      evidenceCount: 3,
      aiEnhanced: false,
    });
    expect(r.confidence).toBeGreaterThanOrEqual(75);
    expect(r.confidence).toBeLessThanOrEqual(90);
  });

  // --- free mail ---
  it("free-mail unknown customer scores ≤65", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: false,
      knownPartnerDomain: false,
      knownDomainMap: false,
      freeMailDomain: true,
      policySignal: 10,
      evidenceCount: 0,
      aiEnhanced: false,
    });
    expect(r.confidence).toBeLessThanOrEqual(65);
  });

  // --- no-evidence partner (keyword-only, no domain signal) ---
  it("no-evidence keyword-only partner scores moderate (≤80)", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: true,
      knownPartnerDomain: false,
      knownDomainMap: false,
      freeMailDomain: false,
      policySignal: 18,
      evidenceCount: 0,
      aiEnhanced: false,
    });
    expect(r.confidence).toBeLessThanOrEqual(80);
  });

  // --- no-signal base ---
  it("no-signal case scores low (≤60)", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: false,
      knownPartnerDomain: false,
      knownDomainMap: false,
      freeMailDomain: false,
      policySignal: 0,
      evidenceCount: 0,
      aiEnhanced: false,
    });
    expect(r.confidence).toBeLessThanOrEqual(60);
  });

  // --- clamp bounds ---
  it("clamp enforces minimum of 40", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: false,
      knownPartnerDomain: false,
      knownDomainMap: false,
      freeMailDomain: true,
      policySignal: 0,
      evidenceCount: 0,
      aiEnhanced: false,
    });
    expect(r.confidence).toBeGreaterThanOrEqual(40);
  });

  it("clamp enforces maximum of 94", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: true,
      knownPartnerDomain: true,
      knownDomainMap: true,
      freeMailDomain: false,
      policySignal: 18,
      evidenceCount: 10,
      aiEnhanced: true,
    });
    expect(r.confidence).toBeLessThanOrEqual(94);
  });

  // --- monotonicity ---
  it("more evidence never lowers score (monotonic in evidenceCount)", () => {
    const base = {
      isPartner: false,
      knownPartnerDomain: false,
      knownDomainMap: true,
      freeMailDomain: false,
      policySignal: 10,
      aiEnhanced: false,
    } as const;
    const low = computeCustomerPartnerConfidence({ ...base, evidenceCount: 0 });
    const mid = computeCustomerPartnerConfidence({ ...base, evidenceCount: 2 });
    const high = computeCustomerPartnerConfidence({ ...base, evidenceCount: 5 });
    expect(mid.confidence).toBeGreaterThanOrEqual(low.confidence);
    expect(high.confidence).toBeGreaterThanOrEqual(mid.confidence);
    expect(high.confidence).toBeGreaterThanOrEqual(low.confidence);
  });

  // --- breakdown shape ---
  it("breakdown records all addends with descriptive keys", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: true,
      knownPartnerDomain: true,
      knownDomainMap: true,
      freeMailDomain: false,
      policySignal: 18,
      evidenceCount: 2,
      aiEnhanced: true,
    });
    expect(r.breakdown).toHaveProperty("base");
    expect(r.breakdown).toHaveProperty("policySignal");
    expect(r.breakdown).toHaveProperty("total");
    expect(r.breakdown.total).toBe(r.confidence);
  });

  it("breakdown includes knownPartnerDomain when triggered", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: true,
      knownPartnerDomain: true,
      knownDomainMap: false,
      freeMailDomain: false,
      policySignal: 18,
    });
    expect(r.breakdown.knownPartnerDomain).toBeGreaterThan(0);
  });

  it("breakdown includes freeMailPenalty when free mail", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: false,
      knownPartnerDomain: false,
      knownDomainMap: false,
      freeMailDomain: true,
      policySignal: 10,
    });
    expect(r.breakdown.freeMailPenalty).toBeLessThan(0);
  });

  it("breakdown includes evidenceBonus when evidence present", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: false,
      knownPartnerDomain: false,
      knownDomainMap: false,
      freeMailDomain: false,
      policySignal: 0,
      evidenceCount: 3,
    });
    expect(r.breakdown.evidenceBonus).toBeGreaterThan(0);
  });

  it("breakdown includes aiEnhanced when set", () => {
    const r = computeCustomerPartnerConfidence({
      isPartner: true,
      knownPartnerDomain: false,
      knownDomainMap: false,
      freeMailDomain: false,
      policySignal: 0,
      aiEnhanced: true,
    });
    expect(r.breakdown.aiEnhanced).toBeGreaterThan(0);
  });

  // --- conservative fallback for LEGACY doc path ---
  it("partner keyword-only (no domain) gets modest bonus", () => {
    // isPartner=true but no known-domain → partnerKeywordBonus fires (doc path pattern)
    const r = computeCustomerPartnerConfidence({
      isPartner: true,
      knownPartnerDomain: false,
      knownDomainMap: false,
      freeMailDomain: false,
      policySignal: 18,
      partnerKeywordBonus: 5,
    });
    expect(r.confidence).toBeGreaterThanOrEqual(70);
    expect(r.confidence).toBeLessThanOrEqual(85);
  });
});

// ---------------------------------------------------------------------------
// classifyMailInsightThread — integration tests for thread-path confidence
// ---------------------------------------------------------------------------

describe("customer/partner confidence (thread path)", () => {
  const baseThread = (overrides: Partial<ThreadLike>): ThreadLike => ({
    id: "test-thread",
    threadKey: "test-key",
    threadTitle: "Test thread",
    summary: "Test summary for thread",
    status: "active",
    effectiveStatus: null,
    aiEnhanced: false,
    messageIds: [],
    nextActions: [],
    evidenceItems: [],
    revenueOpsTags: [],
    participantDomains: [],
    metadata: { messages: [] },
    ...overrides,
  });

  it("known partner domain thread partner reaches ≥85", () => {
    const result = classifyMailInsightThread(
      baseThread({
        threadTitle: "[넥시아스] 라이선스 협업",
        summary: "라이선스 관련 논의",
        aiEnhanced: true,
        evidenceItems: ["PoC 검증 요청", "견적 요청"],
        nextActions: [{ recommendedAction: "견적 회신" }],
        participantDomains: ["nexias.co.kr"],
        metadata: {
          messages: [{ from: "hgyang@nexias.co.kr", fromName: "넥시아스" }],
        },
      }),
    );
    const partner = result.candidates.find((c) => c.candidateType === "partner");
    expect(partner).toBeDefined();
    expect(partner!.confidence).toBeGreaterThanOrEqual(85);
    expect(partner!.confidence).toBeLessThanOrEqual(94);
    expect(partner!.confidenceBreakdown).toBeDefined();
  });

  it("free-mail customer (gmail) thread scores ≤65", () => {
    const result = classifyMailInsightThread(
      baseThread({
        threadTitle: "[개인] 견적 문의",
        summary: "Sangfor 제품 견적 문의",
        participantDomains: ["gmail.com"],
        metadata: {
          messages: [{ from: "someone@gmail.com", fromName: "개인" }],
        },
      }),
    );
    const customer = result.candidates.find((c) => c.candidateType === "customer");
    expect(customer).toBeDefined();
    expect(customer!.confidence).toBeLessThanOrEqual(65);
    expect(customer!.confidence).toBeGreaterThanOrEqual(40);
  });

  it("visible partner thread with AI and evidence hits max 94", () => {
    const result = classifyMailInsightThread(
      baseThread({
        threadTitle: "[넥시아스] 대규모 PoC & 견적 요청",
        summary: "고객사 PoC 및 견적 요청에 대한 논의",
        aiEnhanced: true,
        evidenceItems: ["PoC 검증 요청", "견적 요청", "기술 검토"],
        nextActions: [
          { recommendedAction: "PoC 범위 확정" },
          { recommendedAction: "견적서 작성" },
        ],
        participantDomains: ["nexias.co.kr"],
        metadata: {
          messages: [{ from: "hgyang@nexias.co.kr", fromName: "넥시아스" }],
        },
      }),
    );
    const partner = result.candidates.find((c) => c.candidateType === "partner");
    expect(partner).toBeDefined();
    expect(partner!.confidence).toBe(94);
  });
});

// ---------------------------------------------------------------------------
// classifyMailCandidateDocument — integration tests for doc-path confidence
// ---------------------------------------------------------------------------

describe("customer/partner confidence (doc path)", () => {
  it("known partner domain doc partner reaches ≥80", () => {
    const result = classifyMailCandidateDocument({
      title: "[넥시아스] 베를로 - 고객사 라이선스 전달",
      body: [
        "From: 양해광 <hgyang@nexias.co.kr>",
        "Received: 2026-06-11T14:00:00.000Z",
        "",
        "라이선스 전달",
      ].join("\n"),
    });
    const partner = result.candidates.find((c) => c.candidateType === "partner");
    expect(partner).toBeDefined();
    expect(partner!.confidence).toBeGreaterThanOrEqual(80);
    expect(partner!.confidenceBreakdown).toBeDefined();
  });

  it("keyword-only partner (non-known domain) gets lower confidence than domain-backed", () => {
    const result = classifyMailCandidateDocument({
      title: "[ChannelOne] 파트너 총판 협업 문의",
      body: [
        "From: Channel <sales@channelone.example>",
        "Received: 2026-06-03T08:30:00.000Z",
        "",
        "Sangfor reseller partner 협업 제안",
      ].join("\n"),
    });
    const partner = result.candidates.find((c) => c.candidateType === "partner");
    expect(partner).toBeDefined();
    expect(partner!.confidence).toBeLessThan(85);
  });

  it("bracketed customer with non-free, non-known domain gets moderate confidence", () => {
    const result = classifyMailCandidateDocument({
      title: "[SamsungSDS] 방화벽 도입 문의",
      body: [
        "From: Kim Buyer <buyer@samsungsds.com>",
        "Received: 2026-06-07T09:30:00.000Z",
        "",
        "Sangfor 방화벽 도입 검토 중입니다. 견적 부탁드립니다.",
      ].join("\n"),
    });
    const customer = result.candidates.find((c) => c.candidateType === "customer");
    expect(customer).toBeDefined();
    expect(customer!.confidence).toBeGreaterThanOrEqual(40);
    expect(customer!.confidence).toBeLessThanOrEqual(75);
  });
});

// ---------------------------------------------------------------------------
// characterization guard: opportunity / poc / task outputs stay unchanged
// ---------------------------------------------------------------------------

describe("characterization guard: opportunity/poc/task scoring unchanged", () => {
  const threadFixtures: Record<string, ThreadLike> = {
    opportunityRich: {
      id: "guard-opp",
      threadKey: "guard-opp-key",
      threadTitle: "[Acme] 라이선스 견적 요청",
      summary: "고객사가 라이선스 견적과 계약 조건을 요청했습니다.",
      status: "active",
      effectiveStatus: null,
      aiEnhanced: true,
      messageIds: ["m1"],
      nextActions: [{ recommendedAction: "견적 회신" }],
      evidenceItems: ["견적 요청"],
      revenueOpsTags: ["견적/계약"],
      participantDomains: ["acme.example"],
      metadata: {
        messages: [{ id: "m1", from: "buyer@acme.example", fromName: "Acme Buyer" }],
      },
    },
    pocRich: {
      id: "guard-poc",
      threadKey: "guard-poc-key",
      threadTitle: "[Acme] SASE PoC 검증 일정 협의",
      summary: "고객사가 SASE PoC 검증 일정을 협의하고자 합니다.",
      status: "active",
      effectiveStatus: null,
      aiEnhanced: true,
      messageIds: ["m1"],
      nextActions: [{ recommendedAction: "PoC 일정 확정" }],
      evidenceItems: ["PoC 검증 요청"],
      revenueOpsTags: ["PoC/검증"],
      participantDomains: ["acme.example"],
      metadata: {
        messages: [{ id: "m1", from: "buyer@acme.example", fromName: "Acme Buyer" }],
      },
    },
    taskFromOpp: {
      id: "guard-task",
      threadKey: "guard-task-key",
      threadTitle: "[Acme] 라이선스 견적 요청",
      summary: "고객사가 라이선스 견적과 계약 조건을 요청했습니다.",
      status: "active",
      effectiveStatus: null,
      aiEnhanced: true,
      messageIds: ["m1"],
      nextActions: [{ recommendedAction: "견적 회신" }],
      evidenceItems: ["견적 요청"],
      revenueOpsTags: ["견적/계약"],
      participantDomains: ["acme.example"],
      metadata: {
        messages: [{ id: "m1", from: "buyer@acme.example", fromName: "Acme Buyer" }],
      },
    },
  };

  // values verified from golden snapshots (keyword + revenueOpsTag match counts):
  // opportunity: 4 matches (견적, 계약, 라이선스 keywords + 견적/계약 tag) → 66 + 4*6 + 8 = 98 capped at 94
  it("opportunity confidence formula unchanged: 66 + matches*6 + aiEnhanced*8 capped at 94", () => {
    const r = classifyMailInsightThread(threadFixtures.opportunityRich);
    const opp = r.candidates.find((c) => c.candidateType === "opportunity");
    expect(opp).toBeDefined();
    expect(opp!.confidence).toBe(94);
  });

  // poc: 3 matches (poc, 검증 keywords + PoC/검증 tag) → 68 + 3*6 + 8 = 94 capped at 94
  it("poc confidence formula unchanged: 68 + matches*6 + aiEnhanced*8 capped at 94", () => {
    const r = classifyMailInsightThread(threadFixtures.pocRich);
    const poc = r.candidates.find((c) => c.candidateType === "poc");
    expect(poc).toBeDefined();
    expect(poc!.confidence).toBe(94);
  });

  // task: 3 task matches (요청, 회신 keywords + nextAction) → 62 + min(3,5)*4 + 8 = 82
  it("task confidence formula unchanged: 62 + matches*4 + aiEnhanced*8 capped at 92", () => {
    const r = classifyMailInsightThread(threadFixtures.taskFromOpp);
    const task = r.candidates.find((c) => c.candidateType === "task");
    expect(task).toBeDefined();
    expect(task!.confidence).toBe(82);
  });
});
