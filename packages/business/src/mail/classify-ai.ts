import { prisma } from "@sangfor/db";

import { GROUND_TRUTH_CALIBRATION } from "../ai-classify-batch";
import { recordDecision } from "../governance/ai-decision";
import {
  buildChatCompletionRequestBody,
  extractChatCompletionText,
  getOpenAiApiKey,
  getOpenAiAuthHeaders,
  getOpenAiChatCompletionsUrl,
  getOpenAiModel,
} from "../openai-config";
import { MailPolicyLookup, resolveProjectId } from "../mail-policy-memory";

import { STATIC_POLICY_LOOKUP } from "./constants";
import {
  AiClassificationResult,
  ThreadLike,
  asRecord,
  asStringArray,
  asUnknownArray,
  classifyMailInsightThread,
  combineHybridClassification,
  isProjectCandidateType,
  toInputJson,
} from "./classify-rules";
import { getMailDerivedCandidate } from "./candidates-update";

export type AiRevalidationDecision =
  | "approve_candidate"
  | "needs_human_review"
  | "reject"
  | "knowledge_only";

export type AiRevalidationResult = {
  decision: AiRevalidationDecision;
  targetObject:
    | "opportunity"
    | "poc"
    | "task"
    | "customer_partner_only"
    | "none";
  confidence: number;
  reasoningSummary: string;
  evidence: Array<{
    sourceType: "email" | "attachment" | "thread" | "calendar";
    sourceId: string;
    quoteOrSummary: string;
  }>;
  duplicateCheck: {
    possibleDuplicate: boolean;
    matchedObjectType?: string;
    matchedObjectId?: string;
    reason?: string;
  };
  missingFields: string[];
  suggestedFields: {
    title?: string;
    stage?: string;
    priority?: string;
    productLine?: string;
    nextAction?: string;
  };
  riskFlags: string[];
  mode: "template" | "llm";
  model?: string;
  fallbackReason?: string;
  revalidatedAt: string;
  cacheKey: string;
};

/**
 * AI 기반 메일 분류 엔진
 * 모든 초기 분류에 AI를 적용하여 정확도 향상
 */
