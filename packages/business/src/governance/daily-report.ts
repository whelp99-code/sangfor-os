import { prisma } from "@sangfor/db";
import type { OpportunityStage } from "@prisma/client";
import { ACTIVE_OPPORTUNITY_STAGES } from "../crm/opportunity-stage";
import { resolveDefaultProjectId } from "../infrastructure/default-project";
import {
  getOpenAiApiKey,
  getOpenAiChatCompletionsUrl,
  getOpenAiAuthHeaders,
  getOpenAiModel,
  buildChatCompletionRequestBody,
  extractChatCompletionText,
} from "../platform/openai-config";

export interface DailyReportData {
  date: string;
  mail: {
    todayCandidates: number;
    pendingApproval: number;
    todayApproved: number;
    todayConverted: number;
  };
  entities: {
    customers: number;
    partners: number;
    tasks: number;
    opportunities: number;
  };
  candidatesByType: unknown;
}

/**
 * Assemble the daily operations report (mail-intelligence throughput + entity counts).
 * Extracted from apps/web route to decouple presentation from persistence.
 *
 * When a projectId is provided (or inferred via the default-project resolver),
 * entity counts are scoped to that project.  Mail-derived-candidate queries
 * are left unscoped (the model does not carry a projectId FK).
 */
export async function generateDailyReport(projectId?: string): Promise<DailyReportData> {
  const resolvedId = projectId ?? (await resolveDefaultProjectId());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const candidates = await prisma.mailDerivedCandidate.groupBy({
    by: ["candidateType", "status"],
    _count: true,
  });

  const todayCandidates = await prisma.mailDerivedCandidate.count({
    where: { createdAt: { gte: today } },
  });

  const pendingApproval = await prisma.mailDerivedCandidate.count({
    where: { status: "proposed" },
  });

  const todayApproved = await prisma.mailDerivedCandidate.count({
    where: {
      status: "approved",
      updatedAt: { gte: today },
    },
  });

  const todayConverted = await prisma.mailDerivedCandidate.count({
    where: {
      status: "converted",
      updatedAt: { gte: today },
    },
  });

  const [customers, partners, tasks, opportunities] = await Promise.all([
    prisma.customer.count({ where: { projectId: resolvedId } }),
    prisma.partner.count({ where: { projectId: resolvedId } }),
    prisma.workTask.count({ where: { projectId: resolvedId } }),
    prisma.opportunity.count({
      where: {
        projectId: resolvedId,
        stage: { in: [...ACTIVE_OPPORTUNITY_STAGES] as OpportunityStage[] },
      },
    }),
  ]);

  return {
    date: today.toISOString().split("T")[0],
    mail: {
      todayCandidates,
      pendingApproval,
      todayApproved,
      todayConverted,
    },
    entities: {
      customers,
      partners,
      tasks,
      opportunities,
    },
    candidatesByType: candidates,
  };
}

export interface DailyBrief {
  inflow: { mails: number; candidatesByType: Record<string, number> };
  deadlines: { renewalsD30: number; slaAtRisk: number; pendingApprovals: number };
  autopilot: { autoApproved24h: number; suggestedPending: number };
  stageChanges24h: number;
  summary: string;
  generatedAt: string;
}

export interface BuildDailyBriefDeps {
  prisma?: typeof prisma;
  llm?: (prompt: string) => Promise<string>;
}

/** RenewalOpportunity/SupportCase statuses treated as already closed out. */
const RENEWAL_DONE_STATUSES = ["renewed", "cancelled", "closed", "done"];
const SUPPORT_CASE_DONE_STATUSES = ["resolved", "closed"];

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[daily-brief] ${label}_failed:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

function fallbackSummary(input: {
  mails: number;
  candidateCount: number;
  renewalsD30: number;
  slaAtRisk: number;
  pendingApprovals: number;
  autoApproved24h: number;
  suggestedPending: number;
}): string {
  return (
    `어제 메일 ${input.mails}건·후보 ${input.candidateCount}건 유입. ` +
    `오늘 임박: 리뉴얼 ${input.renewalsD30}건, SLA ${input.slaAtRisk}건, 미결승인 ${input.pendingApprovals}건. ` +
    `autopilot 자동승인 ${input.autoApproved24h}건/제안 ${input.suggestedPending}건 대기.`
  );
}

