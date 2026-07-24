import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  hasCapability,
  isActiveProjectAssignment,
  resolveActiveCompanyRole,
  resolveCapabilities,
  type AuthContext,
  type BusinessPermission,
} from "@sangfor/auth";
import {
  canonicalizeRfc8785,
  prisma,
  withRlsTransaction,
  type Prisma,
} from "@sangfor/db";
import { z } from "zod";

import { recordDecision } from "../governance/ai-decision";
import { appendAuditEvent } from "../governance/audit-db";
import { deriveChainScopeKey, type AuditChainScope } from "../governance/audit-chain";
import { caseRefFor } from "../infrastructure/case-ref";
import { resolveDefaultProjectSlug } from "../infrastructure/default-project";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const boundedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum).refine((value) => !CONTROL_CHARACTERS.test(value), {
    message: "control_characters_not_allowed",
  });
const nullableOptionalText = (maximum: number) =>
  z.preprocess(
    (value) => value === "" ? null : value,
    z.string().trim().max(maximum).refine((value) => !CONTROL_CHARACTERS.test(value), {
      message: "control_characters_not_allowed",
    }).nullable().optional(),
  );
export const crmIdempotencyKeySchema = boundedText(1, 128);

export const createCustomerSchema = z.object({
  name: boundedText(2, 200),
  domain: nullableOptionalText(253),
  industry: nullableOptionalText(200),
  notes: nullableOptionalText(10_000),
}).strict();

export const createCustomerCommandSchema = createCustomerSchema.extend({
  idempotencyKey: crmIdempotencyKeySchema,
}).strict();

export const updateCustomerChangesSchema = z.object({
  name: boundedText(2, 200).optional(),
  domain: nullableOptionalText(253),
  industry: nullableOptionalText(200),
  notes: nullableOptionalText(10_000),
  status: z.enum(["active", "inactive", "archived"]).optional(),
}).strict().refine((changes) => Object.keys(changes).length > 0, {
  message: "customer_changes_required",
});

export const updateCustomerSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  changes: updateCustomerChangesSchema,
  idempotencyKey: crmIdempotencyKeySchema,
}).strict();

export const archiveCustomerSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  idempotencyKey: crmIdempotencyKeySchema,
}).strict();

export const customerListQuerySchema = z.object({
  search: boundedText(1, 200).optional(),
  domain: boundedText(1, 253).transform((value) => value.toLowerCase()).optional(),
  first: z.coerce.number().int().min(1).max(100).default(50),
  cursor: boundedText(1, 4096).optional(),
}).strict();

export type CustomerListQuery = z.input<typeof customerListQuerySchema>;
export type CreateCustomerCommand = z.input<typeof createCustomerCommandSchema>;
export type UpdateCustomerCommand = z.input<typeof updateCustomerSchema>;
export type ArchiveCustomerCommand = z.input<typeof archiveCustomerSchema>;

export type CrmServiceErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CONFIGURATION_ERROR";

export class CrmServiceError extends Error {
  constructor(
    public readonly code: CrmServiceErrorCode,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "CrmServiceError";
  }
}

