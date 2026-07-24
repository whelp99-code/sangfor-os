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
  withRlsTransaction,
  type Prisma,
} from "@sangfor/db";
import { z } from "zod";

import { appendAuditEvent } from "../governance/audit-db";
import { deriveChainScopeKey, type AuditChainScope } from "../governance/audit-chain";
import { CrmServiceError } from "./customer-partner";
import {
  CANONICAL_STAGES,
  normalizeOpportunityStage,
  nextOpportunityStage,
  validateOpportunityStageOrder,
  validateRegistrationGate,
} from "./opportunity-stage";

type ScopedTransaction = Prisma.TransactionClient;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const boundedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum).refine((value) => !CONTROL_CHARACTERS.test(value), {
    message: "control_characters_not_allowed",
  });
const nullableText = (maximum: number) =>
  z.preprocess(
    (value) => value === "" ? null : value,
    z.string().trim().max(maximum).nullable().optional(),
  );
const idempotencyKeySchema = boundedText(1, 128);
const expectedUpdatedAtSchema = z.string().datetime({ offset: true });
const canonicalStageSchema = z.enum([
  "LEAD",
  "QUALIFIED",
  "PROPOSAL",
  "POC",
  "NEGOTIATION",
  "WON",
  "LOST",
]);

export const createOpportunitySchema = z.object({
  title: boundedText(2, 300),
  customerId: boundedText(1, 200).optional(),
  partnerId: boundedText(1, 200).optional(),
  amount: z.number().finite().nonnegative().optional(),
  probability: z.number().int().min(0).max(100).default(20),
  closeDate: z.string().datetime({ offset: true }).optional(),
  nextAction: nullableText(2_000),
  dealType: boundedText(1, 100).optional(),
}).strict();

