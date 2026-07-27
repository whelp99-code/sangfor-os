import { Prisma, prisma } from "@sangfor/db";

import { getDomainAutonomy, type DomainKey } from "../domain-ai/project-decision";
import { resolveAutonomyMode, autonomyFromComputed } from "./autonomy-policy";
import { gtmDomainForCandidate } from "../mail/classify-rules";

export type AutopilotAction = "auto" | "suggest" | "observe" | "skipped";

export interface AutopilotResultEntry {
  id: string;
  type: string;
  action: AutopilotAction;
  reason: string;
}

export interface AutopilotPassResult {
  scanned: number;
  autoApproved: number;
  suggested: number;
  skipped: number;
  demoted: string[];
  results: AutopilotResultEntry[];
}

export interface RunAutopilotOpts {
  dryRun?: boolean;
  limit?: number;
}

export interface AutopilotDeps {
  prisma?: typeof import("@sangfor/db").prisma;
  /** Legacy test seam retained as inert input; U043 never invokes it without AuthContext. */
  approve?: (id: string) => Promise<unknown>;
  /** Legacy test seam retained as inert input; review drafts replace autonomous decisions. */
  recordDecision?: typeof import("../governance/ai-decision").recordDecision;
  getAutonomy?: (
    domain: string,
  ) => Promise<{ pct: number | null; sample: number; label: string }>;
  resolveMode?: typeof import("./autonomy-policy").resolveAutonomyMode;
  getProjectId?: () => Promise<string>;
  env?: Record<string, string | undefined>;
}

const CANDIDATE_TYPE_WHITELIST = new Set([
  "customer",
  "partner",
  "task",
  "opportunity",
  "poc",
]);

async function checkReversalsAndDemote(
  client: NonNullable<AutopilotDeps["prisma"]>,
): Promise<string[]> {
  const recent = await client.domainDecisionLog.findMany({
    where: { actor: "ai", actionType: "autopilot_approve" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, caseRef: true, domain: true, createdAt: true },
  });

  if (recent.length < 3) return [];

  // All 3 most recent must have a later human/sales rejection with same caseRef
  const top3 = recent.slice(0, 3);
  const flipped: Array<{ caseRef: string | null; domain: string }> = [];

  for (const row of top3) {
    if (!row.caseRef) continue;
    const laterRejection = await client.domainDecisionLog.findFirst({
      where: {
        caseRef: row.caseRef,
        actor: { in: ["human", "sales"] },
        outcome: "rejected",
        createdAt: { gt: row.createdAt },
      },
      select: { id: true },
    });
    if (laterRejection) {
      flipped.push({ caseRef: row.caseRef, domain: row.domain });
    }
  }

  if (flipped.length < 3) return [];

  const domains = new Set(flipped.map((f) => f.domain));
  const demoted: string[] = [];

  for (const domain of domains) {
    await client.autonomyPolicy.updateMany({
      where: { domain, decisionType: "autopilot_approve" },
      data: { mode: "suggest" },
    });
    const key = `${domain}:autopilot_approve`;
    demoted.push(key);
    console.warn(
      `[autopilot] auto-demotion: policy (domain=${domain}, ` +
        `decisionType=autopilot_approve) \u2192 suggest ` +
        `(3 consecutive reversals)`,
    );
  }

  return demoted;
}

