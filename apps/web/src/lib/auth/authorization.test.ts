import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  userCompanyRoleFindMany: vi.fn(),
  projectMemberFindUnique: vi.fn(),
}));

vi.mock("@sangfor/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/db")>();
  return { ...actual, prisma: { ...actual.prisma,
    userCompanyRole: { findMany: prismaMocks.userCompanyRoleFindMany },
    projectMember: { findUnique: prismaMocks.projectMemberFindUnique },
  } };
});

import { INTERNAL_CONTEXT_HEADER, signInternalContext } from "@/lib/auth/persisted-session";
import { assertBusinessCapability, enforceRequestedCompany } from "./authorization";

function userJwtEnv(): Record<string, string> {
  const activatedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    USER_JWT_ACTIVE_KID: "authorization-test-key-1",
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_ISSUER: "sangfor-os",
    USER_JWT_AUDIENCE: "sangfor-os-runtime",
    USER_JWT_TTL_SECONDS: "900",
    USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_KEYRING_JSON: JSON.stringify({
      version: "sangfor.user-jwt-keyring/v1",
      keys: [
        {
          kid: "authorization-test-key-1",
          state: "active",
          secretBase64Url: Buffer.alloc(32, 9).toString("base64url"),
          activatedAt,
          demotedAt: null,
          verifyUntil: null,
          retiredAt: null,
        },
      ],
    }),
  };
}

function contextHeader(overrides: { userId?: string; tenantId?: string; companyId?: string; projectId?: string; mfaVerifiedAt?: Date | null } = {}) {
  return signInternalContext({
    ok: true,
    sessionId: "jti-test",
    userId: overrides.userId ?? "user-1",
    tenantId: overrides.tenantId ?? "tenant-1",
    companyId: overrides.companyId ?? "company-1",
    projectId: overrides.projectId ?? "project-1",
    mfaVerifiedAt: overrides.mfaVerifiedAt ?? null,
  });
}

function requestWithContext(overrides: Parameters<typeof contextHeader>[0] = {}, extraHeaders: Record<string, string> = {}) {
  return new Request("http://localhost/api/customers", {
    headers: { [INTERNAL_CONTEXT_HEADER]: contextHeader(overrides), ...extraHeaders },
  });
}

