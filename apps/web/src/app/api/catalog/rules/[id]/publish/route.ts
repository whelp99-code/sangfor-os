import { NextResponse } from "next/server";
import {
  resolveCrmAuthContext,
  publishSizingTemplate,
  publishCompatibilityRule,
  CatalogRuleServiceError,
} from "@sangfor/business";
import { assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

const ALLOWED_PUBLISH_KEYS = new Set([
  "type",
  "artifactVersionId",
  "approvalId",
  "expectedActiveArtifactVersionId",
]);

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const body = await request.json();

    if ("action" in body) {
      return NextResponse.json(
        { error: "Caller action field injection or modification is forbidden", code: "ACTION_INJECTION_FORBIDDEN" },
        { status: 422 }
      );
    }

    const keys = Object.keys(body);
    const unknownKeys = keys.filter((k) => !ALLOWED_PUBLISH_KEYS.has(k));
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `Unknown key(s) forbidden: ${unknownKeys.join(", ")}`, code: "UNKNOWN_KEYS_FORBIDDEN" },
        { status: 422 }
      );
    }

    const { type, artifactVersionId, approvalId, expectedActiveArtifactVersionId } = body;

    if (!type || !["sizing", "compatibility"].includes(type)) {
      return NextResponse.json({ error: "Invalid or missing rule type" }, { status: 422 });
    }
    if (!artifactVersionId || typeof artifactVersionId !== "string") {
      return NextResponse.json({ error: "artifactVersionId is required" }, { status: 422 });
    }
    if (!approvalId || typeof approvalId !== "string") {
      return NextResponse.json({ error: "approvalId is required" }, { status: 422 });
    }

    const caller = {
      userId: auth.ctx.userId,
      sessionId: auth.ctx.sessionId || "session-web",
      mfaVerifiedAt: new Date(),
      scope: {
        tenantId: auth.ctx.tenantId,
        companyId: auth.ctx.companyId,
        projectId: auth.ctx.projectId,
      },
    };

    if (type === "sizing") {
      const result = await publishSizingTemplate(caller, id, {
        artifactVersionId,
        approvalId,
        expectedActiveArtifactVersionId: expectedActiveArtifactVersionId ?? null,
      });
      return NextResponse.json({ ok: true, result });
    } else {
      const result = await publishCompatibilityRule(caller, id, {
        artifactVersionId,
        approvalId,
        expectedActiveArtifactVersionId: expectedActiveArtifactVersionId ?? null,
      });
      return NextResponse.json({ ok: true, result });
    }
  } catch (error) {
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
