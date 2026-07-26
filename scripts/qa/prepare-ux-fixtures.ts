import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { signSessionJwt } from "@sangfor/auth";
import { parseUserJwtConfig } from "@sangfor/config";
import { prisma, type Prisma } from "@sangfor/db";

export const OWNER_UNIT = "U066";
export const FIXTURE_SCHEMA_VERSION = "sangfor.ux-fixtures/v1";

export const BUSINESS_ROLES = [
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
] as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const FIXTURE_IDS = Object.freeze({
  UX_FIXTURE_DEAL_ID: "ux-u066-deal",
  UX_FIXTURE_CUSTOMER_ID: "ux-u066-customer",
  UX_FIXTURE_PARTNER_ID: "ux-u066-partner",
  UX_FIXTURE_TASK_ID: "ux-u066-task",
  UX_FIXTURE_POC_ID: "ux-u066-poc",
  UX_FIXTURE_PROPOSAL_ID: "ux-u066-proposal",
  UX_FIXTURE_KNOWLEDGE_ID: "ux-u066-knowledge",
  UX_FIXTURE_APPROVAL_ID: "ux-u066-approval",
  UX_FIXTURE_PROJECT_ID: "ux-u066-project",
  UX_FIXTURE_SUPPORT_ID: "ux-u066-support",
  UX_FIXTURE_STALE_APPROVAL_ID: "ux-u066-approval-stale",
  UX_FIXTURE_CORRUPT_APPROVAL_ID: "ux-u066-approval-corrupt",
});

const TENANT_ID = "ux-u066-tenant";
const COMPANY_ID = "ux-u066-company";
const PROJECT_SCOPE_ID = "ux-u066-project-scope";
const PROJECT_SLUG = "ux-u066-project-scope";
const PROJECT_OPPORTUNITY_ID = "ux-u066-project-opportunity";
const TEMPLATE_ID = "ux-u066-proposal-template";
const DOCUMENT_VERSION_ID = "ux-u066-proposal-version-1";
const FIXED_RECORD_TIME = new Date("2026-07-20T00:00:00.000Z");

type TaskPostgresReceipt = {
  schemaVersion: number;
  runId: string;
  ownerUnit: string;
  purpose: string;
  host: string;
  port: number;
  databaseName: string;
  imageDigest: string;
  migrate: boolean;
  cleanupState: string;
  sentinel: {
    schemaVersion: number;
    runId: string;
    ownerUnit: string;
    purpose: string;
    imageDigest: string;
  };
};

export type SafetyContext = {
  ownerUnit: "U043" | "U066" | "U076";
  databaseName: string;
  databaseHost: string;
  postgresReceiptFile: string;
  postgresReceiptSha256: string;
  taskRunId: string;
};

type RoleIdentity = {
  role: BusinessRole;
  userId: string;
  assignmentId: string;
  projectMemberId: string;
  sessionId: string;
  email: string;
};

type StorageState = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax";
  }>;
  origins: [];
};

function fail(message: string): never {
  throw Object.assign(new Error(`prepare-ux-fixtures: ${message}`), { exitCode: 64 });
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function parseJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fail(`invalid JSON file: ${file}`);
  }
}

function isTaskPostgresReceipt(value: unknown): value is TaskPostgresReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<TaskPostgresReceipt>;
  const sentinel = receipt.sentinel;
  return receipt.schemaVersion === 1
    && typeof receipt.runId === "string"
    && typeof receipt.ownerUnit === "string"
    && typeof receipt.purpose === "string"
    && typeof receipt.host === "string"
    && Number.isInteger(receipt.port)
    && typeof receipt.databaseName === "string"
    && typeof receipt.imageDigest === "string"
    && typeof receipt.migrate === "boolean"
    && typeof receipt.cleanupState === "string"
    && Boolean(sentinel)
    && sentinel?.schemaVersion === 1
    && typeof sentinel.runId === "string"
    && typeof sentinel.ownerUnit === "string"
    && typeof sentinel.purpose === "string"
    && typeof sentinel.imageDigest === "string";
}