type ScopedTransaction = Prisma.TransactionClient;
type ActorAssignment = {
  id: string;
  userId: string;
  companyId: string;
  role: string;
  status: string | null;
  validFrom: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export interface VerifiedCrmIdentity {
  userId: string;
  sessionId: string | null;
  tenantId: string;
  companyId: string;
  projectId: string;
  product?: string;
}

function assertContextShape(ctx: AuthContext | VerifiedCrmIdentity): void {
  for (const [field, value] of Object.entries({
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    projectId: ctx.projectId,
  })) {
    if (typeof value !== "string" || value.trim().length === 0 || CONTROL_CHARACTERS.test(value)) {
      throw new CrmServiceError("UNAUTHORIZED", 401, `invalid_auth_context:${field}`);
    }
  }
}

async function resolveActorAssignment(
  tx: ScopedTransaction,
  ctx: AuthContext | VerifiedCrmIdentity,
  permission: BusinessPermission,
): Promise<ActorAssignment> {
  assertContextShape(ctx);
  const now = new Date();
  const [companyAssignments, projectAssignment] = await Promise.all([
    tx.userCompanyRole.findMany({
      where: { userId: ctx.userId, companyId: ctx.companyId },
      select: {
        id: true,
        userId: true,
        companyId: true,
        role: true,
        status: true,
        validFrom: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
    tx.projectMember.findFirst({
      where: { userId: ctx.userId, projectId: ctx.projectId },
      select: {
        id: true,
        userId: true,
        projectId: true,
        status: true,
        validFrom: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
  ]);
  const roleResolution = resolveActiveCompanyRole(companyAssignments, now);
  if (!roleResolution.ok) {
    throw new CrmServiceError("FORBIDDEN", 403, `crm_assignment_denied:${roleResolution.reason}`);
  }
  if (!isActiveProjectAssignment(projectAssignment, now)) {
    throw new CrmServiceError("FORBIDDEN", 403, "crm_project_assignment_denied");
  }
  if (!hasCapability(roleResolution.role, permission)) {
    throw new CrmServiceError("FORBIDDEN", 403, `crm_capability_denied:${permission}`);
  }
  return roleResolution.assignment as ActorAssignment;
}

export async function resolveCrmAuthContext(identity: VerifiedCrmIdentity): Promise<AuthContext> {
  assertContextShape(identity);
  return withRlsTransaction(identity, async (tx) => {
    const assignment = await resolveActorAssignment(tx, identity, "customer.read");
    const roleResolution = resolveActiveCompanyRole([assignment], new Date());
    if (!roleResolution.ok) {
      throw new CrmServiceError("FORBIDDEN", 403, "crm_assignment_denied");
    }
    return {
      ...identity,
      businessRole: roleResolution.role,
      permissions: resolveCapabilities(roleResolution.role),
    };
  });
}

interface CustomerCursorPayload {
  version: 1;
  kind: "customer";
  projectId: string;
  filterHash: string;
  updatedAt: string;
  id: string;
}

function cursorSecret(): Buffer {
  const explicit = process.env.CRM_CURSOR_SECRET;
  if (explicit && Buffer.byteLength(explicit) >= 32) return Buffer.from(explicit);

  try {
    const activeKid = process.env.USER_JWT_ACTIVE_KID;
    const parsed = JSON.parse(process.env.USER_JWT_KEYRING_JSON ?? "") as {
      keys?: Array<{ kid?: string; secretBase64Url?: string }>;
    };
    const entry = parsed.keys?.find((candidate) => candidate.kid === activeKid);
    const secret = entry?.secretBase64Url ? Buffer.from(entry.secretBase64Url, "base64url") : null;
    if (secret && secret.length >= 32) {
      return createHmac("sha256", secret).update("sangfor.crm.customer-cursor/v1").digest();
    }
  } catch {
    // The stable configuration error below is intentionally non-secret.
  }
  throw new CrmServiceError("CONFIGURATION_ERROR", 503, "crm_cursor_signing_key_unavailable");
}

function customerFilterHash(search: string | undefined, domain: string | undefined): string {
  return createHash("sha256")
    .update(canonicalizeRfc8785({ domain: domain ?? null, search: search ?? null }))
    .digest("hex");
}

function encodeCustomerCursor(payload: CustomerCursorPayload): string {
  const body = Buffer.from(canonicalizeRfc8785(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", cursorSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function decodeCustomerCursor(
  cursor: string,
  projectId: string,
  filterHash: string,
): CustomerCursorPayload {
  const [body, suppliedSignature, extra] = cursor.split(".");
  if (!body || !suppliedSignature || extra) {
    throw new CrmServiceError("VALIDATION_ERROR", 422, "invalid_customer_cursor");
  }
  if (
    Buffer.from(body, "base64url").toString("base64url") !== body
    || Buffer.from(suppliedSignature, "base64url").toString("base64url") !== suppliedSignature
  ) {
    throw new CrmServiceError("VALIDATION_ERROR", 422, "invalid_customer_cursor");
  }
  const expected = createHmac("sha256", cursorSecret()).update(body).digest();
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new CrmServiceError("VALIDATION_ERROR", 422, "invalid_customer_cursor");
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CustomerCursorPayload;
    if (
      payload.version !== 1 ||
      payload.kind !== "customer" ||
      payload.projectId !== projectId ||
      payload.filterHash !== filterHash ||
      typeof payload.id !== "string" ||
      Number.isNaN(new Date(payload.updatedAt).getTime())
    ) {
      throw new Error("cursor_contract_mismatch");
    }
    return payload;
  } catch {
    throw new CrmServiceError("VALIDATION_ERROR", 422, "invalid_customer_cursor");
  }
}

function projectAuditScope(ctx: AuthContext): AuditChainScope {
  return {
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    projectId: ctx.projectId,
    level: "PROJECT",
  };
}

function mutationInputHash(
  contract: string,
  ctx: AuthContext,
  actorAssignmentId: string,
  command: unknown,
): string {
  return createHash("sha256").update(canonicalizeRfc8785({
    actorAssignmentId,
    command,
    contract,
    scope: {
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      projectId: ctx.projectId,
    },
  })).digest("hex");
}

function auditDetails(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function acquireMutationLock(
  tx: ScopedTransaction,
  scope: AuditChainScope,
): Promise<void> {
  const chainScopeKey = deriveChainScopeKey(scope);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chainScopeKey}, 0))`;
}

async function replayCustomerMutation<T>(
  tx: ScopedTransaction,
  scope: AuditChainScope,
  idempotencyKey: string,
  contract: string,
  inputHash: string,
): Promise<T | null> {
  const existing = await tx.auditLog.findFirst({
    where: {
      chainScopeKey: deriveChainScopeKey(scope),
      idempotencyKey,
    },
    select: { details: true },
  });
  if (!existing) return null;
  const details = auditDetails(existing.details);
  if (details?.contract !== contract || details.inputHash !== inputHash || !details.result) {
    throw new CrmServiceError("CONFLICT", 409, "idempotency_key_reused");
  }
  return details.result as T;
}

function mapValidation<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new CrmServiceError("VALIDATION_ERROR", 422, "invalid_crm_command");
  }
  return parsed.data;
}

function customerListInclude(withOpportunities: boolean) {
  return {
    contacts: { where: { archivedAt: null }, ...(withOpportunities ? { select: { id: true } } : {}) },
    partnerLinks: withOpportunities ? { select: { id: true } } : { include: { partner: true } },
    _count: { select: { workTasks: true, ...(!withOpportunities ? { activityLogs: true } : {}) } },
    ...(withOpportunities ? {
      opportunities: {
        where: { archivedAt: null },
        orderBy: [{ updatedAt: "desc" as const }, { id: "desc" as const }],
        take: 10,
        select: { id: true, title: true, code: true, stage: true, amount: true, updatedAt: true },
      },
    } : {}),
  };
}

async function listCustomerPage(
  ctx: AuthContext,
  rawQuery: CustomerListQuery,
  withOpportunities: boolean,
) {
  const query = customerListQuerySchema.parse(rawQuery);
  const filterHash = customerFilterHash(query.search, query.domain);
  const boundary = query.cursor
    ? decodeCustomerCursor(query.cursor, ctx.projectId, filterHash)
    : null;
  return withRlsTransaction(ctx, async (tx) => {
    await resolveActorAssignment(tx, ctx, "customer.read");
    const rows = await tx.customer.findMany({
      where: {
        projectId: ctx.projectId,
        archivedAt: null,
        ...(query.search ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { domain: { contains: query.search, mode: "insensitive" as const } },
          ],
        } : {}),
        ...(query.domain ? {
          domain: { equals: query.domain, mode: "insensitive" as const },
        } : {}),
        ...(boundary ? {
          AND: [{
            OR: [
              { updatedAt: { lt: new Date(boundary.updatedAt) } },
              { updatedAt: new Date(boundary.updatedAt), id: { lt: boundary.id } },
            ],
          }],
        } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: query.first + 1,
      include: customerListInclude(withOpportunities),
    });
    const items = rows.slice(0, query.first);
    const last = rows.length > query.first ? items.at(-1) : null;
    return {
      items,
      nextCursor: last
        ? encodeCustomerCursor({
            version: 1,
            kind: "customer",
            projectId: ctx.projectId,
            filterHash,
            updatedAt: last.updatedAt.toISOString(),
            id: last.id,
          })
        : null,
    };
  });
}

/**
 * Canonical U043 Customer service. Scope, assignment and capability are re-derived from persisted
 * rows inside U016's fail-closed application-role transaction on every call.
 */
export async function listCustomers(ctx: AuthContext, query: CustomerListQuery = {}) {
  return listCustomerPage(ctx, query, false);
}

export async function listCustomersWithOpportunities(ctx: AuthContext, query: CustomerListQuery = {}) {
  return listCustomerPage(ctx, query, true);
}

export async function getCustomerDetail(ctx: AuthContext, id: string) {
  if (!id || CONTROL_CHARACTERS.test(id)) {
    throw new CrmServiceError("VALIDATION_ERROR", 422, "invalid_customer_id");
  }
  return withRlsTransaction(ctx, async (tx) => {
    await resolveActorAssignment(tx, ctx, "customer.read");
    return tx.customer.findFirst({
      where: { id, projectId: ctx.projectId, archivedAt: null },
      include: {
        contacts: { where: { archivedAt: null } },
        partnerLinks: { include: { partner: true } },
        activityLogs: { orderBy: { createdAt: "desc" }, take: 20 },
        workTasks: { where: { archivedAt: null }, orderBy: { dueAt: "asc" }, take: 10 },
        pocProjects: { orderBy: { updatedAt: "desc" }, take: 10 },
        opportunities: {
          where: { archivedAt: null },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 10,
        },
        customerAssets: { orderBy: { updatedAt: "desc" }, take: 50 },
        renewalOpportunities: { orderBy: { updatedAt: "desc" }, take: 50 },
        supportCases: { orderBy: { updatedAt: "desc" }, take: 50 },
      },
    });
  });
}

export async function createCustomer(ctx: AuthContext, rawCommand: CreateCustomerCommand) {
  return withRlsTransaction(ctx, (tx) =>
    createCustomerInScopedTransaction(tx, ctx, rawCommand));
}

/** @internal Transaction-aware entrypoint for the U043 mail conversion coordinator. */
async function createCustomerInScopedTransaction(
  tx: ScopedTransaction,
  ctx: AuthContext,
  rawCommand: CreateCustomerCommand,
) {
  const command = createCustomerCommandSchema.parse(rawCommand);
  const actor = await resolveActorAssignment(tx, ctx, "customer.write");
  const scope = projectAuditScope(ctx);
  const contract = "sangfor.crm.customer.create/v1";
  const auditKey = `customer.create:${command.idempotencyKey}`;
  const normalizedCommand = {
    name: command.name,
    domain: command.domain ?? null,
    industry: command.industry ?? null,
    notes: command.notes ?? null,
  };
  const inputHash = mutationInputHash(contract, ctx, actor.id, normalizedCommand);
  await acquireMutationLock(tx, scope);
  const replay = await replayCustomerMutation<Record<string, unknown>>(
    tx,
    scope,
    auditKey,
    contract,
    inputHash,
  );
  if (replay) return replay;

  const customer = await tx.customer.create({
    data: {
      projectId: ctx.projectId,
      name: command.name,
      domain: command.domain,
      industry: command.industry,
      notes: command.notes,
    },
  });
  const result = JSON.parse(JSON.stringify(customer)) as Record<string, unknown>;
  await appendAuditEvent(tx, {
    scope,
    eventType: "customer.created",
    actorId: actor.id,
    resourceType: "customer",
    resourceId: customer.id,
    idempotencyKey: auditKey,
    details: { contract, inputHash, actorAssignmentId: actor.id, result },
  });
  return customer;
}

function canonicalMailCompanyKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b(?:incorporated|corporation|company|limited|ltd|inc|corp|co)\b/g, "")
    .replace(/(?:주식회사|\(주\)|㈜)/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** @internal Project-local canonical merge used only by the U043 mail conversion coordinator. */
export async function mergeMailDerivedCustomerInScopedTransaction(
  tx: ScopedTransaction,
  ctx: AuthContext,
  input: {
    name: string;
    domain?: string | null;
    industry?: string | null;
    notes?: string | null;
    idempotencyKey: string;
  },
) {
  await resolveActorAssignment(tx, ctx, "customer.write");
  const key = canonicalMailCompanyKey(input.name);
  const domain = input.domain?.trim().toLowerCase() || null;
  const scoped = await tx.customer.findMany({
    where: { projectId: ctx.projectId, archivedAt: null },
    select: {
      id: true,
      projectId: true,
      name: true,
      domain: true,
      industry: true,
      notes: true,
      status: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const existing = scoped.find((customer) =>
    canonicalMailCompanyKey(customer.name) === key ||
    (domain !== null && customer.domain?.trim().toLowerCase() === domain));
  if (existing) return { entity: existing, created: false };

  const entity = await createCustomerInScopedTransaction(tx, ctx, {
    name: input.name,
    domain,
    industry: input.industry ?? null,
    notes: input.notes ?? null,
    idempotencyKey: input.idempotencyKey,
  });
  return { entity, created: true };
}

/** @internal Project-local Partner merge for the same authenticated mail transaction. */
export async function mergeMailDerivedPartnerInScopedTransaction(
  tx: ScopedTransaction,
  ctx: AuthContext,
  input: { name: string; partnerType?: string | null },
) {
  const actor = await resolveActorAssignment(tx, ctx, "customer.write");
  const key = canonicalMailCompanyKey(input.name);
  const scoped = await tx.partner.findMany({
    where: { projectId: ctx.projectId, status: { not: "archived" } },
  });
  const existing = scoped.find((partner) => canonicalMailCompanyKey(partner.name) === key);
  if (existing) return { entity: existing, created: false };
  const entity = await tx.partner.create({
    data: {
      projectId: ctx.projectId,
      name: input.name,
      partnerType: input.partnerType ?? null,
      status: "active",
    },
  });
  await appendAuditEvent(tx, {
    scope: projectAuditScope(ctx),
    eventType: "partner.created",
    actorId: actor.id,
    resourceType: "partner",
    resourceId: entity.id,
    details: { source: "mail_candidate", actorAssignmentId: actor.id },
  });
  return { entity, created: true };
}

export async function updateCustomer(
  ctx: AuthContext,
  id: string,
  rawCommand: UpdateCustomerCommand,
) {
  const command = updateCustomerSchema.parse(rawCommand);
  return withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveActorAssignment(tx, ctx, "customer.write");
    const scope = projectAuditScope(ctx);
    const contract = "sangfor.crm.customer.update/v1";
    const auditKey = `customer.update:${command.idempotencyKey}`;
    const normalizedCommand = {
      customerId: id,
      expectedUpdatedAt: command.expectedUpdatedAt,
      changes: command.changes,
    };
    const inputHash = mutationInputHash(contract, ctx, actor.id, normalizedCommand);
    await acquireMutationLock(tx, scope);
    const replay = await replayCustomerMutation<Record<string, unknown>>(
      tx,
      scope,
      auditKey,
      contract,
      inputHash,
    );
    if (replay) return replay;

    const changed = await tx.customer.updateMany({
      where: {
        id,
        projectId: ctx.projectId,
        archivedAt: null,
        updatedAt: new Date(command.expectedUpdatedAt),
      },
      data: command.changes,
    });
    if (changed.count !== 1) {
      throw new CrmServiceError("CONFLICT", 409, "customer_version_conflict");
    }
    const customer = await tx.customer.findFirst({
      where: { id, projectId: ctx.projectId, archivedAt: null },
    });
    if (!customer) {
      throw new CrmServiceError("CONFLICT", 409, "customer_version_conflict");
    }
    const result = JSON.parse(JSON.stringify(customer)) as Record<string, unknown>;
    await appendAuditEvent(tx, {
      scope,
      eventType: "customer.updated",
      actorId: actor.id,
      resourceType: "customer",
      resourceId: id,
      idempotencyKey: auditKey,
      details: { contract, inputHash, actorAssignmentId: actor.id, result },
    });
    return customer;
  });
}

export async function archiveCustomer(
  ctx: AuthContext,
  id: string,
  rawCommand: ArchiveCustomerCommand,
) {
  const command = archiveCustomerSchema.parse(rawCommand);
  return withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveActorAssignment(tx, ctx, "customer.write");
    const scope = projectAuditScope(ctx);
    const contract = "sangfor.crm.customer.archive/v1";
    const auditKey = `customer.archive:${command.idempotencyKey}`;
    const normalizedCommand = {
      customerId: id,
      expectedUpdatedAt: command.expectedUpdatedAt,
    };
    const inputHash = mutationInputHash(contract, ctx, actor.id, normalizedCommand);
    await acquireMutationLock(tx, scope);
    const replay = await replayCustomerMutation<Record<string, unknown>>(
      tx,
      scope,
      auditKey,
      contract,
      inputHash,
    );
    if (replay) return replay;

    const archivedAt = new Date();
    const changed = await tx.customer.updateMany({
      where: {
        id,
        projectId: ctx.projectId,
        archivedAt: null,
        updatedAt: new Date(command.expectedUpdatedAt),
      },
      data: { status: "archived", archivedAt },
    });
    if (changed.count !== 1) {
      throw new CrmServiceError("CONFLICT", 409, "customer_version_conflict");
    }
    const customer = await tx.customer.findFirst({
      where: { id, projectId: ctx.projectId, archivedAt },
    });
    if (!customer) {
      throw new CrmServiceError("CONFLICT", 409, "customer_version_conflict");
    }
    const result = JSON.parse(JSON.stringify(customer)) as Record<string, unknown>;
    await appendAuditEvent(tx, {
      scope,
      eventType: "customer.archived",
      actorId: actor.id,
      resourceType: "customer",
      resourceId: id,
      idempotencyKey: auditKey,
      details: { contract, inputHash, actorAssignmentId: actor.id, result },
    });
    return customer;
  });
}

export const createPartnerSchema = z.object({
  projectSlug: z.string().optional(),
  name: z.string().min(2),
  partnerType: z.string().optional(),
});

export const updatePartnerSchema = createPartnerSchema
  .omit({ projectSlug: true })
  .partial()
  .extend({
    status: z.enum(["active", "inactive", "archived"]).optional(),
    kind: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.enum(["VENDOR", "DISTRIBUTOR", "RESELLER"]).optional(),
    ),
  });

export const createContactSchema = z.object({
  customerId: z.string().optional(),
  partnerId: z.string().optional(),
  name: z.string().min(2),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
}).refine((input) => Boolean(input.customerId) !== Boolean(input.partnerId), {
  message: "contact_requires_exactly_one_parent",
});

export const updateContactSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.preprocess((value) => value === "" ? null : value, z.string().email().nullable().optional()),
  phone: z.preprocess((value) => value === "" ? null : value, z.string().nullable().optional()),
  role: z.preprocess((value) => value === "" ? null : value, z.string().nullable().optional()),
});

/**
 * Purpose: Phase 12 Customer/Partner Core — CRM entities for production portal.
 * Failure Points: Missing project; duplicate partner link; orphan contact without parent.
 * Observability: customer_activity_logs, state_transition_logs
 */
async function resolveProjectId(slug: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

export async function createPartner(input: z.infer<typeof createPartnerSchema>) {
  const parsed = createPartnerSchema.parse(input);
  const projectId = await resolveProjectId(parsed.projectSlug ?? (await resolveDefaultProjectSlug()));

  return prisma.partner.create({
    data: {
      projectId,
      name: parsed.name,
      partnerType: parsed.partnerType,
    },
  });
}

export async function listPartners(projectSlug?: string) {
  const projectId = await resolveProjectId(projectSlug ?? (await resolveDefaultProjectSlug()));
  return prisma.partner.findMany({
    where: { projectId, status: { not: "archived" } },
    orderBy: { name: "asc" },
    include: {
      customerLinks: { include: { customer: true } },
      contacts: { where: { archivedAt: null }, orderBy: { createdAt: "asc" }, take: 1 },
      _count: { select: { contacts: true, opportunities: true } },
    },
  });
}

export async function getPartnerDetail(id: string) {
  return prisma.partner.findUnique({
    where: { id },
    include: {
      contacts: { where: { archivedAt: null } },
      customerLinks: { include: { customer: true } },
      workTasks: { orderBy: { dueAt: "asc" }, take: 10 },
    },
  });
}

export async function updatePartner(id: string, input: z.infer<typeof updatePartnerSchema>) {
  const parsed = updatePartnerSchema.parse(input);
  const partner = await prisma.partner.update({
    where: { id },
    data: parsed,
  });

  // Best-effort decision spine capture — outside txn, never throws.
  await recordDecision({
    projectId: partner.projectId,
    domain: "sales",
    actor: "human",
    actionType: "entity_edit",
    caseRef: caseRefFor("partner", id),
    outcome: "corrected",
    humanEdit: parsed,
  });

  return partner;
}

export async function archivePartner(id: string) {
  // Direct update, not updatePartner — archive must leave exactly one
  // entity_archive spine row, not an extra entity_edit from the delegate.
  const partner = await prisma.partner.update({
    where: { id },
    data: { status: "archived" },
  });
  // Best-effort decision spine capture — outside txn, never throws.
  await recordDecision({
    projectId: partner.projectId,
    domain: "sales",
    actor: "human",
    actionType: "entity_archive",
    caseRef: caseRefFor("partner", id),
    outcome: "approved",
  });
  return partner;
}

export async function createContact(input: z.infer<typeof createContactSchema>) {
  const parsed = createContactSchema.parse(input);
  if (!parsed.customerId && !parsed.partnerId) {
    throw new Error("contact_parent_required");
  }

  const contact = await prisma.contact.create({ data: parsed });

  if (parsed.customerId) {
    await prisma.customerActivityLog.create({
      data: {
        customerId: parsed.customerId,
        activityType: "contact_added",
        summary: `Contact ${contact.name} added`,
      },
    });
  }

  return contact;
}

export async function getContactDetail(id: string) {
  return prisma.contact.findUnique({
    where: { id },
    include: {
      customer: { select: { projectId: true } },
      partner: { select: { projectId: true } },
    },
  });
}

export async function updateContact(id: string, input: z.infer<typeof updateContactSchema>) {
  const parsed = updateContactSchema.parse(input);
  const existing = await getContactDetail(id);
  if (!existing || existing.archivedAt) throw new Error("contact_not_found");
  const projectId = existing.customer?.projectId ?? existing.partner?.projectId;
  if (!projectId) throw new Error("contact_parent_required");

  const contact = await prisma.contact.update({ where: { id }, data: parsed });
  await recordDecision({
    projectId,
    domain: "sales",
    actor: "human",
    actionType: "entity_edit",
    caseRef: caseRefFor("contact", id),
    outcome: "corrected",
    humanEdit: parsed,
  });
  return contact;
}

export async function archiveContact(id: string) {
  const existing = await getContactDetail(id);
  if (!existing) throw new Error("contact_not_found");
  const projectId = existing.customer?.projectId ?? existing.partner?.projectId;
  if (!projectId) throw new Error("contact_parent_required");

  const contact = await prisma.contact.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  await recordDecision({
    projectId,
    domain: "sales",
    actor: "human",
    actionType: "entity_archive",
    caseRef: caseRefFor("contact", id),
    outcome: "approved",
  });
  return contact;
}

export async function linkCustomerPartner(
  customerId: string,
  partnerId: string,
  linkType = "reseller",
) {
  const link = await prisma.customerPartnerLink.upsert({
    where: { customerId_partnerId: { customerId, partnerId } },
    update: { linkType },
    create: { customerId, partnerId, linkType },
  });

  await prisma.customerActivityLog.create({
    data: {
      customerId,
      activityType: "partner_linked",
      summary: `Partner linked (${linkType})`,
      metadata: { partnerId },
    },
  });

  return link;
}

export async function findConnectionCandidatesByEmail(ctx: AuthContext, email: string) {
  const domain = email.includes("@") ? email.split("@")[1]?.toLowerCase() : null;
  return withRlsTransaction(ctx, async (tx) => {
    await resolveActorAssignment(tx, ctx, "customer.read");
    const [contacts, customers] = await Promise.all([
      tx.contact.findMany({
        where: {
          email: { equals: email, mode: "insensitive" },
          OR: [
            { customer: { projectId: ctx.projectId, archivedAt: null } },
            { partner: { projectId: ctx.projectId } },
          ],
        },
        include: { customer: true, partner: true },
        take: 5,
      }),
      domain
        ? tx.customer.findMany({
            where: {
              projectId: ctx.projectId,
              archivedAt: null,
              domain: { equals: domain, mode: "insensitive" },
            },
            take: 5,
          })
        : Promise.resolve([]),
    ]);
    return { contacts, customers };
  });
}
