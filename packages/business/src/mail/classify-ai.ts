import {
  hasCapability,
  isActiveProjectAssignment,
  resolveActiveCompanyRole,
  type AuthContext,
} from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction, type Prisma } from "@sangfor/db";
import { createHash } from "node:crypto";
import { z } from "zod";

import { GROUND_TRUTH_CALIBRATION } from "./ai-classify-batch";
import { CrmServiceError, listCustomers } from "../crm/customer-partner";
import { listOpportunities } from "../crm/opportunity-center";
import { appendAuditEvent } from "../governance/audit-db";
import { deriveChainScopeKey } from "../governance/audit-chain";
import {
  buildChatCompletionRequestBody,
  extractChatCompletionText,
  getOpenAiApiKey,
  getOpenAiAuthHeaders,
  getOpenAiChatCompletionsUrl,
  getOpenAiModel,
} from "../platform/openai-config";
import { MailPolicyLookup } from "./mail-policy-memory";

import { INTERNAL_COMPANY_NAMES, STATIC_POLICY_LOOKUP } from "./constants";
import { SELF_DOMAINS, SYSTEM_SENDER_DOMAINS } from "./mail-domain-registry";
import {
  AiClassificationResult,
  ARTIFACT_ENTITY_NAME_EXAMPLES,
  ThreadLike,
  asRecord,
  asStringArray,
  asUnknownArray,
  classifyMailInsightThread,
  combineHybridClassification,
  gtmDomainForCandidate,
  isProjectCandidateType,
  toInputJson,
} from "./classify-rules";
type MailDerivedCandidate = Prisma.MailDerivedCandidateGetPayload<Record<string, never>>;

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
    | "customer"
    | "partner"
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
  llmConfidence?: number;
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
발신 도메인(분류 대상이 아닐 수 있음): ${thread.participantDomains.join(', ')}
본문: ${thread.summary}

## 발신자 vs 분류 대상 (중요)
- '발신 도메인'은 이 메일을 보낸 곳일 뿐, 분류 대상과 다를 수 있다. 분류 대상은 "이 메일의 비즈니스가 누구에 관한 것인가"이다.
- 우리 벤더(본사) Sangfor(sangfor.com)나 총판이 제3의 회사 문의를 대신 전달("FW:/RE: [회사] … 견적/문의/도입/라이선스")하는 경우: 그 [회사]는 제품을 도입하려는 엔드고객(customer)이다. 리셀러/SI/총판이라는 명시적 증거가 없으면 partner가 아니라 customer.
- 다만 발신자 자신이 외부 채널/SI 회사이고 자기 이름으로 공동제안·협업·재판매를 제안하는 경우(예: "[자사] 씨젠 공동 제안"처럼 발신 회사가 곧 대괄호 회사): 그 발신 회사는 partner이고, 그 안에서 도입 주체로 언급된 최종 회사가 customer다. 대괄호 회사가 곧 발신 회사 자신이면 customer로 뒤집지 말 것.
- sangfor.com(우리 공급 벤더/본사) 자체는 우리가 파는 고객도, 함께 파는 파트너도 아니다 — 발신이 sangfor.com이라는 사실만으로 대상 회사를 partner로 판단하지 말 것.

## 노이즈(반드시 exclude)
- 발송 실패/반송 알림(Undeliverable, Mail Delivery Failed, postmaster, MicrosoftExchange…@ 로 시작하는 발신): exclude.
- 전자서명/전자계약·인증서 플랫폼의 단순 서명요청/완료/발급 통지(eformsign, signgate, 모두싸인, DocuSign 등): 그 자체는 영업 대상이 아니다 — exclude(순수 행정 후속이면 task). opportunity/customer로 만들지 말 것.

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