function companyRole(overrides: Record<string, unknown> = {}) {
  return {
    id: "ucr-1",
    userId: "user-1",
    companyId: "company-1",
    role: "sales_manager",
    status: "active",
    validFrom: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function projectAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pm-1",
    userId: "user-1",
    projectId: "project-1",
    status: "active",
    validFrom: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(userJwtEnv())) vi.stubEnv(key, value);
  prismaMocks.userCompanyRoleFindMany.mockResolvedValue([]);
  prismaMocks.projectMemberFindUnique.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertBusinessCapability — RED characterization", () => {
  it("denies (403) an unclassified route key", async () => {
    const response = await assertBusinessCapability(requestWithContext(), "apps/web/src/app/api/__unknown__/route.ts");
    expect(response?.status).toBe(403);
  });

  it("is a no-op when the internal-context header is absent (direct-call unit test premise, matches api-auth.ts)", async () => {
    const response = await assertBusinessCapability(new Request("http://localhost/api/customers"), "apps/web/src/app/api/customers/route.ts");
    expect(response).toBeNull();
    expect(prismaMocks.userCompanyRoleFindMany).not.toHaveBeenCalled();
  });

  it("ignores a forged businessRole/permissions field smuggled onto the request body — the header carries no role claim and the body is never read", async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([]);
    const request = new Request("http://localhost/api/customers", {
      method: "POST",
      headers: { [INTERNAL_CONTEXT_HEADER]: contextHeader(), "content-type": "application/json" },
      body: JSON.stringify({ role: "system_admin", businessRole: "system_admin", permissions: ["system.admin"] }),
    });
    const response = await assertBusinessCapability(request, "apps/web/src/app/api/customers/route.ts");
    expect(response?.status).toBe(403);
  });

  it.each(["legacy_pending" as const, null, "revoked" as const, "expired" as const])(
    "denies a %s company role",
    async (status) => {
      prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ status, revokedAt: status === "revoked" ? new Date() : null })]);
      const response = await assertBusinessCapability(requestWithContext(), "apps/web/src/app/api/customers/route.ts");
      expect(response?.status).toBe(403);
    },
  );

  it("denies zero active company roles", async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([]);
    const response = await assertBusinessCapability(requestWithContext(), "apps/web/src/app/api/customers/route.ts");
    expect(response?.status).toBe(403);
  });

  it("denies two simultaneously active, conflicting company roles as a configuration error", async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([
      companyRole({ id: "a", role: "sales_manager" }),
      companyRole({ id: "b", role: "ceo" }),
    ]);
    const response = await assertBusinessCapability(requestWithContext(), "apps/web/src/app/api/customers/route.ts");
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ reason: "MULTIPLE_ACTIVE_ROLES" });
  });

  it("denies an active role lacking the route's required capability", async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: "support_engineer" })]);
    const response = await assertBusinessCapability(requestWithContext(), "apps/web/src/app/api/customers/route.ts");
    expect(response?.status).toBe(403);
  });

  it("denies a company-mismatched active role (session companyId has no active row for this user)", async () => {
    prismaMocks.userCompanyRoleFindMany.mockImplementation(async ({ where }: { where: { companyId: string } }) =>
      where.companyId === "company-1" ? [] : [companyRole({ companyId: "company-2" })],
    );
    const response = await assertBusinessCapability(requestWithContext({ companyId: "company-1" }), "apps/web/src/app/api/customers/route.ts");
    expect(response?.status).toBe(403);
  });

  it.each([[null], ["legacy_pending" as const], ["expired" as const]])(
    "denies a project-assigned capability when ProjectMember is missing/%s",
    async (status) => {
      prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: "sales_manager" })]);
      prismaMocks.projectMemberFindUnique.mockResolvedValue(
        status === null ? null : projectAssignment({ status, expiresAt: status === "expired" ? new Date() : null }),
      );
      const response = await assertBusinessCapability(requestWithContext(), "apps/web/src/app/api/opportunities/route.ts");
      expect(response?.status).toBe(403);
      const expectedReason = status === "legacy_pending" || status === "expired" ? "PROJECT_ASSIGNMENT_INACTIVE" : "PROJECT_ASSIGNMENT_REQUIRED";
      await expect(response?.json()).resolves.toMatchObject({ reason: expectedReason });
    },
  );

  it("admits a project-assigned capability with active role and active ProjectMember", async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: "sales_manager" })]);
    prismaMocks.projectMemberFindUnique.mockResolvedValue(projectAssignment());
    const response = await assertBusinessCapability(requestWithContext(), "apps/web/src/app/api/opportunities/route.ts");
    expect(response).toBeNull();
  });

  it("denies a project-assigned capability with an active role but no active ProjectMember", async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: "sales_manager" })]);
    prismaMocks.projectMemberFindUnique.mockResolvedValue(null);
    const response = await assertBusinessCapability(requestWithContext(), "apps/web/src/app/api/customers/route.ts");
    expect(response?.status).toBe(403);
    expect(prismaMocks.projectMemberFindUnique).toHaveBeenCalled();
  });

  it("denies a privileged capability with no MFA evidence", async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: "system_admin" })]);
    const response = await assertBusinessCapability(requestWithContext({ mfaVerifiedAt: null }), "apps/web/src/app/api/mcp/tools/route.ts");
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ reason: "MFA_REQUIRED" });
  });

  it("denies a privileged capability with stale MFA evidence", async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: "system_admin" })]);
    const stale = new Date(Date.now() - (300 + 60) * 1000);
    const response = await assertBusinessCapability(requestWithContext({ mfaVerifiedAt: stale }), "apps/web/src/app/api/mcp/tools/route.ts");
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ reason: "MFA_STALE" });
  });

  it("admits a privileged capability with fresh MFA evidence", async () => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role: "system_admin" })]);
    const fresh = new Date(Date.now() - 5_000);
    const response = await assertBusinessCapability(requestWithContext({ mfaVerifiedAt: fresh }), "apps/web/src/app/api/mcp/tools/route.ts");
    expect(response).toBeNull();
  });

  it("admits the authenticated-only auth/logout route for any valid identity, without a company-role lookup", async () => {
    const response = await assertBusinessCapability(requestWithContext(), "apps/web/src/app/api/auth/logout/route.ts");
    expect(response).toBeNull();
    expect(prismaMocks.userCompanyRoleFindMany).not.toHaveBeenCalled();
  });

  it.each([
    "ceo",
    "sales_manager",
    "account_manager",
    "presales_engineer",
    "solution_architect",
    "finance_manager",
    "delivery_engineer",
    "support_engineer",
    "security_officer",
    "system_admin",
  ] as const)("positive fixture: %s can be activated as the sole active company role", async (role) => {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValue([companyRole({ role })]);
    const response = await assertBusinessCapability(requestWithContext(), "apps/web/src/app/api/customers/route.ts");
    expect(prismaMocks.userCompanyRoleFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1", companyId: "company-1" },
      select: expect.any(Object),
    });
    if (response) await expect(response.json()).resolves.not.toMatchObject({ reason: "NO_ACTIVE_ROLE" });
  });
});

describe("enforceRequestedCompany", () => {
  it("returns 403 for an explicit conflicting company id", () => {
    expect(enforceRequestedCompany("company-1", "company-2")?.status).toBe(403);
  });

  it("returns null for a matching or absent explicit company id", () => {
    expect(enforceRequestedCompany("company-1", "company-1")).toBeNull();
    expect(enforceRequestedCompany("company-1", undefined)).toBeNull();
  });
});
