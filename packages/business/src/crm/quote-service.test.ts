import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tx: null as Record<string, unknown> | null,
  appendAuditEvent: vi.fn(),
  createArtifactVersion: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  canonicalizeRfc8785: (value: unknown) => {
    const keys = Object.keys(value as object).sort();
    const sorted: Record<string, unknown> = {};
    for (const k of keys) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return JSON.stringify(sorted);
  },
  prisma: {},
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    Decimal: class {
      value: number;
      constructor(val: string | number) {
        this.value = typeof val === "string" ? parseFloat(val) : val;
      }
      toString() {
        return this.value.toFixed(2);
      }
      add(other: any) {
        return new (this as any).constructor(this.value + (typeof other === "string" ? parseFloat(other) : other.value ?? other));
      }
      sub(other: any) {
        return new (this as any).constructor(this.value - (typeof other === "string" ? parseFloat(other) : other.value ?? other));
      }
      mul(other: any) {
        return new (this as any).constructor(this.value * (typeof other === "string" ? parseFloat(other) : other.value ?? other));
      }
      div(other: any) {
        return new (this as any).constructor(this.value / (typeof other === "string" ? parseFloat(other) : other.value ?? other));
      }
      lessThan(other: any) {
        return this.value < (typeof other === "string" ? parseFloat(other) : other.value ?? other);
      }
      greaterThan(other: any) {
        return this.value > (typeof other === "string" ? parseFloat(other) : other.value ?? other);
      }
      toDecimalPlaces(places: number) {
        const factor = Math.pow(10, places);
        return new (this as any).constructor(Math.round(this.value * factor) / factor);
      }
    },
  },
  withRlsTransaction: vi.fn(async (_scope: unknown, callback: (tx: unknown) => Promise<unknown>) => {
    if (!harness.tx) throw new Error("test transaction is not configured");
    return callback(harness.tx);
  }),
}));

vi.mock("../governance/audit-db", () => ({
  appendAuditEvent: harness.appendAuditEvent,
}));

vi.mock("../governance/artifact-service", () => ({
  createArtifactVersion: harness.createArtifactVersion,
}));

import { createQuoteVersion, QuoteServiceError, type CreateQuoteVersionInput } from "./quote-service";

const SALES: AuthContext = {
  userId: "user-sales-1",
  sessionId: "session-1",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write", "quote.read", "quote.write", "quote.approve_discount"],
  product: "portal",
};

interface FakeTxState {
  opportunity: any;
  latestQuote: any | null;
  qualification: any;
  sku: any;
  sizingTemplate: any;
  compatRules: any[];
  licenseMetric: any | null;
  artifact: any;
  quoteLineItems: any[];
  commercialSnapshot: any;
}