function buildRevalidationCacheKey(candidate: MailDerivedCandidate) {
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

async function checkCustomerPartnerDedup(
  ctx: AuthContext,
  candidate: MailDerivedCandidate,
): Promise<AiRevalidationResult["duplicateCheck"]> {
  const normalizedName = candidate.title
    .replace(/^(Customer|Partner):\s*/i, "")
    .slice(0, 80);

  if (candidate.candidateType === "customer") {
    const page = await listCustomers(ctx, { search: normalizedName, first: 1 });
    const match = page.items[0];
    return match
      ? { possibleDuplicate: true, matchedObjectType: "customer", matchedObjectId: match.id, reason: match.name }
      : { possibleDuplicate: false };
  }

  if (candidate.candidateType === "partner") {
    const match = await withRlsTransaction(ctx, (tx) => tx.partner.findFirst({
      where: {
        projectId: ctx.projectId,
        status: { not: "archived" },
        name: { contains: normalizedName, mode: "insensitive" },
      },
      select: { id: true, name: true },
    }));
    return match
      ? { possibleDuplicate: true, matchedObjectType: "partner", matchedObjectId: match.id, reason: match.name }
      : { possibleDuplicate: false };
  }

  return { possibleDuplicate: false };
}

async function findPossibleDuplicate(
  ctx: AuthContext,
  candidate: MailDerivedCandidate,
) {
  const normalizedTitle = candidate.title
    .replace(/^(Opportunity|PoC|Follow up):\s*/i, "")
    .slice(0, 80);

  if (candidate.candidateType === "opportunity") {
    const page = await listOpportunities(ctx, { search: normalizedTitle, first: 1 });
    const match = page.items[0];
    return match
      ? { possibleDuplicate: true, matchedObjectType: "opportunity", matchedObjectId: match.id, reason: match.title }
      : { possibleDuplicate: false };
  }

  if (candidate.candidateType === "poc") {
    const match = await withRlsTransaction(ctx, (tx) => tx.pocProject.findFirst({
      where: {
        projectId: ctx.projectId,
        title: { contains: normalizedTitle, mode: "insensitive" },
      },
      select: { id: true, title: true },
    }));
    return match
      ? { possibleDuplicate: true, matchedObjectType: "poc", matchedObjectId: match.id, reason: match.title }
      : { possibleDuplicate: false };
  }

  const match = await withRlsTransaction(ctx, (tx) => tx.workTask.findFirst({
    where: {
      projectId: ctx.projectId,
      archivedAt: null,
      title: { contains: normalizedTitle, mode: "insensitive" },
    },
    select: { id: true, title: true },
  }));
  return match
    ? { possibleDuplicate: true, matchedObjectType: "task", matchedObjectId: match.id, reason: match.title }
    : { possibleDuplicate: false };
}

function stripJsonCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text;
}

