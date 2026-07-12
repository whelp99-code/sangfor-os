import { Prisma } from "@sangfor/db";
import { sanitizeJsonStrings } from "@sangfor/shared";
import type { GtmDomain } from "@sangfor/shared/modes";

import {
  MailPolicyLookup,
  normalizePolicyKey,
} from "./mail-policy-memory";
import { SELF_DOMAINS, SYSTEM_SENDER_DOMAINS, KNOWN_PARTNER_DOMAINS, FREE_MAIL_DOMAINS, KNOWN_DOMAIN_MAP } from "./mail-domain-registry";
import {
  INTERNAL_COMPANY_NAMES,
  KEYWORDS,
  KNOWN_PARTNER_NAMES,
  STATIC_POLICY_LOOKUP,
} from "./constants";

export type HeaderInfo = {
  from?: string;
  email?: string;
  receivedAt?: Date;
  attachments?: string[];
  messageId?: string;
};

export type ClassifiedCandidate = {
  candidateType: "customer" | "partner" | "task" | "opportunity" | "poc";
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

export type PolicyDecision = {
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

export const ARTIFACT_ENTITY_NAME_EXAMPLES = ["Example", "Mail", "Mails", "<1 min", "Re:", "Fw:"] as const;

export function isArtifactEntityName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  // case-insensitive exact match against known artifact name examples
  if (ARTIFACT_ENTITY_NAME_EXAMPLES.some((ex) => ex.toLowerCase() === trimmed.toLowerCase())) return true;
  // Re:/Fw:/Fwd: prefix (email reply/forward headers)
  if (/^(re|fw|fwd):/i.test(trimmed)) return true;
  // duration-like prefix, e.g. "<1 min", "<5 mins", "<1 hour"
  if (/^<\s*\d+\s*(min|mins|minute|minutes|sec|secs|second|seconds|hour|hours|hr|hrs)\b/i.test(trimmed)) return true;
  if (trimmed.length < 2) return true;
  // bare numbers/symbols/whitespace only — Unicode-aware so Korean/CJK is not caught
  if (/^[\d\s\p{P}\p{S}]+$/u.test(trimmed)) return true;
  return false;
}

export function normalizeCompanyName(value: string) {
  return normalizePolicyKey(value).replace(/[^a-z0-9가-힣]/g, "");
}

export function isInternalCompanyName(value?: string, policy: MailPolicyLookup = STATIC_POLICY_LOOKUP) {
  if (!value) return false;
  const normalized = normalizeCompanyName(value);
  return INTERNAL_COMPANY_NAMES.has(normalized) || policy.internalCompanyNames.has(normalized);
}

export function isKnownPartner(value?: string, policy: MailPolicyLookup = STATIC_POLICY_LOOKUP) {
  if (!value) return false;
  const normalized = normalizeCompanyName(value);
  return KNOWN_PARTNER_NAMES.has(normalized) || policy.knownPartnerNames.has(normalized);
}

export function domainFromEmail(value?: string | null) {
  const match = String(value ?? "").match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  return match?.[1]?.toLowerCase();
}

export function domainMatches(domain: string | undefined, domains: Set<string>) {
  if (!domain) return false;
  const normalized = normalizePolicyKey(domain);
  return [...domains].some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
}

export function isInternalDomain(domain: string | undefined, policy: MailPolicyLookup = STATIC_POLICY_LOOKUP) {
  if (!domain) return false;
  const normalized = normalizePolicyKey(domain);
  return SELF_DOMAINS.has(normalized) || domainMatches(normalized, policy.internalDomains);
}

export function isSystemSenderDomain(domain: string | undefined, policy: MailPolicyLookup = STATIC_POLICY_LOOKUP) {
  if (!domain) return false;
  const normalized = normalizePolicyKey(domain);
  return SYSTEM_SENDER_DOMAINS.has(normalized) || domainMatches(normalized, policy.systemSenderDomains);
}

export function isKnownPartnerDomain(domain: string | undefined, policy: MailPolicyLookup = STATIC_POLICY_LOOKUP) {
  if (!domain) return false;
  const normalized = normalizePolicyKey(domain);
  return KNOWN_PARTNER_DOMAINS.has(normalized) || domainMatches(normalized, policy.knownPartnerDomains);
}

// --- customer/partner signal-based confidence scoring ---

const CUSTOMER_PARTNER_BASE = 55;
const CUSTOMER_PARTNER_MAX = 94;
const CUSTOMER_PARTNER_MIN = 40;
const KNOWN_PARTNER_DOMAIN_BONUS = 20;
const KNOWN_DOMAIN_MAP_BONUS = 12;
const FREE_MAIL_PENALTY = -10;
const EVIDENCE_BONUS_PER_UNIT = 2;
const AI_ENHANCED_BONUS = 6;
const PARTNER_KEYWORD_BONUS = 5;

export type CustomerPartnerConfidenceSignals = {
  isPartner: boolean;
  knownPartnerDomain: boolean;
  knownDomainMap: boolean;
  freeMailDomain: boolean;
  policySignal: number;
  evidenceCount?: number;
  aiEnhanced?: boolean;
  partnerKeywordBonus?: number;
};

export function computeCustomerPartnerConfidence(
  signals: CustomerPartnerConfidenceSignals,
): { confidence: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let score = CUSTOMER_PARTNER_BASE;
  breakdown.base = CUSTOMER_PARTNER_BASE;

  if (signals.knownPartnerDomain) {
    score += KNOWN_PARTNER_DOMAIN_BONUS;
    breakdown.knownPartnerDomain = KNOWN_PARTNER_DOMAIN_BONUS;
  }

  if (signals.knownDomainMap && !signals.knownPartnerDomain) {
    score += KNOWN_DOMAIN_MAP_BONUS;
    breakdown.knownDomainMap = KNOWN_DOMAIN_MAP_BONUS;
  }

  if (signals.policySignal) {
    score += signals.policySignal;
    breakdown.policySignal = signals.policySignal;
  }

  if (signals.freeMailDomain) {
    score += FREE_MAIL_PENALTY;
    breakdown.freeMailPenalty = FREE_MAIL_PENALTY;
  }

  const evidenceCount = signals.evidenceCount ?? 0;
  if (evidenceCount > 0) {
    const bonus = Math.min(evidenceCount, 3) * EVIDENCE_BONUS_PER_UNIT;
    score += bonus;
    breakdown.evidenceBonus = bonus;
  }

  if (signals.aiEnhanced) {
    score += AI_ENHANCED_BONUS;
    breakdown.aiEnhanced = AI_ENHANCED_BONUS;
  }

  if (signals.partnerKeywordBonus) {
    score += signals.partnerKeywordBonus;
    breakdown.partnerKeywordBonus = signals.partnerKeywordBonus;
  }

  score = Math.max(CUSTOMER_PARTNER_MIN, Math.min(CUSTOMER_PARTNER_MAX, Math.round(score)));
  breakdown.total = score;

  return { confidence: score, breakdown };
}

export function matchedPolicyMemories(
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

export function normalizedText(title: string, body: string) {
  return `${title}\n${body}`.toLowerCase();
}

export function matchKeywords(text: string, keywords: readonly string[]) {
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

export function compactSummary(body: string) {
  const cleaned = body
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(from|sender|received|messageid|attachments):/i.test(line))
    .join(" ");
  return cleaned.slice(0, 420) || "Mail-derived candidate from imported mail intelligence.";
}

export function isProjectCandidateType(candidateType: string) {
  return candidateType === "task" || candidateType === "opportunity" || candidateType === "poc";
}

/** Map a mail-derived candidateType to its GTM domain for the decision spine. */
export function gtmDomainForCandidate(candidateType: string): GtmDomain {
  return candidateType === "poc" ? "presales" : "sales";
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(sanitizeJsonStrings(value ?? {}))) as Prisma.InputJsonValue;
}

export function parseMailHeader(body: string): HeaderInfo {
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

export function inferCompanyName(
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
    const knownPartnerDomain = isKnownPartnerDomain(domain, policy);
    const knownDomainMap = !!domain && KNOWN_DOMAIN_MAP[domain] !== undefined;
    const freeMailDomain = !!domain && FREE_MAIL_DOMAINS.has(domain);
    const policySignal = isPartner ? 18 : 10;
    const partnerKeywordBonus = isPartner && !knownPartnerDomain ? PARTNER_KEYWORD_BONUS : 0;
    const { confidence, breakdown } = computeCustomerPartnerConfidence({
      isPartner,
      knownPartnerDomain,
      knownDomainMap,
      freeMailDomain,
      policySignal,
      partnerKeywordBonus,
    });
    candidates.push({
      candidateType: isPartner ? "partner" : "customer",
      title: `${isPartner ? "Partner" : "Customer"}: ${companyName}`,
      summary: `${companyName} inferred from imported mail intelligence. ${summary}`.slice(0, 420),
      confidence,
      matchedKeywords: isPartner ? ["sender-domain", ...partnerMatches] : ["sender-domain"],
      confidenceBreakdown: breakdown,
    });
  }

  return { header, candidates, excluded: [] as PolicyDecision[] };
}

export type ThreadLike = {
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

export function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export function asUnknownArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function asObjectArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item != null && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

export function extractThreadMessages(thread: ThreadLike) {
  const metadata = asRecord(thread.metadata);
  return asObjectArray(metadata.messages);
}

export function isPromotionalThread(thread: ThreadLike) {
  const messages = extractThreadMessages(thread);
  if (messages.some((message) => message.isPromotional === true)) return true;
  const text = textFromThread(thread);
  const marketingSignal = /\b(unsubscribe|newsletter|wallet|shipped|launch|promo|promotion|marketing)\b|\$\d+/i.test(text);
  const explicitBusinessSignal = /견적\s*요청|계약\s*조건|검증\s*요청|고객사|purchase\s+order|quote\s+request/i.test(text);
  return marketingSignal && !explicitBusinessSignal;
}

export function extractDisplayName(value?: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const beforeEmail = text.replace(/<[^>]+>/g, "").trim();
  return beforeEmail || undefined;
}

export function domainRootName(domain: string) {
  const root = domain.split(".")[0] ?? "";
  if (!root || ["gmail", "naver", "daum", "outlook", "hotmail"].includes(root)) return undefined;
  return root.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function titleBracketName(title: string) {
  return title.match(/\[([^\]]{2,60})\]/)?.[1]?.trim();
}

export function hasKnownNameInText(text: string, names: Set<string>) {
  const normalized = normalizeCompanyName(text);
  return [...names].find((name) => normalized.includes(name.replace(/[^a-z0-9가-힣]/g, "")));
}

export function hasVendorSupport(thread: ThreadLike): boolean {
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

export function resolveThreadEntityPolicy(
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

export function uniquePolicyDomains(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => normalizePolicyKey(String(value ?? ""))).filter(Boolean))];
}

export function textFromThread(thread: ThreadLike) {
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

export function hasExternalSignal(policyDecision: PolicyDecision) {
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
    const knownPartnerDomain = policyDecision.participantDomains.some(
      (d) => isKnownPartnerDomain(d, policy),
    );
    const knownDomainMap = policyDecision.participantDomains.some(
      (d) => KNOWN_DOMAIN_MAP[d] !== undefined,
    );
    const freeMailDomain = policyDecision.participantDomains.some(
      (d) => FREE_MAIL_DOMAINS.has(d),
    );
    const policySignal = isPartner ? 18 : 10;
    const evidenceCount = evidenceItems.length + nextActions.length;
    const { confidence, breakdown } = computeCustomerPartnerConfidence({
      isPartner,
      knownPartnerDomain,
      knownDomainMap,
      freeMailDomain,
      policySignal,
      evidenceCount,
      aiEnhanced: thread.aiEnhanced,
    });
    candidates.push({
      candidateType: isPartner ? "partner" : "customer",
      title: `${isPartner ? "Partner" : "Customer"}: ${policyDecision.candidateName}`,
      summary: `${policyDecision.candidateName} inferred from Mail Intelligence thread. ${thread.summary}`.slice(0, 420),
      confidence,
      matchedKeywords: [policyDecision.reason],
      evidenceItems,
      nextActions,
      sourceMessageIds: messageIds,
      policyDecision,
      mailIntelligence: buildMailIntelligenceMetadata(thread),
      confidenceBreakdown: breakdown,
    });
  }

  return {
    candidates,
    excluded: policyDecision.decision === "exclude" ? [policyDecision] : [],
  };
}

export function buildMailIntelligenceMetadata(thread: ThreadLike) {
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

export type PolicyClassifyResult = ReturnType<typeof classifyMailInsightThread>;

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
