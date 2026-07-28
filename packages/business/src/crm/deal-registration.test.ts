import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
loadEnv({ path: path.join(repoRoot, ".env") });

const TAG = "__t43a_deal_reg__";
const integration = process.env.CI_INTEGRATION === "1";
let opportunityId: string;
let prisma: typeof import("@sangfor/db").prisma;
let createOpportunity: typeof import("./opportunity-center").createOpportunity;
let getOpportunityDetail: typeof import("./opportunity-center").getOpportunityDetail;
let getDealRegistration: typeof import("./deal-registration").getDealRegistration;
let upsertDealRegistration: typeof import("./deal-registration").upsertDealRegistration;

import type { AuthContext } from "@sangfor/auth";

const mockCtx: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write"],
  product: "portal",
};

describe.skipIf(!integration)("deal-registration service", () => {
  beforeAll(async () => {
    ({ prisma } = await import("@sangfor/db"));
    ({ createOpportunity, getOpportunityDetail } = await import("./opportunity-center"));
    ({ getDealRegistration, upsertDealRegistration } = await import("./deal-registration"));
    const opp = (await createOpportunity(mockCtx, { title: TAG, idempotencyKey: "ik-deal-reg-1" })) as { id: string };
    opportunityId = opp.id;
  });

  afterAll(async () => {
    if (!opportunityId) return;
    await prisma.dealRegistration.deleteMany({ where: { opportunity: { title: TAG } } });
    await prisma.domainDecisionLog.deleteMany({ where: { caseRef: `opp:${opportunityId}` } });
    await prisma.stateTransitionLog.deleteMany({ where: { entityType: "opportunity", entityId: opportunityId } });
    await prisma.opportunity.deleteMany({ where: { title: TAG } });
  });

  it("upsert creates a DealRegistration row; getDealRegistration returns it with correct regStatus", async () => {
    await upsertDealRegistration(opportunityId, {
      regStatus: "APPROVED",
      registrationNumber: "DR-1",
    });

    const reg = await getDealRegistration(opportunityId);
    expect(reg).not.toBeNull();
    expect(reg!.regStatus).toBe("APPROVED");
    expect(reg!.registrationNumber).toBe("DR-1");
  });

  it("upsert again with different regStatus UPDATES the same row (only one row exists)", async () => {
    await upsertDealRegistration(opportunityId, { regStatus: "EXPIRED" });

    const reg = await getDealRegistration(opportunityId);
    expect(reg).not.toBeNull();
    expect(reg!.regStatus).toBe("EXPIRED");

    const count = await prisma.dealRegistration.count({ where: { opportunityId } });
    expect(count).toBe(1);
  });

  it("getOpportunityDetail returns opp.dealRegistration non-null after upsert", async () => {
    const opp = (await getOpportunityDetail(mockCtx, opportunityId)) as { dealRegistration?: { regStatus: string } | null } | null;
    expect(opp).not.toBeNull();
    expect(opp!.dealRegistration).not.toBeNull();
    expect(opp!.dealRegistration!.regStatus).toBe("EXPIRED");
  });
});
