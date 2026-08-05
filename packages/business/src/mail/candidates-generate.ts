import { prisma } from "@sangfor/db";
import { z } from "zod";

import { loadLlmConfigFromDb } from "../platform/llm-settings";
import {
  MailPolicyLookup,
  buildMailPolicyLookup,
  resolveProjectId,
  seedDefaultMailPolicyMemory,
} from "./mail-policy-memory";

import {
  PolicyDecision,
  ThreadLike,
  asRecord,
  asStringArray,
  classifyMailCandidateDocument,
  classifyMailInsightThread,
  domainFromEmail,
  extractThreadMessages,
  isArtifactEntityName,
  isInternalCompanyName,
  isInternalDomain,
  isKnownPartner,
  isKnownPartnerDomain,
  isProjectCandidateType,
  isSystemSenderDomain,
  matchedPolicyMemories,
  gtmDomainForCandidate,
  toInputJson,
} from "./classify-rules";
import { classifyMailInsightThreadHybrid } from "./classify-ai";
import { groundTruthFor } from "./ground-truth-registry";
import { isVendorDomain } from "./mail-entity-quality";
import { listMailDerivedCandidates } from "./candidates-update";
import { recordDecision } from "../governance/ai-decision";
import { caseRefFor } from "../infrastructure/case-ref";
import { resolveDefaultProjectSlug } from "../infrastructure/default-project";

const generateMailCandidatesSchema = z.object({
  projectSlug: z.string().optional(),
  limit: z.number().int().min(1).max(2_000).default(50),
  legacyKnowledgeFallback: z.boolean().default(false),
});

function sourceSenderFromThread(thread: ThreadLike) {
  const message = extractThreadMessages(thread)[0];
  return String(message?.fromName ?? message?.from ?? thread.participantDomains[0] ?? "mail thread");
}