export function validateSafetyEnvironment(env: NodeJS.ProcessEnv = process.env): SafetyContext {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    fail("production environment is forbidden");
  }

  const databaseUrlValue = env.DATABASE_URL?.trim();
  if (!databaseUrlValue) fail("DATABASE_URL is required");
  const taskOwnedDatabaseUrl = env.TASK_OWNED_DATABASE_URL?.trim();
  if (!taskOwnedDatabaseUrl) fail("TASK_OWNED_DATABASE_URL is required");
  if (databaseUrlValue !== taskOwnedDatabaseUrl) {
    fail("DATABASE_URL must exactly match TASK_OWNED_DATABASE_URL");
  }
  const ownerUnit = env.UX_FIXTURE_MODE === "u076-final"
    ? "U076"
    : env.UX_FIXTURE_MODE === "u043-crm"
      ? "U043"
      : OWNER_UNIT;
  if (env.TASK_OWNER_UNIT?.trim() !== ownerUnit) fail(`TASK_OWNER_UNIT must be ${ownerUnit}`);
  const taskRunId = env.TASK_RUN_ID?.trim();
  if (!taskRunId) fail("TASK_RUN_ID is required");

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(databaseUrlValue);
  } catch {
    return fail("DATABASE_URL is invalid");
  }
  if (databaseUrl.protocol !== "postgresql:" && databaseUrl.protocol !== "postgres:") {
    fail("DATABASE_URL must use PostgreSQL");
  }
  if (databaseUrl.hostname !== "127.0.0.1" && databaseUrl.hostname !== "localhost") {
    fail("DATABASE_URL must use a loopback host");
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  if (!/^sangfor_task_[A-Za-z0-9_]+$/.test(databaseName)) {
    fail("DATABASE_URL database must match sangfor_task_*");
  }

  const receiptFileValue = env.TASK_POSTGRES_RECEIPT_FILE?.trim();
  if (!receiptFileValue) fail("TASK_POSTGRES_RECEIPT_FILE is required");
  const postgresReceiptFile = resolve(receiptFileValue);
  if (!existsSync(postgresReceiptFile)) fail("TASK_POSTGRES_RECEIPT_FILE does not exist");

  const receiptValue = parseJsonFile(postgresReceiptFile);
  if (!isTaskPostgresReceipt(receiptValue)) fail("task PostgreSQL receipt has an invalid shape");
  const receipt = receiptValue;
  if (receipt.ownerUnit !== ownerUnit || receipt.sentinel.ownerUnit !== ownerUnit) {
    fail(`task PostgreSQL receipt owner must be ${ownerUnit}`);
  }
  if (receipt.runId.length === 0 || receipt.sentinel.runId !== receipt.runId) {
    fail("task PostgreSQL receipt runId mismatch");
  }
  if (receipt.runId !== taskRunId) {
    fail("task PostgreSQL receipt does not match TASK_RUN_ID");
  }
  if (receipt.purpose !== receipt.sentinel.purpose
    || receipt.imageDigest !== receipt.sentinel.imageDigest) {
    fail("task PostgreSQL receipt does not match its database sentinel");
  }
  const databasePort = Number(databaseUrl.port || "5432");
  if (receipt.host !== "127.0.0.1"
    || receipt.databaseName !== databaseName
    || receipt.port !== databasePort) {
    fail("task PostgreSQL receipt does not match DATABASE_URL");
  }
  if (!receipt.migrate) fail("task PostgreSQL receipt must confirm migrations");
  if (receipt.cleanupState !== "open") fail("task PostgreSQL receipt is not open");

  return {
    ownerUnit,
    databaseName,
    databaseHost: databaseUrl.hostname,
    postgresReceiptFile,
    postgresReceiptSha256: sha256File(postgresReceiptFile),
    taskRunId,
  };
}

export function roleIdentity(role: BusinessRole): RoleIdentity {
  const stem = role.replaceAll("_", "-");
  return {
    role,
    userId: `ux-u066-user-${stem}`,
    assignmentId: `ux-u066-company-role-${stem}`,
    projectMemberId: `ux-u066-project-member-${stem}`,
    sessionId: `ux-u066-session-${stem}`,
    email: `ux-u066-${stem}@fixture.sangfor.local`,
  };
}

