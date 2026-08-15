import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  listScoped: vi.fn(),
  resolveContext: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  assertApiAccess: mocks.assertApiAccess,
  apiError: vi.fn(),
}));
vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: mocks.evaluateSession,
}));
vi.mock("@/lib/auth/authorization", () => ({
  assertBusinessCapability: vi.fn(),
}));
vi.mock("@sangfor/business", () => ({
  resolveCrmAuthContext: mocks.resolveContext,
}));
vi.mock("@sangfor/business/mail-candidates", () => ({
  generateMailDerivedCandidates: vi.fn(),
  generateMailDerivedCandidatesHybrid: vi.fn(),
  listScopedMailDerivedCandidates: mocks.listScoped,
}));

import { GET } from "./route";

const SALES = {
  userId: "user-1",
  sessionId: "session-1",
  tenantId: "tenant-1",
  companyId: "company-1",
  projectId: "project-1",
  businessRole: "sales_manager",
  permissions: ["customer.read"],
  product: "portal",
} satisfies AuthContext;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.evaluateSession.mockResolvedValue({
    ok: true,
    userId: SALES.userId,
    tenantId: SALES.tenantId,
    companyId: SALES.companyId,
    projectId: SALES.projectId,
  });
  mocks.resolveContext.mockResolvedValue(SALES);
  mocks.listScoped.mockResolvedValue([{ id: "candidate-1" }]);
});

describe("GET /api/mail-candidates", () => {
  it("lists candidates through server-derived scoped authority", async () => {
    const response = await GET(
      new Request("http://localhost/api/mail-candidates?status=proposed&limit=20"),
    );

    expect(response.status).toBe(200);
    expect(mocks.listScoped).toHaveBeenCalledWith(SALES, {
      status: "proposed",
      candidateType: undefined,
      limit: 20,
    });
  });

  it("returns unauthorized without reading candidates", async () => {
    mocks.evaluateSession.mockResolvedValueOnce({ ok: false });

    const response = await GET(
      new Request("http://localhost/api/mail-candidates"),
    );

    expect(response.status).toBe(401);
    expect(mocks.listScoped).not.toHaveBeenCalled();
  });
});