export async function runAutopilotPass(
  opts?: RunAutopilotOpts,
  deps?: AutopilotDeps,
): Promise<AutopilotPassResult> {
  const env = deps?.env ?? process.env;
  const client = deps?.prisma ?? prisma;

  if (env.AUTOPILOT_ENABLED === "0") {
    console.warn("[autopilot] AUTOPILOT_ENABLED=0, skipping pass");
    return {
      scanned: 0,
      autoApproved: 0,
      suggested: 0,
      skipped: 0,
      demoted: [],
      results: [],
    };
  }

  // 1) Reversal auto-demote (runs BEFORE scanning new candidates)
  const demoted = await checkReversalsAndDemote(client);

  // 2) Scan candidates that satisfy the dual gate.
  const rawCandidates = await client.mailDerivedCandidate.findMany({
    where: { status: "proposed", confidence: { gte: 85 } },
    select: { id: true, candidateType: true, metadata: true },
  });

  // In-memory filter: metadata.aiRevalidation.decision === "approve_candidate"
  const dualGateCandidates = rawCandidates.filter((c) => {
    const meta = c.metadata as Record<string, unknown> | null;
    const reval = (meta?.aiRevalidation ?? {}) as Record<string, unknown>;
    return reval.decision === "approve_candidate";
  });

  // Slice to limit AFTER the above filters.
  // scanned = candidates actually iterated (post-filter, post-slice —
  // INCLUDES unsupported-type skips since they were still inspected).
  const limit = opts?.limit ?? 20;
  const candidates = dualGateCandidates.slice(0, limit);

  let scanned = 0;
  let autoApproved = 0;
  let suggestedCount = 0;
  let skipped = 0;
  const results: AutopilotResultEntry[] = [];

  for (const candidate of candidates) {
    scanned++;
    const entry: AutopilotResultEntry = {
      id: candidate.id,
      type: candidate.candidateType,
      action: "auto",
      reason: "",
    };

    if (!CANDIDATE_TYPE_WHITELIST.has(candidate.candidateType)) {
      entry.action = "skipped";
      entry.reason = "unsupported_candidate_type";
      skipped++;
      results.push(entry);
      continue;
    }

    try {
      const domain = gtmDomainForCandidate(candidate.candidateType);
      const autonomyRaw = await (deps?.getAutonomy ?? getDomainAutonomy)(domain as DomainKey);
      const autonomy = autonomyFromComputed(autonomyRaw);

      // Fetch the policy row ONCE (we need its id for output.policyId)
      // and feed it into resolveAutonomyMode via loadPolicy to avoid a
      // double-query.
      const policyRow = await client.autonomyPolicy.findUnique({
        where: {
          domain_decisionType: {
            domain,
            decisionType: "autopilot_approve",
          },
        },
      });

      const loadPolicy = async () =>
        policyRow
          ? {
              mode: policyRow.mode,
              minAutonomy: policyRow.minAutonomy,
              minSamples: policyRow.minSamples,
              requireColorGatePass: policyRow.requireColorGatePass,
            }
          : null;

      const mode = await (deps?.resolveMode ?? resolveAutonomyMode)(
        {
          domain,
          decisionType: "autopilot_approve",
          autonomy,
          colorGatePass: true, // dual-gate filter upstream IS the gate-pass proxy
        },
        { loadPolicy, env: deps?.env },
      );

      if (mode === "auto") {
        // This scheduler has no verified session-derived AuthContext. Persist a review draft
        // instead of invoking any Customer/Opportunity conversion authority.
        entry.action = "suggest";
        if (!opts?.dryRun) {
          const existingMeta = (candidate.metadata as Record<string, unknown>) ?? {};
          await client.mailDerivedCandidate.update({
            where: { id: candidate.id },
            data: {
              metadata: {
                ...existingMeta,
                autopilotReviewDraft: {
                  reviewRequired: true,
                  reason: "authenticated_crm_context_required",
                  policyId: policyRow?.id ?? null,
                  requestedAt: new Date().toISOString(),
                },
              } as Prisma.InputJsonValue,
            },
          });
          entry.reason = "authenticated_crm_context_required";
          suggestedCount++;
        } else {
          entry.reason = "would_persist_review_draft (dryRun)";
          suggestedCount++;
        }
      } else if (mode === "suggest") {
        entry.action = "suggest";
        entry.reason = "suggest";
        if (!opts?.dryRun) {
          // Flag the candidate as suggested (preserve existing metadata keys).
          const existingMeta = (candidate.metadata as Record<string, unknown>) ?? {};
          await client.mailDerivedCandidate.update({
            where: { id: candidate.id },
            data: {
              metadata: {
                ...existingMeta,
                autopilotSuggested: true,
                autopilotSuggestedAt: new Date().toISOString(),
              } as Prisma.InputJsonValue,
            },
          });
        }
        suggestedCount++;
      } else {
        entry.action = "observe";
        entry.reason = "observe";
        skipped++;
      }
    } catch (err: unknown) {
      entry.action = "skipped";
      entry.reason = err instanceof Error ? err.message : String(err);
      skipped++;
    }

    results.push(entry);
  }

  return {
    scanned,
    autoApproved,
    suggested: suggestedCount,
    skipped,
    demoted,
    results,
  };
}
