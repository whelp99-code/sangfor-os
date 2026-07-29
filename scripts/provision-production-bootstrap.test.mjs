import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { provisionProductionBootstrap, validateProductionBootstrapConfig } from "./provision-production-bootstrap.mjs";

function validEnvironment() {
  return {
    DEFAULT_TENANT_ID: "tenant-prod",
    DEFAULT_TENANT_SLUG: "tenant-prod",
    DEFAULT_COMPANY_ID: "company-prod",
    DEFAULT_COMPANY_SLUG: "company-prod",
    DEFAULT_PROJECT_ID: "project-prod",
    DEFAULT_PROJECT_SLUG: "project-prod",
    PRODUCTION_OPERATOR_USER_ID: "operator-prod",
    PRODUCTION_OPERATOR_EMAIL: "operator-prod@production.sangfor.com",
  };
}

function fakeDatabase(seed = {}, transactionErrors = []) {
  const calls = [];
  const record = (model, operation, handler) => async (arguments_) => {
    calls.push({ model, operation, arguments: arguments_ });
    return handler(arguments_);
  };
  const value = (key) => (arguments_) => {
    if (key === "tenantById") return "id" in arguments_.where ? seed.tenantById ?? null : seed.tenantBySlug ?? null;
    if (key === "companyById") return seed.companyById ?? null;
    if (key === "companiesBySlug") return seed.companiesBySlug ?? [];
    if (key === "projectById") return "id" in arguments_.where ? seed.projectById ?? null : seed.projectBySlug ?? null;
    if (key === "operatorById") return "id" in arguments_.where ? seed.operatorById ?? null : seed.operatorByEmail ?? null;
    return seed[key] ?? null;
  };
  const transaction = {
    tenant: { findUnique: record("tenant", "findUnique", value("tenantById")), create: record("tenant", "create", (arguments_) => arguments_.data) },
    company: { findUnique: record("company", "findUnique", value("companyById")), findMany: record("company", "findMany", value("companiesBySlug")), create: record("company", "create", (arguments_) => arguments_.data) },
    project: { findUnique: record("project", "findUnique", value("projectById")), create: record("project", "create", (arguments_) => arguments_.data) },
    user: { findUnique: record("user", "findUnique", value("operatorById")), create: record("user", "create", (arguments_) => arguments_.data) },
    userCompanyRole: { findUnique: record("userCompanyRole", "findUnique", value("existingRole")), create: record("userCompanyRole", "create", (arguments_) => arguments_.data) },
    projectMember: { findUnique: record("projectMember", "findUnique", value("existingMembership")), create: record("projectMember", "create", (arguments_) => arguments_.data) },
  };
  return {
    calls,
    database: {
      async $transaction(callback) {
        calls.push({ model: "$transaction", operation: "start" });
        const error = transactionErrors.shift();
        if (error) throw error;
        return callback(transaction);
      },
    },
  };
}

