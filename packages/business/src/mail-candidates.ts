import { Prisma, prisma } from "@sangfor/db";
import { GROUND_TRUTH_CALIBRATION } from "./ai-classify-batch";
import { z } from "zod";

import { createCustomer, createPartner } from "./customer-partner";
import { createImprovementCandidateFromError } from "./improvement-loop";
import { loadLlmConfigFromDb } from "./llm-settings";
import {
  buildMailPolicyLookup,
  buildStaticMailPolicyLookup,
  MailPolicyLookup,
  normalizePolicyKey,
  resolveProjectId,
  seedDefaultMailPolicyMemory,
  upsertPolicyMemory,
} from "./mail-policy-memory";
import { createOpportunity } from "./opportunity-center";
import { recordDecision } from "./ai-decision";
import {
  buildChatCompletionRequestBody,
  extractChatCompletionText,
  getOpenAiApiKey,
  getOpenAiAuthHeaders,
  getOpenAiChatCompletionsUrl,
  getOpenAiModel,
} from "./openai-config";
import { createPocProject } from "./poc-center";
import { createWorkTask, linkTaskToEntity } from "./task-center";

export const mailCandidateTypeSchema = z.enum([
  "customer",
  "partner",
  "task",
  "opportunity",
  "poc",
]);

export const mailCandidateStatusSchema = z.enum([
  "needs_revalidation",
  "proposed",
  "approved",
  "rejected",
  "converted",
  "knowledge_only",
]);

const generateMailCandidatesSchema = z.object({
  projectSlug: z.string().default("demo-project"),
  limit: z.number().int().min(1).max(2_000).default(50),
  legacyKnowledgeFallback: z.boolean().default(false),
});

const listMailCandidatesSchema = z.object({
  status: mailCandidateStatusSchema.optional(),
  candidateType: mailCandidateTypeSchema.optional(),
  limit: z.number().int().min(1).max(2_000).default(100),
});

type HeaderInfo = {
  from?: string;
  email?: string;
  receivedAt?: Date;
  attachments?: string[];
  messageId?: string;
};

type ClassifiedCandidate = {
  candidateType: z.infer<typeof mailCandidateTypeSchema>;
  title: string;
  summary: string;
  confidence: number;
  matchedKeywords: string[];
  evidenceItems?: string[];
  nextActions?: unknown[];
  sourceMessageIds?: string[];
  policyDecision?: PolicyDecision;
  mailIntelligence?: Record<string, unknown>;
  confidenceBreakdown?: Record<string, number>;
};

type PolicyDecision = {
  decision: "candidate" | "exclude";
  entityRole:
    | "customer"
    | "partner"
    | "internal_company"
    | "system_sender"
    | "unknown";
  reason: string;
  candidateName?: string;
  matchedPolicyMemories: Array<{
    memoryType: string;
    key: string;
    label: string;
  }>;
  participantDomains: string[];
};

type AiRevalidationDecision =
  | "approve_candidate"
  | "needs_human_review"
  | "reject"
  | "knowledge_only";

type AiRevalidationResult = {
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

const KEYWORDS = {
  opportunity: [
    "견적",
    "제안",
    "quote",
    "proposal",
    "purchase",
    "구매",
    "계약",
    "라이선스",
    "license",
    "renewal",
  ],
  poc: ["poc", "proof of concept", "검증", "테스트", "호환성", "compatibility", "pilot"],
  task: ["요청", "확인", "답변", "회신", "follow up", "action", "urgent", "긴급"],
  partner: ["partner", "파트너", "총판", "reseller", "distributor", "msp", "유통"],
} as const;

const INTERNAL_DOMAINS = new Set([
  "sangfor.com",
  "sangfor.co.kr",
  "blro.co.kr",
  "ai-portal.local",
  "microsoft.com",
]);

const SYSTEM_SENDER_DOMAINS = new Set(["bill36524.com"]);

const INTERNAL_COMPANY_NAMES = new Set(["베를로", "blro"]);

const KNOWN_PARTNER_NAMES = new Set(["넥시아스", "nexias"]);
const KNOWN_PARTNER_DOMAINS = new Set(["nexias.co.kr"]);
const STATIC_POLICY_LOOKUP = buildStaticMailPolicyLookup();

function normalizeCompanyName(value: string) {
  return normalizePolicyKey(value).replace(/[^a-z0-9가-힣]/g, "");
}

function isInternalCompanyName(value?: string, policy: MailPolicyLookup = STATIC_POLICY_LOOKUP) {
  if (!value) return false;
  const normalized = normalizeCompanyName(value);
  return INTERNAL_COMPANY_NAMES.has(normalized) || policy.internalCompanyNames.has(normalized);
}

function isKnownPartner(value?: string, policy: MailPolicyLookup = STATIC_POLICY_LOOKUP) {
  if (!value) return false;
  const normalized = normalizeCompanyName(value);
  return KNOWN_PARTNER_NAMES.has(normalized) || policy.knownPartnerNames.has(normalized);
}

function domainFromEmail(value?: string | null) {
  const match = String(value ?? "").match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  return match?.[1]?.toLowerCase();
}

// 발신자 도메인에서 회사명 추출
function extractCompanyFromDomain(domain: string): string {
  const domainMap: Record<string, string> = {
    'berlo.co.kr': '베를로',
    'berlo.com': '베를로',
    'nexias.com': '넥시아스',
    'partner.co.kr': '파트너사',
    'customer.kr': '고객사',
    'sangfor.com': 'Sangfor',
  };
  return domainMap[domain] || domain.split('.')[0];
}

// 발신자명에서 담당자 추출
function extractContactFromEmail(email: string, name?: string): string {
  if (name) return name;
  const localPart = email.split('@')[0];
  return localPart.replace(/[0-9]/g, '').replace('.', ' ');
}

function domainMatches(domain: string | undefined, domains: Set<string>) {
  if (!domain) return false;
  const normalized = normalizePolicyKey(domain);
  return [...domains].some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
}

function isInternalDomain(domain: string | undefined, policy: MailPolicyLookup = STATIC_POLICY_LOOKUP) {
  if (!domain) return false;
  const normalized = normalizePolicyKey(domain);
  return INTERNAL_DOMAINS.has(normalized) || domainMatches(normalized, policy.internalDomains);
}

function isSystemSenderDomain(domain: string | undefined, policy: MailPolicyLookup = STATIC_POLICY_LOOKUP) {
  if (!domain) return false;
  const normalized = normalizePolicyKey(domain);
  return SYSTEM_SENDER_DOMAINS.has(normalized) || domainMatches(normalized, policy.systemSenderDomains);
}

function isKnownPartnerDomain(domain: string | undefined, policy: MailPolicyLookup = STATIC_POLICY_LOOKUP) {
  if (!domain) return false;
  const normalized = normalizePolicyKey(domain);
  return KNOWN_PARTNER_DOMAINS.has(normalized) || domainMatches(normalized, policy.knownPartnerDomains);
}

function matchedPolicyMemories(
  policy: MailPolicyLookup,
  matches: Array<{ memoryType: string; key: string }>,
) {
  return matches.flatMap((match) => {
    const key = normalizePolicyKey(match.key);
    const memory = policy.memories.find(
      (item) => item.memoryType === match.memoryType && item.key === key,
    );
    return memory
      ? [{ memoryType: memory.memoryType, key: memory.key, label: memory.label }]
      : [{ memoryType: match.memoryType, key, label: match.key }];
  });
}

function normalizedText(title: string, body: string) {
  return `${title}\n${body}`.toLowerCase();
}

function matchKeywords(text: string, keywords: readonly string[]) {
  return keywords.filter((keyword) => {
    const normalized = keyword.toLowerCase();
    if (/^[a-z0-9][a-z0-9\s-]*$/i.test(normalized)) {
      const pattern = normalized
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\s+/g, "\\s+");
      return new RegExp(`(^|[^a-z0-9])${pattern}($|[^a-z0-9])`, "i").test(text);
    }
    return text.includes(normalized);
  });
}

