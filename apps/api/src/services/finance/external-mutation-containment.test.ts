import { createServer } from "node:http";

import express, { type Express } from "express";
import { createDevelopmentAuthContext, type BusinessRole } from "@sangfor/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  popbillConstructor: vi.fn(),
  popbillIssue: vi.fn(),
  codefConstructor: vi.fn(),
  codefConnect: vi.fn(),
  financeAccountCreate: vi.fn(),
  financeAccountFind: vi.fn(),
  taxInvoiceCreate: vi.fn(),
  invoiceCreate: vi.fn(),
}));
const IDENTITY_FIELDS = [
  "approvedBy", "actorId", "requestedBy", "requester", "approver", "approverId", "approverPersonaId", "personaId",
] as const;
const DIRECT_CONFLICT_CASES = IDENTITY_FIELDS.flatMap((field) => [
  [`${field} root`, { [field]: "caller-spoof" }],
  [`${field} nested`, { nested: { [field]: "caller-spoof" } }],
  [`${field} array`, { nested: [{ [field]: "caller-spoof" }] }],
] as const);

vi.mock("@sangfor/db", () => ({
  prisma: {
    financeAccount: {
      create: spies.financeAccountCreate,
      findUnique: spies.financeAccountFind,
      findMany: vi.fn(),
    },
    taxInvoice: {
      create: spies.taxInvoiceCreate,
      update: vi.fn(),
      findMany: vi.fn(),
    },
    companySettings: { findUnique: vi.fn() },
  },
}));

vi.mock("./index", () => {
  class EmptyService {}
  class InvoicesService {
    create(body: unknown): Promise<unknown> {
      spies.invoiceCreate(body);
      return Promise.resolve({ ok: true });
    }
  }
  class PopbillService {
    constructor() {
      spies.popbillConstructor();
    }
    issue(): Promise<{ readonly ok: true }> {
      spies.popbillIssue();
      return Promise.resolve({ ok: true });
    }
  }
  class CodefService {
    constructor() {
      spies.codefConstructor();
    }
    connectAccount(): Promise<{ readonly ok: true }> {
      spies.codefConnect();
      return Promise.resolve({ ok: true });
    }
  }
  return {
    DashboardService: EmptyService,
    InvoicesService,
    ExpensesService: EmptyService,
    CashflowsService: EmptyService,
    SubscriptionsService: EmptyService,
    LedgerService: EmptyService,
    ProjectsService: EmptyService,
    MonthCloseService: EmptyService,
    VatService: EmptyService,
    PopbillService,
    CodefService,
    ChatbotService: EmptyService,
    NotionSyncService: EmptyService,
    HealthService: EmptyService,
  };
});

vi.mock("./tax-invoice-inbound.service", () => ({ ingestSecureMailHtml: vi.fn() }));
vi.mock("./tax-invoice-issue.service", () => ({
  issueSalesTaxInvoice: vi.fn(),
  markTransmitted: vi.fn(),
}));
vi.mock("./company-settings.service", () => ({ setCompanySettings: vi.fn() }));

import { createCfoRoutes } from "../../routes/cfo";
import { CodefService as RealCodefService } from "./codef.service";
import { PopbillService as RealPopbillService } from "./popbill.service";

type HttpResult = {
  readonly status: number;
  readonly body: string;
};

function createCfoApp(role: BusinessRole, principalId = "server-principal"): Express {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const authContext = createDevelopmentAuthContext({ userId: principalId, businessRole: role });
    request.authContext = authContext;
    request.user = {
      id: authContext.userId,
      email: authContext.userId,
      role: authContext.businessRole,
      authContext,
    };
    next();
  });
  app.use(createCfoRoutes());
  return app;
}

