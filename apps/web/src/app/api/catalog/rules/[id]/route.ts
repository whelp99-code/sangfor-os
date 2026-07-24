import { NextResponse } from "next/server";
import { prisma } from "@sangfor/db";
import { resolveCrmAuthContext, CatalogRuleServiceError } from "@sangfor/business";
import { evaluateSizingRule, evaluateCompatibilityRule, RuleEngineError } from "@sangfor/business/catalog-rule-engine";
import { assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

const FORBIDDEN_SCOPE_FIELDS = new Set(["tenantId", "companyId", "projectId", "projectSlug", "actor", "role", "action"]);

function hasForbiddenScope(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  if (Array.isArray(input)) return input.some(hasForbiddenScope);
  return Object.keys(input).some((key) => FORBIDDEN_SCOPE_FIELDS.has(key) || hasForbiddenScope((input as Record<string, unknown>)[key]));
}

async function resolveContext(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return { ok: false as const, response: denied };
  const session = await evaluatePersistedSessionFromRequest(request);
  if (!session.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  try {
    const ctx = await resolveCrmAuthContext({
      userId: session.userId,
      sessionId: null,
      tenantId: session.tenantId,
      companyId: session.companyId,
      projectId: session.projectId,
      product: "portal",
    });
    return { ok: true as const, ctx };
  } catch (error) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: error instanceof Error ? error.message : "authorization_failed" },
        { status: 403 }
      ),
    };
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const sizing = await prisma.sizingTemplate.findUnique({
    where: { id },
  });
  if (sizing) {
    return NextResponse.json({ type: "sizing", rule: sizing });
  }

  const compat = await prisma.compatibilityRule.findUnique({
    where: { id },
  });
  if (compat) {
    return NextResponse.json({ type: "compatibility", rule: compat });
  }

  return NextResponse.json({ error: "Rule not found" }, { status: 404 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const body = await request.json();

    if (hasForbiddenScope(body)) {
      return NextResponse.json(
        { error: "Scope modification or forbidden scope field injected" },
        { status: 422 }
      );
    }

    const { type, name, configJson } = body;

    if (configJson && typeof configJson === "object") {
      try {
        if (type === "sizing") {
          evaluateSizingRule(configJson, {});
        } else if (type === "compatibility") {
          evaluateCompatibilityRule(configJson, {});
        }
      } catch (e) {
        if (e instanceof RuleEngineError && e.code === "VALIDATION_ERROR") {
          return NextResponse.json(
            { error: e.message, code: e.code },
            { status: 422 }
          );
        }
      }
    }

    const sizing = await prisma.sizingTemplate.findUnique({ where: { id } });
    if (sizing) {
      // Create new draft ArtifactVersion if artifact is attached
      let newVersionId: string | null = null;
      if (sizing.artifactId) {
        const lastVersion = await prisma.artifactVersion.findFirst({
          where: { artifactId: sizing.artifactId },
          orderBy: { version: "desc" },
        });
        const nextVersionNum = (lastVersion?.version ?? 0) + 1;
        const version = await prisma.artifactVersion.create({
          data: {
            artifactId: sizing.artifactId,
            version: nextVersionNum,
            contentHashVersion: "v1",
            canonicalContentEnvelope: JSON.stringify(configJson || sizing.configJson || {}),
            contentHash: `hash-${Date.now()}`,
            contentJson: (configJson || sizing.configJson || {}) as any,
            status: "draft",
            createdByAssignmentId: "ucr-system",
          },
        });
        newVersionId = version.id;
      }

      const updated = await prisma.sizingTemplate.update({
        where: { id },
        data: {
          name: name ?? sizing.name,
          configJson: configJson ?? sizing.configJson,
        },
      });

      return NextResponse.json({
        ok: true,
        type: "sizing",
        rule: updated,
        newArtifactVersionId: newVersionId,
      });
    }

    const compat = await prisma.compatibilityRule.findUnique({ where: { id } });
    if (compat) {
      const updated = await prisma.compatibilityRule.update({
        where: { id },
        data: {
          configJson: configJson ?? compat.configJson,
        },
      });
      return NextResponse.json({
        ok: true,
        type: "compatibility",
        rule: updated,
      });
    }

    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof RuleEngineError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 422 }
      );
    }
    if (error instanceof CatalogRuleServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal error" },
      { status: 500 }
    );
  }
}
