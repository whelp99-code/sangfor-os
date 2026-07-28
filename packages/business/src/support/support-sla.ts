export type SupportSeverity = "critical" | "high" | "medium" | "low";

export type SlaTargetMinutes = {
  responseMinutes: number;
  resolutionMinutes: number;
};

const SLA_TARGETS: Record<SupportSeverity, SlaTargetMinutes> = {
  critical: { responseMinutes: 60, resolutionMinutes: 240 },
  high: { responseMinutes: 240, resolutionMinutes: 1440 },
  medium: { responseMinutes: 1440, resolutionMinutes: 2880 },
  low: { responseMinutes: 1440, resolutionMinutes: 4320 },
};

export function getSlaPolicyMinutes(severity: SupportSeverity): SlaTargetMinutes {
  const target = SLA_TARGETS[severity];
  if (!target) {
    throw new Error(`Invalid severity: ${severity}`);
  }
  return target;
}

export function calculateSlaDeadlines(openedAt: Date, severity: SupportSeverity): {
  responseDueAt: Date;
  resolutionDueAt: Date;
} {
  const { responseMinutes, resolutionMinutes } = getSlaPolicyMinutes(severity);
  const responseDueAt = new Date(openedAt.getTime() + responseMinutes * 60 * 1000);
  const resolutionDueAt = new Date(openedAt.getTime() + resolutionMinutes * 60 * 1000);
  return { responseDueAt, resolutionDueAt };
}