function webSessionRole(role: BusinessRole): "admin" | "operator" | "viewer" {
  if (role === "system_admin" || role === "security_officer" || role === "ceo") return "admin";
  if (role === "account_manager") return "viewer";
  return "operator";
}

export function buildStorageState(token: string, expiresAt: Date): StorageState {
  return {
    cookies: [{
      name: "session",
      value: token,
      domain: "127.0.0.1",
      path: "/",
      expires: Math.floor(expiresAt.getTime() / 1000),
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    }],
    origins: [],
  };
}

async function seedDatabase(now: Date): Promise<void> {
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
  const staleAt = new Date("2026-07-19T00:00:00.000Z");

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.tenant.upsert({
      where: { id: TENANT_ID },
      create: { id: TENANT_ID, name: "U066 UX Fixture Tenant", slug: TENANT_ID, status: "active", createdAt: FIXED_RECORD_TIME },
      update: { name: "U066 UX Fixture Tenant", status: "active" },
    });
    await tx.company.upsert({
      where: { id: COMPANY_ID },
      create: { id: COMPANY_ID, tenantId: TENANT_ID, name: "U066 UX Fixture Company", slug: COMPANY_ID, createdAt: FIXED_RECORD_TIME },
      update: { tenantId: TENANT_ID, name: "U066 UX Fixture Company", slug: COMPANY_ID },
    });
    await tx.project.upsert({
      where: { id: PROJECT_SCOPE_ID },
      create: { id: PROJECT_SCOPE_ID, slug: PROJECT_SLUG, name: "U066 UX Fixture Scope", companyId: COMPANY_ID, createdAt: FIXED_RECORD_TIME },
      update: { name: "U066 UX Fixture Scope", companyId: COMPANY_ID },
    });

    for (const role of BUSINESS_ROLES) {
      const identity = roleIdentity(role);
      await tx.user.upsert({
        where: { id: identity.userId },
        create: { id: identity.userId, email: identity.email, name: `U066 ${role}`, status: "active", createdAt: FIXED_RECORD_TIME },
        update: { email: identity.email, name: `U066 ${role}`, status: "active", disabledAt: null, disabledReason: null },
      });
      await tx.userCompanyRole.upsert({
        where: { id: identity.assignmentId },
        create: {
          id: identity.assignmentId,
          userId: identity.userId,
          companyId: COMPANY_ID,
          role,
          status: "active",
          validFrom: FIXED_RECORD_TIME,
          createdAt: FIXED_RECORD_TIME,
        },
        update: { role, status: "active", validFrom: FIXED_RECORD_TIME, expiresAt: null, revokedAt: null },
      });
      await tx.projectMember.upsert({
        where: { id: identity.projectMemberId },
        create: {
          id: identity.projectMemberId,
          projectId: PROJECT_SCOPE_ID,
          userId: identity.userId,
          role: "member",
          status: "active",
          validFrom: FIXED_RECORD_TIME,
          createdAt: FIXED_RECORD_TIME,
        },
        update: { status: "active", validFrom: FIXED_RECORD_TIME, expiresAt: null, revokedAt: null },
      });
      await tx.authSession.upsert({
        where: { id: identity.sessionId },
        create: {
          id: identity.sessionId,
          userId: identity.userId,
          tenantId: TENANT_ID,
          companyId: COMPANY_ID,
          projectId: PROJECT_SCOPE_ID,
          issuedAt: now,
          expiresAt,
          mfaVerifiedAt: now,
          mfaMethod: "totp",
        },
        update: { issuedAt: now, expiresAt, revokedAt: null, mfaVerifiedAt: now, mfaMethod: "totp" },
      });
    }

    await tx.customer.upsert({
      where: { id: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID },
      create: { id: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, projectId: PROJECT_SCOPE_ID, name: "U066 Fixture Customer", domain: "u066.fixture.local", industry: "Technology", status: "active", createdAt: FIXED_RECORD_TIME },
      update: { projectId: PROJECT_SCOPE_ID, name: "U066 Fixture Customer", archivedAt: null, status: "active" },
    });
    await tx.partner.upsert({
      where: { id: FIXTURE_IDS.UX_FIXTURE_PARTNER_ID },
      create: { id: FIXTURE_IDS.UX_FIXTURE_PARTNER_ID, projectId: PROJECT_SCOPE_ID, name: "U066 Fixture Partner", kind: "DISTRIBUTOR", status: "active", createdAt: FIXED_RECORD_TIME },
      update: { projectId: PROJECT_SCOPE_ID, name: "U066 Fixture Partner", kind: "DISTRIBUTOR", status: "active" },
    });
    await tx.opportunity.upsert({
      where: { id: FIXTURE_IDS.UX_FIXTURE_DEAL_ID },
      create: { id: FIXTURE_IDS.UX_FIXTURE_DEAL_ID, projectId: PROJECT_SCOPE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, partnerId: FIXTURE_IDS.UX_FIXTURE_PARTNER_ID, title: "U066 Fixture Deal", stage: "QUALIFIED", amount: 125000000, probability: 60, nextAction: "Review deterministic UX fixture", createdAt: FIXED_RECORD_TIME },
      update: { projectId: PROJECT_SCOPE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, partnerId: FIXTURE_IDS.UX_FIXTURE_PARTNER_ID, title: "U066 Fixture Deal", archivedAt: null, stage: "QUALIFIED", probability: 60 },
    });
    await tx.workTask.upsert({
      where: { id: FIXTURE_IDS.UX_FIXTURE_TASK_ID },
      create: { id: FIXTURE_IDS.UX_FIXTURE_TASK_ID, projectId: PROJECT_SCOPE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, title: "U066 Fixture Task", status: "doing", priority: "high", source: "u066_fixture", createdAt: FIXED_RECORD_TIME },
      update: { projectId: PROJECT_SCOPE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, title: "U066 Fixture Task", archivedAt: null, status: "doing", priority: "high" },
    });
    await tx.pocProject.upsert({
      where: { id: FIXTURE_IDS.UX_FIXTURE_POC_ID },
      create: { id: FIXTURE_IDS.UX_FIXTURE_POC_ID, projectId: PROJECT_SCOPE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, partnerId: FIXTURE_IDS.UX_FIXTURE_PARTNER_ID, opportunityId: FIXTURE_IDS.UX_FIXTURE_DEAL_ID, title: "U066 Fixture PoC", productName: "Sangfor HCI", status: "running", createdAt: FIXED_RECORD_TIME },
      update: { projectId: PROJECT_SCOPE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, partnerId: FIXTURE_IDS.UX_FIXTURE_PARTNER_ID, opportunityId: FIXTURE_IDS.UX_FIXTURE_DEAL_ID, title: "U066 Fixture PoC", status: "running" },
    });
    await tx.documentTemplate.upsert({
      where: { id: TEMPLATE_ID },
      create: { id: TEMPLATE_ID, projectId: PROJECT_SCOPE_ID, templateKey: "u066-fixture-proposal", title: "U066 Fixture Proposal Template", bodyMarkdown: "# U066 Fixture Proposal", createdAt: FIXED_RECORD_TIME },
      update: { title: "U066 Fixture Proposal Template", bodyMarkdown: "# U066 Fixture Proposal" },
    });
    await tx.generatedDocument.upsert({
      where: { id: FIXTURE_IDS.UX_FIXTURE_PROPOSAL_ID },
      create: { id: FIXTURE_IDS.UX_FIXTURE_PROPOSAL_ID, templateId: TEMPLATE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, pocProjectId: FIXTURE_IDS.UX_FIXTURE_POC_ID, opportunityId: FIXTURE_IDS.UX_FIXTURE_DEAL_ID, title: "U066 Fixture Proposal", bodyMarkdown: "# U066 Fixture Proposal\n\nDeterministic acceptance content.", status: "draft", createdAt: FIXED_RECORD_TIME },
      update: { templateId: TEMPLATE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, pocProjectId: FIXTURE_IDS.UX_FIXTURE_POC_ID, opportunityId: FIXTURE_IDS.UX_FIXTURE_DEAL_ID, title: "U066 Fixture Proposal", bodyMarkdown: "# U066 Fixture Proposal\n\nDeterministic acceptance content.", status: "draft" },
    });
    await tx.documentVersion.upsert({
      where: { id: DOCUMENT_VERSION_ID },
      create: { id: DOCUMENT_VERSION_ID, generatedDocumentId: FIXTURE_IDS.UX_FIXTURE_PROPOSAL_ID, version: 1, bodyMarkdown: "# U066 Fixture Proposal\n\nDeterministic acceptance content.", createdAt: FIXED_RECORD_TIME },
      update: { bodyMarkdown: "# U066 Fixture Proposal\n\nDeterministic acceptance content." },
    });
    await tx.knowledgeDocument.upsert({
      where: { id: FIXTURE_IDS.UX_FIXTURE_KNOWLEDGE_ID },
      create: { id: FIXTURE_IDS.UX_FIXTURE_KNOWLEDGE_ID, projectId: PROJECT_SCOPE_ID, title: "U066 Fixture Knowledge", body: "Deterministic U066 knowledge fixture.", tags: ["u066", "fixture"], source: "u066_fixture", createdAt: FIXED_RECORD_TIME },
      update: { projectId: PROJECT_SCOPE_ID, title: "U066 Fixture Knowledge", body: "Deterministic U066 knowledge fixture.", tags: ["u066", "fixture"], source: "u066_fixture" },
    });
    await tx.opportunity.upsert({
      where: { id: PROJECT_OPPORTUNITY_ID },
      create: { id: PROJECT_OPPORTUNITY_ID, projectId: PROJECT_SCOPE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, title: "U066 Fixture Delivery Opportunity", stage: "WON", amount: 80000000, probability: 100, createdAt: FIXED_RECORD_TIME },
      update: { projectId: PROJECT_SCOPE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, title: "U066 Fixture Delivery Opportunity", archivedAt: null, stage: "WON", probability: 100 },
    });
    await tx.engagement.upsert({
      where: { id: FIXTURE_IDS.UX_FIXTURE_PROJECT_ID },
      create: { id: FIXTURE_IDS.UX_FIXTURE_PROJECT_ID, opportunityId: PROJECT_OPPORTUNITY_ID, projectId: PROJECT_SCOPE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, name: "U066 Fixture Delivery Project", status: "active", amount: 80000000, convertedAt: FIXED_RECORD_TIME },
      update: { projectId: PROJECT_SCOPE_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, name: "U066 Fixture Delivery Project", status: "active", amount: 80000000 },
    });
    await tx.supportCase.upsert({
      where: { id: FIXTURE_IDS.UX_FIXTURE_SUPPORT_ID },
      create: { id: FIXTURE_IDS.UX_FIXTURE_SUPPORT_ID, customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, subject: "U066 Fixture Support Case", severity: "high", status: "open", slaDeadline: new Date("2026-08-01T00:00:00.000Z"), createdAt: FIXED_RECORD_TIME },
      update: { customerId: FIXTURE_IDS.UX_FIXTURE_CUSTOMER_ID, subject: "U066 Fixture Support Case", severity: "high", status: "open", closedAt: null },
    });

    const approvals = [
      { id: FIXTURE_IDS.UX_FIXTURE_APPROVAL_ID, status: "pending", reason: "U066 deterministic approval", expiresAt: null },
      { id: FIXTURE_IDS.UX_FIXTURE_STALE_APPROVAL_ID, status: "pending", reason: "U066 deterministic stale approval", expiresAt: staleAt },
      { id: FIXTURE_IDS.UX_FIXTURE_CORRUPT_APPROVAL_ID, status: "cancelled", reason: "U066 corrupt-state fixture sentinel", expiresAt: null },
    ];
    for (const approval of approvals) {
      await tx.approvalRequest.upsert({
        where: { id: approval.id },
        create: { ...approval, legacyUnbound: true, createdAt: FIXED_RECORD_TIME },
        update: { status: approval.status, reason: approval.reason, expiresAt: approval.expiresAt },
      });
    }
  });
}

