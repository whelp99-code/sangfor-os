import { prisma } from "@sangfor/db";
import { z } from "zod";
import { traceWorkflowEvent } from "./langfuse-observability";

export const improvementSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const improvementStatusSchema = z.enum([
  "proposed",
  "approved",
  "rejected",
  "converted",
]);

export const createFromErrorSchema = z.object({
  errorEventId: z.string().optional(),
  sourceType: z.string().min(1).optional(),
  sourceId: z.string().optional(),
  message: z.string().min(3).optional(),
  details: z.record(z.unknown()).optional(),
  commandRunId: z.string().optional(),
  severity: improvementSeveritySchema.optional(),
  suggestedModule: z.string().optional(),
});

export const listImprovementsFilterSchema = z.object({
  status: improvementStatusSchema.optional(),
  severity: improvementSeveritySchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const patchImprovementSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

function inferSeverity(message: string): z.infer<typeof improvementSeveritySchema> {
  const lower = message.toLowerCase();
  if (/\b(critical|fatal|data loss|security breach)\b/.test(lower)) return "critical";
  if (/\b(error|failed|exception|500|blocked)\b/.test(lower)) return "high";
  if (/\b(warn|degraded|retry)\b/.test(lower)) return "medium";
  return "low";
}

function buildTitle(message: string) {
  const trimmed = message.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

export async function createImprovementCandidateFromError(
  input: z.infer<typeof createFromErrorSchema>,
) {
  const parsed = createFromErrorSchema.parse(input);

  let sourceType = parsed.sourceType ?? "error_event";
  let sourceId = parsed.sourceId;
  let message = parsed.message ?? "Unknown error";
  let details = parsed.details ?? {};
  let commandRunId = parsed.commandRunId;

  if (parsed.errorEventId) {
    const event = await prisma.errorEvent.findUnique({
      where: { id: parsed.errorEventId },
    });
    if (!event) {
      throw new Error("error_event_not_found");
    }
    sourceType = "error_event";
    sourceId = event.id;
    message = event.message;
    details =
      event.details && typeof event.details === "object"
        ? (event.details as Record<string, unknown>)
        : {};
    if (typeof details.commandRunId === "string") {
      commandRunId = details.commandRunId;
    }
  }

  const severity = parsed.severity ?? inferSeverity(message);
  const summary = [
    `Source: ${sourceType}${sourceId ? ` ${sourceId}` : ""}`,
    message,
    commandRunId ? `Linked command run: ${commandRunId}` : null,
    Object.keys(details).length > 0 ? `Details: ${JSON.stringify(details)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return prisma.improvementCandidate.create({
    data: {
      sourceType,
      sourceId,
      title: buildTitle(message),
      summary,
      severity,
      suggestedModule: parsed.suggestedModule ?? "development",
      suggestedAction: "run_phase13_orchestrator",
      status: "proposed",
      commandRunId,
    },
  });
}

export async function listImprovementCandidates(
  filter: z.infer<typeof listImprovementsFilterSchema> = { limit: 50 },
) {
  const parsed = listImprovementsFilterSchema.parse(filter);
  return prisma.improvementCandidate.findMany({
    where: {
      ...(parsed.status ? { status: parsed.status } : {}),
      ...(parsed.severity ? { severity: parsed.severity } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: parsed.limit,
    include: { commandRun: true },
  });
}

export async function getImprovementCandidate(id: string) {
  return prisma.improvementCandidate.findUnique({
    where: { id },
    include: { commandRun: true },
  });
}

export async function approveImprovementCandidate(id: string) {
  const row = await prisma.improvementCandidate.findUnique({ where: { id } });
  if (!row) throw new Error("improvement_candidate_not_found");
  if (row.status === "rejected") {
    throw new Error("improvement_candidate_rejected");
  }
  if (row.status === "converted") {
    throw new Error("improvement_candidate_already_converted");
  }
  return prisma.improvementCandidate.update({
    where: { id },
    data: { status: "approved" },
  });
}

export async function rejectImprovementCandidate(id: string) {
  const row = await prisma.improvementCandidate.findUnique({ where: { id } });
  if (!row) throw new Error("improvement_candidate_not_found");
  if (row.status === "converted") {
    throw new Error("improvement_candidate_already_converted");
  }
  return prisma.improvementCandidate.update({
    where: { id },
    data: { status: "rejected" },
  });
}

export async function convertImprovementToPhase13Run(id: string) {
  const row = await prisma.improvementCandidate.findUnique({ where: { id } });
  if (!row) throw new Error("improvement_candidate_not_found");
  if (row.status === "rejected") {
    throw new Error("improvement_candidate_rejected");
  }
  if (row.status === "converted" && row.commandRunId) {
    const { getPhase13RunDetail } = await import("./skills/phase13-orchestrator");
    return {
      candidate: row,
      phase13: await getPhase13RunDetail(row.commandRunId),
    };
  }
  if (row.status !== "approved") {
    throw new Error("improvement_candidate_not_approved");
  }

  const inputSummary = [
    "Phase 15 improvement candidate — convert to Phase 13 orchestrator run",
    `Title: ${row.title}`,
    `Severity: ${row.severity}`,
    row.summary,
    "Apply aios-error-to-improvement and regression recommendation skills.",
  ].join("\n");

  const { runPhase13Orchestrator } = await import("./skills/phase13-orchestrator");
  const executionProfile = row.sourceType === "route_smoke" ? "smoke" : "full";
  const phase13 = await runPhase13Orchestrator({
    inputSummary,
    projectSlug: "demo-project",
    phase: 13,
    module: row.suggestedModule ?? "development",
    executionProfile,
  });

  const candidate = await prisma.improvementCandidate.update({
    where: { id },
    data: {
      status: "converted",
      commandRunId: phase13.commandRunId,
    },
  });

  void traceWorkflowEvent({
    event: "phase15.convertToPhase13",
    phase: 15,
    commandRunId: phase13.commandRunId,
    improvementCandidateId: candidate.id,
    metadata: {
      severity: candidate.severity,
      suggestedModule: candidate.suggestedModule,
      suggestedAction: candidate.suggestedAction,
      sourceType: candidate.sourceType,
    },
  });

  return { candidate, phase13 };
}
