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

describe.skipIf(!integration)("createOpportunity assigns a deal code", () => {
  afterAll(async () => {
    if (opportunityId) {
      await prisma.stateTransitionLog.deleteMany({ where: { entityType: "opportunity", entityId: opportunityId } });
    }
    await prisma.opportunity.deleteMany({ where: { title: TAG } });
  });

  it("returns a PRJ-YYYY-NNNN code", async () => {
    const opp = await createOpportunity({ title: TAG, projectSlug: "demo-project" });
    opportunityId = opp.id;
    expect(opp.code).toMatch(/^PRJ-\d{4}-\d{4,}$/);
  });
});