function fakeTx(overrides: Partial<FakeTxState> = {}) {
  const state: FakeTxState = {
    opportunity: {
      id: "opp-a",
      projectId: "project-a",
      title: "Opportunity A",
      companyId: SALES.companyId,
    },
    latestQuote: null,
    qualification: {
      id: "qual-a",
      opportunityId: "opp-a",
      passed: true,
      scoringVersion: "bant-tf-v1",
      updatedAt: new Date("2026-07-24T00:00:00.000Z"),
    },
    sku: {
      id: "sku-a",
      skuCode: "SKU-001",
      name: "Product A",
      status: "active",
      unitPrice: 1000,
      unitCost: 500,
      edition: {
        id: "edition-a",
        editionKey: "standard",
        family: {
          id: "family-a",
          familyKey: "product-a",
          companyId: SALES.companyId,
        },
      },
    },
    sizingTemplate: {
      id: "sizing-a",
      productFamilyId: "family-a",
      status: "ACTIVE",
      activeArtifactVersion: {
        id: "artifact-sizing-v1",
        contentHash: "hash-sizing-v1",
      },
    },
    compatRules: [
      {
        id: "rule-1",
        sourceSkuId: "sku-a",
        status: "active",
        activeArtifactVersion: {
          id: "artifact-compat-v1",
          contentHash: "hash-compat-v1",
        },
      },
    ],
    licenseMetric: null,
    artifact: null,
    quoteLineItems: [],
    commercialSnapshot: null,
    ...overrides,
  };

  let quoteCounter = 0;

  const tx = {
    $executeRaw: vi.fn(async () => 1),
    opportunity: {
      findFirst: vi.fn(async () => state.opportunity),
    },
    dealQualification: {
      findFirst: vi.fn(async () => state.qualification),
    },
    userCompanyRole: {
      findFirst: vi.fn(async () => ({
        id: "ucr-sales-1",
        userId: SALES.userId,
        companyId: SALES.companyId,
        role: "ceo",
        status: "active",
      })),
    },
    quote: {
      findFirst: vi.fn(async () => state.latestQuote),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `quote-${++quoteCounter}`,
          ...data,
          createdAt: new Date("2026-07-24T00:00:00.000Z"),
        };
        return created;
      }),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(async ({ include }: { include?: Record<string, unknown> }) => {
        const result: Record<string, unknown> = {
          id: `quote-${quoteCounter}`,
          opportunityId: state.opportunity.id,
          companyId: SALES.companyId,
          status: "draft",
          version: 1,
          totalRevenue: { toString: () => "1000.00" },
          totalCost: { toString: () => "500.00" },
          marginPct: { toString: () => "50.00" },
          createdBy: SALES.userId,
          supersedesQuoteId: state.latestQuote?.id ?? null,
          contentHash: "hash-content",
          currency: "USD",
          artifactVersionId: "artifact-v1",
        };
        if (include?.lineItems) result.lineItems = state.quoteLineItems;
        if (include?.commercialSnapshot) result.commercialSnapshot = state.commercialSnapshot;
        if (include?.artifactVersion) result.artifactVersion = { id: "artifact-v1" };
        return result;
      }),
    },
    productSku: {
      findUnique: vi.fn(async () => state.sku),
    },
    sizingTemplate: {
      findFirst: vi.fn(async () => state.sizingTemplate),
    },
    compatibilityRule: {
      findMany: vi.fn(async () => state.compatRules),
    },
    licenseMetric: {
      findFirst: vi.fn(async () => state.licenseMetric),
    },
    artifact: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `artifact-${Date.now()}`,
        ...data,
      })),
      findUniqueOrThrow: vi.fn(async () => ({
        id: "artifact-existing",
        currentVersionId: "artifact-v0",
        currentRevision: 1,
      })),
    },
    artifactVersion: {
      findUnique: vi.fn(async () => ({
        id: "artifact-v0",
        artifactId: "artifact-existing",
        version: 1,
        contentHash: "hash-prev",
      })),
    },
    quoteLineItem: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const item = { id: `line-${Date.now()}`, ...data };
        state.quoteLineItems.push(item);
        return item;
      }),
      update: vi.fn(async ({ where, data }: { where: any; data: Record<string, unknown> }) => {
        const idx = state.quoteLineItems.findIndex((l) => l.id === where.id);
        if (idx >= 0) {
          state.quoteLineItems[idx] = { ...state.quoteLineItems[idx], ...data };
        }
        return state.quoteLineItems[idx] || { id: where.id, ...data };
      }),
    },
    quoteCommercialSnapshot: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.commercialSnapshot = { id: `snapshot-${Date.now()}`, ...data };
        return state.commercialSnapshot;
      }),
    },
  };

  return { tx, state };
}

