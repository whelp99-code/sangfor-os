import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterAll } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: path.join(repoRoot, ".env") });

import { prisma } from "@sangfor/db";
import { createOpportunity } from "./opportunity-center";

const TAG = "__t13_deal_code__";

describe("createOpportunity assigns a deal code", () => {
  afterAll(async () => {
    await prisma.opportunity.deleteMany({ where: { title: TAG } });
  });

  it("returns a PRJ-YYYY-NNNN code", async () => {
    const opp = await createOpportunity({ title: TAG, projectSlug: "demo-project" });
    expect(opp.code).toMatch(/^PRJ-\d{4}-\d{4,}$/);
  });
});
