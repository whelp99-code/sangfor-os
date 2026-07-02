import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  evaluateProposalAction,
  buildVariables,
  maybeEnhanceWithLlm,
  type ProposalVariablesPrisma,
} from "./proposal-generator";

function fakeProposalPrisma(input: {
  customer?: { name: string } | null;
  poc?: {
    title: string;
    productName: string | null;
    deploymentType: string | null;
    hwSpec: string | null;
    swSpec: string | null;
    requirements: string | null;
  } | null;
}): ProposalVariablesPrisma {
  return {
    customer: {
      findUnique: vi.fn(async () => input.customer ?? null),
    },
    pocProject: {
      findUnique: vi.fn(async () => input.poc ?? null),
    },
  };
}

describe("evaluateProposalAction", () => {
  it("blocks a customer-facing action on a non-approved proposal", () => {
    expect(evaluateProposalAction({ status: "draft", action: "send" })).toEqual({
      allowed: false,
      reason: "proposal_action_requires_approval",
    });
  });

  it("allows a customer-facing action once approved", () => {
    expect(evaluateProposalAction({ status: "approved", action: "send" })).toEqual({ allowed: true });
  });

  it("blocks export the same way as send when not approved", () => {
    expect(evaluateProposalAction({ status: "draft", action: "export" })).toEqual({
      allowed: false,
      reason: "proposal_action_requires_approval",
    });
  });

  it("always allows internal actions (review/edit) regardless of status", () => {
    expect(evaluateProposalAction({ status: "draft", action: "review" })).toEqual({ allowed: true });
  });
});

describe("buildVariables golden cases", () => {
  it("returns the default variable set when no ids or extras are given", async () => {
    const prisma = fakeProposalPrisma({});
    const vars = await buildVariables(undefined, undefined, {}, { prisma });

    expect(vars).toEqual({
      customer_name: "Customer",
      scope: "Sangfor security platform PoC and rollout",
      timeline: "8 weeks",
      amount: "TBD",
      product_name: "—",
      poc_title: "—",
      deployment_type: "—",
      hw_spec: "—",
      sw_spec: "—",
    });
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    expect(prisma.pocProject.findUnique).not.toHaveBeenCalled();
  });

  it("uses the resolved customer name when a customerId is given", async () => {
    const prisma = fakeProposalPrisma({ customer: { name: "Acme Corp" } });
    const vars = await buildVariables("cust-1", undefined, {}, { prisma });
    expect(vars.customer_name).toBe("Acme Corp");
  });

  it("falls back to 'Customer' when the customer lookup resolves null", async () => {
    const prisma = fakeProposalPrisma({ customer: null });
    const vars = await buildVariables("cust-missing", undefined, {}, { prisma });
    expect(vars.customer_name).toBe("Customer");
  });

  it("fills PoC-derived fields and lets poc.requirements override scope", async () => {
    const prisma = fakeProposalPrisma({
      poc: {
        title: "VDI Sizing",
        productName: "vDesk",
        deploymentType: "on-prem",
        hwSpec: "R730",
        swSpec: "vSphere 8",
        requirements: "24/7 uptime",
      },
    });
    const vars = await buildVariables(undefined, "poc-1", {}, { prisma });

    expect(vars.poc_title).toBe("VDI Sizing");
    expect(vars.product_name).toBe("vDesk");
    expect(vars.deployment_type).toBe("on-prem");
    expect(vars.hw_spec).toBe("R730");
    expect(vars.sw_spec).toBe("vSphere 8");
    expect(vars.scope).toBe("24/7 uptime");
  });

  it("lets extra overrides win over customer/poc-derived defaults", async () => {
    const prisma = fakeProposalPrisma({
      customer: { name: "Acme Corp" },
      poc: {
        title: "VDI Sizing",
        productName: "vDesk",
        deploymentType: "on-prem",
        hwSpec: "R730",
        swSpec: "vSphere 8",
        requirements: "24/7 uptime",
      },
    });
    const vars = await buildVariables("cust-1", "poc-1", { amount: "$50,000" }, { prisma });

    expect(vars.amount).toBe("$50,000");
    expect(vars.customer_name).toBe("Acme Corp");
    expect(vars.poc_title).toBe("VDI Sizing");
  });
});

describe("maybeEnhanceWithLlm", () => {
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });

  it("returns the body unchanged when OPENAI_API_KEY is unset", async () => {
    const result = await maybeEnhanceWithLlm("body text", "title");
    expect(result).toBe("body text");
  });

  it("appends the knowledge context when the key is set and context is resolved", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const result = await maybeEnhanceWithLlm("body text", "title", {
      buildContextPack: vi.fn().mockResolvedValue("some knowledge context"),
    });
    expect(result).toBe("body text\n\n## Knowledge context\n\nsome knowledge context");
  });

  it("returns the body unchanged when the key is set but context resolves null", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const result = await maybeEnhanceWithLlm("body text", "title", {
      buildContextPack: vi.fn().mockResolvedValue(null),
    });
    expect(result).toBe("body text");
  });

  it("returns the body unchanged when the context builder throws", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const result = await maybeEnhanceWithLlm("body text", "title", {
      buildContextPack: vi.fn().mockRejectedValue(new Error("boom")),
    });
    expect(result).toBe("body text");
  });
});
