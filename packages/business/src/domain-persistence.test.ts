import { describe, it, expect, vi } from "vitest";
import { createDomainPersister, type PersistencePrisma } from "./domain-persistence";
import type { DomainArtifact, DomainCase } from "./domain-agent-runtime";

const sampleCase: DomainCase = {
  id: "c1",
  subject: "Sangfor 방화벽 도입",
  tags: ["firewall"],
};

function artifact(structured: Record<string, unknown> | undefined): DomainArtifact {
  return {
    produces: "x",
    summary: "s",
    payload: structured === undefined ? { recalledCount: 0 } : { structured },
  };
}

/** 호출을 기록하는 가짜 prisma. 각 모델 upsert 는 {id} 를 돌려준다. */
function fakePrisma() {
  const calls: Record<string, unknown[]> = {};
  const model = (name: string) => ({
    upsert: vi.fn(async (args: { where: { id: string } }) => {
      (calls[`${name}.upsert`] ??= []).push(args);
      return { id: args.where.id };
    }),
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      (calls[`${name}.findUnique`] ??= []).push(args);
      return name === "opportunity" ? { id: args.where.id, amount: 1000 } : { id: args.where.id };
    }),
  });
  const prisma = {
    opportunity: model("opportunity"),
    customer: model("customer"),
    quote: model("quote"),
    pocProject: model("pocProject"),
    customerAsset: model("customerAsset"),
    supportCase: model("supportCase"),
    invoice: model("invoice"),
  } as unknown as PersistencePrisma;
  return { prisma, calls, raw: prisma as unknown as Record<string, { upsert: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> }> };
}

function makePersister(p: PersistencePrisma) {
  return createDomainPersister({ prisma: p, resolveProjectId: async () => "proj-1" });
}

describe("createDomainPersister", () => {
  it("skips when there is no structured payload (e.g. stub generator)", async () => {
    const { prisma, raw } = fakePrisma();
    const persist = makePersister(prisma);
    const r = await persist({ domain: "marketing", case: sampleCase, artifact: artifact(undefined) });
    expect(r.persisted).toHaveLength(0);
    expect(r.skipped).toMatch(/structured/i);
    expect(raw.opportunity.upsert).not.toHaveBeenCalled();
  });

  it("marketing: upserts a QUALIFIED Opportunity scoped to the project when qualified", async () => {
    const { prisma, raw } = fakePrisma();
    const persist = makePersister(prisma);
    const r = await persist({
      domain: "marketing",
      case: sampleCase,
      artifact: artifact({ qualified: true, leadScore: 80, nextAction: "데모 제안" }),
    });
    expect(r.persisted.map((p) => p.entity)).toEqual(["Opportunity"]);
    const args = raw.opportunity.upsert.mock.calls[0][0];
    expect(args.where.id).toBe("dompipe:opp:c1"); // deterministic = idempotent
    expect(args.create.projectId).toBe("proj-1");
    expect(args.create.stage).toBe("QUALIFIED");
    expect(args.create.probability).toBe(80);
  });

  it("marketing: skips persistence when not qualified", async () => {
    const { prisma, raw } = fakePrisma();
    const persist = makePersister(prisma);
    const r = await persist({
      domain: "marketing",
      case: sampleCase,
      artifact: artifact({ qualified: false, leadScore: 10, nextAction: "보류" }),
    });
    expect(r.persisted).toHaveLength(0);
    expect(r.skipped).toMatch(/qualified/i);
    expect(raw.opportunity.upsert).not.toHaveBeenCalled();
  });

  it("sales: upserts Customer + Opportunity(PROPOSAL) + Quote with consistent deterministic ids", async () => {
    const { prisma, raw } = fakePrisma();
    const persist = makePersister(prisma);
    const r = await persist({
      domain: "sales",
      case: sampleCase,
      artifact: artifact({
        customer: "ACME",
        opportunityTitle: "ACME 방화벽",
        estimatedAmount: 5000000,
        discountPct: 10,
      }),
    });
    expect(r.persisted.map((p) => p.entity).sort()).toEqual(["Customer", "Opportunity", "Quote"]);
    expect(raw.customer.upsert.mock.calls[0][0].where.id).toBe("dompipe:cust:c1");
    const opp = raw.opportunity.upsert.mock.calls[0][0];
    expect(opp.where.id).toBe("dompipe:opp:c1");
    expect(opp.create.customerId).toBe("dompipe:cust:c1");
    expect(opp.create.stage).toBe("PROPOSAL");
    const quote = raw.quote.upsert.mock.calls[0][0];
    expect(quote.create.opportunityId).toBe("dompipe:opp:c1");
    expect(quote.create.companyId).toBe("proj-1");
    expect(Number(quote.create.totalRevenue)).toBe(5000000);
    expect(typeof quote.create.createdBy).toBe("string");
  });

  it("presales: upserts a PocProject linked to the opportunity", async () => {
    const { prisma, raw } = fakePrisma();
    const persist = makePersister(prisma);
    const r = await persist({
      domain: "presales",
      case: sampleCase,
      artifact: artifact({ proposalTitle: "기술 제안", architecture: "NGAF + HA" }),
    });
    expect(r.persisted.map((p) => p.entity)).toEqual(["PocProject"]);
    const poc = raw.pocProject.upsert.mock.calls[0][0];
    expect(poc.where.id).toBe("dompipe:poc:c1");
    expect(poc.create.opportunityId).toBe("dompipe:opp:c1");
    expect(poc.create.requirements).toContain("NGAF");
  });

  it("engineer: ensures a Customer then upserts CustomerAsset (+ SupportCase when titled)", async () => {
    const { prisma, raw } = fakePrisma();
    const persist = makePersister(prisma);
    const r = await persist({
      domain: "engineer",
      case: sampleCase,
      artifact: artifact({
        assetSummary: "NGAF M5400 x2",
        deploymentSteps: ["rack", "config"],
        haRequired: true,
        supportCaseTitle: "초기 구축",
      }),
    });
    expect(r.persisted.map((p) => p.entity)).toEqual(["CustomerAsset", "SupportCase"]);
    expect(raw.customer.upsert).toHaveBeenCalled(); // FK target ensured
    const asset = raw.customerAsset.upsert.mock.calls[0][0];
    expect(asset.create.customerId).toBe("dompipe:cust:c1");
    expect(asset.create.assetType).toBe("deployment");
  });

  it("cfo: creates an Invoice only when the decision is approved", async () => {
    const { prisma, raw } = fakePrisma();
    const persist = makePersister(prisma);

    const held = await persist({
      domain: "cfo",
      case: sampleCase,
      artifact: artifact({ decision: "hold", rationale: "마진 부족" }),
    });
    expect(held.persisted).toHaveLength(0);
    expect(raw.invoice.upsert).not.toHaveBeenCalled();

    const approved = await persist({
      domain: "cfo",
      case: sampleCase,
      artifact: artifact({ decision: "approved", marginPct: 35, rationale: "승인" }),
    });
    expect(approved.persisted.map((p) => p.entity)).toEqual(["Invoice"]);
    const inv = raw.invoice.upsert.mock.calls[0][0];
    expect(inv.where.id).toBe("dompipe:inv:c1");
    expect(inv.create.amount).toBe(1000); // derived from the linked opportunity amount
  });
});
