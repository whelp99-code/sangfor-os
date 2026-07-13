import { resolveDefaultProjectId, resolveDefaultProjectSlug } from "@sangfor/business";
import { prisma } from "@sangfor/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthBypassEnabled } from "@/lib/api-auth";
import {
  getVerifiedSessionFromRequest,
  isAuthConfigured,
} from "@/lib/auth/session";

export type ProjectScope = {
  readonly projectId: string;
  readonly projectSlug: string;
};

export type ProjectRelatedEntity =
  | "customer"
  | "partner"
  | "opportunity"
  | "poc"
  | "poc_project"
  | "proposal"
  | "engagement"
  | "mail_message";

export type ProjectReference = {
  readonly entityType: unknown;
  readonly entityId: unknown;
};

type ProjectScopeResult =
  | { readonly ok: true; readonly scope: ProjectScope }
  | { readonly ok: false; readonly response: NextResponse };

const resourceProjectSchema = z.union([
  z.object({ projectId: z.string() }),
  z.object({ template: z.object({ projectId: z.string() }) }),
  z.object({ opportunity: z.object({ projectId: z.string() }) }),
  z.object({
    customer: z.object({ projectId: z.string() }).nullable(),
    partner: z.object({ projectId: z.string() }).nullable(),
  }),
  z.object({ customer: z.object({ projectId: z.string() }) }),
]);

class ProjectScopeConfigurationError extends Error {
  constructor() {
    super("The configured default project id and slug do not identify the same project");
    this.name = "ProjectScopeConfigurationError";
  }
}

export async function resolveDefaultProjectScope(): Promise<ProjectScope> {
  const [projectId, projectSlug] = await Promise.all([
    resolveDefaultProjectId(),
    resolveDefaultProjectSlug(),
  ]);
  const project = await prisma.project.findFirst({
    where: { id: projectId, slug: projectSlug },
    select: { id: true },
  });
  if (!project) throw new ProjectScopeConfigurationError();
  return { projectId, projectSlug };
}

export async function resolveProjectScope(request: Request): Promise<ProjectScopeResult> {
  if (isAuthBypassEnabled() || !isAuthConfigured()) {
    return { ok: true, scope: await resolveDefaultProjectScope() };
  }

  const session = getVerifiedSessionFromRequest(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthorized", message: "Authentication required" },
        { status: 401 },
      ),
    };
  }

  const project = await prisma.project.findFirst({
    where: { id: session.projectId, slug: session.projectSlug },
    select: { id: true },
  });
  if (!project) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "forbidden", message: "Signed project scope is no longer valid" },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    scope: { projectId: session.projectId, projectSlug: session.projectSlug },
  };
}

export function enforceRequestedProject(
  scope: ProjectScope,
  requestedProjectSlug: unknown,
): NextResponse | null {
  if (requestedProjectSlug === undefined || requestedProjectSlug === scope.projectSlug) {
    return null;
  }
  return NextResponse.json(
    { error: "forbidden", message: "Project scope does not match the signed session" },
    { status: 403 },
  );
}

export function isResourceInProject(resource: unknown, scope: ProjectScope): boolean {
  const parsed = resourceProjectSchema.safeParse(resource);
  if (!parsed.success) return false;
  if ("projectId" in parsed.data) return parsed.data.projectId === scope.projectId;
  if ("template" in parsed.data) return parsed.data.template.projectId === scope.projectId;
  if ("opportunity" in parsed.data) return parsed.data.opportunity.projectId === scope.projectId;
  return (
    parsed.data.customer?.projectId === scope.projectId ||
    ("partner" in parsed.data && parsed.data.partner?.projectId === scope.projectId)
  );
}

async function relatedResourceExists(
  scope: ProjectScope,
  reference: ProjectReference,
): Promise<boolean> {
  if (reference.entityId === undefined || reference.entityId === null) return true;
  if (typeof reference.entityId !== "string" || reference.entityId.length === 0) return false;
  const where = { id: reference.entityId, projectId: scope.projectId };

  switch (reference.entityType) {
    case "customer":
      return Boolean(await prisma.customer.findFirst({ where, select: { id: true } }));
    case "partner":
      return Boolean(await prisma.partner.findFirst({ where, select: { id: true } }));
    case "opportunity":
      return Boolean(await prisma.opportunity.findFirst({ where, select: { id: true } }));
    case "poc":
    case "poc_project":
      return Boolean(await prisma.pocProject.findFirst({ where, select: { id: true } }));
    case "proposal":
      return Boolean(
        await prisma.generatedDocument.findFirst({
          where: { id: reference.entityId, template: { projectId: scope.projectId } },
          select: { id: true },
        }),
      );
    case "engagement":
      return Boolean(
        await prisma.engagement.findFirst({
          where: {
            id: reference.entityId,
            OR: [
              { projectId: scope.projectId },
              { projectId: null, opportunity: { projectId: scope.projectId } },
            ],
          },
          select: { id: true },
        }),
      );
    case "mail_message":
      return Boolean(
        await prisma.mailMessage.findFirst({
          where: {
            id: reference.entityId,
            account: { projectId: scope.projectId },
          },
          select: { id: true },
        }),
      );
    default:
      return false;
  }
}

export async function relatedResourcesBelongToProject(
  scope: ProjectScope,
  references: readonly ProjectReference[],
): Promise<boolean> {
  const results = await Promise.all(
    references.map((reference) => relatedResourceExists(scope, reference)),
  );
  return results.every(Boolean);
}