function writeJsonAtomic(file: string, value: unknown, mode = 0o600): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(temporary, file);
  chmodSync(file, mode);
}

export function writeFixtureArtifacts(input: {
  outputDirectory: string;
  safety: SafetyContext;
  tokens: ReadonlyMap<BusinessRole, string>;
  issuedAt: Date;
  expiresAt: Date;
  activeKid: string;
}): { envFile: string; receiptFile: string; storageStateDirectory: string } {
  const outputDirectory = resolve(input.outputDirectory);
  const storageStateDirectory = join(outputDirectory, "storage-state");
  mkdirSync(storageStateDirectory, { recursive: true, mode: 0o700 });
  chmodSync(storageStateDirectory, 0o700);

  const profiles = BUSINESS_ROLES.map((role) => {
    const token = input.tokens.get(role);
    if (!token) fail(`missing token for ${role}`);
    const identity = roleIdentity(role);
    const storageStateFile = join(storageStateDirectory, `${role}.json`);
    writeJsonAtomic(storageStateFile, buildStorageState(token, input.expiresAt));
    return {
      ...identity,
      storageStateFile,
      storageStateSha256: sha256File(storageStateFile),
    };
  });

  const fixtureEnv = {
    DEFAULT_PROJECT_ID: PROJECT_SCOPE_ID,
    DEFAULT_PROJECT_SLUG: PROJECT_SLUG,
    UX_AUTH_STORAGE_STATE_DIR: storageStateDirectory,
    ...FIXTURE_IDS,
  };
  const envFile = join(outputDirectory, "ux-fixtures.env");
  const envBody = Object.entries(fixtureEnv)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(envFile, `${envBody}\n`, { mode: 0o600 });
  chmodSync(envFile, 0o600);

  const receiptFile = join(outputDirectory, "ux-fixtures-receipt.json");
  writeJsonAtomic(receiptFile, {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    ownerUnit: input.safety.ownerUnit,
    taskRunId: input.safety.taskRunId,
    generatedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    activeJwtKid: input.activeKid,
    database: {
      host: input.safety.databaseHost,
      name: input.safety.databaseName,
      postgresReceiptFile: input.safety.postgresReceiptFile,
      postgresReceiptSha256: input.safety.postgresReceiptSha256,
    },
    envFile,
    env: fixtureEnv,
    fixtureCount: Object.keys(FIXTURE_IDS).length,
    authProfileCount: profiles.length,
    authProfiles: profiles,
  });
  return { envFile, receiptFile, storageStateDirectory };
}

