import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterAll } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
loadEnv({ path: path.join(repoRoot, ".env") });

import { prisma } from "@sangfor/db";
import { createOpportunity } from "./opportunity-center";

const TAG = "__t13_deal_code__";
const integration = process.env.CI_INTEGRATION === "1";
let opportunityId: string | undefined;

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

describe.skipIf(!integration)("createOpportunity assigns a deal code", () => {
  afterAll(async () => {
    if (opportunityId) {
      await prisma.stateTransitionLog.deleteMany({ where: { entityType: "opportunity", entityId: opportunityId } });
    }
    await prisma.opportunity.deleteMany({ where: { title: TAG } });
  });

  it("returns a PRJ-YYYY-NNNN code", async () => {
    const opp = (await createOpportunity(mockCtx, { title: TAG, idempotencyKey: "ik-deal-code-1" })) as { id: string; code?: string };
    opportunityId = opp.id;
    expect(opp.code).toMatch(/^PRJ-\d{4}-\d{4,}$/);
  });
});
