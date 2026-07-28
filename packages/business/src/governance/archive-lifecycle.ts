import type { AuthContext } from "@sangfor/auth";
import { Prisma, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "./audit-db";

export class ArchiveError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ArchiveError";
    this.code = code;
    this.httpStatus = status;
  }
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

export type ArchiveEntityType =
  | "customer"
  | "partner"
  | "contact"
  | "opportunity"
  | "task"
  | "poc"
  | "proposal";

export type ListArchivedEntitiesInput = {
  authContext: AuthContext;
  entityType?: ArchiveEntityType;
  limit?: number;
};

export async function listArchivedEntities(input: ListArchivedEntitiesInput) {
  const { authContext, entityType, limit: rawLimit } = input;
  const limit = Math.min(Math.max(rawLimit ?? 50, 1), 50);
  const scope = rlsScope(authContext);

  return withRlsTransaction(scope, async (tx) => {
    let nodes: any[] = [];
    let totalCount = 0;

    if (!entityType || entityType === "customer") {
      const customers = await tx.customer.findMany({
        where: { status: "archived" },
        take: limit + 1,
        orderBy: { updatedAt: "desc" },
      });
      totalCount += customers.length;
      nodes.push(...customers.map((c: any) => ({ ...c, entityType: "customer" })));
    }

    if (!entityType || entityType === "partner") {
      const partners = await tx.partner.findMany({
        where: { status: "archived" },
        take: limit + 1,
        orderBy: { updatedAt: "desc" },
      });
      totalCount += partners.length;
      nodes.push(...partners.map((p: any) => ({ ...p, entityType: "partner" })));
    }

    if (!entityType || entityType === "contact") {
      const contacts = await tx.contact.findMany({
        where: { archivedAt: { not: null } },
        take: limit + 1,
        orderBy: { updatedAt: "desc" },
      });
      totalCount += contacts.length;
      nodes.push(...contacts.map((c: any) => ({ ...c, entityType: "contact" })));
    }

    if (!entityType || entityType === "opportunity") {
      const opps = await tx.opportunity.findMany({
        where: { archivedAt: { not: null } },
        take: limit + 1,
        orderBy: { updatedAt: "desc" },
      });
      totalCount += opps.length;
      nodes.push(...opps.map((o: any) => ({ ...o, entityType: "opportunity" })));
    }

    if (!entityType || entityType === "task") {
      const tasks = await tx.workTask.findMany({
        where: { archivedAt: { not: null } },
        take: limit + 1,
        orderBy: { updatedAt: "desc" },
      });
      totalCount += tasks.length;
      nodes.push(...tasks.map((t: any) => ({ ...t, entityType: "task" })));
    }

    if (!entityType || entityType === "poc") {
      const pocs = await tx.pocProject.findMany({
        where: { status: "archived" },
        take: limit + 1,
        orderBy: { updatedAt: "desc" },
      });
      totalCount += pocs.length;
      nodes.push(...pocs.map((p: any) => ({ ...p, entityType: "poc" })));
    }

    if (!entityType || entityType === "proposal") {
      const oppProposals = await tx.opportunity.findMany({
        where: { dealStatus: "LOST" },
        take: limit + 1,
        orderBy: { updatedAt: "desc" },
      });
      totalCount += oppProposals.length;
      nodes.push(...oppProposals.map((pr: any) => ({ ...pr, entityType: "proposal" })));
    }

    const truncated = nodes.length > limit;
    const boundedNodes = nodes.slice(0, limit);

    return {
      nodes: boundedNodes,
      totalCount: Math.max(totalCount, boundedNodes.length),
      truncated,
    };
  });
}

export type RestoreArchivedEntityInput = {
  authContext: AuthContext;
  entityType: ArchiveEntityType;
  id: string;
  expectedVersion: string;
  restoreStatus?: string;
};