function compactSummary(body: string) {
  const cleaned = body
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(from|sender|received|messageid|attachments):/i.test(line))
    .join(" ");
  return cleaned.slice(0, 420) || "Mail-derived candidate from imported mail intelligence.";
}

function isProjectCandidateType(candidateType: string) {
  return candidateType === "task" || candidateType === "opportunity" || candidateType === "poc";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Strip characters that are invalid in JSON / Postgres jsonb — C0 control chars
// and unpaired UTF-16 surrogates. The latter arise when real email text (emoji,
// astral-plane CJK) is truncated with `.slice(n)`, splitting a surrogate pair.
function sanitizeJsonStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  }
  if (Array.isArray(value)) return value.map(sanitizeJsonStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeJsonStrings(v)]),
    );
  }
  return value;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(sanitizeJsonStrings(value ?? {}))) as Prisma.InputJsonValue;
}

function parseMailHeader(body: string): HeaderInfo {
  const lines = body.replace(/\r/g, "").split("\n");
  const findValue = (label: string) => {
    const line = lines.find((entry) => entry.toLowerCase().startsWith(`${label.toLowerCase()}:`));
    return line?.slice(label.length + 1).trim();
  };
  const from = findValue("From") ?? findValue("Sender");
  const email = findValue("Email") ?? from?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const received = findValue("Received") ?? findValue("ReceivedAt");
  const attachments = findValue("Attachments")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const messageId = findValue("MessageId") ?? findValue("Message-ID");
  const receivedAt = received ? new Date(received) : undefined;

  return {
    from,
    email,
    receivedAt: receivedAt && !Number.isNaN(receivedAt.getTime()) ? receivedAt : undefined,
    attachments,
    messageId,
  };
}

function inferCompanyName(
  title: string,
  header: HeaderInfo,
  policy: MailPolicyLookup = STATIC_POLICY_LOOKUP,
) {
  const bracket = title.match(/\[([^\]]{2,60})\]/)?.[1]?.trim();
  if (
    bracket &&
    !isInternalCompanyName(bracket, policy) &&
    !/sangfor|newsletter|notification|시스템알림/i.test(bracket)
  ) {
    return bracket;
  }

  const domain = domainFromEmail(header.email);
  if (!domain || isInternalDomain(domain, policy) || isSystemSenderDomain(domain, policy)) return undefined;
  const root = domain.split(".")[0];
  if (!root || ["gmail", "naver", "daum", "outlook", "hotmail"].includes(root)) return undefined;
  return root.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function classifyMailCandidateDocument(input: {
  title: string;
  body: string;
  tags?: string[];
}, policy: MailPolicyLookup = STATIC_POLICY_LOOKUP) {
  const header = parseMailHeader(input.body);
  const text = normalizedText(input.title, input.body);
  const summary = compactSummary(input.body);
  const domain = domainFromEmail(header.email);
  const promotional = /\b(unsubscribe|newsletter|promo|promotion|marketing)\b|뉴스레터|홍보/i.test(text);
  if (promotional) {
    return {
      header,
      candidates: [],
      excluded: [{
        decision: "exclude",
        entityRole: "unknown",
        reason: "newsletter or promotional mail is not an AIOS business candidate",
        candidateName: header.from,
        matchedPolicyMemories: [],
        participantDomains: domain ? [domain] : [],
      } satisfies PolicyDecision],
    };
  }
  if (isInternalDomain(domain, policy) || isSystemSenderDomain(domain, policy)) {
    return {
      header,
      candidates: [],
      excluded: [{
        decision: "exclude",
        entityRole: isInternalDomain(domain, policy) ? "internal_company" : "system_sender",
        reason: isInternalDomain(domain, policy)
          ? "raw mail sender domain matches internal company policy"
          : "raw mail sender domain is a system sender",
        candidateName: header.from,
        matchedPolicyMemories: domain
          ? matchedPolicyMemories(policy, [{
              memoryType: isInternalDomain(domain, policy) ? "internal_domain" : "system_sender_domain",
              key: domain,
            }])
          : [],
        participantDomains: domain ? [domain] : [],
      } satisfies PolicyDecision],
    };
  }
  const candidates: ClassifiedCandidate[] = [];

  const opportunityMatches = matchKeywords(text, KEYWORDS.opportunity);
  if (opportunityMatches.length > 0) {
    candidates.push({
      candidateType: "opportunity",
      title: `Opportunity: ${input.title}`.slice(0, 180),
      summary,
      confidence: Math.min(92, 62 + opportunityMatches.length * 7),
      matchedKeywords: opportunityMatches,
    });
  }

  const pocMatches = matchKeywords(text, KEYWORDS.poc);
  if (pocMatches.length > 0) {
    candidates.push({
      candidateType: "poc",
      title: `PoC: ${input.title}`.slice(0, 180),
      summary,
      confidence: Math.min(92, 65 + pocMatches.length * 7),
      matchedKeywords: pocMatches,
    });
  }

  const taskMatches = matchKeywords(text, KEYWORDS.task);
  if (taskMatches.length > 0 || opportunityMatches.length > 0 || pocMatches.length > 0) {
    candidates.push({
      candidateType: "task",
      title: `Follow up: ${input.title}`.slice(0, 180),
      summary,
      confidence: Math.min(90, 58 + (taskMatches.length + opportunityMatches.length + pocMatches.length) * 5),
      matchedKeywords: [...taskMatches, ...opportunityMatches, ...pocMatches],
    });
  }

  const companyName = inferCompanyName(input.title, header, policy);
  if (companyName) {
    const partnerMatches = matchKeywords(text, KEYWORDS.partner);
    const isPartner =
      partnerMatches.length > 0 ||
      isKnownPartner(companyName, policy) ||
      isKnownPartnerDomain(domain, policy);
    candidates.push({
      candidateType: isPartner ? "partner" : "customer",
      title: `${isPartner ? "Partner" : "Customer"}: ${companyName}`,
      summary: `${companyName} inferred from imported mail intelligence. ${summary}`.slice(0, 420),
      confidence: isPartner ? 76 : 70,
      matchedKeywords: isPartner ? ["sender-domain", ...partnerMatches] : ["sender-domain"],
    });
  }

  return { header, candidates, excluded: [] as PolicyDecision[] };
}

type ThreadLike = {
  id?: string;
  threadKey: string;
  threadTitle: string;
  summary: string;
  status: string;
  effectiveStatus?: string | null;
  aiEnhanced: boolean;
  messageIds?: unknown;
  nextActions?: unknown;
  evidenceItems?: unknown;
  revenueOpsTags: string[];
  participantDomains: string[];
  metadata?: unknown;
};

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function asUnknownArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asObjectArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item != null && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function extractThreadMessages(thread: ThreadLike) {
  const metadata = asRecord(thread.metadata);
  return asObjectArray(metadata.messages);
}

function isPromotionalThread(thread: ThreadLike) {
  const messages = extractThreadMessages(thread);
  if (messages.some((message) => message.isPromotional === true)) return true;
  const text = textFromThread(thread);
  const marketingSignal = /\b(unsubscribe|newsletter|wallet|shipped|launch|promo|promotion|marketing)\b|\$\d+/i.test(text);
  const explicitBusinessSignal = /견적\s*요청|계약\s*조건|검증\s*요청|고객사|purchase\s+order|quote\s+request/i.test(text);
  return marketingSignal && !explicitBusinessSignal;
}

function extractDisplayName(value?: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const beforeEmail = text.replace(/<[^>]+>/g, "").trim();
  return beforeEmail || undefined;
}

function domainRootName(domain: string) {
  const root = domain.split(".")[0] ?? "";
  if (!root || ["gmail", "naver", "daum", "outlook", "hotmail"].includes(root)) return undefined;
  return root.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function titleBracketName(title: string) {
  return title.match(/\[([^\]]{2,60})\]/)?.[1]?.trim();
}

