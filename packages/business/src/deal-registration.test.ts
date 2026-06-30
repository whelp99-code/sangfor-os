import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: path.join(repoRoot, ".env") });

import { prisma } from "@sangfor/db";
import { createOpportunity } from "./opportunity-center";
import { getDealRegistration, upsertDealRegistration } from "./deal-registration";
import { getOpportunityDetail } from "./opportunity-center";

const TAG = "__t43a_deal_reg__";
let opportunityId: string;

describe("deal-registration service", () => {
  beforeAll(async () => {
    const opp = await createOpportunity({ title: TAG, projectSlug: "demo-project" });
    opportunityId = opp.id;
  });

  afterAll(async () => {
    await prisma.dealRegistration.deleteMany({ where: { opportunity: { title: TAG } } });
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
    const opp = await getOpportunityDetail(opportunityId);
    expect(opp).not.toBeNull();
    expect(opp!.dealRegistration).not.toBeNull();
    expect(opp!.dealRegistration!.regStatus).toBe("EXPIRED");
  });
});
