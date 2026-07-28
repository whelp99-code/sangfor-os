import { describe, expect, it } from "vitest";
import { calculateSlaDeadlines, getSlaPolicyMinutes } from "./support-sla";

describe("U056: support-sla unit tests", () => {
  it("returns exact 24x7 SLA targets for each severity", () => {
    expect(getSlaPolicyMinutes("critical")).toEqual({ responseMinutes: 60, resolutionMinutes: 240 });
    expect(getSlaPolicyMinutes("high")).toEqual({ responseMinutes: 240, resolutionMinutes: 1440 });
    expect(getSlaPolicyMinutes("medium")).toEqual({ responseMinutes: 1440, resolutionMinutes: 2880 });
    expect(getSlaPolicyMinutes("low")).toEqual({ responseMinutes: 1440, resolutionMinutes: 4320 });
  });

  it("calculates responseDueAt and resolutionDueAt accurately", () => {
    const openedAt = new Date(Date.UTC(2026, 6, 25, 12, 0, 0));
    const { responseDueAt, resolutionDueAt } = calculateSlaDeadlines(openedAt, "critical");

    expect(responseDueAt.toISOString()).toBe("2026-07-25T13:00:00.000Z");
    expect(resolutionDueAt.toISOString()).toBe("2026-07-25T16:00:00.000Z");
  });
});