function hasKnownNameInText(text: string, names: Set<string>) {
  const normalized = normalizeCompanyName(text);
  return [...names].find((name) => normalized.includes(name.replace(/[^a-z0-9가-힣]/g, "")));
}

function hasVendorSupport(thread: ThreadLike): boolean {
  const checkEmail = (emailStr?: string | null) => {
    return String(emailStr ?? "").toLowerCase().includes("tech.support@sangfor.com");
  };
  
  if (checkEmail(thread.threadTitle) || checkEmail(thread.summary)) return true;
  
  const messages = extractThreadMessages(thread);
  for (const msg of messages) {
    if (checkEmail(String(msg.from)) || checkEmail(String(msg.fromName))) return true;
    const recipients = [
      ...asObjectArray(msg.to),
      ...asObjectArray(msg.cc),
      ...asObjectArray(msg.bcc)
    ];
    for (const rec of recipients) {
      const addr = String(typeof rec === "string" ? rec : rec.email ?? rec.address ?? "");
      if (checkEmail(addr)) return true;
    }
  }
  return false;
}

function resolveThreadEntityPolicy(
  thread: ThreadLike,
  policy: MailPolicyLookup,
): PolicyDecision {
  const participantDomains = uniquePolicyDomains([
    ...thread.participantDomains,
    ...extractThreadMessages(thread).flatMap((message) => [
      domainFromEmail(String(message.from ?? "")),
      domainFromEmail(String(message.fromName ?? "")),
    ]),
  ]);

  if (hasVendorSupport(thread)) {
    return {
      decision: "candidate",
      entityRole: "partner",
      reason: "vendor tech support center email matched",
      candidateName: "Sangfor Tech Support",
      matchedPolicyMemories: [],
      participantDomains,
    };
  }
  const messages = extractThreadMessages(thread);
  const text = normalizedText(
    thread.threadTitle,
    [
      thread.summary,
      thread.revenueOpsTags.join(" "),
      messages.map((message) => `${message.fromName ?? ""} ${message.from ?? ""}`).join(" "),
    ].join("\n"),
  );
  const bracket = titleBracketName(thread.threadTitle);
  const internalDomain = participantDomains.find((domain) => isInternalDomain(domain, policy));
  const systemDomain = participantDomains.find((domain) => isSystemSenderDomain(domain, policy));
  const externalDomains = participantDomains.filter(
    (domain) => !isInternalDomain(domain, policy) && !isSystemSenderDomain(domain, policy),
  );

  if (systemDomain && externalDomains.length === 0) {
    return {
      decision: "exclude",
      entityRole: "system_sender",
      reason: "only system sender domain is present",
      candidateName: systemDomain,
      matchedPolicyMemories: matchedPolicyMemories(policy, [
        { memoryType: "system_sender_domain", key: systemDomain },
      ]),
      participantDomains,
    };
  }

  if (bracket && isInternalCompanyName(bracket, policy)) {
    return {
      decision: "exclude",
      entityRole: "internal_company",
      reason: "thread title bracket matches internal company policy",
      candidateName: bracket,
      matchedPolicyMemories: matchedPolicyMemories(policy, [
        { memoryType: "internal_company_name", key: bracket },
      ]),
      participantDomains,
    };
  }

  const partnerName = hasKnownNameInText(text, policy.knownPartnerNames);
  const partnerDomain = externalDomains.find((domain) => isKnownPartnerDomain(domain, policy));
  if (partnerName || partnerDomain || (bracket && isKnownPartner(bracket, policy))) {
    const candidateName = bracket && isKnownPartner(bracket, policy)
      ? bracket
      : partnerName
        ? policy.memories.find((memory) => memory.key === partnerName)?.label ?? partnerName
        : domainRootName(partnerDomain ?? "") ?? partnerDomain;
    return {
      decision: "candidate",
      entityRole: "partner",
      reason: partnerDomain ? "known partner domain matched" : "known partner name matched",
      candidateName,
      matchedPolicyMemories: matchedPolicyMemories(policy, [
        partnerDomain
          ? { memoryType: "known_partner_domain", key: partnerDomain }
          : { memoryType: "known_partner_name", key: candidateName ?? "" },
      ]),
      participantDomains,
    };
  }

  if (bracket && !isInternalCompanyName(bracket, policy)) {
    return {
      decision: "candidate",
      entityRole: "customer",
      reason: "external bracket company inferred from Mail Intelligence thread title",
      candidateName: bracket,
      matchedPolicyMemories: [],
      participantDomains,
    };
  }

  const externalDomain = externalDomains[0];
  if (externalDomain) {
    const messageForDomain = messages.find((message) => domainFromEmail(String(message.from ?? "")) === externalDomain);
    const displayName = extractDisplayName(messageForDomain?.fromName);
    const candidateName =
      displayName && !isInternalCompanyName(displayName, policy)
        ? displayName
        : domainRootName(externalDomain) ?? externalDomain;
    return {
      decision: "candidate",
      entityRole: "customer",
      reason: internalDomain ? "external participant found alongside internal domain" : "external participant domain inferred",
      candidateName,
      matchedPolicyMemories: [],
      participantDomains,
    };
  }

  return {
    decision: "exclude",
    entityRole: internalDomain ? "internal_company" : "unknown",
    reason: internalDomain ? "only internal participant domains are present" : "no external customer or partner signal",
    candidateName: internalDomain,
    matchedPolicyMemories: internalDomain
      ? matchedPolicyMemories(policy, [{ memoryType: "internal_domain", key: internalDomain }])
      : [],
    participantDomains,
  };
}

function uniquePolicyDomains(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => normalizePolicyKey(String(value ?? ""))).filter(Boolean))];
}

function textFromThread(thread: ThreadLike) {
  return normalizedText(
    thread.threadTitle,
    [
      thread.summary,
      thread.revenueOpsTags.join(" "),
      asStringArray(thread.evidenceItems).join(" "),
      JSON.stringify(thread.nextActions ?? []),
    ].join("\n"),
  );
}

function hasExternalSignal(policyDecision: PolicyDecision) {
  return policyDecision.decision === "candidate" && (
    policyDecision.entityRole === "customer" || policyDecision.entityRole === "partner"
  );
}