export const createOpportunityCommandSchema = createOpportunitySchema.extend({
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const updateOpportunityChangesSchema = z.object({
  title: boundedText(2, 300).optional(),
  stage: canonicalStageSchema.optional(),
  amount: z.number().finite().nonnegative().nullable().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  closeDate: z.string().datetime({ offset: true }).nullable().optional(),
  nextAction: nullableText(2_000),
  partnerId: boundedText(1, 200).nullable().optional(),
  customerId: boundedText(1, 200).nullable().optional(),
  dealStatus: z.enum(["OPEN", "WON", "LOST", "ON_HOLD", "DISQUALIFIED"]).optional(),
  dealType: boundedText(1, 100).optional(),
  lostReason: nullableText(2_000),
}).strict().refine((changes) => Object.keys(changes).length > 0, {
  message: "opportunity_changes_required",
});

export const updateOpportunitySchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  changes: updateOpportunityChangesSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const opportunityOwnerAssignmentSchema = z.object({
  ownerAssignmentId: boundedText(1, 200),
  expectedOwnershipRevision: z.number().int().nonnegative(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const opportunityArchiveSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const opportunityAdvanceSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const opportunityConversionCommandSchema = z.object({
  opportunityId: boundedText(1, 200),
  expectedUpdatedAt: expectedUpdatedAtSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const addOpportunityLinkSchema = z.object({
  entityType: z.enum(["poc", "proposal", "partner", "customer"]),
  entityId: boundedText(1, 200),
  linkType: boundedText(1, 100).default("related"),
  expectedUpdatedAt: expectedUpdatedAtSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const removeOpportunityLinkSchema = z.object({
  linkId: boundedText(1, 200),
  expectedUpdatedAt: expectedUpdatedAtSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const opportunityListQuerySchema = z.object({
  first: z.coerce.number().int().min(1).max(100).default(50),
  cursor: boundedText(1, 4096).optional(),
  ownerAssignmentId: boundedText(1, 200).optional(),
  stage: canonicalStageSchema.optional(),
  search: boundedText(1, 200).optional(),
}).strict();

export type OpportunityListQuery = z.input<typeof opportunityListQuerySchema>;
export type CreateOpportunityCommand = z.input<typeof createOpportunityCommandSchema>;
export type UpdateOpportunityCommand = z.input<typeof updateOpportunitySchema>;
export type OpportunityOwnerAssignmentCommand = z.input<typeof opportunityOwnerAssignmentSchema>;
export type OpportunityArchiveCommand = z.input<typeof opportunityArchiveSchema>;
export type OpportunityAdvanceCommand = z.input<typeof opportunityAdvanceSchema>;
export type OpportunityConversionCommand = z.input<typeof opportunityConversionCommandSchema>;

export interface ScopedOpportunityForConversion {
  id: string;
  projectId: string;
  customerId: string | null;
  title: string;
  stage: string;
  updatedAt: Date;
}

export type OpportunityConversionMaterializer<T extends Record<string, unknown>> = (
  tx: ScopedTransaction,
  opportunity: ScopedOpportunityForConversion,
) => Promise<T>;

function parseCommand<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CrmServiceError("VALIDATION_ERROR", 422, "invalid_opportunity_command");
  }
  return parsed.data;
}

interface PersistedActorAssignment {
  id: string;
  userId: string;
  companyId: string;
  role: string;
  status: string | null;
  validFrom: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface VerifiedOpportunityIdentity {
  userId: string;
  sessionId: string | null;
  tenantId: string;
  companyId: string;
  projectId: string;
  product?: string;
}

async function resolveActor(
  tx: ScopedTransaction,
  ctx: AuthContext | VerifiedOpportunityIdentity,
  permission: BusinessPermission,
): Promise<PersistedActorAssignment> {
  const now = new Date();
  const [assignments, projectAssignment] = await Promise.all([
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
  const resolved = resolveActiveCompanyRole(assignments, now);
  if (!resolved.ok || !isActiveProjectAssignment(projectAssignment, now)) {
    throw new CrmServiceError("FORBIDDEN", 403, "opportunity_assignment_denied");
  }
  if (!hasCapability(resolved.role, permission)) {
    throw new CrmServiceError("FORBIDDEN", 403, `crm_capability_denied:${permission}`);
  }
  return resolved.assignment as PersistedActorAssignment;
}

export async function resolveOpportunityAuthContext(
  identity: VerifiedOpportunityIdentity,
): Promise<AuthContext> {
  return withRlsTransaction(identity, async (tx) => {
    const actor = await resolveActor(tx, identity, "opportunity.read");
    const resolved = resolveActiveCompanyRole([actor], new Date());
    if (!resolved.ok) {
      throw new CrmServiceError("FORBIDDEN", 403, "opportunity_assignment_denied");
    }
    return {
      ...identity,
      businessRole: resolved.role,
      permissions: resolveCapabilities(resolved.role),
    };
  });
}

async function validateTargetOwner(
  tx: ScopedTransaction,
  ctx: AuthContext,
  ownerAssignmentId: string,
): Promise<PersistedActorAssignment> {
  const target = await tx.userCompanyRole.findFirst({
    where: { id: ownerAssignmentId, companyId: ctx.companyId },
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
  });
  if (!target) throw new CrmServiceError("FORBIDDEN", 403, "opportunity_owner_denied");
  const resolved = resolveActiveCompanyRole([target], new Date());
  if (!resolved.ok || !hasCapability(resolved.role, "opportunity.write")) {
    throw new CrmServiceError("FORBIDDEN", 403, "opportunity_owner_denied");
  }
  const membership = await tx.projectMember.findFirst({
    where: { userId: target.userId, projectId: ctx.projectId },
    select: {
      id: true,
      userId: true,
      projectId: true,
      status: true,
      validFrom: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!isActiveProjectAssignment(membership, new Date())) {
    throw new CrmServiceError("FORBIDDEN", 403, "opportunity_owner_project_denied");
  }
  return target as PersistedActorAssignment;
}

function auditScope(ctx: AuthContext): AuditChainScope {
  return {
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    projectId: ctx.projectId,
    level: "PROJECT",
  };
}

function inputHash(
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

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function lockAuditChain(tx: ScopedTransaction, scope: AuditChainScope): Promise<void> {
  const scopeKey = deriveChainScopeKey(scope);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`;
}

async function replay<T>(
  tx: ScopedTransaction,
  scope: AuditChainScope,
  idempotencyKey: string,
  contract: string,
  hash: string,
): Promise<T | null> {
  const row = await tx.auditLog.findFirst({
    where: { chainScopeKey: deriveChainScopeKey(scope), idempotencyKey },
    select: { details: true },
  });
  if (!row) return null;
  const details = asObject(row.details);
  if (details?.contract !== contract || details.inputHash !== hash || !details.result) {
    throw new CrmServiceError("CONFLICT", 409, "idempotency_key_reused");
  }
  return details.result as T;
}

function receiptResult<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

interface OpportunityCursorFilter {
  ownerAssignmentId: string | null;
  archived: false;
  stage?: string | null;
  search?: string | null;
}

interface OpportunityCursorPayload {
  version: 1;
  kind: "opportunity";
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
      return createHmac("sha256", secret).update("sangfor.crm.opportunity-cursor/v1").digest();
    }
  } catch {
    // Return the stable, non-secret configuration error below.
  }
  throw new CrmServiceError("CONFIGURATION_ERROR", 503, "crm_cursor_signing_key_unavailable");
}

function filterHash(filter: OpportunityCursorFilter): string {
  return createHash("sha256").update(canonicalizeRfc8785(filter)).digest("hex");
}

function encodeCursor(
  boundary: { updatedAt: Date; id: string },
  projectId: string,
  filter: OpportunityCursorFilter,
): string {
  const body = Buffer.from(canonicalizeRfc8785({
    version: 1,
    kind: "opportunity",
    projectId,
    filterHash: filterHash(filter),
    updatedAt: boundary.updatedAt.toISOString(),
    id: boundary.id,
  } satisfies OpportunityCursorPayload), "utf8").toString("base64url");
  const signature = createHmac("sha256", cursorSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function decodeCursor(
  cursor: string,
  projectId: string,
  filter: OpportunityCursorFilter,
): { updatedAt: Date; id: string } {
  const [body, signature, extra] = cursor.split(".");
  if (!body || !signature || extra) {
    throw new CrmServiceError("VALIDATION_ERROR", 422, "invalid_opportunity_cursor");
  }
  if (
    Buffer.from(body, "base64url").toString("base64url") !== body
    || Buffer.from(signature, "base64url").toString("base64url") !== signature
  ) {
    throw new CrmServiceError("VALIDATION_ERROR", 422, "invalid_opportunity_cursor");
  }
  const expected = createHmac("sha256", cursorSecret()).update(body).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new CrmServiceError("VALIDATION_ERROR", 422, "invalid_opportunity_cursor");
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OpportunityCursorPayload;
    const updatedAt = new Date(payload.updatedAt);
    if (
      payload.version !== 1
      || payload.kind !== "opportunity"
      || payload.projectId !== projectId
      || payload.filterHash !== filterHash(filter)
      || typeof payload.id !== "string"
      || Number.isNaN(updatedAt.getTime())
    ) {
      throw new Error("cursor_contract_mismatch");
    }
    return { updatedAt, id: payload.id };
  } catch {
    throw new CrmServiceError("VALIDATION_ERROR", 422, "invalid_opportunity_cursor");
  }
}

function whereAfter(boundary: { updatedAt: Date; id: string }) {
  return {
    OR: [
      { updatedAt: { lt: boundary.updatedAt } },
      { updatedAt: boundary.updatedAt, id: { lt: boundary.id } },
    ],
  };
}

function pageSize(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value <= 0) throw new Error("page size must be positive");
  if (value > 100) throw new Error("page size must not exceed 100");
  return value;
}

export const __opportunityCursor = {
  encode: encodeCursor,
  decode: decodeCursor,
  whereAfter,
  pageSize,
};

export async function withScopedOpportunityRead<T>(
  ctx: AuthContext,
  callback: (tx: ScopedTransaction) => Promise<T>,
): Promise<T> {
  return withRlsTransaction(ctx, async (tx) => {
    await resolveActor(tx, ctx, "opportunity.read");
    return callback(tx);
  });
}

export async function listOpportunities(ctx: AuthContext, rawQuery: OpportunityListQuery = {}) {
  const query = opportunityListQuerySchema.parse(rawQuery);
  const filter: OpportunityCursorFilter = {
    ownerAssignmentId: query.ownerAssignmentId ?? null,
    archived: false,
    stage: query.stage ?? null,
    search: query.search ?? null,
  };
  const boundary = query.cursor ? decodeCursor(query.cursor, ctx.projectId, filter) : null;
  return withRlsTransaction(ctx, async (tx) => {
    await resolveActor(tx, ctx, "opportunity.read");
    const rows = await tx.opportunity.findMany({
      where: {
        projectId: ctx.projectId,
        archivedAt: null,
        ...(query.ownerAssignmentId ? { ownerAssignmentId: query.ownerAssignmentId } : {}),
        ...(query.stage ? { stage: query.stage } : {}),
        ...(query.search ? { title: { contains: query.search, mode: "insensitive" } } : {}),
        ...(boundary ? { AND: [whereAfter(boundary)] } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: query.first + 1,
      include: {
        customer: true,
        partner: true,
        ownerAssignment: {
          select: { id: true, userId: true, role: true, status: true },
        },
        links: true,
        dealRegistration: true,
      },
    });
    const items = rows.slice(0, query.first);
    const last = rows.length > query.first ? items.at(-1) : null;
    return {
      items,
      nextCursor: last ? encodeCursor(last, ctx.projectId, filter) : null,
    };
  });
}

export async function getOpportunityDetail(ctx: AuthContext, id: string) {
  return withRlsTransaction(ctx, async (tx) => {
    await resolveActor(tx, ctx, "opportunity.read");
    return tx.opportunity.findFirst({
      where: { id, projectId: ctx.projectId, archivedAt: null },
      include: {
        customer: true,
        partner: true,
        distributor: true,
        ownerAssignment: {
          select: { id: true, userId: true, role: true, status: true },
        },
        links: { orderBy: { createdAt: "desc" } },
        stageEvents: { orderBy: { createdAt: "desc" } },
        qualification: { include: { economicBuyer: true, champion: true } },
        dealRegistration: { include: { distributor: true } },
      },
    });
  });
}

export async function listEligibleOpportunityOwners(ctx: AuthContext) {
  return withRlsTransaction(ctx, async (tx) => {
    await resolveActor(tx, ctx, "opportunity.read");
    const assignments = await tx.userCompanyRole.findMany({
      where: { companyId: ctx.companyId },
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
      orderBy: [{ role: "asc" }, { id: "asc" }],
    });
    const now = new Date();
    const eligible: Array<{ id: string; userId: string; role: string }> = [];
    for (const assignment of assignments) {
      const resolved = resolveActiveCompanyRole([assignment], now);
      if (!resolved.ok || !hasCapability(resolved.role, "opportunity.write")) continue;
      const membership = await tx.projectMember.findFirst({
        where: { userId: assignment.userId, projectId: ctx.projectId },
        select: {
          id: true,
          userId: true,
          projectId: true,
          status: true,
          validFrom: true,
          expiresAt: true,
          revokedAt: true,
        },
      });
      if (!isActiveProjectAssignment(membership, now)) continue;
      eligible.push({ id: assignment.id, userId: assignment.userId, role: assignment.role });
    }
    return eligible;
  });
}

async function validateRelatedScope(
  tx: ScopedTransaction,
  ctx: AuthContext,
  input: { customerId?: string | null; partnerId?: string | null },
): Promise<void> {
  if (input.customerId) {
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, projectId: ctx.projectId, archivedAt: null },
      select: { id: true },
    });
    if (!customer) throw new CrmServiceError("NOT_FOUND", 404, "customer_not_found");
  }
  if (input.partnerId) {
    const partner = await tx.partner.findFirst({
      where: { id: input.partnerId, projectId: ctx.projectId, status: { not: "archived" } },
      select: { id: true },
    });
    if (!partner) throw new CrmServiceError("NOT_FOUND", 404, "partner_not_found");
  }
}

export async function createOpportunity(ctx: AuthContext, rawCommand: CreateOpportunityCommand) {
  return withRlsTransaction(ctx, (tx) =>
    createOpportunityInScopedTransaction(tx, ctx, rawCommand));
}

/** @internal Transaction-aware entrypoint for the U043 mail conversion coordinator. */
export async function createOpportunityInScopedTransaction(
  tx: ScopedTransaction,
  ctx: AuthContext,
  rawCommand: CreateOpportunityCommand,
) {
  const command = createOpportunityCommandSchema.parse(rawCommand);
  const actor = await resolveActor(tx, ctx, "opportunity.write");
  const scope = auditScope(ctx);
  const contract = "sangfor.crm.opportunity.create/v1";
  const key = `opportunity.create:${command.idempotencyKey}`;
  const normalized = {
    title: command.title,
    customerId: command.customerId ?? null,
    partnerId: command.partnerId ?? null,
    amount: command.amount ?? null,
    probability: command.probability,
    closeDate: command.closeDate ?? null,
    nextAction: command.nextAction ?? null,
    dealType: command.dealType ?? null,
  };
  const hash = inputHash(contract, ctx, actor.id, normalized);
  await lockAuditChain(tx, scope);
  const prior = await replay<Record<string, unknown>>(tx, scope, key, contract, hash);
  if (prior) return prior;
  await validateRelatedScope(tx, ctx, command);
  const opportunity = await tx.opportunity.create({
    data: {
      projectId: ctx.projectId,
      title: command.title,
      customerId: command.customerId,
      partnerId: command.partnerId,
      stage: "LEAD",
      amount: command.amount,
      probability: command.probability,
      closeDate: command.closeDate ? new Date(command.closeDate) : undefined,
      nextAction: command.nextAction,
      dealType: command.dealType,
      ownerAssignmentId: actor.id,
    },
  });
  await tx.opportunityStageEvent.create({
    data: { opportunityId: opportunity.id, toStage: "LEAD", note: "Opportunity created" },
  });
  const result = receiptResult(opportunity);
  await appendAuditEvent(tx, {
    scope,
    eventType: "opportunity.created",
    actorId: actor.id,
    resourceType: "opportunity",
    resourceId: opportunity.id,
    idempotencyKey: key,
    details: { contract, inputHash: hash, actorAssignmentId: actor.id, result },
  });
  return opportunity;
}

function canonicalMailOpportunityKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

/** @internal Project-local canonical merge used only by the U043 mail conversion coordinator. */
export async function mergeMailDerivedOpportunityInScopedTransaction(
  tx: ScopedTransaction,
  ctx: AuthContext,
  input: {
    title: string;
    probability: number;
    nextAction?: string | null;
    idempotencyKey: string;
  },
) {
  await resolveActor(tx, ctx, "opportunity.write");
  const key = canonicalMailOpportunityKey(input.title);
  const scoped = await tx.opportunity.findMany({
    where: { projectId: ctx.projectId, archivedAt: null },
    select: {
      id: true,
      projectId: true,
      title: true,
      stage: true,
      customerId: true,
      partnerId: true,
      amount: true,
      probability: true,
      closeDate: true,
      nextAction: true,
      ownerAssignmentId: true,
      ownershipRevision: true,
      updatedAt: true,
      createdAt: true,
      archivedAt: true,
    },
  });
  const existing = scoped.find(
    (opportunity) => canonicalMailOpportunityKey(opportunity.title) === key,
  );
  if (existing) return { entity: existing, created: false };
  const entity = await createOpportunityInScopedTransaction(tx, ctx, {
    title: input.title,
    probability: input.probability,
    nextAction: input.nextAction ?? null,
    idempotencyKey: input.idempotencyKey,
  });
  return { entity, created: true };
}

export async function updateOpportunity(
  ctx: AuthContext,
  id: string,
  rawCommand: UpdateOpportunityCommand,
) {
  const command = updateOpportunitySchema.parse(rawCommand);
  return withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveActor(tx, ctx, "opportunity.write");
    const scope = auditScope(ctx);
    const contract = "sangfor.crm.opportunity.update/v1";
    const key = `opportunity.update:${command.idempotencyKey}`;
    const normalized = { opportunityId: id, ...command };
    const hash = inputHash(contract, ctx, actor.id, normalized);
    await lockAuditChain(tx, scope);
    const prior = await replay<Record<string, unknown>>(tx, scope, key, contract, hash);
    if (prior) return prior;
    const existing = await tx.opportunity.findFirst({
      where: { id, projectId: ctx.projectId, archivedAt: null },
      include: { dealRegistration: { select: { regStatus: true } } },
    });
    if (!existing) throw new CrmServiceError("NOT_FOUND", 404, "opportunity_not_found");
    await validateRelatedScope(tx, ctx, command.changes);

    const changes = { ...command.changes } as Record<string, unknown>;
    if (command.changes.closeDate !== undefined) {
      changes.closeDate = command.changes.closeDate ? new Date(command.changes.closeDate) : null;
    }
    if (command.changes.stage && command.changes.stage !== existing.stage) {
      const order = validateOpportunityStageOrder(existing.stage, command.changes.stage);
      if (!order.allowed) {
        throw new CrmServiceError("CONFLICT", 409, `illegal_stage_transition:${order.reason}`);
      }
      const gate = validateRegistrationGate({
        from: existing.stage,
        to: command.changes.stage,
        dealType: command.changes.dealType ?? existing.dealType,
        regStatus: existing.dealRegistration?.regStatus ?? null,
      });
      if (!gate.allowed) {
        throw new CrmServiceError("CONFLICT", 409, `registration_gate:${gate.reason}`);
      }
    }
    const changed = await tx.opportunity.updateMany({
      where: {
        id,
        projectId: ctx.projectId,
        archivedAt: null,
        updatedAt: new Date(command.expectedUpdatedAt),
      },
      data: changes,
    });
    if (changed.count !== 1) {
      throw new CrmServiceError("CONFLICT", 409, "opportunity_version_conflict");
    }
    if (command.changes.stage && command.changes.stage !== existing.stage) {
      await tx.opportunityStageEvent.create({
        data: {
          opportunityId: id,
          fromStage: normalizeOpportunityStage(existing.stage),
          toStage: command.changes.stage,
          note: "Stage updated",
        },
      });
    }
    const opportunity = await tx.opportunity.findFirst({
      where: { id, projectId: ctx.projectId, archivedAt: null },
    });
    if (!opportunity) throw new CrmServiceError("CONFLICT", 409, "opportunity_version_conflict");
    const result = receiptResult(opportunity);
    await appendAuditEvent(tx, {
      scope,
      eventType: "opportunity.updated",
      actorId: actor.id,
      resourceType: "opportunity",
      resourceId: id,
      idempotencyKey: key,
      details: {
        contract,
        inputHash: hash,
        actorAssignmentId: actor.id,
        previousStage: existing.stage,
        result,
      },
    });
    return opportunity;
  });
}

export async function assignOpportunityOwner(
  ctx: AuthContext,
  id: string,
  rawCommand: OpportunityOwnerAssignmentCommand,
) {
  const command = opportunityOwnerAssignmentSchema.parse(rawCommand);
  return withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveActor(tx, ctx, "opportunity.write");
    const scope = auditScope(ctx);
    const contract = "sangfor.crm.opportunity.owner-assignment/v1";
    const key = `opportunity.owner:${command.idempotencyKey}`;
    const normalized = { opportunityId: id, ...command };
    const hash = inputHash(contract, ctx, actor.id, normalized);
    await lockAuditChain(tx, scope);
    const prior = await replay<Record<string, unknown>>(tx, scope, key, contract, hash);
    if (prior) return prior;
    await validateTargetOwner(tx, ctx, command.ownerAssignmentId);
    const existing = await tx.opportunity.findFirst({
      where: { id, projectId: ctx.projectId, archivedAt: null },
      select: { id: true, ownerAssignmentId: true, ownershipRevision: true, ownerId: true },
    });
    if (!existing) throw new CrmServiceError("NOT_FOUND", 404, "opportunity_not_found");
    if (existing.ownershipRevision !== command.expectedOwnershipRevision) {
      throw new CrmServiceError("CONFLICT", 409, "opportunity_owner_conflict");
    }
    if (existing.ownerAssignmentId === command.ownerAssignmentId) {
      throw new CrmServiceError("CONFLICT", 409, "opportunity_owner_unchanged");
    }
    const changed = await tx.opportunity.updateMany({
      where: {
        id,
        projectId: ctx.projectId,
        archivedAt: null,
        ownerAssignmentId: existing.ownerAssignmentId,
        ownershipRevision: command.expectedOwnershipRevision,
      },
      data: {
        ownerAssignmentId: command.ownerAssignmentId,
        ownershipRevision: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      throw new CrmServiceError("CONFLICT", 409, "opportunity_owner_conflict");
    }
    const opportunity = await tx.opportunity.findFirst({
      where: { id, projectId: ctx.projectId, archivedAt: null },
    });
    if (!opportunity) throw new CrmServiceError("CONFLICT", 409, "opportunity_owner_conflict");
    const result = receiptResult(opportunity);
    await appendAuditEvent(tx, {
      scope,
      eventType: "opportunity.owner_assigned",
      actorId: actor.id,
      resourceType: "opportunity",
      resourceId: id,
      idempotencyKey: key,
      details: {
        contract,
        inputHash: hash,
        actorAssignmentId: actor.id,
        previousOwnerAssignmentId: existing.ownerAssignmentId,
        legacyOwnerId: existing.ownerId,
        result,
      },
    });
    return opportunity;
  });
}

export async function advanceOpportunityStage(
  ctx: AuthContext,
  id: string,
  rawCommand: OpportunityAdvanceCommand,
) {
  const command = opportunityAdvanceSchema.parse(rawCommand);
  const detail = await getOpportunityDetail(ctx, id);
  if (!detail) throw new CrmServiceError("NOT_FOUND", 404, "opportunity_not_found");
  const next = nextOpportunityStage(detail.stage);
  if (!next) throw new CrmServiceError("CONFLICT", 409, "cannot_advance_stage");
  return updateOpportunity(ctx, id, {
    expectedUpdatedAt: command.expectedUpdatedAt,
    changes: { stage: next },
    idempotencyKey: command.idempotencyKey,
  });
}

export async function archiveOpportunity(
  ctx: AuthContext,
  id: string,
  rawCommand: OpportunityArchiveCommand,
) {
  const command = opportunityArchiveSchema.parse(rawCommand);
  return withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveActor(tx, ctx, "opportunity.write");
    const scope = auditScope(ctx);
    const contract = "sangfor.crm.opportunity.archive/v1";
    const key = `opportunity.archive:${command.idempotencyKey}`;
    const hash = inputHash(contract, ctx, actor.id, { opportunityId: id, ...command });
    await lockAuditChain(tx, scope);
    const prior = await replay<Record<string, unknown>>(tx, scope, key, contract, hash);
    if (prior) return prior;
    const archivedAt = new Date();
    const changed = await tx.opportunity.updateMany({
      where: {
        id,
        projectId: ctx.projectId,
        archivedAt: null,
        updatedAt: new Date(command.expectedUpdatedAt),
      },
      data: { archivedAt },
    });
    if (changed.count !== 1) {
      throw new CrmServiceError("CONFLICT", 409, "opportunity_version_conflict");
    }
    const opportunity = await tx.opportunity.findFirst({
      where: { id, projectId: ctx.projectId, archivedAt },
    });
    if (!opportunity) throw new CrmServiceError("CONFLICT", 409, "opportunity_version_conflict");
    const result = receiptResult(opportunity);
    await appendAuditEvent(tx, {
      scope,
      eventType: "opportunity.archived",
      actorId: actor.id,
      resourceType: "opportunity",
      resourceId: id,
      idempotencyKey: key,
      details: { contract, inputHash: hash, actorAssignmentId: actor.id, result },
    });
    return opportunity;
  });
}

export async function executeOpportunityConversion<T extends Record<string, unknown>>(
  ctx: AuthContext,
  rawCommand: OpportunityConversionCommand,
  materialize: OpportunityConversionMaterializer<T>,
): Promise<T> {
  const command = opportunityConversionCommandSchema.parse(rawCommand);
  return withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveActor(tx, ctx, "opportunity.write");
    const scope = auditScope(ctx);
    const contract = "sangfor.crm.opportunity.convert-to-engagement/v1";
    const key = `opportunity.convert:${command.idempotencyKey}`;
    const hash = inputHash(contract, ctx, actor.id, command);
    await lockAuditChain(tx, scope);
    const prior = await replay<T>(tx, scope, key, contract, hash);
    if (prior) return prior;

    const opportunity = await tx.opportunity.findFirst({
      where: {
        id: command.opportunityId,
        projectId: ctx.projectId,
        archivedAt: null,
      },
      select: {
        id: true,
        projectId: true,
        customerId: true,
        title: true,
        stage: true,
        updatedAt: true,
      },
    });
    if (!opportunity) {
      throw new CrmServiceError("NOT_FOUND", 404, "opportunity_not_found");
    }
    if (opportunity.updatedAt.getTime() !== new Date(command.expectedUpdatedAt).getTime()) {
      throw new CrmServiceError("CONFLICT", 409, "opportunity_version_conflict");
    }
    if (!new Set(["PROPOSAL", "POC", "NEGOTIATION", "WON"]).has(opportunity.stage)) {
      throw new CrmServiceError("CONFLICT", 409, "conversion_stage_not_ready");
    }
    const [pocLink, poc] = await Promise.all([
      tx.opportunityLink.findFirst({
        where: { opportunityId: opportunity.id, entityType: "poc" },
        select: { id: true },
      }),
      tx.pocProject.findFirst({
        where: { opportunityId: opportunity.id, projectId: ctx.projectId },
        select: { id: true },
      }),
    ]);
    if (!pocLink && !poc) {
      throw new CrmServiceError("CONFLICT", 409, "conversion_requires_poc");
    }

    const convertedAt = new Date();
    const claimed = await tx.opportunity.updateMany({
      where: {
        id: opportunity.id,
        projectId: ctx.projectId,
        archivedAt: null,
        updatedAt: new Date(command.expectedUpdatedAt),
      },
      data: { updatedAt: convertedAt },
    });
    if (claimed.count !== 1) {
      throw new CrmServiceError("CONFLICT", 409, "opportunity_version_conflict");
    }

    const result = await materialize(tx, opportunity);
    await tx.opportunityStageEvent.create({
      data: {
        opportunityId: opportunity.id,
        fromStage: normalizeOpportunityStage(opportunity.stage),
        toStage: normalizeOpportunityStage(opportunity.stage),
        note: "converted_to_project",
      },
    });
    await appendAuditEvent(tx, {
      scope,
      eventType: "opportunity.converted",
      actorId: actor.id,
      resourceType: "opportunity",
      resourceId: opportunity.id,
      idempotencyKey: key,
      details: {
        contract,
        inputHash: hash,
        actorAssignmentId: actor.id,
        result: receiptResult(result),
      },
    });
    return result;
  });
}

export async function addOpportunityLink(
  ctx: AuthContext,
  opportunityId: string,
  rawCommand: z.input<typeof addOpportunityLinkSchema>,
) {
  const command = addOpportunityLinkSchema.parse(rawCommand);
  return withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveActor(tx, ctx, "opportunity.write");
    const opportunity = await tx.opportunity.findFirst({
      where: {
        id: opportunityId,
        projectId: ctx.projectId,
        archivedAt: null,
        updatedAt: new Date(command.expectedUpdatedAt),
      },
      select: { id: true },
    });
    if (!opportunity) throw new CrmServiceError("CONFLICT", 409, "opportunity_version_conflict");
    if (command.entityType === "customer") {
      await validateRelatedScope(tx, ctx, { customerId: command.entityId });
    } else if (command.entityType === "partner") {
      await validateRelatedScope(tx, ctx, { partnerId: command.entityId });
    }
    const link = await tx.opportunityLink.upsert({
      where: {
        opportunityId_entityType_entityId: {
          opportunityId,
          entityType: command.entityType,
          entityId: command.entityId,
        },
      },
      update: { linkType: command.linkType },
      create: {
        opportunityId,
        entityType: command.entityType,
        entityId: command.entityId,
        linkType: command.linkType,
      },
    });
    await appendAuditEvent(tx, {
      scope: auditScope(ctx),
      eventType: "opportunity.link_added",
      actorId: actor.id,
      resourceType: "opportunity",
      resourceId: opportunityId,
      idempotencyKey: `opportunity.link.add:${command.idempotencyKey}`,
      details: { linkId: link.id, entityType: command.entityType, entityId: command.entityId },
    });
    return link;
  });
}

export async function removeOpportunityLink(
  ctx: AuthContext,
  opportunityId: string,
  rawCommand: z.input<typeof removeOpportunityLinkSchema>,
) {
  const command = removeOpportunityLinkSchema.parse(rawCommand);
  return withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveActor(tx, ctx, "opportunity.write");
    const opportunity = await tx.opportunity.findFirst({
      where: {
        id: opportunityId,
        projectId: ctx.projectId,
        archivedAt: null,
        updatedAt: new Date(command.expectedUpdatedAt),
      },
      select: { id: true },
    });
    if (!opportunity) throw new CrmServiceError("CONFLICT", 409, "opportunity_version_conflict");
    const deleted = await tx.opportunityLink.deleteMany({
      where: { id: command.linkId, opportunityId },
    });
    if (deleted.count !== 1) throw new CrmServiceError("NOT_FOUND", 404, "opportunity_link_not_found");
    await appendAuditEvent(tx, {
      scope: auditScope(ctx),
      eventType: "opportunity.link_removed",
      actorId: actor.id,
      resourceType: "opportunity",
      resourceId: opportunityId,
      idempotencyKey: `opportunity.link.remove:${command.idempotencyKey}`,
      details: { linkId: command.linkId },
    });
    return { ok: true as const };
  });
}

export type EnrichedOpportunityLink = {
  id: string;
  entityType: string;
  entityId: string;
  linkType: string;
  label: string;
  href: string | null;
};

export async function enrichOpportunityLinks(
  ctx: AuthContext,
  links: Array<{ id: string; entityType: string; entityId: string; linkType: string }>,
): Promise<EnrichedOpportunityLink[]> {
  return withRlsTransaction(ctx, async (tx) => {
    await resolveActor(tx, ctx, "opportunity.read");
    return Promise.all(links.map(async (link) => {
      let label = link.entityId;
      let href: string | null = null;
      if (link.entityType === "customer") {
        const row = await tx.customer.findFirst({
          where: { id: link.entityId, projectId: ctx.projectId, archivedAt: null },
          select: { name: true },
        });
        if (row) {
          label = row.name;
          href = `/customers/${link.entityId}`;
        }
      } else if (link.entityType === "partner") {
        const row = await tx.partner.findFirst({
          where: { id: link.entityId, projectId: ctx.projectId },
          select: { name: true },
        });
        if (row) {
          label = row.name;
          href = `/partners/${link.entityId}`;
        }
      } else if (link.entityType === "poc") {
        const row = await tx.pocProject.findFirst({
          where: { id: link.entityId, projectId: ctx.projectId },
          select: { title: true },
        });
        if (row) {
          label = row.title;
          href = `/poc/${link.entityId}`;
        }
      } else if (link.entityType === "proposal") {
        const row = await tx.generatedDocument.findFirst({
          where: { id: link.entityId, customer: { projectId: ctx.projectId } },
          select: { title: true },
        });
        if (row) {
          label = row.title;
          href = `/proposals/${link.entityId}`;
        }
      }
      return { ...link, label, href };
    }));
  });
}

export async function getOpportunityPipelineSummary(ctx: AuthContext) {
  return withRlsTransaction(ctx, async (tx) => {
    await resolveActor(tx, ctx, "opportunity.read");
    const rows = await tx.opportunity.findMany({
      where: { projectId: ctx.projectId, archivedAt: null },
      select: { stage: true },
    });
    const byStage: Record<string, number> = {};
    for (const stage of CANONICAL_STAGES) byStage[stage] = 0;
    for (const row of rows) {
      const stage = normalizeOpportunityStage(row.stage);
      byStage[stage] = (byStage[stage] ?? 0) + 1;
    }
    return { total: rows.length, byStage };
  });
}

export async function listQuotesByOpportunity(ctx: AuthContext, opportunityId: string) {
  return withRlsTransaction(ctx, async (tx) => {
    await resolveActor(tx, ctx, "opportunity.read");
    const opportunity = await tx.opportunity.findFirst({
      where: { id: opportunityId, projectId: ctx.projectId, archivedAt: null },
      select: { id: true },
    });
    if (!opportunity) throw new CrmServiceError("NOT_FOUND", 404, "opportunity_not_found");
    return tx.quote.findMany({
      where: { opportunityId },
      orderBy: { createdAt: "desc" },
    });
  });
}
