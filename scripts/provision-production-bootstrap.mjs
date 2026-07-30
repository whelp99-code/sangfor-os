import { fileURLToPath } from "node:url";

const placeholderPattern = /(replace|placeholder|change.?me|example\.com|your[-_])/iu;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/u;
const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const reservedEmailDomainPattern = /(?:^|\.)invalid$|(?:^|\.)test$|(?:^|\.)example$|(?:^|\.)localhost$/u;

const REQUIRED_CONFIG_KEYS = [
  "DEFAULT_TENANT_ID",
  "DEFAULT_TENANT_SLUG",
  "DEFAULT_COMPANY_ID",
  "DEFAULT_COMPANY_SLUG",
  "DEFAULT_PROJECT_ID",
  "DEFAULT_PROJECT_SLUG",
  "PRODUCTION_OPERATOR_USER_ID",
  "PRODUCTION_OPERATOR_EMAIL",
];

/** Mirrors BUSINESS_ROLE_CODES from @sangfor/auth. This script is bind-mounted into the
 * runtime image on its own, so it cannot import the package; a unit test pins the two lists
 * together. */
export const BUSINESS_ROLE_CODES = [
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
];

const DEFAULT_OPERATOR_ROLE = "system_admin";

const stableNames = {
  tenant: "Production Tenant",
  company: "Production Company",
  project: "Production Project",
  operator: "Production Operator",
};

const MAX_SERIALIZABLE_RETRIES = 2;

function isSerializableConflict(error) {
  return typeof error === "object" && error !== null && error.code === "P2034";
}

function configurationError(issues) {
  throw new Error(`production bootstrap configuration rejected:\n${issues.join("\n")}`);
}

/** Validates only bootstrap identity fields and returns their normalized values. */
export function validateProductionBootstrapConfig(environment) {
  const issues = [];
  const config = {};

  for (const key of REQUIRED_CONFIG_KEYS) {
    const value = typeof environment[key] === "string" ? environment[key].trim() : "";
    if (!value) issues.push(`${key}: missing`);
    else if (placeholderPattern.test(value)) issues.push(`${key}: placeholder`);
    else config[key] = value;
  }

  for (const key of REQUIRED_CONFIG_KEYS.filter((key) => key !== "PRODUCTION_OPERATOR_EMAIL")) {
    const value = config[key];
    if (value && !identifierPattern.test(value)) issues.push(`${key}: invalid identifier`);
  }

  const email = config.PRODUCTION_OPERATOR_EMAIL;
  if (email && email !== email.toLowerCase()) issues.push("PRODUCTION_OPERATOR_EMAIL: must be canonical lowercase");
  else if (email && !emailPattern.test(email)) issues.push("PRODUCTION_OPERATOR_EMAIL: invalid email");
  else if (email && reservedEmailDomainPattern.test(email.slice(email.lastIndexOf("@") + 1))) issues.push("PRODUCTION_OPERATOR_EMAIL: reserved email domain");

  const roleRaw = typeof environment.PRODUCTION_OPERATOR_ROLE === "string" ? environment.PRODUCTION_OPERATOR_ROLE.trim() : "";
  const operatorRole = roleRaw || DEFAULT_OPERATOR_ROLE;
  if (!BUSINESS_ROLE_CODES.includes(operatorRole)) issues.push("PRODUCTION_OPERATOR_ROLE: unknown business role");

  if (issues.length > 0) configurationError(issues);
  return /** @type {const} */ ({
    tenantId: config.DEFAULT_TENANT_ID,
    tenantSlug: config.DEFAULT_TENANT_SLUG,
    companyId: config.DEFAULT_COMPANY_ID,
    companySlug: config.DEFAULT_COMPANY_SLUG,
    projectId: config.DEFAULT_PROJECT_ID,
    projectSlug: config.DEFAULT_PROJECT_SLUG,
    operatorUserId: config.PRODUCTION_OPERATOR_USER_ID,
    operatorEmail: config.PRODUCTION_OPERATOR_EMAIL,
    operatorRole,
  });
}

function requireExact(condition, message) {
  if (!condition) throw new Error(`production bootstrap collision: ${message}`);
}

function requireActiveTenant(tenant) {
  requireExact(tenant.status === "active", "tenant must already be active");
}

function requireActiveOperator(user) {
  requireExact(user.status === "active" && user.disabledAt === null, "operator must already be active");
}

function requireActiveAssignment(assignment, label, currentTime) {
  requireExact(
    assignment.status === "active" && assignment.validFrom instanceof Date && assignment.validFrom <= currentTime && assignment.expiresAt === null && assignment.revokedAt === null,
    `${label} must already be active`,
  );
}

/**
 * Idempotently creates the fixed production hierarchy and operator access. The database object is
 * injected so tests can prove the transactional identity and collision behavior without a database.
 */