function candidateLooksPolicyExcluded(
  candidate: {
    candidateType: string;
    title: string;
    summary: string;
    sourceSender: string | null;
    metadata: unknown;
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
  const promotionalSignal = /\b(unsubscribe|newsletter|promo|promotion|marketing|subscription|billing|renewal)\b|뉴스레터|홍보|(광고)|구독|청구|요금|프로모션|microsoft\s*365|your\s+microsoft/.test(candidateText);
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
  if (domain && isVendorDomain(domain)) {
    return {
      decision: "exclude",
      entityRole: "unknown",
      reason: "existing candidate sender domain is a known vendor/SaaS we consume",
      candidateName: entityName,
      matchedPolicyMemories: [],
      participantDomains: [domain],
    } satisfies PolicyDecision;
  }
  const gt = domain ? groundTruthFor(domain) : undefined;
  if (gt && (gt.classification === "vendor" || gt.classification === "system")) {
    return {
      decision: "exclude",
      entityRole: gt.classification === "system" ? "system_sender" : "unknown",
      reason: `ground-truth ${gt.classification}: ${gt.evidence}`,
      candidateName: entityName,
      matchedPolicyMemories: [],
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
    const domain = gtmDomainForCandidate(candidate.candidateType);
    await recordDecision({
      projectId,
      domain,
      actor: domain === "presales" ? "presales" : "sales",
      actionType: "candidate_suppressed",
      caseRef: caseRefFor("mailCandidate", candidate.id),
      input: toInputJson({ title: candidate.title, candidateType: candidate.candidateType }),
      output: toInputJson(policyDecision),
    });
    suppressed += 1;
  }
  return suppressed;
}

function projectCandidateLooksWeak(candidate: {
  candidateType: string;
  title: string;
  summary: string;
  metadata: unknown;
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
    const domain = gtmDomainForCandidate(candidate.candidateType);
    await recordDecision({
      projectId,
      domain,
      actor: domain === "presales" ? "presales" : "sales",
      actionType: "project_candidate_suppressed",
      caseRef: caseRefFor("mailCandidate", candidate.id),
      input: toInputJson({ title: candidate.title, candidateType: candidate.candidateType }),
      output: toInputJson(policyDecision),
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
      candidateType: true,
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
    const domain = gtmDomainForCandidate(candidate.candidateType);
    await recordDecision({
      projectId,
      domain,
      actor: domain === "presales" ? "presales" : "sales",
      actionType: "candidate_restored",
      caseRef: caseRefFor("mailCandidate", candidate.id),
      input: toInputJson({ title: candidate.title, status: "knowledge_only" }),
      output: toInputJson({ status: "proposed", reason: "known_partner_policy_match" }),
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
  const projectSlug = parsed.projectSlug ?? (await resolveDefaultProjectSlug());
  await loadLlmConfigFromDb(); // pick up web-saved OpenAI key for AI revalidation
  await seedDefaultMailPolicyMemory(projectSlug);
  const projectId = await resolveProjectId(projectSlug);
  const policy = await buildMailPolicyLookup(projectSlug);
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
      await recordDecision({
        projectId,
        domain: "sales",
        actor: "sales",
        actionType: "candidate_excluded",
        caseRef: caseRefFor("mailThread", thread.id),
        input: toInputJson({
          threadKey: thread.threadKey,
          threadTitle: thread.threadTitle,
        }),
        output: toInputJson(excluded),
      });
    }

    for (const candidate of classified.candidates) {
      if (candidate.candidateType === "customer" || candidate.candidateType === "partner") {
        const entityName = candidate.title.replace(/^(Customer|Partner):\s*/i, "").trim();
        if (isArtifactEntityName(entityName)) {
          console.log(`[artifact-filter] skipped candidate "${candidate.title}" — parser artifact`);
          continue;
        }
      }
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
      const domain = gtmDomainForCandidate(candidate.candidateType);
      await recordDecision({
        projectId,
        domain,
        actor: domain === "presales" ? "presales" : "sales",
        actionType: "candidate_created",
        caseRef: caseRefFor("mailCandidate", createdCandidate.id),
        input: toInputJson({
          threadId: thread.id,
          threadKey: thread.threadKey,
          candidateType: candidate.candidateType,
        }),
        output: toInputJson({
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
  const projectSlug = parsed.projectSlug ?? (await resolveDefaultProjectSlug());
  await loadLlmConfigFromDb(); // web-saved OpenAI-compatible key/model (Codex Spark, etc.)
  await seedDefaultMailPolicyMemory(projectSlug);
  const projectId = await resolveProjectId(projectSlug);
  const policy = await buildMailPolicyLookup(projectSlug);
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
      await recordDecision({
        projectId,
        domain: "sales",
        actor: "sales",
        actionType: "candidate_excluded",
        caseRef: caseRefFor("mailThread", thread.id),
        input: toInputJson({
          threadKey: thread.threadKey,
          threadTitle: thread.threadTitle,
        }),
        output: toInputJson(excluded),
      });
    }
    if (classified.excluded.length > 0 && classified.candidates.length === 0) {
      const openRows = await prisma.mailDerivedCandidate.findMany({
        where: {
          status: { in: ["proposed", "needs_revalidation"] },
          OR: [
            { mailInsightThreadId: thread.id },
            ...(thread.knowledgeDocumentId ? [{ knowledgeDocumentId: thread.knowledgeDocumentId }] : []),
          ],
        },
        select: { id: true, metadata: true },
      });
      for (const row of openRows) {
        await prisma.mailDerivedCandidate.update({
          where: { id: row.id },
          data: {
            status: "knowledge_only",
            metadata: toInputJson({
              ...asRecord(row.metadata),
              policyDecision: classified.excluded[0],
              classificationMethod: "hybrid",
              aiFirstExcludedAt: new Date().toISOString(),
            }),
          },
        });
      }
    }

    for (const candidate of classified.candidates) {
      if (candidate.candidateType === "customer" || candidate.candidateType === "partner") {
        const entityName = candidate.title.replace(/^(Customer|Partner):\s*/i, "").trim();
        if (isArtifactEntityName(entityName)) {
          console.log(`[artifact-filter] skipped candidate "${candidate.title}" — parser artifact`);
          continue;
        }
      }
      // AI-first: refresh any open/knowledge candidate on the same thread.
      const existing = await prisma.mailDerivedCandidate.findFirst({
        where: {
          status: { in: ["proposed", "needs_revalidation", "knowledge_only"] },
          OR: [
            { mailInsightThreadId: thread.id },
            ...(thread.knowledgeDocumentId ? [{ knowledgeDocumentId: thread.knowledgeDocumentId }] : []),
          ],
        },
        orderBy: [{ updatedAt: "desc" }],
      });
      if (existing) {
        const aiClassification = (candidate as Record<string, unknown>).aiClassification;
        const nextStatus = isProjectCandidateType(candidate.candidateType)
          ? "needs_revalidation"
          : "proposed";
        const nextMeta = toInputJson({
          ...asRecord(existing.metadata),
          threadInsightId: thread.id,
          threadKey: thread.threadKey,
          mailIntelligence: candidate.mailIntelligence,
          policyDecision: candidate.policyDecision,
          aiClassification,
          confidenceBreakdown: candidate.confidenceBreakdown,
          classificationMethod: "hybrid",
          aiFirstUpdatedAt: new Date().toISOString(),
        });
        const baseData = {
          mailInsightThreadId: existing.mailInsightThreadId ?? thread.id,
          title: candidate.title,
          summary: candidate.summary,
          confidence: candidate.confidence,
          status: nextStatus,
          metadata: nextMeta,
        } as const;

        // knowledgeDocumentId+candidateType is unique — only change type when free.
        if (existing.candidateType !== candidate.candidateType) {
          const typeTaken = await prisma.mailDerivedCandidate.findFirst({
            where: {
              id: { not: existing.id },
              candidateType: candidate.candidateType,
              OR: [
                ...(thread.knowledgeDocumentId
                  ? [{ knowledgeDocumentId: thread.knowledgeDocumentId }]
                  : []),
                { mailInsightThreadId: thread.id },
              ],
            },
            select: { id: true, metadata: true },
          });
          if (typeTaken) {
            await prisma.mailDerivedCandidate.update({
              where: { id: typeTaken.id },
              data: baseData,
            });
            await prisma.mailDerivedCandidate.update({
              where: { id: existing.id },
              data: {
                status: "knowledge_only",
                metadata: toInputJson({
                  ...asRecord(existing.metadata),
                  supersededBy: typeTaken.id,
                  classificationMethod: "hybrid",
                  aiFirstSupersededAt: new Date().toISOString(),
                }),
              },
            });
          } else {
            await prisma.mailDerivedCandidate.update({
              where: { id: existing.id },
              data: { ...baseData, candidateType: candidate.candidateType },
            });
          }
        } else {
          await prisma.mailDerivedCandidate.update({
            where: { id: existing.id },
            data: baseData,
          });
        }
        skipped += 1; // counted as refresh-not-create
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
      const domain = gtmDomainForCandidate(candidate.candidateType);
      await recordDecision({
        projectId,
        domain,
        actor: domain === "presales" ? "presales" : "sales",
        actionType: "candidate_created",
        caseRef: caseRefFor("mailCandidate", createdCandidate.id),
        input: toInputJson({
          threadId: thread.id,
          threadKey: thread.threadKey,
          candidateType: candidate.candidateType,
          classificationMethod: "hybrid",
        }),
        output: toInputJson({
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
