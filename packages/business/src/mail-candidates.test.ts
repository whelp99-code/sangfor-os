import { describe, expect, it } from "vitest";

import {
  classifyMailCandidateDocument,
  classifyMailInsightThread,
  combineHybridClassification,
} from "./mail-candidates";
import type { AiClassificationResult } from "./mail-candidates";

describe("mail candidate classification", () => {
  it("finds opportunity, task, and customer candidates from real mail-like content", () => {
    const result = classifyMailCandidateDocument({
      title: "[Acme] Sangfor 라이선스 견적 요청",
      body: [
        "From: Buyer <buyer@acme.example>",
        "Received: 2026-06-01T09:00:00.000Z",
        "Attachments: requirements.pdf",
        "",
        "Sangfor 라이선스 견적과 계약 조건 확인 부탁드립니다.",
      ].join("\n"),
    });

    expect(result.candidates.map((candidate) => candidate.candidateType)).toEqual(
      expect.arrayContaining(["opportunity", "task", "customer"]),
    );
    expect(result.header.attachments).toContain("requirements.pdf");
  });

  it("finds poc candidates when compatibility language is present", () => {
    const result = classifyMailCandidateDocument({
      title: "PoC 호환성 검증 일정 문의",
      body: "From: Engineer <eng@example.com>\nPoC compatibility 테스트 일정 확인 요청",
    });

    expect(result.candidates.some((candidate) => candidate.candidateType === "poc")).toBe(true);
  });

  it("classifies partner candidates when partner language is present", () => {
    const result = classifyMailCandidateDocument({
      title: "[ChannelOne] 파트너 총판 협업 문의",
      body: "From: Channel <sales@channelone.example>\nSangfor reseller partner 협업 제안",
    });

    expect(result.candidates.some((candidate) => candidate.candidateType === "partner")).toBe(true);
  });

  it("does not create a customer candidate for the internal company name", () => {
    const result = classifyMailCandidateDocument({
      title: "[베를로] Sangfor VDI 사이징관련 정보 요청 건",
      body: "From: 박 재민 <jm.park@blro.co.kr>\n견적 확인 요청",
    });

    expect(
      result.candidates.some(
        (candidate) => candidate.candidateType === "customer" && candidate.title.includes("베를로"),
      ),
    ).toBe(false);
  });

  it("does not infer billing system senders as customer candidates", () => {
    const result = classifyMailCandidateDocument({
      title: "2026년 05월 발행현황보고서[(주)베를로]",
      body: "From: Bill36524 <billmanager@bill36524.com>\n세금계산서 발행현황",
    });

    expect(result.candidates.some((candidate) => candidate.candidateType === "customer")).toBe(false);
  });

  it("uses known partner hints when classifying company candidates", () => {
    const result = classifyMailCandidateDocument({
      title: "[넥시아스] 베를로 - 고객사 라이선스 전달",
      body: "From: 양해광 <hgyang@nexias.co.kr>\n라이선스 전달",
    });

    expect(result.candidates.some((candidate) => candidate.candidateType === "partner")).toBe(true);
    expect(result.candidates.some((candidate) => candidate.title.includes("Customer: 넥시아스"))).toBe(false);
  });

  it("suppresses internal domain raw mail fallback documents", () => {
    const result = classifyMailCandidateDocument({
      title: "Mail: [URGENT] Server is down - need immediate fix",
      body: [
        "From: Kim Ops",
        "Email: ops@blro.co.kr",
        "Received: 2026-06-20T09:15:00Z",
        "MessageId: msg001",
        "",
        "Production server crashed at 9am. All services down.",
      ].join("\n"),
      tags: ["mail-intelligence", "urgent", "critical"],
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.excluded[0]?.entityRole).toBe("internal_company");
  });

  it("suppresses newsletter raw mail fallback documents", () => {
    const result = classifyMailCandidateDocument({
      title: "Mail: FW: Industry newsletter - June edition",
      body: [
        "From: Industry News",
        "Email: newsletter@industry.com",
        "Received: 2026-06-20T06:30:00Z",
        "MessageId: msg004",
        "",
        "June newsletter with industry updates.",
      ].join("\n"),
      tags: ["mail-intelligence"],
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.excluded[0]?.reason).toContain("newsletter");
  });

  it("keeps actionable customer proposal raw mail documents", () => {
    const result = classifyMailCandidateDocument({
      title: "Mail: RE: Product demo feedback",
      body: [
        "From: Choi Client",
        "Email: client@samsung.com",
        "Received: 2026-06-20T06:00:00Z",
        "MessageId: msg006",
        "",
        "Great demo! We want to proceed with 200 units. Can you send proposal?",
      ].join("\n"),
      tags: ["mail-intelligence"],
    });

    expect(result.candidates.map((candidate) => candidate.candidateType)).toEqual(
      expect.arrayContaining(["customer", "opportunity", "task"]),
    );
    expect(result.excluded).toHaveLength(0);
  });

  it("excludes internal-company Mail Intelligence threads from customer candidates", () => {
    const result = classifyMailInsightThread({
      threadKey: "conv-internal",
      threadTitle: "[베를로] Sangfor VDI 사이징관련 정보 요청 건",
      summary: "내부 검토 요청",
      status: "active",
      aiEnhanced: true,
      messageIds: ["m1"],
      nextActions: [{ recommendedAction: "내부 확인" }],
      evidenceItems: ["베를로 내부 요청"],
      revenueOpsTags: ["SASE/VDI"],
      participantDomains: ["blro.co.kr"],
      metadata: {
        messages: [{ id: "m1", from: "jm.park@blro.co.kr", fromName: "박재민" }],
      },
    });

    expect(result.candidates.some((candidate) => candidate.candidateType === "customer")).toBe(false);
    expect(result.excluded[0]?.entityRole).toBe("internal_company");
  });

  it("excludes system sender Mail Intelligence threads", () => {
    const result = classifyMailInsightThread({
      threadKey: "conv-billing",
      threadTitle: "2026년 05월 발행현황보고서[(주)베를로]",
      summary: "세금계산서 발행현황",
      status: "reference",
      aiEnhanced: false,
      messageIds: ["m1"],
      nextActions: [],
      evidenceItems: ["발행현황"],
      revenueOpsTags: [],
      participantDomains: ["bill36524.com"],
      metadata: {
        messages: [{ id: "m1", from: "billmanager@bill36524.com", fromName: "Bill36524" }],
      },
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.excluded[0]?.entityRole).toBe("system_sender");
  });

  it("classifies known partner thread as partner and creates evidence-backed project candidates", () => {
    const result = classifyMailInsightThread({
      threadKey: "conv-partner-poc",
      threadTitle: "[넥시아스] 고객사 SASE PoC 견적 및 검증 요청",
      summary: "고객사가 SASE PoC 검증과 견적을 요청했습니다.",
      status: "active",
      aiEnhanced: true,
      messageIds: ["m1"],
      nextActions: [{ recommendedAction: "PoC 범위와 견적 회신", evidence: "검증 요청" }],
      evidenceItems: ["PoC 검증 요청", "견적 요청"],
      revenueOpsTags: ["PoC/검증", "견적/계약"],
      participantDomains: ["nexias.co.kr", "customer.example"],
      metadata: {
        messages: [{ id: "m1", from: "hgyang@nexias.co.kr", fromName: "넥시아스" }],
      },
    });

    expect(result.candidates.map((candidate) => candidate.candidateType)).toEqual(
      expect.arrayContaining(["partner", "poc", "opportunity", "task"]),
    );
    expect(result.candidates.some((candidate) => candidate.title.includes("Customer: 넥시아스"))).toBe(false);
  });

  it("does not treat Autopilot marketing copy as a PoC pilot signal", () => {
    const result = classifyMailInsightThread({
      threadKey: "conv-autopilot",
      threadTitle: "[New on Crew] Autopilot — hand it one line, it works for days",
      summary: "Crew just shipped Autopilot. $10 in every wallet to try it.",
      status: "active",
      aiEnhanced: true,
      messageIds: ["m1"],
      nextActions: [],
      evidenceItems: ["Crew just shipped Autopilot."],
      revenueOpsTags: ["PoC/검증"],
      participantDomains: ["crew.you", "blro.co.kr"],
      metadata: {
        messages: [{ id: "m1", from: "no-reply@crew.you", fromName: "Crew", isPromotional: true }],
      },
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.excluded[0]?.reason).toContain("promotional");
  });

  it("classifies tech.support@sangfor.com thread as a partner candidate (vendor support bypass)", () => {
    const result = classifyMailInsightThread({
      threadKey: "conv-sangfor-support",
      threadTitle: "[Sangfor Tech Support] critical HCI disk error resolved",
      summary: "장애 확인 및 복구 완료 보고",
      status: "done",
      aiEnhanced: true,
      messageIds: ["m1"],
      nextActions: [],
      evidenceItems: ["disk error"],
      revenueOpsTags: [],
      participantDomains: ["sangfor.com", "blro.co.kr"],
      metadata: {
        messages: [{ id: "m1", from: "tech.support@sangfor.com", fromName: "Sangfor Support" }],
      },
    });

    expect(result.candidates.some((c) => c.candidateType === "partner" && c.title.includes("Sangfor Tech Support"))).toBe(true);
    expect(result.excluded).toHaveLength(0);
  });

  it("suppresses existing proposed promotional fallback customer candidates", async () => {
    const { prisma } = await import("@sangfor/db");
    const { generateMailDerivedCandidates } = await import("./mail-candidates");
    const { resolveProjectId } = await import("./mail-policy-memory");

    const projectId = await resolveProjectId("demo-project");
    const unique = Date.now();
    const candidate = await prisma.mailDerivedCandidate.create({
      data: {
        candidateType: "customer",
        title: `Customer: Newsletter ${unique}`,
        summary: "Industry newsletter with unsubscribe and promotional updates.",
        sourceTitle: "Mail: Industry newsletter",
        sourceSender: "Industry News",
        confidence: 70,
        status: "proposed",
        metadata: {
          email: `newsletter.${unique}@industry.example.com`,
          legacyKnowledgeFallback: true,
          tags: ["mail-intelligence"],
        },
      },
    });

    await generateMailDerivedCandidates({ projectSlug: "demo-project", limit: 8 });

    const updated = await prisma.mailDerivedCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(updated.status).toBe("knowledge_only");
    expect(updated.metadata).toMatchObject({
      policyDecision: { reason: expect.stringContaining("promotional") },
    });
  });

  it("processes legacy knowledge fallback documents even when mail insight threads exist", async () => {
    const { prisma } = await import("@sangfor/db");
    const { generateMailDerivedCandidates } = await import("./mail-candidates");
    const { resolveProjectId } = await import("./mail-policy-memory");

    const projectId = await resolveProjectId("demo-project");
    const unique = Date.now();
    await prisma.mailInsightThread.create({
      data: {
        projectId,
        threadKey: `test-thread-${unique}`,
        threadTitle: `Existing thread ${unique}`,
        summary: "Existing thread keeps threads.length above zero.",
        status: "active",
        effectiveStatus: "active",
        aiEnhanced: false,
        messageIds: [],
        nextActions: [],
        evidenceItems: [],
        revenueOpsTags: [],
        participantDomains: ["example.com"],
      },
    });
    const document = await prisma.knowledgeDocument.create({
      data: {
        projectId,
        title: `Mail: Legacy quote request ${unique}`,
        body: [
          "From: Legacy Buyer",
          `Email: legacy.${unique}@buyer.example.com`,
          "Received: 2026-06-20T06:00:00Z",
          `MessageId: legacy-${unique}`,
          "",
          "Please send a quote and proposal for 200 units.",
        ].join("\n"),
        tags: ["mail-intelligence"],
        source: "mail-intelligence",
      },
    });

    await generateMailDerivedCandidates({ projectSlug: "demo-project", limit: 20, legacyKnowledgeFallback: true });

    const created = await prisma.mailDerivedCandidate.findFirst({
      where: {
        knowledgeDocumentId: document.id,
        candidateType: "opportunity",
      },
    });
    expect(created).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// combineHybridClassification — pure unit tests (no network, no DB)
// ---------------------------------------------------------------------------

function makeAiResult(
  category: AiClassificationResult["category"],
  confidence = 85,
): AiClassificationResult {
  return { category, confidence, reasoning: "test", urgency: "medium", sentiment: "neutral" };
}

/** Build a minimal policyResult that has one customer candidate and no excluded. */
function makeCustomerPolicyResult() {
  return classifyMailInsightThread({
    threadKey: "conv-customer",
    threadTitle: "[SamsungSDS] Sangfor 라이선스 견적 요청",
    summary: "고객사가 라이선스 견적과 계약 조건을 요청했습니다.",
    status: "active",
    aiEnhanced: true,
    messageIds: ["m1"],
    nextActions: [{ recommendedAction: "견적 회신" }],
    evidenceItems: ["견적 요청"],
    revenueOpsTags: ["견적/계약"],
    participantDomains: ["samsungsds.com"],
    metadata: { messages: [{ id: "m1", from: "buyer@samsungsds.com", fromName: "Samsung SDS" }] },
  });
}

/** Build a minimal policyResult that has one partner candidate. */
function makePartnerPolicyResult() {
  return classifyMailInsightThread({
    threadKey: "conv-partner",
    threadTitle: "[넥시아스] 고객사 SASE 견적 문의",
    summary: "파트너가 고객사를 위해 견적을 요청했습니다.",
    status: "active",
    aiEnhanced: true,
    messageIds: ["m1"],
    nextActions: [{ recommendedAction: "견적 확인" }],
    evidenceItems: ["견적"],
    revenueOpsTags: ["견적/계약"],
    participantDomains: ["nexias.co.kr"],
    metadata: { messages: [{ id: "m1", from: "hgyang@nexias.co.kr", fromName: "넥시아스" }] },
  });
}

describe("combineHybridClassification", () => {
  it("returns policyResult unchanged when aiResult is null", () => {
    const policyResult = makeCustomerPolicyResult();
    const combined = combineHybridClassification(policyResult, null);
    expect(combined.candidates).toEqual(policyResult.candidates);
    expect(combined.excluded).toEqual(policyResult.excluded);
    expect(combined.aiClassification).toBeNull();
  });

  it("drops all candidates and moves them to excluded when AI says vendor", () => {
    const policyResult = makeCustomerPolicyResult();
    // policy should produce at least one candidate
    expect(policyResult.candidates.length).toBeGreaterThan(0);

    const combined = combineHybridClassification(policyResult, makeAiResult("vendor"));
    expect(combined.candidates).toHaveLength(0);
    expect(combined.excluded.length).toBeGreaterThan(0);
    expect(combined.excluded.some(e => e.reason.includes("vendor"))).toBe(true);
    expect(combined.aiClassification?.category).toBe("vendor");
  });

  it("drops all candidates and moves them to excluded when AI says exclude", () => {
    const policyResult = makeCustomerPolicyResult();
    expect(policyResult.candidates.length).toBeGreaterThan(0);

    const combined = combineHybridClassification(policyResult, makeAiResult("exclude"));
    expect(combined.candidates).toHaveLength(0);
    expect(combined.excluded.length).toBeGreaterThan(0);
    expect(combined.aiClassification?.category).toBe("exclude");
  });

  it("corrects a customer candidate to partner when AI says partner with confidence >= 70", () => {
    const policyResult = makeCustomerPolicyResult();
    const customerCandidates = policyResult.candidates.filter(c => c.candidateType === "customer");
    expect(customerCandidates.length).toBeGreaterThan(0);

    const combined = combineHybridClassification(policyResult, makeAiResult("partner", 80));
    const corrected = combined.candidates.filter(c => c.candidateType === "partner" && c.title.startsWith("Partner:"));
    // Every originally-customer candidate should now be partner
    expect(corrected.length).toBeGreaterThanOrEqual(customerCandidates.length);
    // No leftover customer candidate with the same name
    expect(combined.candidates.some(c => c.candidateType === "customer" && c.title.startsWith("Customer:"))).toBe(false);
  });

  it("does NOT correct customer→partner when AI confidence is below 70", () => {
    const policyResult = makeCustomerPolicyResult();
    const combined = combineHybridClassification(policyResult, makeAiResult("partner", 65));
    // candidateType unchanged
    expect(combined.candidates.some(c => c.candidateType === "customer")).toBe(true);
  });

  it("corrects a partner candidate to customer when AI says customer with confidence >= 70", () => {
    const policyResult = makePartnerPolicyResult();
    const partnerCandidates = policyResult.candidates.filter(c => c.candidateType === "partner");
    expect(partnerCandidates.length).toBeGreaterThan(0);

    const combined = combineHybridClassification(policyResult, makeAiResult("customer", 75));
    const corrected = combined.candidates.filter(c => c.candidateType === "customer" && c.title.startsWith("Customer:"));
    expect(corrected.length).toBeGreaterThanOrEqual(partnerCandidates.length);
  });

  it("blends confidence 30% policy / 70% AI when category is opportunity", () => {
    const policyResult = makeCustomerPolicyResult();
    const firstCandidate = policyResult.candidates[0];
    if (!firstCandidate) return; // skip if no candidates (shouldn't happen)

    const aiResult = makeAiResult("opportunity", 90);
    const combined = combineHybridClassification(policyResult, aiResult);
    const blended = combined.candidates[0];
    expect(blended).toBeDefined();
    const expected = Math.min(100, Math.round((firstCandidate.confidence * 0.3) + (90 * 0.7)));
    expect(blended!.confidence).toBe(expected);
    expect((blended as Record<string, unknown>).aiClassification).toBe(aiResult);
  });

  it("does not modify non-customer/partner candidates (opportunity, poc, task) during type correction", () => {
    const policyResult = makeCustomerPolicyResult();
    const aiResult = makeAiResult("partner", 90);
    const combined = combineHybridClassification(policyResult, aiResult);
    // opportunity/poc/task types must be preserved
    const preserved = combined.candidates.filter(c =>
      c.candidateType === "opportunity" || c.candidateType === "poc" || c.candidateType === "task"
    );
    const original = policyResult.candidates.filter(c =>
      c.candidateType === "opportunity" || c.candidateType === "poc" || c.candidateType === "task"
    );
    expect(preserved.length).toBe(original.length);
  });
});