export async function restoreArchivedEntity(input: RestoreArchivedEntityInput) {
  const { authContext, entityType, id, expectedVersion, restoreStatus } = input;
  const scope = rlsScope(authContext);

  // Validate status matrix rules
  if (["customer", "partner"].includes(entityType)) {
    if (!restoreStatus) throw new ArchiveError("restore_status_required", "restoreStatus is required", 400);
    if (!["active", "inactive"].includes(restoreStatus)) {
      throw new ArchiveError("restore_status_invalid", "restoreStatus must be active | inactive", 400);
    }
  } else if (entityType === "poc") {
    if (!restoreStatus) throw new ArchiveError("restore_status_required", "restoreStatus is required", 400);
    if (!["planning", "in_progress", "completed"].includes(restoreStatus)) {
      throw new ArchiveError("restore_status_invalid", "restoreStatus must be planning | in_progress | completed", 400);
    }
  } else if (entityType === "proposal") {
    if (!restoreStatus) throw new ArchiveError("restore_status_required", "restoreStatus is required", 400);
    if (!["draft", "approved"].includes(restoreStatus)) {
      throw new ArchiveError("restore_status_invalid", "restoreStatus must be draft | approved", 400);
    }
  } else {
    // contact, opportunity, task use archivedAt != null
    if (restoreStatus !== undefined) {
      throw new ArchiveError("restore_status_not_applicable", "restoreStatus not applicable for this entityType", 400);
    }
  }

  return withRlsTransaction(scope, async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`archive-restore:${entityType}:${id}`}, 0))`,
    );

    let modelName = entityType === "poc" ? "pocProject" : entityType === "task" ? "workTask" : entityType === "proposal" ? "opportunity" : entityType;
    let targetModel = (tx as any)[modelName];

    const existing = await targetModel.findUnique({ where: { id } });
    if (!existing) {
      throw new ArchiveError("NOT_FOUND", `${entityType} with id ${id} not found`, 404);
    }

    // Check if already restored
    const isArchived = ["customer", "partner", "poc", "proposal"].includes(entityType)
      ? existing.status === "archived" || existing.dealStatus === "LOST"
      : existing.archivedAt !== null;

    if (!isArchived) {
      return { restored: false, reason: "already_restored" };
    }

    // CAS check on version (updatedAt)
    if (existing.updatedAt && existing.updatedAt.toISOString() !== expectedVersion) {
      throw new ArchiveError("archive_state_changed", "Archive state changed or version mismatch", 409);
    }

    const archivedWhere = ["customer", "partner", "poc"].includes(entityType)
      ? { status: "archived" }
      : entityType === "proposal"
        ? { dealStatus: "LOST" }
        : { archivedAt: { not: null } };
    let data: Record<string, unknown>;
    if (["customer", "partner", "poc"].includes(entityType)) {
      data = { status: restoreStatus };
    } else if (entityType === "proposal") {
      data = { dealStatus: "OPEN" };
    } else {
      data = { archivedAt: null };
    }

    const restored = await targetModel.updateMany({
      where: { id, updatedAt: existing.updatedAt, ...archivedWhere },
      data,
    });
    if (restored.count !== 1) {
      const current = await targetModel.findUnique({ where: { id } });
      const stillArchived = current && (["customer", "partner", "poc"].includes(entityType)
        ? current.status === "archived"
        : entityType === "proposal"
          ? current.dealStatus === "LOST"
          : current.archivedAt !== null);
      if (!stillArchived) return { restored: false, reason: "already_restored" };
      throw new ArchiveError("archive_state_changed", "Archive state changed or version mismatch", 409);
    }

    await appendAuditEvent(tx, {
      scope,
      eventType: "governance.archive.restored",
      actorId: authContext.userId,
      resourceType: entityType,
      resourceId: id,
      details: { entityType, id, restoreStatus },
      idempotencyKey: `archive-restore:${entityType}:${id}:${expectedVersion}`,
    });

    return { restored: true, id, entityType, restoreStatus: restoreStatus ?? "restored" };
  });
}
