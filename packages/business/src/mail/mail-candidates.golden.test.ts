import { describe, it, expect } from "vitest";

import {
  classifyMailCandidateDocument,
  classifyMailInsightThread,
  combineHybridClassification,
} from "./mail-candidates";
import type { AiClassificationResult } from "./mail-candidates";

/**
 * Golden-master snapshot safety net for mail-candidates.ts's pure classification
 * functions (Phase 0 / plan §0-2), ahead of the Phase 4 file split. Pure-function
 * zone only — no DB, no AI/network calls. Fixtures are drawn from the same
 * real-mail-like corpus style as mail-candidates.test.ts (Korean/English mixed
 * B2B mail, bracketed company names, internal/partner/system-sender domains).
 */

// ---------------------------------------------------------------------------
// classifyMailCandidateDocument — document-style fixtures
// ---------------------------------------------------------------------------

describe("classifyMailCandidateDocument golden master", () => {
  it("opportunity quote-request mail", () => {
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
    expect(result).toMatchSnapshot();
  });

  it("PoC compatibility-test mail", () => {
    const result = classifyMailCandidateDocument({
      title: "PoC 호환성 검증 일정 문의",
      body: [
        "From: Engineer <eng@example.com>",
        "Received: 2026-06-02T10:00:00.000Z",
        "",
        "PoC compatibility 테스트 일정 확인 요청",
      ].join("\n"),
    });
    expect(result).toMatchSnapshot();
  });

  it("partner/reseller mail", () => {
    const result = classifyMailCandidateDocument({
      title: "[ChannelOne] 파트너 총판 협업 문의",
      body: [
        "From: Channel <sales@channelone.example>",
        "Received: 2026-06-03T08:30:00.000Z",
        "",
        "Sangfor reseller partner 협업 제안",
      ].join("\n"),
    });
    expect(result).toMatchSnapshot();
  });

  it("internal-company mail is excluded", () => {
    const result = classifyMailCandidateDocument({
      title: "[베를로] Sangfor VDI 사이징관련 정보 요청 건",
      body: [
        "From: 박 재민 <jm.park@blro.co.kr>",
        "Received: 2026-06-04T11:00:00.000Z",
        "",
        "견적 확인 요청",
      ].join("\n"),
    });
    expect(result).toMatchSnapshot();
  });

  it("newsletter/promotional mail is excluded", () => {
    const result = classifyMailCandidateDocument({
      title: "Mail: FW: Industry newsletter - June edition",
      body: [
        "From: Industry News",
        "Email: newsletter@industry.com",
        "Received: 2026-06-05T06:30:00.000Z",
        "MessageId: msg100",
        "",
        "June newsletter with industry updates. Unsubscribe here.",
      ].join("\n"),
      tags: ["mail-intelligence"],
    });
    expect(result).toMatchSnapshot();
  });

  it("billing/tax-invoice system-sender mail is excluded", () => {
    const result = classifyMailCandidateDocument({
      title: "2026년 05월 발행현황보고서[(주)베를로]",
      body: [
        "From: Bill36524 <billmanager@bill36524.com>",
        "Received: 2026-06-06T07:00:00.000Z",
        "",
        "세금계산서 발행현황",
      ].join("\n"),
    });
    expect(result).toMatchSnapshot();
  });

  it("customer inquiry with bracketed company name", () => {
    const result = classifyMailCandidateDocument({
      title: "[SamsungSDS] 방화벽 도입 문의",
      body: [
        "From: Kim Buyer <buyer@samsungsds.com>",
        "Received: 2026-06-07T09:30:00.000Z",
        "",
        "Sangfor 방화벽 도입 검토 중입니다. 견적 부탁드립니다.",
      ].join("\n"),
    });
    expect(result).toMatchSnapshot();
  });

  it("multiple keyword matches across opportunity+poc+task", () => {
    const result = classifyMailCandidateDocument({
      title: "[Acme] PoC 검증 및 견적 후속 조치",
      body: [
        "From: Buyer <buyer@acme.example>",
        "Received: 2026-06-08T10:00:00.000Z",
        "",
        "PoC compatibility 테스트 완료 후 견적과 계약 조건, 후속 조치 확인 부탁드립니다.",
      ].join("\n"),
    });
    expect(result).toMatchSnapshot();
  });

  it("generic task-only mail with no company signal", () => {
    const result = classifyMailCandidateDocument({
      title: "회의록 후속 조치 안내",
      body: [
        "From: 익명",
        "Received: 2026-06-09T12:00:00.000Z",
        "",
        "지난 회의에서 논의된 후속 조치 목록을 공유드립니다.",
      ].join("\n"),
    });
    expect(result).toMatchSnapshot();
  });

  it("free-mail-domain (gmail) sender", () => {
    const result = classifyMailCandidateDocument({
      title: "견적 문의드립니다",
      body: [
        "From: 개인 <someone@gmail.com>",
        "Received: 2026-06-10T13:00:00.000Z",
        "",
        "Sangfor 제품 견적 부탁드립니다.",
      ].join("\n"),
    });
    expect(result).toMatchSnapshot();
  });

  it("known-partner-domain case", () => {
    const result = classifyMailCandidateDocument({
      title: "[넥시아스] 베를로 - 고객사 라이선스 전달",
      body: [
        "From: 양해광 <hgyang@nexias.co.kr>",
        "Received: 2026-06-11T14:00:00.000Z",
        "",
        "라이선스 전달",
      ].join("\n"),
    });
    expect(result).toMatchSnapshot();
  });

  it("mail with attachments and a Received timestamp header", () => {
    const result = classifyMailCandidateDocument({
      title: "Mail: RE: Product demo feedback",
      body: [
        "From: Choi Client",
        "Email: client@samsung.com",
        "Received: 2026-06-12T06:00:00.000Z",
        "MessageId: msg200",
        "Attachments: demo-feedback.pdf, pricing.xlsx",
        "",
        "Great demo! We want to proceed with 200 units. Can you send proposal?",
      ].join("\n"),
      tags: ["mail-intelligence"],
    });
    expect(result).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// classifyMailInsightThread — thread-style fixtures
// ---------------------------------------------------------------------------

describe("classifyMailInsightThread golden master", () => {
  it("qualified opportunity thread with evidence + AI-enhanced flag", () => {
    const result = classifyMailInsightThread({
      threadKey: "conv-opp-1",
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
    expect(result).toMatchSnapshot();
  });

  it("PoC verification thread", () => {
    const result = classifyMailInsightThread({
      threadKey: "conv-poc-1",
      threadTitle: "[Acme] SASE PoC 검증 일정 협의",
      summary: "고객사가 SASE PoC 검증 일정을 협의하고자 합니다.",
      status: "active",
      aiEnhanced: true,
      messageIds: ["m1"],
      nextActions: [{ recommendedAction: "PoC 일정 확정" }],
      evidenceItems: ["PoC 검증 요청"],
      revenueOpsTags: ["PoC/검증"],
      participantDomains: ["acme.example"],
      metadata: { messages: [{ id: "m1", from: "buyer@acme.example", fromName: "Acme Buyer" }] },
    });
    expect(result).toMatchSnapshot();
  });

  it("promotional/newsletter thread is excluded", () => {
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
    expect(result).toMatchSnapshot();
  });

  it("thread with only an internal domain participant is excluded", () => {
    const result = classifyMailInsightThread({
      threadKey: "conv-internal-only",
      threadTitle: "내부 공지 - 시스템 점검 안내",
      summary: "내부 시스템 점검 일정 공지",
      status: "reference",
      aiEnhanced: false,
      messageIds: ["m1"],
      nextActions: [],
      evidenceItems: [],
      revenueOpsTags: [],
      participantDomains: ["blro.co.kr"],
      metadata: { messages: [{ id: "m1", from: "ops@blro.co.kr", fromName: "Ops Team" }] },
    });
    expect(result).toMatchSnapshot();
  });

  it("vendor tech-support thread (bypass path)", () => {
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
    expect(result).toMatchSnapshot();
  });

  it("known partner domain thread", () => {
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
    expect(result).toMatchSnapshot();
  });

  it("external customer domain thread with a display name in fromName", () => {
    const result = classifyMailInsightThread({
      threadKey: "conv-external-display-name",
      threadTitle: "방화벽 도입 후속 논의",
      summary: "고객사 담당자가 방화벽 도입을 위한 후속 논의를 요청했습니다.",
      status: "active",
      aiEnhanced: false,
      messageIds: ["m1"],
      nextActions: [{ recommendedAction: "후속 미팅 일정 협의" }],
      evidenceItems: ["도입 검토 중"],
      revenueOpsTags: [],
      participantDomains: ["other-corp.example"],
      metadata: {
        messages: [{ id: "m1", from: "buyer@other-corp.example", fromName: "Kim Manager" }],
      },
    });
    expect(result).toMatchSnapshot();
  });

  it("bracketed customer name in thread title with no evidence", () => {
    const result = classifyMailInsightThread({
      threadKey: "conv-bracket-no-evidence",
      threadTitle: "[QuietCorp] 안녕하세요",
      summary: "짧은 인사",
      status: "reference",
      aiEnhanced: false,
      messageIds: ["m1"],
      nextActions: [],
      evidenceItems: [],
      revenueOpsTags: [],
      participantDomains: ["quietcorp.example"],
      metadata: { messages: [{ id: "m1", from: "hi@quietcorp.example", fromName: "Quiet Corp" }] },
    });
    expect(result).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// combineHybridClassification — combining a thread policy result with AI
// ---------------------------------------------------------------------------

function makeAiResult(
  category: AiClassificationResult["category"],
  confidence: number,
  reasoning: string,
): AiClassificationResult {
  return { category, confidence, reasoning, urgency: "medium", sentiment: "neutral" };
}

describe("combineHybridClassification golden master", () => {
  const opportunityThread = () =>
    classifyMailInsightThread({
      threadKey: "conv-opp-1",
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

  const partnerThread = () =>
    classifyMailInsightThread({
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
      metadata: { messages: [{ id: "m1", from: "hgyang@nexias.co.kr", fromName: "넥시아스" }] },
    });

  it("null aiResult passes the policy result through unchanged", () => {
    const combined = combineHybridClassification(opportunityThread(), null);
    expect(combined).toMatchSnapshot();
  });

  it("AI vendor classification moves candidates to excluded", () => {
    const combined = combineHybridClassification(
      opportunityThread(),
      makeAiResult("vendor", 90, "SaaS tool we use internally"),
    );
    expect(combined).toMatchSnapshot();
  });

  it("AI exclude classification moves candidates to excluded", () => {
    const combined = combineHybridClassification(
      opportunityThread(),
      makeAiResult("exclude", 80, "irrelevant to sales pipeline"),
    );
    expect(combined).toMatchSnapshot();
  });

  it("AI customer correction (confidence >= 70) relabels a partner candidate", () => {
    const combined = combineHybridClassification(
      partnerThread(),
      makeAiResult("customer", 85, "confirmed direct customer, not a reseller"),
    );
    expect(combined).toMatchSnapshot();
  });

  it("AI opportunity classification below the correction threshold blends confidence", () => {
    const combined = combineHybridClassification(
      opportunityThread(),
      makeAiResult("opportunity", 60, "weak signal, low confidence"),
    );
    expect(combined).toMatchSnapshot();
  });
});