describe("production bootstrap provisioner", () => {
  it("rejects unsafe bootstrap identities before any database work", () => {
    assert.throws(() => validateProductionBootstrapConfig({ ...validEnvironment(), DEFAULT_TENANT_SLUG: "replace-me" }), /DEFAULT_TENANT_SLUG: placeholder/u);
    assert.throws(() => validateProductionBootstrapConfig({ ...validEnvironment(), PRODUCTION_OPERATOR_EMAIL: "Operator@Sangfor.invalid" }), /canonical lowercase/u);
    assert.throws(() => validateProductionBootstrapConfig({ ...validEnvironment(), PRODUCTION_OPERATOR_EMAIL: "operator-prod@sangfor.invalid" }), /reserved email domain/u);
    assert.throws(() => validateProductionBootstrapConfig({ ...validEnvironment(), PRODUCTION_OPERATOR_USER_ID: "bad value" }), /invalid identifier/u);
  });

  it("creates the exact active hierarchy and operator assignments in one transaction", async () => {
    const config = validateProductionBootstrapConfig(validEnvironment());
    const fake = fakeDatabase();
    const activeFrom = new Date("2026-07-29T00:00:00.000Z");

    assert.deepEqual(await provisionProductionBootstrap(config, fake.database, { now: () => activeFrom }), { ok: true });
    assert.equal(fake.calls.filter((call) => call.model === "$transaction").length, 1);
    assert.deepEqual(fake.calls.filter((call) => call.operation === "create").map((call) => [call.model, call.arguments.data]), [
      ["tenant", { id: "tenant-prod", slug: "tenant-prod", name: "Production Tenant", status: "active" }],
      ["company", { id: "company-prod", tenantId: "tenant-prod", slug: "company-prod", name: "Production Company" }],
      ["project", { id: "project-prod", companyId: "company-prod", slug: "project-prod", name: "Production Project", description: "Production bootstrap project" }],
      ["user", { id: "operator-prod", email: "operator-prod@production.sangfor.com", name: "Production Operator", status: "active", disabledAt: null, disabledReason: null }],
      ["userCompanyRole", { userId: "operator-prod", companyId: "company-prod", role: "system_admin", status: "active", validFrom: activeFrom, expiresAt: null, revokedAt: null }],
      ["projectMember", { projectId: "project-prod", userId: "operator-prod", role: "member", status: "active", validFrom: activeFrom, expiresAt: null, revokedAt: null }],
    ]);
    assert.equal(fake.calls.some((call) => call.model === "userCredential"), false);
  });

  it("fails closed on an identity collision before any mutation", async () => {
    const fake = fakeDatabase({ tenantById: { id: "tenant-prod", slug: "other-tenant", status: "active" } });

    await assert.rejects(
      provisionProductionBootstrap(validateProductionBootstrapConfig(validEnvironment()), fake.database),
      /tenant ID or slug belongs to a different tenant/u,
    );
    assert.equal(fake.calls.some((call) => call.operation === "create"), false);
  });

  it("is idempotent only when every existing production identity is exact and active", async () => {
    const config = validateProductionBootstrapConfig(validEnvironment());
    const activeFrom = new Date("2026-07-29T00:00:00.000Z");
    const fake = fakeDatabase({
      tenantById: { id: config.tenantId, slug: config.tenantSlug, status: "active" },
      tenantBySlug: { id: config.tenantId, slug: config.tenantSlug, status: "active" },
      companyById: { id: config.companyId, tenantId: config.tenantId, slug: config.companySlug },
      companiesBySlug: [{ id: config.companyId, tenantId: config.tenantId, slug: config.companySlug }],
      projectById: { id: config.projectId, companyId: config.companyId, slug: config.projectSlug },
      projectBySlug: { id: config.projectId, companyId: config.companyId, slug: config.projectSlug },
      operatorById: { id: config.operatorUserId, email: config.operatorEmail, status: "active", disabledAt: null },
      operatorByEmail: { id: config.operatorUserId, email: config.operatorEmail, status: "active", disabledAt: null },
      existingRole: { status: "active", validFrom: activeFrom, expiresAt: null, revokedAt: null },
      existingMembership: { status: "active", validFrom: activeFrom, expiresAt: null, revokedAt: null },
    });

    assert.deepEqual(await provisionProductionBootstrap(config, fake.database, { now: () => activeFrom }), { ok: true });
    assert.equal(fake.calls.some((call) => call.operation === "create"), false);
  });

  it("retries a P2034 conflict and revalidates an exact committed state", async () => {
    const config = validateProductionBootstrapConfig(validEnvironment());
    const activeFrom = new Date("2026-07-29T00:00:00.000Z");
    const fake = fakeDatabase({
      tenantById: { id: config.tenantId, slug: config.tenantSlug, status: "active" }, tenantBySlug: { id: config.tenantId, slug: config.tenantSlug, status: "active" },
      companyById: { id: config.companyId, tenantId: config.tenantId, slug: config.companySlug }, companiesBySlug: [{ id: config.companyId, tenantId: config.tenantId, slug: config.companySlug }],
      projectById: { id: config.projectId, companyId: config.companyId, slug: config.projectSlug }, projectBySlug: { id: config.projectId, companyId: config.companyId, slug: config.projectSlug },
      operatorById: { id: config.operatorUserId, email: config.operatorEmail, status: "active", disabledAt: null }, operatorByEmail: { id: config.operatorUserId, email: config.operatorEmail, status: "active", disabledAt: null },
      existingRole: { status: "active", validFrom: activeFrom, expiresAt: null, revokedAt: null }, existingMembership: { status: "active", validFrom: activeFrom, expiresAt: null, revokedAt: null },
    }, [{ code: "P2034" }]);

    assert.deepEqual(await provisionProductionBootstrap(config, fake.database, { now: () => activeFrom }), { ok: true });
    assert.equal(fake.calls.filter((call) => call.model === "$transaction").length, 2);
    assert.equal(fake.calls.some((call) => call.operation === "create"), false);
  });

  it("fails closed after bounded P2034 retries", async () => {
    const fake = fakeDatabase({}, [{ code: "P2034" }, { code: "P2034" }, { code: "P2034" }]);

    await assert.rejects(
      provisionProductionBootstrap(validateProductionBootstrapConfig(validEnvironment()), fake.database),
      /P2034 exhausted after 3 attempts/u,
    );
    assert.equal(fake.calls.filter((call) => call.model === "$transaction").length, 3);
    assert.equal(fake.calls.some((call) => call.operation === "create"), false);
  });

  it("does not retry non-serializable database errors", async () => {
    const fake = fakeDatabase({}, [{ code: "P2025", message: "unexpected database failure" }]);

    await assert.rejects(
      provisionProductionBootstrap(validateProductionBootstrapConfig(validEnvironment()), fake.database),
      (error) => error?.code === "P2025",
    );
    assert.equal(fake.calls.filter((call) => call.model === "$transaction").length, 1);
  });
});
