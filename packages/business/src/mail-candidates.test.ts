import { describe, expect, it } from "vitest";

import { classifyMailCandidateDocument, classifyMailInsightThread } from "./mail-candidates";

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
});