async function classifyWithAI(thread: ThreadLike): Promise<AiClassificationResult> {
  const prompt = `
당신은 B2B 메일 분류 전문가입니다. 다음 메일을 분석하고 JSON으로 응답해주세요.

## 분류 카테고리
1. opportunity - 영업 기회 (견적 요청, 구매 의향, 계약 논의)
2. poc - PoC/검증 (테스트 요청, 호환성 검증, 파일럿)
3. task - 후속 작업 (답변 필요, 확인 요청, 긴급 대응)
4. customer - 우리가 제품/라이선스를 판매하는 최종 고객사 (구매·도입 주체)
5. partner - 우리와 함께 파는 총판/리셀러/유통/MSP (end customer 아님)
6. exclude - 제외 (프로모션, 뉴스레터, 내부 공지)
7. vendor - 우리가 구독/사용하는 외부 서비스·툴 공급사 (예: Notion, Anthropic/OpenAI, Slack, AWS, Ecount, Wehago, 전자서명 등) — 우리가 파는 고객이 아니라 우리가 쓰는 공급사

## 응답 형식
{
  "category": "opportunity|poc|task|customer|partner|vendor|exclude",
  "confidence": 0-100,
  "reasoning": "분류 근거",
  "urgency": "high|medium|low",
  "sentiment": "positive|neutral|negative"
}

## 메일 정보
제목: ${thread.threadTitle}
발신자: ${thread.participantDomains.join(', ')}
본문: ${thread.summary}

## 분류 기준(사용자 확정)
${GROUND_TRUTH_CALIBRATION}
`;

  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Error("openai_api_key_missing");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Number(process.env.OPENAI_TIMEOUT_MS) || 25000); // AI 응답 타임아웃(게이트웨이 지연 고려; OPENAI_TIMEOUT_MS로 조정)

  try {
    const response = await fetch(getOpenAiChatCompletionsUrl(), {
      method: "POST",
      headers: getOpenAiAuthHeaders(apiKey),
      body: JSON.stringify(
        buildChatCompletionRequestBody({
          model: getOpenAiModel(),
          jsonMode: true,
          maxCompletionTokens: 500,
          messages: [
            { role: "system", content: "You are a B2B email classification expert. Return compact JSON only." },
            { role: "user", content: prompt }
          ]
        })
      ),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`openai_http_${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null; reasoning_content?: string | null };
      }>;
    };
    const text = extractChatCompletionText(payload);
    if (!text) throw new Error("openai_empty_content");

    return JSON.parse(text) as AiClassificationResult;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('openai_timeout');
    }
    throw error;
  }
}

/**
 * 하이브리드 분류: 정책 + AI 통합
 * 1단계: 정책 기반 필터링
 * 2단계: AI 분류 (비동기)
 * 3단계: 결과 결합 (combineHybridClassification)
 */
export async function classifyMailInsightThreadHybrid(
  thread: ThreadLike,
  policy: MailPolicyLookup = STATIC_POLICY_LOOKUP,
) {
  // 1단계: 정책 기반 필터링
  const policyResult = classifyMailInsightThread(thread, policy);

  // 2단계: AI 분류 (비동기)
  let aiResult: AiClassificationResult | null = null;
  try {
    aiResult = await classifyWithAI(thread);
  } catch (error) {
    console.error('AI classification failed:', error);
  }

  // 3단계: 결과 결합
  return combineHybridClassification(policyResult, aiResult);
}

function buildRevalidationCacheKey(candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>) {
  const metadata = asRecord(candidate.metadata);
  const messageId = String(
    metadata.threadKey ?? metadata.messageId ?? candidate.mailInsightThreadId ?? candidate.knowledgeDocumentId ?? candidate.id,
  );
  const attachments = Array.isArray(metadata.attachments) ? metadata.attachments.join("|") : "";
  const evidence = asStringArray(metadata.evidenceItems).join("|").slice(0, 400);
  return [
    "mail-ai-revalidation-v2",
    messageId,
    attachments,
    evidence,
    candidate.candidateType,
    candidate.title,
    candidate.confidence,
  ].join(":");
}

async function findPossibleDuplicate(
  candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>,
) {
  const normalizedTitle = candidate.title
    .replace(/^(Opportunity|PoC|Follow up):\s*/i, "")
    .slice(0, 80);

  if (candidate.candidateType === "opportunity") {
    const match = await prisma.opportunity.findFirst({
      where: { title: { contains: normalizedTitle, mode: "insensitive" } },
      select: { id: true, title: true },
    });
    return match
      ? { possibleDuplicate: true, matchedObjectType: "opportunity", matchedObjectId: match.id, reason: match.title }
      : { possibleDuplicate: false };
  }

  if (candidate.candidateType === "poc") {
    const match = await prisma.pocProject.findFirst({
      where: { title: { contains: normalizedTitle, mode: "insensitive" } },
      select: { id: true, title: true },
    });
    return match
      ? { possibleDuplicate: true, matchedObjectType: "poc", matchedObjectId: match.id, reason: match.title }
      : { possibleDuplicate: false };
  }

  const match = await prisma.workTask.findFirst({
    where: { title: { contains: normalizedTitle, mode: "insensitive" } },
    select: { id: true, title: true },
  });
  return match
    ? { possibleDuplicate: true, matchedObjectType: "task", matchedObjectId: match.id, reason: match.title }
    : { possibleDuplicate: false };
}

function buildTemplateRevalidation(input: {
  candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>;
  duplicateCheck: AiRevalidationResult["duplicateCheck"];
  cacheKey: string;
  fallbackReason?: string;
}): AiRevalidationResult {
  const { candidate, duplicateCheck, cacheKey } = input;
  const metadata = asRecord(candidate.metadata);
  const matchedKeywords = Array.isArray(metadata.matchedKeywords)
    ? metadata.matchedKeywords.map(String)
    : [];
  const attachments = Array.isArray(metadata.attachments) ? metadata.attachments.map(String) : [];
  const evidenceItems = asStringArray(metadata.evidenceItems);
  const nextActions = asUnknownArray(metadata.nextActions);
  const hasSignal =
    matchedKeywords.length > 0 ||
    evidenceItems.length > 0 ||
    nextActions.length > 0 ||
    candidate.confidence >= 70 ||
    attachments.length > 0;
  const missingFields = [
    ...(candidate.candidateType === "opportunity" ? ["customer/partner confirmation"] : []),
    ...(candidate.candidateType === "poc" ? ["product line confirmation", "schedule confirmation"] : []),
  ];

  let decision: AiRevalidationDecision = "needs_human_review";
  if (!hasSignal) decision = "knowledge_only";
  if (duplicateCheck.possibleDuplicate) decision = "needs_human_review";
  if (hasSignal && !duplicateCheck.possibleDuplicate && candidate.confidence >= 82) {
    decision = "approve_candidate";
  }

  return {
    decision,
    targetObject: candidate.candidateType as AiRevalidationResult["targetObject"],
    confidence: Math.max(40, Math.min(95, candidate.confidence + (attachments.length > 0 ? 5 : 0))),
    reasoningSummary:
      decision === "knowledge_only"
        ? "Mail intelligence did not provide enough project signal; keep as knowledge only."
        : "AIOS revalidation found enough mail-derived signal for human approval review.",
    evidence: [
      {
        sourceType: "email",
        sourceId: String(metadata.messageId ?? candidate.knowledgeDocumentId ?? candidate.id),
        quoteOrSummary: candidate.summary.slice(0, 240),
      },
      ...evidenceItems.slice(0, 4).map((evidence, index) => ({
        sourceType: "thread" as const,
        sourceId: String(metadata.threadKey ?? metadata.threadInsightId ?? `${candidate.id}-evidence-${index}`),
        quoteOrSummary: evidence.slice(0, 240),
      })),
      ...attachments.slice(0, 3).map((attachment) => ({
        sourceType: "attachment" as const,
        sourceId: attachment,
        quoteOrSummary: `Attachment referenced by mail intelligence: ${attachment}`,
      })),
    ],
    duplicateCheck,
    missingFields,
    suggestedFields: {
      title: candidate.title.replace(/^(Opportunity|PoC|Follow up):\s*/i, ""),
      stage: candidate.candidateType === "opportunity" ? "lead" : undefined,
      priority: candidate.confidence >= 80 ? "high" : "normal",
      productLine: candidate.candidateType === "poc" ? "Sangfor" : undefined,
      nextAction:
        nextActions.length > 0
          ? String((nextActions[0] as Record<string, unknown>)?.recommendedAction ?? nextActions[0]).slice(0, 180)
          : `Review mail intelligence evidence: ${candidate.summary.slice(0, 160)}`,
    },
    riskFlags: [
      ...(duplicateCheck.possibleDuplicate ? ["possible_duplicate"] : []),
      ...(missingFields.length > 0 ? ["missing_field_confirmation"] : []),
      ...(candidate.confidence < 70 ? ["low_confidence"] : []),
    ],
    mode: "template",
    fallbackReason: input.fallbackReason,
    revalidatedAt: new Date().toISOString(),
    cacheKey,
  };
}

async function callLlmRevalidation(
  candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>,
  duplicateCheck: AiRevalidationResult["duplicateCheck"],
  cacheKey: string,
) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;

  const metadata = asRecord(candidate.metadata);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Number(process.env.OPENAI_TIMEOUT_MS) || 25000); // AI 응답 타임아웃(게이트웨이 지연 고려; OPENAI_TIMEOUT_MS로 조정)

  try {
    const response = await fetch(getOpenAiChatCompletionsUrl(), {
      method: "POST",
      headers: getOpenAiAuthHeaders(apiKey),
      body: JSON.stringify(
        buildChatCompletionRequestBody({
          model: getOpenAiModel(),
          jsonMode: true,
          maxCompletionTokens: 900,
          messages: [
            {
              role: "system",
              content:
                "You validate whether mail-intelligence output should become an AIOS project object. Return compact JSON only.",
            },
            {
              role: "user",
              content: JSON.stringify({
                requiredSchema: {
                  decision: "approve_candidate | needs_human_review | reject | knowledge_only",
                  reasoningSummary: "short Korean or English summary",
                  missingFields: ["string"],
                  riskFlags: ["string"],
                },
                policy: [
                  "Do not approve if evidence is weak.",
                  "Possible duplicates require human review.",
                  "Never create objects automatically.",
                ],
                candidate: {
                  type: candidate.candidateType,
                  title: candidate.title,
                  summary: candidate.summary,
                  confidence: candidate.confidence,
                  sourceTitle: candidate.sourceTitle,
                  sender: candidate.sourceSender,
                  metadata,
                  duplicateCheck,
                },
              }),
            },
          ],
        }),
      ),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`openai_http_${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null; reasoning_content?: string | null };
      }>;
    };
    const text = extractChatCompletionText(payload);
    if (!text) throw new Error("openai_empty_content");

    const parsed = JSON.parse(text) as Partial<AiRevalidationResult>;
    const template = buildTemplateRevalidation({ candidate, duplicateCheck, cacheKey });

    return {
      ...template,
      decision: parsed.decision ?? template.decision,
      reasoningSummary: parsed.reasoningSummary ?? template.reasoningSummary,
      missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : template.missingFields,
      riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : template.riskFlags,
      mode: "llm",
      model: getOpenAiModel(),
    } satisfies AiRevalidationResult;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('openai_timeout');
    }
    throw error;
  }
}