export async function prepareUxFixtures(env: NodeJS.ProcessEnv = process.env) {
  const safety = validateSafetyEnvironment(env);
  const jwtConfig = parseUserJwtConfig(env);
  const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const expiresAt = new Date(issuedAt.getTime() + jwtConfig.ttlSeconds * 1000);
  const nowSeconds = Math.floor(issuedAt.getTime() / 1000);
  const tokens = new Map<BusinessRole, string>();

  for (const role of BUSINESS_ROLES) {
    const identity = roleIdentity(role);
    tokens.set(role, signSessionJwt({
      sub: identity.userId,
      jti: identity.sessionId,
      tenantId: TENANT_ID,
      companyId: COMPANY_ID,
      projectId: PROJECT_SCOPE_ID,
      projectSlug: PROJECT_SLUG,
      product: "portal",
      role: webSessionRole(role),
      nowSeconds,
    }, jwtConfig));
  }

  await seedDatabase(issuedAt);
  const outputDirectory = env.UX_FIXTURE_OUTPUT_DIR?.trim()
    ? resolve(env.UX_FIXTURE_OUTPUT_DIR)
    : join(dirname(safety.postgresReceiptFile), "ux-fixtures");
  const evidenceRoot = `${dirname(safety.postgresReceiptFile)}/`;
  if (!`${outputDirectory}/`.startsWith(evidenceRoot)) {
    fail("UX_FIXTURE_OUTPUT_DIR must stay inside the task evidence directory");
  }
  return writeFixtureArtifacts({
    outputDirectory,
    safety,
    tokens,
    issuedAt,
    expiresAt,
    activeKid: jwtConfig.activeKid,
  });
}

export async function disconnectUxFixtureDatabase(): Promise<void> {
  await prisma.$disconnect();
}