async function defaultLlmSummary(prompt: string): Promise<string> {
  const key = getOpenAiApiKey();
  if (!key) throw new Error("no LLM key");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(getOpenAiChatCompletionsUrl(), {
      method: "POST",
      headers: getOpenAiAuthHeaders(key),
      signal: controller.signal,
      body: JSON.stringify(
        buildChatCompletionRequestBody({
          model: getOpenAiModel(),
          maxCompletionTokens: 300,
          messages: [
            {
              role: "system",
              content:
                "당신은 B2B 영업/CS 운영 코크핏의 아침 브리핑 작성자입니다. 주어진 지표만 사용해 한국어 3문장으로 간결하게 요약하세요. 지표에 없는 사실을 지어내지 마세요.",
            },
            { role: "user", content: prompt },
          ],
        }),
      ),
    }).then((r) => {
      if (!r.ok) throw new Error("brief_llm_" + r.status);
      return r.json() as Promise<Parameters<typeof extractChatCompletionText>[0]>;
    });
    const text = extractChatCompletionText(res);
    if (!text) throw new Error("brief_llm_empty_response");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Assemble the real-data daily brief (BriefBanner). Every count is a live
 * query; the LLM summary is a best-effort decoration — any failure (missing
 * key, timeout, malformed response) falls back to a deterministic Korean
 * template built from the same numbers. This function never throws.
 */
export async function buildDailyBrief(
  projectId?: string,
  deps?: BuildDailyBriefDeps,
): Promise<DailyBrief> {
  const client = deps?.prisma ?? prisma;

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const in30Days = new Date(now);
  in30Days.setDate(in30Days.getDate() + 30);
  const in1Day = new Date(now);
  in1Day.setDate(in1Day.getDate() + 1);
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let resolvedProjectId: string | undefined = projectId;
  if (!resolvedProjectId) {
    resolvedProjectId = await safe(
      "resolve_project_id",
      () => resolveDefaultProjectId(client),
      undefined,
    );
  }

  const mails = await safe(
    "inflow_mails",
    () =>
      client.mailMessage.count({
        where: { receivedAt: { gte: yesterdayStart, lt: todayStart } },
      }),
    0,
  );

  const candidateGroups = await safe(
    "inflow_candidates",
    () =>
      client.mailDerivedCandidate.groupBy({
        by: ["candidateType"],
        where: { createdAt: { gte: yesterdayStart, lt: todayStart } },
        _count: true,
      }),
    [] as Array<{ candidateType: string; _count: number }>,
  );
  const candidatesByType: Record<string, number> = {};
  let candidateCount = 0;
  for (const row of candidateGroups) {
    const count = typeof row._count === "number" ? row._count : 0;
    candidatesByType[row.candidateType] = count;
    candidateCount += count;
  }

  const renewalsD30 = await safe(
    "deadlines_renewals",
    () =>
      client.renewalOpportunity.count({
        where: {
          status: { notIn: RENEWAL_DONE_STATUSES },
          expiresAt: { gte: now, lte: in30Days },
        },
      }),
    0,
  );

  // SupportCase carries no createdAt; slaDeadline is the only field that
  // signals response-SLA risk on this schema.
  const slaAtRisk = await safe(
    "deadlines_sla",
    () =>
      client.supportCase.count({
        where: {
          status: { notIn: SUPPORT_CASE_DONE_STATUSES },
          slaDeadline: { lte: in1Day },
        },
      }),
    0,
  );

  const pendingApprovals = await safe(
    "deadlines_approvals",
    () => client.approvalRequest.count({ where: { status: "ready_for_human_approval" } }),
    0,
  );

  const autoApproved24h = await safe(
    "autopilot_auto_approved",
    () =>
      client.domainDecisionLog.count({
        where: {
          actor: "ai",
          actionType: "autopilot_approve",
          createdAt: { gte: last24h },
          ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
        },
      }),
    0,
  );

  const suggestedPending = await safe(
    "autopilot_suggested_pending",
    () =>
      client.mailDerivedCandidate.count({
        where: {
          status: "proposed",
          metadata: { path: ["autopilotSuggested"], equals: true },
        },
      }),
    0,
  );

  // domainDecisionLog carries projectId directly; OpportunityStageEvent
  // would require a join through Opportunity to scope by project.
  const stageChanges24h = await safe(
    "stage_changes",
    () =>
      client.domainDecisionLog.count({
        where: {
          actionType: "stage_transition",
          createdAt: { gte: last24h },
          ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
        },
      }),
    0,
  );

  const numbers = {
    mails,
    candidateCount,
    renewalsD30,
    slaAtRisk,
    pendingApprovals,
    autoApproved24h,
    suggestedPending,
  };
  const fallback = fallbackSummary(numbers);

  let summary = fallback;
  const llm = deps?.llm ?? defaultLlmSummary;
  try {
    const prompt =
      `어제(${yesterdayStart.toISOString().slice(0, 10)}) 유입 메일 ${mails}건, ` +
      `후보 ${candidateCount}건(${JSON.stringify(candidatesByType)}).\n` +
      `오늘 임박: 리뉴얼 D-30 ${renewalsD30}건, SLA 임박/위반 ${slaAtRisk}건, 미결 승인 ${pendingApprovals}건.\n` +
      `autopilot: 최근 24시간 자동승인 ${autoApproved24h}건, 제안 대기 ${suggestedPending}건.\n` +
      `딜 스테이지 변화(24시간) ${stageChanges24h}건.\n` +
      `위 지표만으로 한국어 3문장 브리핑을 작성하세요.`;
    const text = await llm(prompt);
    summary = text.trim() || fallback;
  } catch (err) {
    console.error(
      "[daily-brief] llm_summary_failed, using fallback:",
      err instanceof Error ? err.message : err,
    );
    summary = fallback;
  }

  return {
    inflow: { mails, candidatesByType },
    deadlines: { renewalsD30, slaAtRisk, pendingApprovals },
    autopilot: { autoApproved24h, suggestedPending },
    stageChanges24h,
    summary,
    generatedAt: now.toISOString(),
  };
}