function buildTemplateRevalidation(input: {
  candidate: MailDerivedCandidate;
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

function describeRevalidationFallback(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/timeout|timed out|abort/.test(message)) {
    return "AI 재검증 응답 시간이 초과되어 규칙 기반 검토로 대체했습니다.";
  }
  if (/429|rate.?limit|quota/.test(message)) {
    return "AI 재검증 요청 한도에 도달하여 규칙 기반 검토로 대체했습니다.";
  }
  if (/401|403|auth|api.?key|credential/.test(message)) {
    return "AI 재검증 서비스 인증을 확인할 수 없어 규칙 기반 검토로 대체했습니다.";
  }
  return "AI 재검증 서비스를 사용할 수 없어 규칙 기반 검토로 대체했습니다.";
}

async function callLlmRevalidation(
  candidate: MailDerivedCandidate,
  duplicateCheck: AiRevalidationResult["duplicateCheck"],
  cacheKey: string,
  deps?: {
    /** Injectable LLM caller for tests; default = production fetch. */
    callLLM?: (system: string, user: string) => Promise<string>;
  },
) {
  const metadata = asRecord(candidate.metadata);

  const llmCaller = async (systemPrompt: string, userPayload: Record<string, unknown>): Promise<string> => {
    if (deps?.callLLM) {
      return deps.callLLM(systemPrompt, JSON.stringify(userPayload));
    }
    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Error("openai_api_key_missing");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Number(process.env.OPENAI_TIMEOUT_MS) || 25000);

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
              { role: "system", content: systemPrompt },
              { role: "user", content: JSON.stringify(userPayload) },
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
      return text;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('openai_timeout');
      }
      throw error;
    }
  };

  const selfDomainsStr = Array.from(SELF_DOMAINS).join(", ");
  const internalNamesStr = Array.from(INTERNAL_COMPANY_NAMES).join(", ");
  const systemSendersStr = Array.from(SYSTEM_SENDER_DOMAINS).join(", ");

  try {
    const text = await llmCaller(
      `You validate whether mail-intelligence output should become an AIOS project or entity record. Return compact JSON only.

GROUND_TRUTH: ${GROUND_TRUTH_CALIBRATION}

DOMAIN KNOWLEDGE:
- Our own company domains: ${selfDomainsStr}. Our internal company names: ${internalNamesStr}. If a customer/partner candidate IS our own company (title starts with "Customer:" or "Partner:" followed by one of these names) → decision=reject, confidence<=30.
- System/relay sender domains: ${systemSendersStr}. Known relay/billing/vendor names that are NOT our customers: "팝빌", "eformsign", "linkhub", "모두싸인", "signgate", "DocuSign", "bill36524". These senders are RELAYS — the actual counterparty is in the title/summary, not the relay name. If the candidate title IS the relay/vendor name itself (e.g. "Customer: 팝빌") → decision=reject, confidence<=40.
- Parser artifact / garbage entity names: ${ARTIFACT_ENTITY_NAME_EXAMPLES.map((n) => `"${n}"`).join(", ")}, bare numbers-only, bare symbols-only, empty/short names (<2 chars) → decision=reject, confidence<=50.
- approve_candidate semantics: evidence is strong, entity name is a real external company (not us, not a relay, not garbage), and no duplicate found. Safe for batch human-approved conversion (NOT auto-creation — still needs human to click convert).
- needs_human_review = possible duplicates, weak evidence, or unsure.
- reject = definitely not our customer/partner (junk, our own company, relay/vendor as entity).`,
      {
        requiredSchema: {
          decision: "approve_candidate | needs_human_review | reject | knowledge_only",
          confidence: "0-100 numeric — how confident are you in this decision",
          reasoningSummary: "short Korean or English summary",
          missingFields: ["string"],
          riskFlags: ["string"],
        },
        policy: [
          "Do not approve if evidence is weak.",
          "Possible duplicates require human review.",
          "Never create objects automatically.",
          "For customer/partner candidates, confirm they are a real customer or partner of ours, not a vendor or noise.",
          "approve_candidate = evidence is strong, entity name is a real external company, and no duplicate — safe for batch human-approved conversion (NOT auto-creation).",
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
      },
    );

    const parsed = JSON.parse(stripJsonCodeFence(text)) as Partial<AiRevalidationResult> & { confidence?: number };
    const template = buildTemplateRevalidation({ candidate, duplicateCheck, cacheKey });

    const llmConfidence =
      typeof parsed.confidence === "number" && !Number.isNaN(parsed.confidence)
        ? Math.max(0, Math.min(100, parsed.confidence))
        : undefined;

    return {
      ...template,
      decision: parsed.decision ?? template.decision,
      confidence: llmConfidence ?? template.confidence,
      reasoningSummary: parsed.reasoningSummary ?? template.reasoningSummary,
      missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : template.missingFields,
      riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : template.riskFlags,
      mode: "llm",
      model: getOpenAiModel(),
      llmConfidence,
    } satisfies AiRevalidationResult;
  } catch (error) {
    if (error instanceof Error && (error.message === "openai_api_key_missing" || error.message === "openai_timeout" || error.message.startsWith("openai_http_"))) {
      throw error;
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
  return /external_marketing|marketing content|newsletter|promo|promotion|subscription|billing|renewal|no actual customer|마케팅|홍보|\(광고\)|구독|청구|요금|프로모션|웨비나|webinar|modusign|microsoft\s*365|your\s+microsoft/.test(text);
}

const revalidateMailDerivedCandidateSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  idempotencyKey: z.string().trim().min(1).max(128),
  force: z.boolean().optional(),
}).strict();

export type RevalidateMailDerivedCandidateCommand = z.input<
  typeof revalidateMailDerivedCandidateSchema
>;

type ScopedCandidate = Prisma.MailDerivedCandidateGetPayload<{
  include: { mailInsightThread: { select: { projectId: true } } };
}>;