async function postPopbillIssue(app: Express, body: Readonly<Record<string, unknown>>): Promise<HttpResult> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Expected an ephemeral TCP listener");
  }
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/popbill/issue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.text() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postInvoice(app: Express, body: unknown): Promise<HttpResult> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Expected an ephemeral listener");
  }
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.text() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("finance external mutation containment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spies.financeAccountCreate.mockResolvedValue({ id: "account-1" });
    spies.financeAccountFind.mockResolvedValue({ id: "account-1", accountName: "fixture" });
    spies.taxInvoiceCreate.mockResolvedValue({ id: "invoice-1" });
    spies.invoiceCreate.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 403 for a non-operator before constructing the Popbill adapter", async () => {
    // Given: an authenticated finance manager calls an external mutation route.
    const app = createCfoApp("finance_manager");

    // When: Popbill issuance is requested.
    const result = await postPopbillIssue(app, {});

    // Then: authorization fails before adapter construction or invocation.
    expect(result.status).toBe(403);
    expect(spies.popbillConstructor).toHaveBeenCalledTimes(0);
    expect(spies.popbillIssue).toHaveBeenCalledTimes(0);
  });

  it("rejects a conflicting caller identity before constructing the Popbill adapter", async () => {
    // Given: an operator request spoofs a different approver.
    const app = createCfoApp("system_admin", "server-operator");

    // When: the conflicting identity reaches the mutation route.
    const result = await postPopbillIssue(app, { approvedBy: "caller-spoof" });

    // Then: the transport returns the identity conflict and calls no adapter.
    expect(result.status).toBe(400);
    expect(result.body).toBe('{"error":"IDENTITY_CONFLICT"}');
    expect(spies.popbillConstructor).toHaveBeenCalledTimes(0);
    expect(spies.popbillIssue).toHaveBeenCalledTimes(0);
  });

  it("contains an operator Popbill request before adapter construction", async () => {
    // Given: a valid server-derived operator context and external credentials.
    vi.stubEnv("POPBILL_LINK_ID", "u002-popbill-link");
    vi.stubEnv("POPBILL_SECRET_KEY", "u002-popbill-secret");
    const app = createCfoApp("system_admin", "server-operator");

    // When: Popbill issuance is requested without caller identity fields.
    const result = await postPopbillIssue(app, {});

    // Then: default containment returns 403 and constructs/calls nothing external.
    expect(result.status).toBe(403);
    expect(result.body).toBe('{"error":"EXTERNAL_MUTATION_CONTAINED"}');
    expect(spies.popbillConstructor).toHaveBeenCalledTimes(0);
    expect(spies.popbillIssue).toHaveBeenCalledTimes(0);
  });

  it("contains direct CODEF account mutation before Prisma", async () => {
    // Given: a configured CODEF service.
    vi.stubEnv("CODEF_CLIENT_ID", "u002-codef-client");
    vi.stubEnv("CODEF_CLIENT_SECRET", "u002-codef-secret");
    const service = new RealCodefService();

    // When: an account connection is attempted directly.
    const operation = service.connectAccount({
      type: "bank",
      organization: "fixture-bank",
      accountName: "fixture-account",
    });

    // Then: containment rejects before any persistence call.
    await expect(operation).rejects.toMatchObject({ code: "EXTERNAL_MUTATION_CONTAINED" });
    expect(spies.financeAccountCreate).toHaveBeenCalledTimes(0);
  });

  it("contains direct Popbill issuance before Prisma", async () => {
    // Given: a configured Popbill service and valid invoice payload.
    vi.stubEnv("POPBILL_LINK_ID", "u002-popbill-link");
    vi.stubEnv("POPBILL_SECRET_KEY", "u002-popbill-secret");
    const service = new RealPopbillService();

    // When: issuance is attempted directly.
    const operation = service.issue({
      direction: "sales",
      supplierCorpNum: "1111111111",
      supplierName: "Supplier",
      buyerCorpNum: "2222222222",
      buyerName: "Buyer",
      supplyAmount: 100,
      vatAmount: 10,
      totalAmount: 110,
      issueDate: new Date("2026-07-18T00:00:00.000Z"),
      items: [{ name: "item", qty: 1, unitPrice: 100, amount: 100 }],
    });

    // Then: containment rejects before persistence or an SDK call.
    await expect(operation).rejects.toMatchObject({ code: "EXTERNAL_MUTATION_CONTAINED" });
    expect(spies.taxInvoiceCreate).toHaveBeenCalledTimes(0);
  });

  it.each(DIRECT_CONFLICT_CASES)("rejects conflicting %s at the direct finance boundary", async (_label, body) => {
    const result = await postInvoice(createCfoApp("system_admin", "server-operator"), body);

    expect(result.status).toBe(400);
    expect(result.body).toBe('{"error":"IDENTITY_CONFLICT"}');
    expect(spies.invoiceCreate).toHaveBeenCalledTimes(0);
  });

  it("strips all equal caller identities before direct finance dispatch", async () => {
    const body = {
      approvedBy: "server-operator",
      nested: {
        actorId: "server-operator",
        requestedBy: "server-operator",
        values: [
          { requester: "server-operator", approver: "server-operator" },
          { approverId: "server-operator", approverPersonaId: "server-operator", personaId: "server-operator" },
        ],
      },
      keep: "value",
    };
    const result = await postInvoice(createCfoApp("system_admin", "server-operator"), body);

    expect(result.status).toBe(200);
    expect(spies.invoiceCreate).toHaveBeenCalledWith({ keep: "value", nested: { values: [{}, {}] } });
  });
});