export function classifyMailInsightThread(
  thread: ThreadLike,
  policy: MailPolicyLookup = STATIC_POLICY_LOOKUP,
) {
  if (isPromotionalThread(thread)) {
    return {
      candidates: [],
      excluded: [{
        decision: "exclude",
        entityRole: "unknown",
        reason: "promotional or newsletter thread is not an AIOS business candidate",
        matchedPolicyMemories: [],
        participantDomains: thread.participantDomains,
      } satisfies PolicyDecision],
    };
  }

  const text = textFromThread(thread);
  const evidenceItems = asStringArray(thread.evidenceItems);
  const nextActions = asUnknownArray(thread.nextActions);
  const messageIds = asStringArray(thread.messageIds);
  const policyDecision = resolveThreadEntityPolicy(thread, policy);
  const candidates: ClassifiedCandidate[] = [];
  const hasEvidence = evidenceItems.length > 0 || nextActions.length > 0 || thread.summary.length > 30;
  const externalSignal = hasExternalSignal(policyDecision);

  const opportunityMatches = [
    ...matchKeywords(text, KEYWORDS.opportunity),
    ...thread.revenueOpsTags.filter((tag) => /견적|계약|구매|opportunity|quote/i.test(tag)),
  ];
  if (hasEvidence && externalSignal && opportunityMatches.length > 0) {
    candidates.push({
      candidateType: "opportunity",
      title: `Opportunity: ${thread.threadTitle}`.slice(0, 180),
      summary: thread.summary.slice(0, 420),
      confidence: Math.min(94, 66 + opportunityMatches.length * 6 + (thread.aiEnhanced ? 8 : 0)),
      matchedKeywords: uniquePolicyDomains(opportunityMatches),
      evidenceItems,
      nextActions,
      sourceMessageIds: messageIds,
      policyDecision,
      mailIntelligence: buildMailIntelligenceMetadata(thread),
      confidenceBreakdown: {
        keywordSignal: opportunityMatches.length * 6,
        aiEnhanced: thread.aiEnhanced ? 8 : 0,
        evidence: evidenceItems.length > 0 ? 8 : 0,
      },
    });
  }

  const pocMatches = [
    ...matchKeywords(text, KEYWORDS.poc),
    ...thread.revenueOpsTags.filter((tag) => /poc|검증|테스트|pilot/i.test(tag)),
  ];
  if (hasEvidence && externalSignal && pocMatches.length > 0) {
    candidates.push({
      candidateType: "poc",
      title: `PoC: ${thread.threadTitle}`.slice(0, 180),
      summary: thread.summary.slice(0, 420),
      confidence: Math.min(94, 68 + pocMatches.length * 6 + (thread.aiEnhanced ? 8 : 0)),
      matchedKeywords: uniquePolicyDomains(pocMatches),
      evidenceItems,
      nextActions,
      sourceMessageIds: messageIds,
      policyDecision,
      mailIntelligence: buildMailIntelligenceMetadata(thread),
      confidenceBreakdown: {
        keywordSignal: pocMatches.length * 6,
        aiEnhanced: thread.aiEnhanced ? 8 : 0,
        evidence: evidenceItems.length > 0 ? 8 : 0,
      },
    });
  }

  const taskMatches = [
    ...matchKeywords(text, KEYWORDS.task),
    ...nextActions.map((action) => String((action as Record<string, unknown>)?.recommendedAction ?? "next_action")),
  ];
  if (hasEvidence && externalSignal && (taskMatches.length > 0 || opportunityMatches.length > 0 || pocMatches.length > 0)) {
    candidates.push({
      candidateType: "task",
      title: `Follow up: ${thread.threadTitle}`.slice(0, 180),
      summary: thread.summary.slice(0, 420),
      confidence: Math.min(92, 62 + Math.min(taskMatches.length, 5) * 4 + (thread.aiEnhanced ? 8 : 0)),
      matchedKeywords: uniquePolicyDomains([...taskMatches, ...opportunityMatches, ...pocMatches]).slice(0, 12),
      evidenceItems,
      nextActions,
      sourceMessageIds: messageIds,
      policyDecision,
      mailIntelligence: buildMailIntelligenceMetadata(thread),
      confidenceBreakdown: {
        actionSignal: Math.min(taskMatches.length, 5) * 4,
        aiEnhanced: thread.aiEnhanced ? 8 : 0,
        evidence: evidenceItems.length > 0 ? 8 : 0,
      },
    });
  }

  if (policyDecision.decision === "candidate" && policyDecision.candidateName) {
    const isPartner = policyDecision.entityRole === "partner";
    candidates.push({
      candidateType: isPartner ? "partner" : "customer",
      title: `${isPartner ? "Partner" : "Customer"}: ${policyDecision.candidateName}`,
      summary: `${policyDecision.candidateName} inferred from Mail Intelligence thread. ${thread.summary}`.slice(0, 420),
      confidence: isPartner ? 82 : 74,
      matchedKeywords: [policyDecision.reason],
      evidenceItems,
      nextActions,
      sourceMessageIds: messageIds,
      policyDecision,
      mailIntelligence: buildMailIntelligenceMetadata(thread),
      confidenceBreakdown: {
        policySignal: isPartner ? 18 : 10,
        aiEnhanced: thread.aiEnhanced ? 6 : 0,
      },
    });
  }

  return {
    candidates,
    excluded: policyDecision.decision === "exclude" ? [policyDecision] : [],
  };
}

function buildMailIntelligenceMetadata(thread: ThreadLike) {
  return {
    threadInsightId: thread.id,
    threadKey: thread.threadKey,
    threadTitle: thread.threadTitle,
    status: thread.status,
    effectiveStatus: thread.effectiveStatus,
    aiEnhanced: thread.aiEnhanced,
    revenueOpsTags: thread.revenueOpsTags,
    participantDomains: thread.participantDomains,
    summary: thread.summary,
    nextActions: asUnknownArray(thread.nextActions).slice(0, 12),
    evidenceItems: asStringArray(thread.evidenceItems).slice(0, 12),
  };
}

/**
 * AI 기반 메일 분류 결과 타입
 */