export async function provisionProductionBootstrap(config, database, { now = () => new Date(), maxSerializableRetries = MAX_SERIALIZABLE_RETRIES } = {}) {
  if (!Number.isSafeInteger(maxSerializableRetries) || maxSerializableRetries < 0) throw new TypeError("maxSerializableRetries must be a non-negative integer");

  for (let attempt = 0; attempt <= maxSerializableRetries; attempt += 1) {
    try {
      // A fresh Serializable transaction repeats every exact-state check after each conflict.
      return await database.$transaction(async (transaction) => {
        const activeFrom = now();
        const [tenantById, tenantBySlug, companyById, companiesBySlug, projectById, projectBySlug, operatorById, operatorByEmail, existingRoles, existingMembership] = await Promise.all([
          transaction.tenant.findUnique({ where: { id: config.tenantId }, select: { id: true, slug: true, status: true } }),
          transaction.tenant.findUnique({ where: { slug: config.tenantSlug }, select: { id: true, slug: true, status: true } }),
          transaction.company.findUnique({ where: { id: config.companyId }, select: { id: true, tenantId: true, slug: true } }),
          transaction.company.findMany({ where: { slug: config.companySlug }, select: { id: true, tenantId: true, slug: true } }),
          transaction.project.findUnique({ where: { id: config.projectId }, select: { id: true, companyId: true, slug: true } }),
          transaction.project.findUnique({ where: { slug: config.projectSlug }, select: { id: true, companyId: true, slug: true } }),
          transaction.user.findUnique({ where: { id: config.operatorUserId }, select: { id: true, email: true, status: true, disabledAt: true } }),
          transaction.user.findUnique({ where: { email: config.operatorEmail }, select: { id: true, email: true, status: true, disabledAt: true } }),
          transaction.userCompanyRole.findMany({ where: { userId: config.operatorUserId, companyId: config.companyId }, select: { role: true, status: true, validFrom: true, expiresAt: true, revokedAt: true } }),
          transaction.projectMember.findUnique({ where: { projectId_userId: { projectId: config.projectId, userId: config.operatorUserId } }, select: { status: true, validFrom: true, expiresAt: true, revokedAt: true } }),
        ]);

        const tenantExists = tenantById || tenantBySlug;
        if (tenantExists) {
          requireExact(tenantById?.slug === config.tenantSlug && tenantBySlug?.id === config.tenantId, "tenant ID or slug belongs to a different tenant");
          requireActiveTenant(tenantById);
        }

        const companyExists = companyById || companiesBySlug.length > 0;
        if (companyExists) {
          requireExact(companyById?.tenantId === config.tenantId && companyById?.slug === config.companySlug, "company ID belongs to a different company");
          requireExact(companiesBySlug.length === 1 && companiesBySlug[0]?.id === config.companyId && companiesBySlug[0]?.tenantId === config.tenantId, "company slug belongs to a different company");
        }

        const projectExists = projectById || projectBySlug;
        if (projectExists) {
          requireExact(projectById?.companyId === config.companyId && projectById?.slug === config.projectSlug && projectBySlug?.id === config.projectId && projectBySlug?.companyId === config.companyId, "project ID or slug belongs to a different project");
        }

        const operatorExists = operatorById || operatorByEmail;
        if (operatorExists) {
          requireExact(operatorById?.email === config.operatorEmail && operatorByEmail?.id === config.operatorUserId, "operator user ID or email belongs to a different user");
          requireActiveOperator(operatorById);
        }

        // Runtime resolution rejects an operator holding more than one active company role, so a
        // second assignment locks the portal instead of widening it. Refuse to add one.
        requireExact(existingRoles.length <= 1, "operator already holds more than one company role");
        const existingRole = existingRoles[0];
        if (existingRole) {
          requireExact(existingRole.role === config.operatorRole, "operator company role differs from PRODUCTION_OPERATOR_ROLE");
          requireActiveAssignment(existingRole, `${config.operatorRole} assignment`, activeFrom);
        }
        if (existingMembership) requireActiveAssignment(existingMembership, "project membership", activeFrom);

        if (!tenantExists) await transaction.tenant.create({ data: { id: config.tenantId, slug: config.tenantSlug, name: stableNames.tenant, status: "active" } });
        if (!companyExists) await transaction.company.create({ data: { id: config.companyId, tenantId: config.tenantId, slug: config.companySlug, name: stableNames.company } });
        if (!projectExists) await transaction.project.create({ data: { id: config.projectId, companyId: config.companyId, slug: config.projectSlug, name: stableNames.project, description: "Production bootstrap project" } });
        if (!operatorExists) await transaction.user.create({ data: { id: config.operatorUserId, email: config.operatorEmail, name: stableNames.operator, status: "active", disabledAt: null, disabledReason: null } });
        if (!existingRole) await transaction.userCompanyRole.create({ data: { userId: config.operatorUserId, companyId: config.companyId, role: config.operatorRole, status: "active", validFrom: activeFrom, expiresAt: null, revokedAt: null } });
        if (!existingMembership) await transaction.projectMember.create({ data: { projectId: config.projectId, userId: config.operatorUserId, role: "member", status: "active", validFrom: activeFrom, expiresAt: null, revokedAt: null } });

        return { ok: true };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!isSerializableConflict(error)) throw error;
      if (attempt === maxSerializableRetries) {
        throw new Error(`production bootstrap serializable conflict P2034 exhausted after ${attempt + 1} attempts; exact state was not committed`, { cause: error });
      }
    }
  }

  throw new Error("production bootstrap retry loop terminated unexpectedly");
}

async function main() {
  const { prisma } = await import("@sangfor/db");
  try {
    await provisionProductionBootstrap(validateProductionBootstrapConfig(process.env), prisma);
    process.stdout.write("production bootstrap completed\n");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 64;
  });
}