async function resolveRevalidationActor(tx: Prisma.TransactionClient, ctx: AuthContext) {
  const now = new Date();
  const [assignments, projectAssignment] = await Promise.all([
    tx.userCompanyRole.findMany({
      where: { userId: ctx.userId, companyId: ctx.companyId },
      select: {
        id: true,
        userId: true,
        companyId: true,
        role: true,
        status: true,
        validFrom: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
    tx.projectMember.findFirst({
      where: { userId: ctx.userId, projectId: ctx.projectId },
      select: {
        id: true,
        userId: true,
        projectId: true,
        status: true,
        validFrom: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
  ]);
  const resolved = resolveActiveCompanyRole(assignments, now);
  if (
    !resolved.ok ||
    !isActiveProjectAssignment(projectAssignment, now) ||
    (!hasCapability(resolved.role, "customer.write") &&
      !hasCapability(resolved.role, "opportunity.write"))
  ) {
    throw new CrmServiceError("FORBIDDEN", 403, "mail_candidate_revalidation_denied");
  }
  return resolved.assignment;
}

async function loadScopedCandidate(
  tx: Prisma.TransactionClient,
  ctx: AuthContext,
  id: string,
): Promise<ScopedCandidate> {
  const candidate = await tx.mailDerivedCandidate.findFirst({
    where: { id },
    include: { mailInsightThread: { select: { projectId: true } } },
  });
  if (!candidate) {
    throw new CrmServiceError("NOT_FOUND", 404, "mail_candidate_not_found");
  }

  const projectIds: string[] = [];
  if (candidate.mailInsightThreadId) {
    const threadProjectId = candidate.mailInsightThread?.projectId;
    if (!threadProjectId) {
      throw new CrmServiceError("FORBIDDEN", 403, "mail_candidate_scope_unverified");
    }
    projectIds.push(threadProjectId);
  }
  if (candidate.knowledgeDocumentId) {
    const document = await tx.knowledgeDocument.findFirst({
      where: { id: candidate.knowledgeDocumentId },
      select: { projectId: true },
    });
    if (!document) {
      throw new CrmServiceError("FORBIDDEN", 403, "mail_candidate_scope_unverified");
    }
    projectIds.push(document.projectId);
  }
  if (
    projectIds.length === 0 ||
    projectIds.some((projectId) => projectId !== ctx.projectId) ||
    new Set(projectIds).size !== 1
  ) {
    throw new CrmServiceError("FORBIDDEN", 403, "mail_candidate_scope_unverified");
  }
  return candidate;
}

function revalidationInputHash(
  ctx: AuthContext,
  actorAssignmentId: string,
  candidateId: string,
  command: z.output<typeof revalidateMailDerivedCandidateSchema>,
): string {
  return createHash("sha256")
    .update(canonicalizeRfc8785({
      contract: "sangfor.mail_candidate.revalidate/v1",
      scope: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        projectId: ctx.projectId,
      },
      actorAssignmentId,
      candidateId,
      command,
    }))
    .digest("hex");
}

function auditDetails(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function revalidateMailDerivedCandidate(
  ctx: AuthContext,
  id: string,
  rawCommand: RevalidateMailDerivedCandidateCommand,
  deps?: {
    /** Injectable LLM caller for tests; forwarded to callLlmRevalidation. */
    callLLM?: (system: string, user: string) => Promise<string>;
  },
) {
  const command = revalidateMailDerivedCandidateSchema.parse(rawCommand);
  const scope = {
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    projectId: ctx.projectId,
    level: "PROJECT" as const,
  };
  const auditKey = `mail_candidate.revalidate:${command.idempotencyKey}`;
  const initial = await withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveRevalidationActor(tx, ctx);
    const candidate = await loadScopedCandidate(tx, ctx, id);
    const inputHash = revalidationInputHash(ctx, actor.id, id, command);
    const prior = await tx.auditLog.findFirst({
      where: { chainScopeKey: deriveChainScopeKey(scope), idempotencyKey: auditKey },
    });
    if (prior) {
      const details = auditDetails(prior.details);
      if (
        details.contract !== "sangfor.mail_candidate.revalidate/v1" ||
        details.inputHash !== inputHash
      ) {
        throw new CrmServiceError("CONFLICT", 409, "mail_candidate_idempotency_conflict");
      }
      return {
        actorAssignmentId: actor.id,
        candidate,
        inputHash,
        replay: details.result,
      };
    }
    return { actorAssignmentId: actor.id, candidate, inputHash, replay: null };
  });

  if (initial.replay) {
    return {
      candidate: initial.candidate,
      revalidation: auditDetails(initial.replay).revalidation ?? initial.replay,
    };
  }
  const candidate = initial.candidate;

  const cacheKey = buildRevalidationCacheKey(candidate);
  const metadata = asRecord(candidate.metadata);
  const existing = asRecord(metadata.aiRevalidation);

  // Skip cache when:
  // - force is true (explicit revalidation request), or
  // - cached result was an LLM-outage fallback (mode=template + fallbackReason)
  //   that should not pin stale data permanently.
  const isCacheStale =
    command.force === true ||
    (existing.mode === "template" && typeof existing.fallbackReason === "string");

  if (!isCacheStale && existing.cacheKey === cacheKey && typeof existing.decision === "string") {
    return { candidate, revalidation: existing };
  }

  const duplicateCheck = isProjectCandidateType(candidate.candidateType)
    ? await findPossibleDuplicate(ctx, candidate)
    : await checkCustomerPartnerDedup(ctx, candidate);

  let revalidation: AiRevalidationResult;
  try {
    const llmResult = await callLlmRevalidation(candidate, duplicateCheck, cacheKey, deps);
    if (llmResult) {
      const llmRaw = llmResult.llmConfidence;
      if (typeof llmRaw === "number" && !Number.isNaN(llmRaw)) {
        const blended = Math.round(candidate.confidence * 0.3 + llmRaw * 0.7);
        llmResult.confidence = Math.max(40, Math.min(95, blended));
      }
      revalidation = llmResult;
    } else {
      revalidation = buildTemplateRevalidation({ candidate, duplicateCheck, cacheKey });
    }
  } catch (error) {
    revalidation = buildTemplateRevalidation({
      candidate,
      duplicateCheck,
      cacheKey,
      fallbackReason: describeRevalidationFallback(error),
    });
  }

  if (
    revalidation.mode === "template" &&
    revalidation.fallbackReason &&
    revalidation.decision === "approve_candidate"
  ) {
    revalidation.decision = "needs_human_review";
  }

  if (
    revalidation.mode === "template" &&
    (candidate.candidateType === "customer" || candidate.candidateType === "partner") &&
    revalidation.decision === "approve_candidate" &&
    duplicateCheck.possibleDuplicate
  ) {
    revalidation.decision = "needs_human_review";
  }

  const status =
    revalidation.decision === "reject"
      ? "rejected"
      : revalidation.decision === "knowledge_only" || shouldKeepRevalidationAsKnowledgeOnly(revalidation)
        ? "knowledge_only"
        : "proposed";

  return withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveRevalidationActor(tx, ctx);
    if (actor.id !== initial.actorAssignmentId) {
      throw new CrmServiceError("CONFLICT", 409, "mail_candidate_actor_changed");
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${deriveChainScopeKey(scope)}, 0))`;
    const prior = await tx.auditLog.findFirst({
      where: { chainScopeKey: deriveChainScopeKey(scope), idempotencyKey: auditKey },
    });
    if (prior) {
      const details = auditDetails(prior.details);
      if (
        details.contract !== "sangfor.mail_candidate.revalidate/v1" ||
        details.inputHash !== initial.inputHash
      ) {
        throw new CrmServiceError("CONFLICT", 409, "mail_candidate_idempotency_conflict");
      }
      const current = await loadScopedCandidate(tx, ctx, id);
      return {
        candidate: current,
        revalidation: auditDetails(details.result).revalidation ?? details.result,
      };
    }

    await loadScopedCandidate(tx, ctx, id);
    const changed = await tx.mailDerivedCandidate.updateMany({
      where: { id, updatedAt: new Date(command.expectedUpdatedAt) },
      data: {
        status,
        confidence: revalidation.confidence,
        metadata: toInputJson({
          ...metadata,
          aiRevalidation: revalidation,
        }),
      },
    });
    if (changed.count !== 1) {
      throw new CrmServiceError("CONFLICT", 409, "mail_candidate_version_conflict");
    }
    const updated = await loadScopedCandidate(tx, ctx, id);
    const result = {
      candidateId: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
      revalidation,
    };
    await appendAuditEvent(tx, {
      scope,
      eventType: "mail_candidate.revalidated",
      actorId: actor.id,
      resourceType: "mail_candidate",
      resourceId: id,
      idempotencyKey: auditKey,
      details: {
        contract: "sangfor.mail_candidate.revalidate/v1",
        inputHash: initial.inputHash,
        actorAssignmentId: actor.id,
        result: toInputJson(result),
      },
    });
    return { candidate: updated, revalidation };
  });
}
