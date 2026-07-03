import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

const schema = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf8");

describe("schema expansion (Phase 7)", () => {
  it("customer accepts segment and riskScore (compile-time)", () => {
    const input: Prisma.CustomerUncheckedCreateInput = {
      projectId: "p1",
      name: "t",
      segment: "ENTERPRISE",
      riskScore: 0.3,
    };
    expect(input.segment).toBe("ENTERPRISE");
    expect(input.riskScore).toBe(0.3);
  });

  it("opportunity accepts stageEnteredAt and probabilityOverride (compile-time)", () => {
    const input: Prisma.OpportunityUncheckedCreateInput = {
      projectId: "p1",
      title: "t",
      stageEnteredAt: new Date("2026-07-03T00:00:00Z"),
      probabilityOverride: 0.75,
    };
    expect(input.stageEnteredAt).toBeInstanceOf(Date);
    expect(input.probabilityOverride).toBe(0.75);
  });

  it("expanded fields remain declared in schema.prisma", () => {
    expect(schema).toMatch(/segment\s+String\?\s+@default\(\"UNCLASSIFIED\"\)/);
    expect(schema).toMatch(/riskScore\s+Float\?\s+@default\(0\.5\)\s+@map\(\"risk_score\"\)/);
    expect(schema).toMatch(/stageEnteredAt\s+DateTime\?\s+@map\(\"stage_entered_at\"\)/);
    expect(schema).toMatch(/probabilityOverride\s+Float\?\s+@map\(\"probability_override\"\)/);
  });

  it("composite indexes remain declared in schema.prisma", () => {
    expect(schema).toContain("@@index([segment, riskScore])");
    expect(schema).toContain("@@index([customerId, stage])");
    expect(schema).toContain("@@index([stage, stageEnteredAt])");
  });
});