describe("QuoteService Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fake = fakeTx();
    harness.tx = fake.tx;
    harness.appendAuditEvent.mockResolvedValue({ id: "audit-a", idempotent: false });
    harness.createArtifactVersion.mockResolvedValue({
      versionId: "artifact-v1",
      contentHash: "hash-content",
    });
  });

  it("defines QuoteServiceError with code and httpStatus", () => {
    const err = new QuoteServiceError("FORGED_INPUT_FORBIDDEN", "Forged input error", 422);
    expect(err.name).toBe("QuoteServiceError");
    expect(err.code).toBe("FORGED_INPUT_FORBIDDEN");
    expect(err.httpStatus).toBe(422);
    expect(err.message).toBe("Forged input error");
  });

  describe("input validation and security", () => {
    it("rejects when opportunity not found", async () => {
      const fake = fakeTx({ opportunity: null });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "missing-opp",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "NOT_FOUND",
        httpStatus: 404,
      });
    });

    it("rejects when opportunity belongs to a different project", async () => {
      const fake = fakeTx();
      fake.tx.opportunity.findFirst.mockResolvedValue(null);
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "NOT_FOUND",
        httpStatus: 404,
      });
    });

    it("rejects when deal qualification missing or failed", async () => {
      const fake = fakeTx({ qualification: null });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "QUALIFICATION_REQUIRED",
        httpStatus: 422,
      });
    });

    it("rejects when deal qualification has not passed", async () => {
      const fake = fakeTx({ qualification: { ...fakeTx().state.qualification, passed: false } });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "QUALIFICATION_REQUIRED",
        httpStatus: 422,
      });
    });

    it("rejects when deal qualification scoringVersion is not bant-tf-v1", async () => {
      const fake = fakeTx({
        qualification: { ...fakeTx().state.qualification, scoringVersion: "legacy-v0" },
      });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "QUALIFICATION_REQUIRED",
        httpStatus: 422,
      });
    });

    it("rejects stale expectedCurrentQuoteId (CAS check)", async () => {
      const fake = fakeTx({ latestQuote: { id: "quote-old-id", contentHash: "old-hash", version: 1 } });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        expectedCurrentQuoteId: "quote-different-id",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "STALE_CAS",
        httpStatus: 409,
      });
    });

    it("rejects stale expectedCurrentContentHash (CAS check)", async () => {
      const fake = fakeTx({ latestQuote: { id: "quote-current", contentHash: "old-hash", version: 1 } });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        expectedCurrentQuoteId: "quote-current",
        expectedCurrentContentHash: "different-hash",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "STALE_CAS",
        httpStatus: 409,
      });
    });

    it("requires at least one line item", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "LINES_REQUIRED",
        httpStatus: 400,
      });
    });

    it("rejects non-positive quantity", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 0, unitPrice: 100 }],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "INVALID_QUANTITY",
        httpStatus: 400,
      });
    });

    it("rejects discount percentage outside 0..100", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100, discountPct: 150 }],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "INVALID_DISCOUNT",
        httpStatus: 400,
      });
    });
  });

  describe("service line specific validation", () => {
    it("accepts service line with cost price and cost status", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 2,
            unitPrice: 100,
            costPrice: 50,
            sourceCostStatus: "confirmed",
          },
        ],
      };

      const result = await createQuoteVersion(SALES, input);
      expect(result.id).toBe("quote-1");
    });

    it("marks quote auto_failed when service line missing cost price", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 1,
            unitPrice: 100,
          },
        ],
      };

      const result = await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const createCall = (tx.quote.create as any).mock.calls[0];
      expect(createCall[0].data.status).toBe("draft");

      const snapshotCall = (tx.quoteCommercialSnapshot.create as any).mock.calls[0];
      expect(snapshotCall[0].data.costCoverageStatus).toBe("auto_failed");
    });

    it("sets requiresApproval=true when missing service line cost", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 1,
            unitPrice: 100,
          },
        ],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const snapshotCall = (tx.quoteCommercialSnapshot.create as any).mock.calls[0];
      expect(snapshotCall[0].data.requiresApproval).toBe(true);
    });
  });

  describe("product line specific validation", () => {
    it("rejects product line without skuId", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "product" as const,
            quantity: 1,
            unitPrice: 1000,
          },
        ],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "SKU_REQUIRED",
        httpStatus: 400,
      });
    });

    it("rejects archived or non-existent SKU", async () => {
      const fake = fakeTx({ sku: null });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "product" as const,
            quantity: 1,
            skuId: "missing-sku",
          },
        ],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "SKU_INACTIVE",
        httpStatus: 400,
      });
    });

    it("rejects inactive SKU", async () => {
      const fake = fakeTx({
        sku: {
          ...fakeTx().state.sku,
          status: "archived",
        },
      });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "product" as const,
            quantity: 1,
            skuId: "sku-a",
          },
        ],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "SKU_INACTIVE",
        httpStatus: 400,
      });
    });

    it("rejects foreign-company SKU selection", async () => {
      const fake = fakeTx();
      fake.state.sku.edition.family.companyId = "company-foreign";
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "product" as const,
            quantity: 1,
            skuId: "sku-a",
          },
        ],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "FORBIDDEN",
        httpStatus: 403,
      });
    });

    it("rejects product line when no active sizing rule exists", async () => {
      const fake = fakeTx({ sizingTemplate: null });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "product" as const,
            quantity: 1,
            skuId: "sku-a",
          },
        ],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "ACTIVE_SIZING_RULE_REQUIRED",
        httpStatus: 422,
      });
    });

    it("rejects product line when sizing rule has no active artifact version", async () => {
      const fake = fakeTx({
        sizingTemplate: { id: "sizing-a", status: "ACTIVE", activeArtifactVersion: null },
      });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "product" as const,
            quantity: 1,
            skuId: "sku-a",
          },
        ],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "ACTIVE_SIZING_RULE_REQUIRED",
        httpStatus: 422,
      });
    });

    it("rejects product line when no active compatibility rules found (fail-closed guard)", async () => {
      const fake = fakeTx({
        compatRules: [],
      });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "product" as const,
            quantity: 1,
            skuId: "sku-a",
          },
        ],
      };

      await expect(createQuoteVersion(SALES, input)).rejects.toMatchObject({
        code: "COMPATIBILITY_REQUIRED",
        httpStatus: 422,
      });
    });

    it("accepts product line with valid SKU and active sizing", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "product" as const,
            quantity: 1,
            skuId: "sku-a",
          },
        ],
      };

      const result = await createQuoteVersion(SALES, input);
      expect(result.id).toBe("quote-1");
    });

    it("accepts product with termMonths for subscription model", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "product" as const,
            quantity: 1,
            skuId: "sku-a",
            termMonths: 24,
          },
        ],
      };

      const result = await createQuoteVersion(SALES, input);
      expect(result.id).toBe("quote-1");
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const lineCall = (tx.quoteLineItem.create as any).mock.calls[0];
      expect(lineCall[0].data.termMonths).toBe(24);
    });
  });

  describe("financial calculations", () => {
    it("computes revenue as quantity * unitPrice * (1 - discountPct/100)", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 2,
            unitPrice: 100,
            discountPct: 10,
            costPrice: 50,
            sourceCostStatus: "confirmed",
          },
        ],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const lineCall = (tx.quoteLineItem.create as any).mock.calls[0];
      expect(parseFloat(lineCall[0].data.revenue.toString())).toBe(180);
    });

    it("computes cost as quantity * costPrice", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 2,
            unitPrice: 100,
            costPrice: 50,
            sourceCostStatus: "confirmed",
          },
        ],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const lineCall = (tx.quoteLineItem.create as any).mock.calls[0];
      expect(parseFloat(lineCall[0].data.cost.toString())).toBe(100);
    });

    it("computes margin percentage correctly", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 2,
            unitPrice: 100,
            discountPct: 10,
            costPrice: 50,
            sourceCostStatus: "confirmed",
          },
        ],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const lineCall = (tx.quoteLineItem.create as any).mock.calls[0];
      const marginPct = parseFloat(lineCall[0].data.marginPct.toString());
      expect(marginPct).toBeGreaterThan(44);
      expect(marginPct).toBeLessThan(45);
    });

    it("sets requiresApproval=true when total margin < 15%", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 1,
            unitPrice: 90,
            costPrice: 80,
            sourceCostStatus: "confirmed",
          },
        ],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const snapshotCall = (tx.quoteCommercialSnapshot.create as any).mock.calls[0];
      expect(snapshotCall[0].data.requiresApproval).toBe(true);
    });

    it("sets requiresApproval=false when total margin >= 15%", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 1,
            unitPrice: 100,
            costPrice: 80,
            sourceCostStatus: "confirmed",
          },
        ],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const snapshotCall = (tx.quoteCommercialSnapshot.create as any).mock.calls[0];
      expect(snapshotCall[0].data.requiresApproval).toBe(false);
    });
  });

  describe("decimal precision", () => {
    it("maintains exact decimal precision in revenue calculation (0.1 + 0.2)", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 1,
            unitPrice: 0.1,
            costPrice: 0.05,
            sourceCostStatus: "confirmed",
          },
          {
            lineType: "service" as const,
            quantity: 1,
            unitPrice: 0.2,
            costPrice: 0.1,
            sourceCostStatus: "confirmed",
          },
        ],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const snapshotCall = (tx.quoteCommercialSnapshot.create as any).mock.calls[0];
      const totalRevenue = parseFloat(snapshotCall[0].data.calculatedRevenue.toString());
      expect(totalRevenue).toBe(0.3);
    });
  });

  describe("compatibility and artifact handling", () => {
    it("sorts compatibility artifact versions by ID ascending", async () => {
      const fake = fakeTx({
        compatRules: [
          {
            id: "rule-3",
            sourceSkuId: "sku-a",
            status: "ACTIVE",
            activeArtifactVersion: { id: "compat-v3", contentHash: "hash-v3" },
          },
          {
            id: "rule-1",
            sourceSkuId: "sku-a",
            status: "ACTIVE",
            activeArtifactVersion: { id: "compat-v1", contentHash: "hash-v1" },
          },
          {
            id: "rule-2",
            sourceSkuId: "sku-a",
            status: "ACTIVE",
            activeArtifactVersion: { id: "compat-v2", contentHash: "hash-v2" },
          },
        ],
      });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "product" as const, quantity: 1, skuId: "sku-a" }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const lineCall = (tx.quoteLineItem.create as any).mock.calls[0];
      const compatIds = lineCall[0].data.compatibilityArtifactVersionIds;
      expect(compatIds).toEqual(["compat-v1", "compat-v2", "compat-v3"]);
    });

    it("creates artifact via createArtifactVersion with proper scope", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await createQuoteVersion(SALES, input);
      expect(harness.createArtifactVersion).toHaveBeenCalled();
      const call = (harness.createArtifactVersion as any).mock.calls[0];
      expect(call[0]).toMatchObject({
        expectedCurrentVersionId: null,
        expectedCurrentRevision: 0,
        contentType: "application/json",
      });
    });

    it("reuses existing artifact for successor quote versions", async () => {
      const fake = fakeTx({
        latestQuote: {
          id: "quote-v1",
          version: 1,
          contentHash: "hash-v1",
          artifactVersionId: "artifact-v0",
        },
      });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        expectedCurrentQuoteId: "quote-v1",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      expect(tx.artifactVersion.findUnique).toHaveBeenCalledWith({
        where: { id: "artifact-v0" },
        select: { artifactId: true },
      });
      expect(tx.artifact.findUniqueOrThrow).toHaveBeenCalled();
      expect(tx.artifact.create).not.toHaveBeenCalled();
      const call = (harness.createArtifactVersion as any).mock.calls[0];
      expect(call[0]).toMatchObject({
        artifactId: "artifact-existing",
        expectedCurrentVersionId: "artifact-v0",
        expectedCurrentRevision: 1,
      });
    });

    it("appends audit event with full quote details", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 1,
            unitPrice: 100,
            costPrice: 50,
            sourceCostStatus: "confirmed",
          },
        ],
      };

      await createQuoteVersion(SALES, input);
      expect(harness.appendAuditEvent).toHaveBeenCalled();
      const call = (harness.appendAuditEvent as any).mock.calls[0];
      expect(call[1]).toMatchObject({
        eventType: "quote.version_created",
        resourceType: "Quote",
        details: expect.objectContaining({
          version: 1,
          costCoverageStatus: "complete",
        }),
      });
    });
  });

  describe("quote versioning and editing", () => {
    it("creates new quote with version number incremented from latest", async () => {
      const fake = fakeTx({ latestQuote: { id: "quote-old", version: 2, contentHash: "hash-old" } });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const createCall = (tx.quote.create as any).mock.calls[0];
      expect(createCall[0].data.version).toBe(3);
    });

    it("links new quote to previous via supersedesQuoteId", async () => {
      const fake = fakeTx({ latestQuote: { id: "quote-v1", version: 1, contentHash: "hash-v1" } });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        expectedCurrentQuoteId: "quote-v1",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const createCall = (tx.quote.create as any).mock.calls[0];
      expect(createCall[0].data.supersedesQuoteId).toBe("quote-v1");
    });

    it("never calls tx.quote.update on predecessor when editing", async () => {
      const fake = fakeTx({ latestQuote: { id: "quote-old", version: 1 } });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        expectedCurrentQuoteId: "quote-old",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      expect((tx.quote.update as any).mock.calls).toHaveLength(0);
    });

    it("uses previous quote currency as default if currency not specified", async () => {
      const fake = fakeTx({ latestQuote: { id: "quote-old", version: 1, currency: "EUR" } });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const createCall = (tx.quote.create as any).mock.calls[0];
      expect(createCall[0].data.currency).toBe("EUR");
    });

    it("defaults to USD currency when no previous quote and no explicit currency", async () => {
      const fake = fakeTx({ latestQuote: null });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const createCall = (tx.quote.create as any).mock.calls[0];
      expect(createCall[0].data.currency).toBe("USD");
    });
  });

  describe("fulfillment snapshots", () => {
    it("creates fulfillment snapshot for service line without SKU", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 1,
            unitPrice: 100,
            costPrice: 50,
            sourceCostStatus: "confirmed",
          },
        ],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const lineCall = (tx.quoteLineItem.create as any).mock.calls[0];
      const snapshot = lineCall[0].data.fulfillmentSnapshot;
      expect(snapshot.source.lineType).toBe("service");
      expect(snapshot.source.skuId).toBeNull();
      expect(snapshot.catalog).toMatchObject({
        catalogSnapshotVersion: null,
        productFamilyId: null,
        skuId: null,
      });
    });

    it("creates fulfillment snapshot for product line with catalog snapshot", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "product" as const, quantity: 1, skuId: "sku-a" }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const lineCall = (tx.quoteLineItem.create as any).mock.calls[0];
      const snapshot = lineCall[0].data.fulfillmentSnapshot;
      expect(snapshot.source.lineType).toBe("product");
      expect(snapshot.source.skuId).toBe("sku-a");
      expect(snapshot.catalog.catalogSnapshotVersion).toBe("quote-line-catalog/v1");
      expect(snapshot.catalog.productFamilyId).toBe("family-a");
      expect(snapshot.catalog.skuId).toBe("sku-a");
    });

    it("fulfillmentSnapshotHash is NULL on INSERT (computed by U035 trigger)", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const lineCall = (tx.quoteLineItem.create as any).mock.calls[0];
      expect(lineCall[0].data.fulfillmentSnapshotHash).toBeUndefined();
    });

    it("fulfillmentSnapshot contains actual quote/line IDs on INSERT (pre-generated)", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const quoteCall = (tx.quote.create as any).mock.calls[0];
      const lineCall = (tx.quoteLineItem.create as any).mock.calls[0];
      const snapshot = lineCall[0].data.fulfillmentSnapshot;
      expect(snapshot.source.quoteId).toBe(quoteCall[0].data.id);
      expect(snapshot.source.quoteLineItemId).toBeTruthy();
      expect(snapshot.source.quoteLineItemId).toEqual(lineCall[0].data.id);
    });
  });

  describe("commercial snapshot", () => {
    it("creates quoteCommercialSnapshot with aggregated financial data", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 1,
            unitPrice: 100,
            costPrice: 50,
            sourceCostStatus: "confirmed",
          },
        ],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const snapshotCall = (tx.quoteCommercialSnapshot.create as any).mock.calls[0];
      expect(snapshotCall[0].data).toMatchObject({
        policyVersion: "v1",
        thresholdMarginPct: expect.any(Object),
        calculatedRevenue: expect.any(Object),
        calculatedCost: expect.any(Object),
        calculatedMarginPct: expect.any(Object),
      });
    });

    it("computes snapshotHash for commercial snapshot", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "service" as const, quantity: 1, unitPrice: 100 }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const snapshotCall = (tx.quoteCommercialSnapshot.create as any).mock.calls[0];
      expect(snapshotCall[0].data.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("license metric handling", () => {
    it("includes license metric snapshot when product has associated metric", async () => {
      const fake = fakeTx({
        licenseMetric: { id: "metric-a", key: "seats", name: "Seats" },
      });
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [{ lineType: "product" as const, quantity: 1, skuId: "sku-a" }],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const lineCall = (tx.quoteLineItem.create as any).mock.calls[0];
      expect(lineCall[0].data.licenseMetricId).toBe("metric-a");
      expect(lineCall[0].data.licenseMetricKey).toBe("seats");
      expect(lineCall[0].data.licenseMetricSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("multiple line aggregation", () => {
    it("sums revenue across all lines", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          {
            lineType: "service" as const,
            quantity: 1,
            unitPrice: 100,
            costPrice: 50,
            sourceCostStatus: "confirmed",
          },
          {
            lineType: "service" as const,
            quantity: 1,
            unitPrice: 50,
            costPrice: 20,
            sourceCostStatus: "confirmed",
          },
        ],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      const snapshotCall = (tx.quoteCommercialSnapshot.create as any).mock.calls[0];
      const totalRev = parseFloat(snapshotCall[0].data.calculatedRevenue.toString());
      expect(totalRev).toBe(150);
    });

    it("creates separate line items for each input line", async () => {
      const fake = fakeTx();
      harness.tx = fake.tx;

      const input: CreateQuoteVersionInput = {
        opportunityId: "opp-a",
        lines: [
          { lineType: "service" as const, quantity: 1, unitPrice: 100 },
          { lineType: "service" as const, quantity: 2, unitPrice: 50 },
          { lineType: "service" as const, quantity: 1, unitPrice: 75 },
        ],
      };

      await createQuoteVersion(SALES, input);
      const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
      expect((tx.quoteLineItem.create as any).mock.calls).toHaveLength(3);
    });
  });
});