export type AiClassificationResult = {
  category: "opportunity" | "poc" | "task" | "customer" | "partner" | "vendor" | "exclude";
  confidence: number;
  reasoning: string;
  urgency: "high" | "medium" | "low";
  sentiment: "positive" | "neutral" | "negative";
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

type PolicyClassifyResult = ReturnType<typeof classifyMailInsightThread>;

/**
 * Pure function: combine policy classification result with an AI result.
 *
 * Rules:
 * - null aiResult → return policyResult unchanged (+ aiClassification: null)
 * - category 'vendor' or 'exclude' → drop all candidates; move them to excluded
 * - category 'customer' or 'partner' with confidence ≥ 70 → correct any policy
 *   customer/partner candidate whose type differs, updating title prefix too
 * - all other categories → blend confidence (30% policy, 70% AI)
 */
export function combineHybridClassification(
  policyResult: PolicyClassifyResult,
  aiResult: AiClassificationResult | null,
) {
  if (!aiResult) {
    return { ...policyResult, aiClassification: null };
  }

  // vendor or exclude: this thread must NOT produce customer/partner candidates
  if (aiResult.category === 'vendor' || aiResult.category === 'exclude') {
    const movedToExcluded: PolicyDecision[] = policyResult.candidates.map(c => ({
      decision: "exclude" as const,
      entityRole: "unknown" as const,
      reason: aiResult.category === 'vendor'
        ? `AI classified as vendor (SaaS/tool we use): ${aiResult.reasoning}`
        : `AI classified as exclude: ${aiResult.reasoning}`,
      candidateName: c.title,
      matchedPolicyMemories: [],
      participantDomains: (c.policyDecision as PolicyDecision | undefined)?.participantDomains ?? [],
    }));
    return {
      candidates: [],
      excluded: [...policyResult.excluded, ...movedToExcluded],
      aiClassification: aiResult,
    };
  }

  // customer/partner correction: when AI is confident, correct mismatched types
  const shouldCorrectType =
    (aiResult.category === 'customer' || aiResult.category === 'partner') &&
    aiResult.confidence >= 70;

  const hybridCandidates = policyResult.candidates.map(c => {
    let candidateType = c.candidateType;
    let title = c.title;

    if (
      shouldCorrectType &&
      (c.candidateType === 'customer' || c.candidateType === 'partner') &&
      c.candidateType !== aiResult.category
    ) {
      candidateType = aiResult.category as 'customer' | 'partner';
      // Replace "Customer: " / "Partner: " prefix
      const nameWithoutPrefix = c.title.replace(/^(Customer|Partner):\s*/i, '');
      title = `${candidateType === 'customer' ? 'Customer' : 'Partner'}: ${nameWithoutPrefix}`;
    }

    return {
      ...c,
      candidateType,
      title,
      confidence: Math.min(100, Math.round((c.confidence * 0.3) + (aiResult.confidence * 0.7))),
      aiClassification: aiResult,
      confidenceBreakdown: {
        ...c.confidenceBreakdown,
        aiClassification: aiResult.confidence,
      },
    };
  });

  return {
    candidates: hybridCandidates,
    excluded: policyResult.excluded,
    aiClassification: aiResult,
  };
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

function sourceSenderFromThread(thread: ThreadLike) {
  const message = extractThreadMessages(thread)[0];
  return String(message?.fromName ?? message?.from ?? thread.participantDomains[0] ?? "mail thread");
}

async function recordPolicyDecision(
  projectId: string,
  input: {
    entityType: string;
    entityId?: string | null;
    decisionType: string;
    inputJson?: Prisma.InputJsonValue;
    outputJson?: Prisma.InputJsonValue;
  },
) {
  await prisma.policyDecisionLog.create({
    data: {
      projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      decisionType: input.decisionType,
      inputJson: input.inputJson,
      outputJson: input.outputJson,
    },
  });
}

function candidateLooksPolicyExcluded(
  candidate: {
    candidateType: string;
    title: string;
    summary: string;
    sourceSender: string | null;
    metadata: Prisma.JsonValue | null;
  },
  policy: MailPolicyLookup,
) {
  if (candidate.candidateType !== "customer" && candidate.candidateType !== "partner") return null;
  const metadata = asRecord(candidate.metadata);
  const emailStr = String(metadata.email ?? metadata.sourceSender ?? candidate.sourceSender ?? "").toLowerCase();
  const participantDomains = asStringArray(metadata.participantDomains);
  const isVendor = emailStr.includes("tech.support@sangfor.com") || 
                   participantDomains.some(d => d.toLowerCase().includes("tech.support@sangfor.com"));
  if (isVendor) {
    return null;
  }
  const entityName = candidate.title.replace(/^(Customer|Partner):\s*/i, "").trim();
  const mailIntelligence = asRecord(metadata.mailIntelligence);
  const candidateText = `${candidate.title}\n${candidate.summary}\n${String(mailIntelligence.summary ?? "")}`.toLowerCase();
  const explicitBusinessSignal = /고객사|견적\s*요청|계약\s*조건|검증\s*요청|quote\s+request|please\s+send\s+(a\s+)?quote|proposal\s+request/i.test(candidateText);
  const promotionalSignal = /\b(unsubscribe|newsletter|promo|promotion|marketing)\b|뉴스레터|홍보/.test(candidateText);
  const autopilotMarketing =
    /\bautopilot\b/.test(candidateText) &&
    /\bcrew\b|wallet|\$\d|shipped/.test(candidateText);
  if ((promotionalSignal || autopilotMarketing) && !explicitBusinessSignal) {
    return {
      decision: "exclude",
      entityRole: "unknown",
      reason: "promotional or newsletter candidate is not a customer or partner candidate",
      candidateName: entityName,
      matchedPolicyMemories: [],
      participantDomains: asStringArray(metadata.participantDomains),
    } satisfies PolicyDecision;
  }
  const email = String(metadata.email ?? metadata.sourceSender ?? candidate.sourceSender ?? "");
  const externalParticipantDomains = participantDomains.filter(
    (item) => !isInternalDomain(item, policy) && !isSystemSenderDomain(item, policy),
  );
  const domain =
    domainFromEmail(email) ??
    domainFromEmail(candidate.sourceSender) ??
    participantDomains.find((item) => isSystemSenderDomain(item, policy)) ??
    externalParticipantDomains[0] ??
    participantDomains.find((item) => isInternalDomain(item, policy)) ??
    participantDomains[0];
  if (isInternalCompanyName(entityName, policy)) {
    return {
      decision: "exclude",
      entityRole: "internal_company",
      reason: "existing candidate title matches internal company policy",
      candidateName: entityName,
      matchedPolicyMemories: matchedPolicyMemories(policy, [
        { memoryType: "internal_company_name", key: entityName },
      ]),
      participantDomains: domain ? [domain] : [],
    } satisfies PolicyDecision;
  }
  if (isInternalDomain(domain, policy) && externalParticipantDomains.length === 0) {
    return {
      decision: "exclude",
      entityRole: "internal_company",
      reason: "existing candidate sender domain matches internal policy",
      candidateName: entityName,
      matchedPolicyMemories: matchedPolicyMemories(policy, [{ memoryType: "internal_domain", key: domain ?? "" }]),
      participantDomains: domain ? [domain] : [],
    } satisfies PolicyDecision;
  }
  if (isSystemSenderDomain(domain, policy)) {
    return {
      decision: "exclude",
      entityRole: "system_sender",
      reason: "existing candidate sender domain is a system sender",
      candidateName: entityName,
      matchedPolicyMemories: matchedPolicyMemories(policy, [
        { memoryType: "system_sender_domain", key: domain ?? "" },
      ]),
      participantDomains: domain ? [domain] : [],
    } satisfies PolicyDecision;
  }
  return null;
}

async function suppressPolicyExcludedCandidates(projectId: string, policy: MailPolicyLookup) {
  const candidates = await prisma.mailDerivedCandidate.findMany({
    where: {
      status: { in: ["proposed", "needs_revalidation"] },
      candidateType: { in: ["customer", "partner"] },
    },
    select: {
      id: true,
      candidateType: true,
      title: true,
      summary: true,
      sourceSender: true,
      metadata: true,
    },
  });
  let suppressed = 0;
  for (const candidate of candidates) {
    const policyDecision = candidateLooksPolicyExcluded(candidate, policy);
    if (!policyDecision) continue;
    await prisma.mailDerivedCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "knowledge_only",
        metadata: toInputJson({
          ...asRecord(candidate.metadata),
          policyDecision,
          suppressedAt: new Date().toISOString(),
        }),
      },
    });
    await recordPolicyDecision(projectId, {
      entityType: "mail_derived_candidate",
      entityId: candidate.id,
      decisionType: "candidate_suppressed",
      inputJson: toInputJson({ title: candidate.title, candidateType: candidate.candidateType }),
      outputJson: toInputJson(policyDecision),
    });
    suppressed += 1;
  }
  return suppressed;
}

function projectCandidateLooksWeak(candidate: {
  candidateType: string;
  title: string;
  summary: string;
  metadata: Prisma.JsonValue | null;
}) {
  if (!isProjectCandidateType(candidate.candidateType)) return null;
  const metadata = asRecord(candidate.metadata);
  const revalidation = asRecord(metadata.aiRevalidation);
  const riskFlags = asStringArray(revalidation.riskFlags).join(" ").toLowerCase();
  const reasoning = String(revalidation.reasoningSummary ?? "").toLowerCase();
  const text = `${candidate.title}\n${candidate.summary}\n${riskFlags}\n${reasoning}`.toLowerCase();
  const marketingRisk =
    /external_marketing|marketing content|newsletter|promo|no actual customer|마케팅|홍보/.test(text);
  const autopilotFalsePoc =
    /\bautopilot\b/.test(text) &&
    candidate.candidateType === "poc" &&
    !/proof of concept|고객사.*검증|검증\s*요청/.test(text);
  const autopilotMarketing =
    /\bautopilot\b/.test(text) &&
    /\bcrew\b|wallet|\$\d|shipped/.test(text) &&
    !/고객사|견적\s*요청|계약\s*조건|검증\s*요청|quote\s+request/.test(text);
  if (!marketingRisk && !autopilotFalsePoc && !autopilotMarketing) return null;
  return {
    decision: "exclude",
    entityRole: "unknown",
    reason: marketingRisk
      ? "AI revalidation identified marketing/newsletter content"
      : autopilotMarketing
        ? "Autopilot marketing content is not actionable AIOS project work"
        : "pilot keyword matched inside Autopilot, not a PoC signal",
    matchedPolicyMemories: [],
    participantDomains: asStringArray(metadata.participantDomains),
  } satisfies PolicyDecision;
}

async function suppressWeakProjectCandidates(projectId: string) {
  const candidates = await prisma.mailDerivedCandidate.findMany({
    where: {
      status: "proposed",
      candidateType: { in: ["task", "opportunity", "poc"] },
    },
    select: {
      id: true,
      candidateType: true,
      title: true,
      summary: true,
      metadata: true,
    },
  });
  let suppressed = 0;
  for (const candidate of candidates) {
    const policyDecision = projectCandidateLooksWeak(candidate);
    if (!policyDecision) continue;
    await prisma.mailDerivedCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "knowledge_only",
        metadata: toInputJson({
          ...asRecord(candidate.metadata),
          policyDecision,
          suppressedAt: new Date().toISOString(),
        }),
      },
    });
    await recordPolicyDecision(projectId, {
      entityType: "mail_derived_candidate",
      entityId: candidate.id,
      decisionType: "project_candidate_suppressed",
      inputJson: toInputJson({ title: candidate.title, candidateType: candidate.candidateType }),
      outputJson: toInputJson(policyDecision),
    });
    suppressed += 1;
  }
  return suppressed;
}

