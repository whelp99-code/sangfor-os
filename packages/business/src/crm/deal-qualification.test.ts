import { describe, expect, it } from "vitest";
import type { AuthContext } from "@sangfor/auth";
import {
  evaluateBantTfV1,
  isQualificationPassing,
  qualifyOpportunity,
  qualifyOpportunitySchema,
} from "./deal-qualification";

const SALES: AuthContext = {
  userId: "user-sales-1",
  sessionId: "session-sales-1",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write"],
  product: "portal",
};

describe("U045 BANT+Technical Fit Qualification (bant-tf-v1)", () => {
  it("enforces exact component max limits (B:20, A:20, N:24, T:16, TF:20) and integer boundary", () => {
    const validMax = {
      budgetScore: 20,
      authorityScore: 20,
      needScore: 24,
      timelineScore: 16,
      technicalFitScore: 20,
    };
    expect(qualifyOpportunitySchema.safeParse(validMax).success).toBe(true);

    const evaluated = evaluateBantTfV1(validMax);
    expect(evaluated.scoreTotal).toBe(100);
    expect(evaluated.passed).toBe(true);

    expect(qualifyOpportunitySchema.safeParse({ ...validMax, budgetScore: 21 }).success).toBe(false);
    expect(qualifyOpportunitySchema.safeParse({ ...validMax, authorityScore: 21 }).success).toBe(false);
    expect(qualifyOpportunitySchema.safeParse({ ...validMax, needScore: 25 }).success).toBe(false);
    expect(qualifyOpportunitySchema.safeParse({ ...validMax, timelineScore: 17 }).success).toBe(false);
    expect(qualifyOpportunitySchema.safeParse({ ...validMax, technicalFitScore: 21 }).success).toBe(false);

    expect(qualifyOpportunitySchema.safeParse({ ...validMax, budgetScore: -1 }).success).toBe(false);
    expect(qualifyOpportunitySchema.safeParse({ ...validMax, needScore: 15.5 }).success).toBe(false);
  });

  it("enforces exact 59/60 boundary for pass threshold", () => {
    const score59 = evaluateBantTfV1({
      budgetScore: 10,
      authorityScore: 10,
      needScore: 15,
      timelineScore: 14,
      technicalFitScore: 10,
    });
    expect(score59.scoreTotal).toBe(59);
    expect(score59.passed).toBe(false);

    const score60 = evaluateBantTfV1({
      budgetScore: 10,
      authorityScore: 10,
      needScore: 15,
      timelineScore: 15,
      technicalFitScore: 10,
    });
    expect(score60.scoreTotal).toBe(60);
    expect(score60.passed).toBe(true);
  });

  it("ignores caller forged total/pass/actor/scoringVersion fields", () => {
    const rawInput = {
      budgetScore: 10,
      authorityScore: 10,
      needScore: 10,
      timelineScore: 10,
      technicalFitScore: 10,
      scoreTotal: 100,
      passed: true,
      scoringVersion: "forged-version",
      actor: "forged-actor",
      tenantId: "foreign-tenant",
    };

    const parsed = qualifyOpportunitySchema.parse(rawInput);
    expect((parsed as any).scoreTotal).toBeUndefined();
    expect((parsed as any).passed).toBeUndefined();
    expect((parsed as any).scoringVersion).toBeUndefined();

    const evaluated = evaluateBantTfV1(parsed);
    expect(evaluated.scoreTotal).toBe(50);
    expect(evaluated.passed).toBe(false);
  });

  it("considers legacy bant-v0 or null scoringVersion as non-passing (blocked)", () => {
    const legacyQualification = {
      scoringVersion: "bant-v0",
      scoreTotal: 80,
      passed: true,
      budgetScore: 20,
      authorityScore: 20,
      needScore: 20,
      timelineScore: 20,
    };
    expect(isQualificationPassing(legacyQualification)).toBe(false);

    const nullVersion = {
      scoringVersion: null,
      scoreTotal: 90,
      passed: true,
    };
    expect(isQualificationPassing(nullVersion)).toBe(false);

    const currentPassing = {
      scoringVersion: "bant-tf-v1",
      scoreTotal: 60,
      passed: true,
    };
    expect(isQualificationPassing(currentPassing)).toBe(true);
  });

  it("rejects unauthorized attempts missing opportunity.write permission", async () => {
    const FORBIDDEN_CTX: AuthContext = { ...SALES, permissions: [] };
    await expect(
      qualifyOpportunity(FORBIDDEN_CTX, "opp-1", {
        budgetScore: 20,
        authorityScore: 20,
        needScore: 24,
        timelineScore: 16,
        technicalFitScore: 20,
      }),
    ).rejects.toMatchObject({ httpStatus: 403 });
  });
});