function shouldKeepRevalidationAsKnowledgeOnly(revalidation: AiRevalidationResult) {
  const text = [
    revalidation.reasoningSummary,
    ...revalidation.riskFlags,
    ...revalidation.missingFields,
  ]
    .join(" ")
    .toLowerCase();
  return /external_marketing|marketing content|newsletter|promo|no actual customer|마케팅|홍보/.test(text);
}

export async function revalidateMailDerivedCandidate(id: string) {
  const candidate = await getMailDerivedCandidate(id);
  if (!isProjectCandidateType(candidate.candidateType)) {
    return { candidate, revalidation: null };
  }

  const cacheKey = buildRevalidationCacheKey(candidate);
  const metadata = asRecord(candidate.metadata);
  const existing = asRecord(metadata.aiRevalidation);
  if (existing.cacheKey === cacheKey && typeof existing.decision === "string") {
    return { candidate, revalidation: existing };
  }

  const duplicateCheck = await findPossibleDuplicate(candidate);
  let revalidation: AiRevalidationResult;
  try {
    revalidation =
      (await callLlmRevalidation(candidate, duplicateCheck, cacheKey)) ??
      buildTemplateRevalidation({ candidate, duplicateCheck, cacheKey });
  } catch (error) {
    revalidation = buildTemplateRevalidation({
      candidate,
      duplicateCheck,
      cacheKey,
      fallbackReason: error instanceof Error ? error.message : "llm_failed",
    });
  }

  const status =
    revalidation.decision === "reject"
      ? "rejected"
      : revalidation.decision === "knowledge_only" || shouldKeepRevalidationAsKnowledgeOnly(revalidation)
        ? "knowledge_only"
        : "proposed";

  const updated = await prisma.mailDerivedCandidate.update({
    where: { id },
    data: {
      status,
      confidence: revalidation.confidence,
      metadata: toInputJson({
        ...metadata,
        aiRevalidation: revalidation,
      }),
    },
  });

  // S1: unified decision instrumentation (best-effort, outside txn, never throws).
  // revalidation.confidence is a 0..100 percentage; normalize to 0..1 for the log.
  // Wrapped defensively: projectId resolution must not break the mail flow.
  try {
    const outcome: "approved" | "rejected" | "corrected" =
      revalidation.decision === "approve_candidate"
        ? "approved"
        : revalidation.decision === "reject"
          ? "rejected"
          : "corrected";
    const projectId = await resolveProjectId("demo-project");
    await recordDecision({
      projectId,
      domain: "sales",
      actor: "sales",
      actionType: "mail_revalidation",
      caseRef: "mail_candidate:" + id,
      outcome,
      predictedConfidence:
        typeof revalidation.confidence === "number"
          ? revalidation.confidence / 100
          : null,
    });
  } catch (error) {
    console.error("[revalidateMailDerivedCandidate] recordDecision failed (swallowed):", error);
  }

  return { candidate: updated, revalidation };
}