async function restoreKnownPartnerCandidates(projectId: string, policy: MailPolicyLookup) {
  const candidates = await prisma.mailDerivedCandidate.findMany({
    where: { status: "knowledge_only", candidateType: "partner" },
    select: {
      id: true,
      title: true,
      metadata: true,
    },
  });
  let restored = 0;
  for (const candidate of candidates) {
    const name = candidate.title.replace(/^Partner:\s*/i, "");
    const metadata = asRecord(candidate.metadata);
    const participantDomains = asStringArray(metadata.participantDomains);
    const isKnown =
      isKnownPartner(name, policy) ||
      participantDomains.some((domain) => isKnownPartnerDomain(domain, policy));
    if (!isKnown) continue;
    await prisma.mailDerivedCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "proposed",
        metadata: toInputJson({
          ...metadata,
          restoredAt: new Date().toISOString(),
          restoreReason: "known_partner_policy_match",
        }),
      },
    });
    await recordPolicyDecision(projectId, {
      entityType: "mail_derived_candidate",
      entityId: candidate.id,
      decisionType: "candidate_restored",
      inputJson: toInputJson({ title: candidate.title, status: "knowledge_only" }),
      outputJson: toInputJson({ status: "proposed", reason: "known_partner_policy_match" }),
    });
    restored += 1;
  }
  return restored;
}

