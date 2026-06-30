import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterAll } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: path.join(repoRoot, ".env") });

import { prisma } from "@sangfor/db";
import {
  createOpportunity,
  updateOpportunity,
  getOpportunityDetail,
} from "./opportunity-center";

const TAG = "__t25_status_update__";

describe("opportunity status-axis update + detail qualification", () => {
  let oppId: string;
  let qualId: string | undefined;

  afterAll(async () => {
    if (qualId) {
      await prisma.dealQualification.deleteMany({ where: { opportunityId: oppId } });
    }
    await prisma.opportunityStageEvent.deleteMany({ where: { opportunityId: oppId } });
    await prisma.opportunity.deleteMany({ where: { title: TAG } });
  });

  it("setup: creates a base opportunity", async () => {
    const opp = await createOpportunity({ title: TAG, projectSlug: "demo-project" });
    oppId = opp.id;
    expect(opp.id).toBeTruthy();
  });

  it("persists dealStatus=LOST and lostReason=price", async () => {
    const updated = await updateOpportunity(oppId, {
      dealStatus: "LOST",
      lostReason: "price",
    });
    const fetched = await prisma.opportunity.findUniqueOrThrow({ where: { id: oppId } });
    expect(fetched.dealStatus).toBe("LOST");
    expect(fetched.lostReason).toBe("price");
  });

  it("persists dealType=RENEWAL", async () => {
    const updated = await updateOpportunity(oppId, { dealType: "RENEWAL" });
    const fetched = await prisma.opportunity.findUniqueOrThrow({ where: { id: oppId } });
    expect(fetched.dealType).toBe("RENEWAL");
  });

  it("silently ignores unknown key marginPct (stripped by Zod)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(updateOpportunity(oppId, { marginPct: 99 } as any)).resolves.not.toThrow();
    const fetched = await prisma.opportunity.findUniqueOrThrow({ where: { id: oppId } });
    // marginPct is not a column; confirm the record is otherwise unchanged (no DB error)
    expect(fetched.id).toBe(oppId);
  });

  it("getOpportunityDetail includes qualification with economicBuyer and champion", async () => {
    // Create a qualification row so we can assert the include shape returns data
    const qual = await prisma.dealQualification.create({
      data: {
        opportunityId: oppId,
        budgetScore: 3,
        authorityScore: 3,
        needScore: 3,
        timelineScore: 3,
        weightedScore: 3,
      },
    });
    qualId = qual.id;

    const detail = await getOpportunityDetail(oppId);
    expect(detail).not.toBeNull();
    expect(detail!.qualification).not.toBeNull();
    // economicBuyer and champion are null when no contact is linked — that's fine;
    // the key assertion is that the field is present (include resolved)
    expect(Object.keys(detail!.qualification!)).toContain("economicBuyer");
    expect(Object.keys(detail!.qualification!)).toContain("champion");
  });
});