async function generateLegacyKnowledgeCandidates(
  projectId: string,
  limit: number,
  policy: MailPolicyLookup,
) {
  const documents = await prisma.knowledgeDocument.findMany({
    where: { projectId, source: "mail-intelligence" },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, title: true, body: true, tags: true },
  });
  let created = 0;
  let skipped = 0;
  for (const document of documents) {
    const classified = classifyMailCandidateDocument(document, policy);
    for (const candidate of classified.candidates) {
      const existing = await prisma.mailDerivedCandidate.findUnique({
        where: {
          knowledgeDocumentId_candidateType: {
            knowledgeDocumentId: document.id,
            candidateType: candidate.candidateType,
          },
        },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      await prisma.mailDerivedCandidate.create({
        data: {
          knowledgeDocumentId: document.id,
          candidateType: candidate.candidateType,
          title: candidate.title,
          summary: candidate.summary,
          sourceTitle: document.title,
          sourceSender: classified.header.from ?? classified.header.email,
          sourceReceivedAt: classified.header.receivedAt,
          confidence: candidate.confidence,
          status: isProjectCandidateType(candidate.candidateType) ? "needs_revalidation" : "proposed",
          metadata: toInputJson({
            messageId: classified.header.messageId,
            email: classified.header.email,
            attachments: classified.header.attachments ?? [],
            tags: document.tags,
            matchedKeywords: candidate.matchedKeywords,
            sourcePolicy:
              candidate.candidateType === "customer" || candidate.candidateType === "partner"
                ? "auto_candidate_final_approval"
                : "requires_ai_revalidation_before_approval",
            legacyKnowledgeFallback: true,
          }),
        },
      });
      created += 1;
    }
  }
  return { created, skipped };
}

export async function generateMailDerivedCandidates(
  input: z.input<typeof generateMailCandidatesSchema> = {},
) {
  const parsed = generateMailCandidatesSchema.parse(input);
  await loadLlmConfigFromDb(); // pick up web-saved OpenAI key for AI revalidation
  await seedDefaultMailPolicyMemory(parsed.projectSlug);
  const projectId = await resolveProjectId(parsed.projectSlug);
  const policy = await buildMailPolicyLookup(parsed.projectSlug);
  const suppressed =
    (await suppressPolicyExcludedCandidates(projectId, policy)) +
    (await suppressWeakProjectCandidates(projectId));
  const restored = await restoreKnownPartnerCandidates(projectId, policy);
  const threads = await prisma.mailInsightThread.findMany({
    where: { projectId },
    orderBy: [{ latestReceivedAt: "desc" }, { updatedAt: "desc" }],
    take: parsed.limit,
  });

  let created = 0;
  let skipped = 0;

  for (const thread of threads) {
    const classified = classifyMailInsightThread(thread, policy);
    for (const excluded of classified.excluded) {
      await recordPolicyDecision(projectId, {
        entityType: "mail_insight_thread",
        entityId: thread.id,
        decisionType: "candidate_excluded",
        inputJson: toInputJson({
          threadKey: thread.threadKey,
          threadTitle: thread.threadTitle,
        }),
        outputJson: toInputJson(excluded),
      });
    }

    for (const candidate of classified.candidates) {
      const existing = await prisma.mailDerivedCandidate.findFirst({
        where: {
          candidateType: candidate.candidateType,
          OR: [
            { mailInsightThreadId: thread.id },
            ...(thread.knowledgeDocumentId ? [{ knowledgeDocumentId: thread.knowledgeDocumentId }] : []),
          ],
        },
      });
      if (existing) {
        if (!existing.mailInsightThreadId) {
          await prisma.mailDerivedCandidate.update({
            where: { id: existing.id },
            data: {
              mailInsightThreadId: thread.id,
              metadata: toInputJson({
                ...asRecord(existing.metadata),
                threadInsightId: thread.id,
                threadKey: thread.threadKey,
                mailIntelligence: candidate.mailIntelligence,
                policyDecision: candidate.policyDecision,
              }),
            },
          });
        }
        skipped += 1;
        continue;
      }

      const createdCandidate = await prisma.mailDerivedCandidate.create({
        data: {
          knowledgeDocumentId: thread.knowledgeDocumentId,
          mailInsightThreadId: thread.id,
          candidateType: candidate.candidateType,
          title: candidate.title,
          summary: candidate.summary,
          sourceTitle: thread.threadTitle,
          sourceSender: sourceSenderFromThread(thread),
          sourceReceivedAt: thread.latestReceivedAt,
          confidence: candidate.confidence,
          status: isProjectCandidateType(candidate.candidateType) ? "needs_revalidation" : "proposed",
          metadata: toInputJson({
            threadInsightId: thread.id,
            threadKey: thread.threadKey,
            sourceMessageIds: candidate.sourceMessageIds ?? asStringArray(thread.messageIds),
            messageId: candidate.sourceMessageIds?.[0] ?? asStringArray(thread.messageIds)[0],
            participantDomains: thread.participantDomains,
            revenueOpsTags: thread.revenueOpsTags,
            matchedKeywords: candidate.matchedKeywords,
            evidenceItems: candidate.evidenceItems ?? [],
            nextActions: candidate.nextActions ?? [],
            mailIntelligence: candidate.mailIntelligence,
            policyDecision: candidate.policyDecision,
            confidenceBreakdown: candidate.confidenceBreakdown,
            sourcePolicy:
              candidate.candidateType === "customer" || candidate.candidateType === "partner"
                ? "auto_candidate_final_approval"
                : "requires_ai_revalidation_before_approval",
          }),
        },
      });
      await recordPolicyDecision(projectId, {
        entityType: "mail_derived_candidate",
        entityId: createdCandidate.id,
        decisionType: "candidate_created",
        inputJson: toInputJson({
          threadId: thread.id,
          threadKey: thread.threadKey,
          candidateType: candidate.candidateType,
        }),
        outputJson: toInputJson({
          title: candidate.title,
          confidence: candidate.confidence,
          policyDecision: candidate.policyDecision,
        }),
      });
      created += 1;
    }
  }

  if (parsed.legacyKnowledgeFallback || process.env.MAIL_CANDIDATES_LEGACY_KNOWLEDGE_FALLBACK === "1") {
    const legacy = await generateLegacyKnowledgeCandidates(projectId, parsed.limit, policy);
    created += legacy.created;
    skipped += legacy.skipped;
  }

  const projectCandidates = await prisma.mailDerivedCandidate.findMany({
    where: { status: "needs_revalidation" },
    orderBy: { createdAt: "desc" },
    take: parsed.limit,
  });
  for (const candidate of projectCandidates) {
    await revalidateMailDerivedCandidate(candidate.id);
  }

  const candidates = await listMailDerivedCandidates({
    limit: Math.min(Math.max(created, 20), 2_000),
  });
  return { created, skipped, scanned: threads.length, suppressed, restored, candidates };
}

/**
 * 하이브리드 AI 분류를 사용하는 메일 후보 생성
 * 정책 기반 분류 + AI 분류를 통합하여 더 정확한 분류 결과 제공
 */
export async function generateMailDerivedCandidatesHybrid(
  input: z.input<typeof generateMailCandidatesSchema> = {},
) {
  const parsed = generateMailCandidatesSchema.parse(input);
  await seedDefaultMailPolicyMemory(parsed.projectSlug);
  const projectId = await resolveProjectId(parsed.projectSlug);
  const policy = await buildMailPolicyLookup(parsed.projectSlug);
  const suppressed =
    (await suppressPolicyExcludedCandidates(projectId, policy)) +
    (await suppressWeakProjectCandidates(projectId));
  const restored = await restoreKnownPartnerCandidates(projectId, policy);
  const threads = await prisma.mailInsightThread.findMany({
    where: { projectId },
    orderBy: [{ latestReceivedAt: "desc" }, { updatedAt: "desc" }],
    take: parsed.limit,
  });

  let created = 0;
  let skipped = 0;
  let aiClassified = 0;

  for (const thread of threads) {
    // 하이브리드 분류 사용 (정책 + AI)
    const classified = await classifyMailInsightThreadHybrid(thread, policy);

    if (classified.aiClassification) {
      aiClassified++;
    }

    for (const excluded of classified.excluded) {
      await recordPolicyDecision(projectId, {
        entityType: "mail_insight_thread",
        entityId: thread.id,
        decisionType: "candidate_excluded",
        inputJson: toInputJson({
          threadKey: thread.threadKey,
          threadTitle: thread.threadTitle,
        }),
        outputJson: toInputJson(excluded),
      });
    }

    for (const candidate of classified.candidates) {
      const existing = await prisma.mailDerivedCandidate.findFirst({
        where: {
          candidateType: candidate.candidateType,
          OR: [
            { mailInsightThreadId: thread.id },
            ...(thread.knowledgeDocumentId ? [{ knowledgeDocumentId: thread.knowledgeDocumentId }] : []),
          ],
        },
      });
      if (existing) {
        if (!existing.mailInsightThreadId) {
          await prisma.mailDerivedCandidate.update({
            where: { id: existing.id },
            data: {
              mailInsightThreadId: thread.id,
              metadata: toInputJson({
                ...asRecord(existing.metadata),
                threadInsightId: thread.id,
                threadKey: thread.threadKey,
                mailIntelligence: candidate.mailIntelligence,
                policyDecision: candidate.policyDecision,
                aiClassification: (candidate as Record<string, unknown>).aiClassification,
              }),
            },
          });
        }
        skipped += 1;
        continue;
      }

      const createdCandidate = await prisma.mailDerivedCandidate.create({
        data: {
          knowledgeDocumentId: thread.knowledgeDocumentId,
          mailInsightThreadId: thread.id,
          candidateType: candidate.candidateType,
          title: candidate.title,
          summary: candidate.summary,
          sourceTitle: thread.threadTitle,
          sourceSender: sourceSenderFromThread(thread),
          sourceReceivedAt: thread.latestReceivedAt,
          confidence: candidate.confidence,
          status: isProjectCandidateType(candidate.candidateType) ? "needs_revalidation" : "proposed",
          metadata: toInputJson({
            threadInsightId: thread.id,
            threadKey: thread.threadKey,
            sourceMessageIds: candidate.sourceMessageIds ?? asStringArray(thread.messageIds),
            messageId: candidate.sourceMessageIds?.[0] ?? asStringArray(thread.messageIds)[0],
            participantDomains: thread.participantDomains,
            revenueOpsTags: thread.revenueOpsTags,
            matchedKeywords: candidate.matchedKeywords,
            evidenceItems: candidate.evidenceItems ?? [],
            nextActions: candidate.nextActions ?? [],
            mailIntelligence: candidate.mailIntelligence,
            policyDecision: candidate.policyDecision,
            confidenceBreakdown: candidate.confidenceBreakdown,
            aiClassification: (candidate as Record<string, unknown>).aiClassification,
            sourcePolicy:
              candidate.candidateType === "customer" || candidate.candidateType === "partner"
                ? "auto_candidate_final_approval"
                : "requires_ai_revalidation_before_approval",
            classificationMethod: "hybrid",
          }),
        },
      });
      await recordPolicyDecision(projectId, {
        entityType: "mail_derived_candidate",
        entityId: createdCandidate.id,
        decisionType: "candidate_created",
        inputJson: toInputJson({
          threadId: thread.id,
          threadKey: thread.threadKey,
          candidateType: candidate.candidateType,
          classificationMethod: "hybrid",
        }),
        outputJson: toInputJson({
          title: candidate.title,
          confidence: candidate.confidence,
          policyDecision: candidate.policyDecision,
          aiClassification: (candidate as Record<string, unknown>).aiClassification,
        }),
      });
      created += 1;
    }
  }

  if (parsed.legacyKnowledgeFallback || process.env.MAIL_CANDIDATES_LEGACY_KNOWLEDGE_FALLBACK === "1") {
    const legacy = await generateLegacyKnowledgeCandidates(projectId, parsed.limit, policy);
    created += legacy.created;
    skipped += legacy.skipped;
  }

  const projectCandidates = await prisma.mailDerivedCandidate.findMany({
    where: { status: "needs_revalidation" },
    orderBy: { createdAt: "desc" },
    take: parsed.limit,
  });
  for (const candidate of projectCandidates) {
    await revalidateMailDerivedCandidate(candidate.id);
  }

  const candidates = await listMailDerivedCandidates({
    limit: Math.min(Math.max(created, 20), 2_000),
  });
  return {
    created,
    skipped,
    scanned: threads.length,
    suppressed,
    restored,
    aiClassified,
    classificationMethod: "hybrid",
    candidates,
  };
}

export async function listMailDerivedCandidates(
  input: z.input<typeof listMailCandidatesSchema> = {},
) {
  const parsed = listMailCandidatesSchema.parse(input);
  return prisma.mailDerivedCandidate.findMany({
    where: {
      ...(parsed.status ? { status: parsed.status } : {}),
      ...(parsed.candidateType ? { candidateType: parsed.candidateType } : {}),
    },
    orderBy: [{ status: "asc" }, { confidence: "desc" }, { createdAt: "desc" }],
    take: parsed.limit,
  });
}

export async function getMailDerivedCandidate(id: string) {
  return prisma.mailDerivedCandidate.findUniqueOrThrow({ where: { id } });
}

const rejectMailCandidateSchema = z.object({
  reasonCode: z.string().min(1).default("manual_reject"),
  note: z.string().optional(),
});

export async function rejectMailDerivedCandidate(
  id: string,
  input: z.input<typeof rejectMailCandidateSchema> = {},
) {
  const parsed = rejectMailCandidateSchema.parse(input);
  const candidate = await getMailDerivedCandidate(id);
  const projectId = await resolveProjectId("demo-project");
  const metadata = asRecord(candidate.metadata);
  const rejection = {
    reasonCode: parsed.reasonCode,
    note: parsed.note,
    rejectedAt: new Date().toISOString(),
  };
  const updated = await prisma.mailDerivedCandidate.update({
    where: { id },
    data: {
      status: "rejected",
      metadata: toInputJson({
        ...metadata,
        rejection,
      }),
    },
  });
  await recordPolicyDecision(projectId, {
    entityType: "mail_derived_candidate",
    entityId: id,
    decisionType: "candidate_rejected",
    inputJson: toInputJson({
      candidateType: candidate.candidateType,
      title: candidate.title,
      metadata,
    }),
    outputJson: toInputJson(rejection),
  });
  await createImprovementCandidateFromError({
    sourceType: "mail_candidate_rejection",
    sourceId: id,
    message: `Mail candidate rejected: ${candidate.title} (${parsed.reasonCode})`,
    details: {
      candidateType: candidate.candidateType,
      reasonCode: parsed.reasonCode,
      note: parsed.note,
      policyDecision: metadata.policyDecision,
    },
    severity: parsed.reasonCode === "internal_company" || parsed.reasonCode === "wrong_entity_role" ? "medium" : "low",
    suggestedModule: "mail-policy-memory",
  });
  await maybeProposePolicyMemoryFromRejection(updated, parsed.reasonCode);
  return updated;
}

async function maybeProposePolicyMemoryFromRejection(
  candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>,
  reasonCode: string,
) {
  const metadata = asRecord(candidate.metadata);
  const entityName = candidate.title.replace(/^(Customer|Partner):\s*/i, "").trim();
  const domain =
    domainFromEmail(String(metadata.email ?? metadata.sourceSender ?? candidate.sourceSender ?? "")) ??
    asStringArray(metadata.participantDomains)[0];
  const policyDecision = asRecord(metadata.policyDecision);

  if (reasonCode === "internal_company" && entityName) {
    await upsertPolicyMemory({
      memoryType: "internal_company_name",
      key: entityName,
      label: entityName,
      valueJson: { sourceCandidateId: candidate.id, reasonCode },
      status: "proposed",
      confidence: 75,
    });
  }

  if (reasonCode === "system_sender" && domain) {
    await upsertPolicyMemory({
      memoryType: "system_sender_domain",
      key: domain,
      label: `${domain} system sender`,
      valueJson: { sourceCandidateId: candidate.id, reasonCode },
      status: "proposed",
      confidence: 75,
    });
  }

  if (
    reasonCode === "wrong_entity_role" &&
    candidate.candidateType === "customer" &&
    policyDecision.entityRole === "partner" &&
    entityName
  ) {
    await upsertPolicyMemory({
      memoryType: "known_partner_name",
      key: entityName,
      label: entityName,
      valueJson: { sourceCandidateId: candidate.id, reasonCode },
      status: "proposed",
      confidence: 70,
    });
  }
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

async function convertCustomer(candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>) {
  const projectId = await resolveProjectId("demo-project");
  const existing = await prisma.customer.findFirst({
    where: { projectId, name: candidate.title.replace(/^Customer:\s*/i, "") },
  });
  if (existing) return existing;
  return createCustomer({
    projectSlug: "demo-project",
    name: candidate.title.replace(/^Customer:\s*/i, ""),
    notes: `Created from approved mail candidate.\n\n${candidate.summary}`,
  });
}

async function convertPartner(candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>) {
  const projectId = await resolveProjectId("demo-project");
  const name = candidate.title.replace(/^Partner:\s*/i, "");
  const existing = await prisma.partner.findFirst({
    where: { projectId, name },
  });
  if (existing) return existing;
  return createPartner({
    projectSlug: "demo-project",
    name,
    partnerType: "mail-derived",
  });
}

async function convertTask(candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>) {
  const task = await createWorkTask({
    projectSlug: "demo-project",
    title: candidate.title.replace(/^Follow up:\s*/i, ""),
    status: "todo",
    priority: candidate.confidence >= 80 ? "high" : "normal",
    source: "mail_candidate",
  });
  if (candidate.knowledgeDocumentId) {
    await linkTaskToEntity(task.id, {
      entityType: "mail_message",
      entityId: candidate.knowledgeDocumentId,
      linkType: "derived_from",
    });
  }
  return task;
}

async function convertOpportunity(candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>) {
  return createOpportunity({
    title: candidate.title.replace(/^Opportunity:\s*/i, ""),
    stage: "lead",
    probability: candidate.confidence >= 80 ? 35 : 20,
    nextAction: `Review approved mail candidate: ${candidate.summary.slice(0, 180)}`,
  });
}

async function convertPoc(candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>) {
  const poc = await createPocProject({
    projectSlug: "demo-project",
    title: candidate.title.replace(/^PoC:\s*/i, ""),
    productName: "Sangfor",
    requirements: candidate.summary,
  });
  if (!poc) throw new Error("poc_create_failed");
  return poc;
}

export async function approveMailDerivedCandidate(id: string) {
  const candidate = await getMailDerivedCandidate(id);
  if (candidate.status === "converted" && candidate.createdEntityId) {
    return { candidate, created: null };
  }
  if (candidate.status === "rejected") {
    throw new Error("candidate_rejected");
  }
  if (candidate.status === "needs_revalidation") {
    throw new Error("project_candidate_requires_ai_revalidation");
  }
  if (candidate.status === "knowledge_only") {
    throw new Error("candidate_marked_knowledge_only");
  }
  if (isProjectCandidateType(candidate.candidateType)) {
    const metadata = asRecord(candidate.metadata);
    const revalidation = asRecord(metadata.aiRevalidation);
    if (
      revalidation.decision !== "approve_candidate" &&
      revalidation.decision !== "needs_human_review"
    ) {
      throw new Error("project_candidate_requires_ai_revalidation");
    }
  }

  let created: { id: string };
  if (candidate.candidateType === "customer") {
    created = await convertCustomer(candidate);
  } else if (candidate.candidateType === "partner") {
    created = await convertPartner(candidate);
  } else if (candidate.candidateType === "task") {
    created = await convertTask(candidate);
  } else if (candidate.candidateType === "opportunity") {
    created = await convertOpportunity(candidate);
  } else if (candidate.candidateType === "poc") {
    created = await convertPoc(candidate);
  } else {
    throw new Error("unsupported_candidate_type");
  }

  const updated = await prisma.mailDerivedCandidate.update({
    where: { id },
    data: {
      status: "converted",
      createdEntityType: candidate.candidateType,
      createdEntityId: created.id,
    },
  });
  const projectId = await resolveProjectId("demo-project");
  await recordPolicyDecision(projectId, {
    entityType: "mail_derived_candidate",
    entityId: id,
    decisionType: "candidate_approved_converted",
    inputJson: toInputJson({
      candidateType: candidate.candidateType,
      title: candidate.title,
      metadata: candidate.metadata,
    }),
    outputJson: toInputJson({
      createdEntityType: candidate.candidateType,
      createdEntityId: created.id,
    }),
  });
  await reinforcePolicyMemoryFromApproval(updated);
  return { candidate: updated, created };
}

async function reinforcePolicyMemoryFromApproval(
  candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>,
) {
  const entityName = candidate.title.replace(/^(Customer|Partner):\s*/i, "").trim();
  if (!entityName) return;
  const metadata = asRecord(candidate.metadata);
  const participantDomains = asStringArray(metadata.participantDomains);
  const domain =
    domainFromEmail(String(metadata.email ?? metadata.sourceSender ?? candidate.sourceSender ?? "")) ??
    participantDomains.find((item) => !isInternalDomain(item) && !isSystemSenderDomain(item));

  if (candidate.candidateType === "partner") {
    await upsertPolicyMemory({
      memoryType: "known_partner_name",
      key: entityName,
      label: entityName,
      valueJson: { sourceCandidateId: candidate.id, createdEntityId: candidate.createdEntityId },
      status: "active",
      source: "approval",
      confidence: 95,
    });
    if (domain) {
      await upsertPolicyMemory({
        memoryType: "known_partner_domain",
        key: domain,
        label: `${entityName} domain`,
        valueJson: { sourceCandidateId: candidate.id, createdEntityId: candidate.createdEntityId },
        status: "active",
        source: "approval",
        confidence: 90,
      });
    }
  }

  if (candidate.candidateType === "customer") {
    await upsertPolicyMemory({
      memoryType: "known_customer_name",
      key: entityName,
      label: entityName,
      valueJson: { sourceCandidateId: candidate.id, createdEntityId: candidate.createdEntityId, domain },
      status: "active",
      source: "approval",
      confidence: 85,
    });
  }
}
