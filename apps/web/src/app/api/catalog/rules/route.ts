import { NextResponse } from "next/server";
import { prisma } from "@sangfor/db";
import { resolveCrmAuthContext, CatalogRuleServiceError } from "@sangfor/business";
import { assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

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

export async function GET(request: Request) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const familyId = url.searchParams.get("familyId");

  let sizingTemplates: any[] = [];
  let compatibilityRules: any[] = [];

  if (!type || type === "sizing") {
    sizingTemplates = await prisma.sizingTemplate.findMany({
      where: familyId ? { productFamilyId: familyId } : {},
      orderBy: { createdAt: "desc" },
    });
  }

  if (!type || type === "compatibility") {
    compatibilityRules = await prisma.compatibilityRule.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  return NextResponse.json({
    sizingTemplates,
    compatibilityRules,
  });
}

export async function POST(request: Request) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { type, productFamilyId, sourceSkuId, targetSkuId, key, name, configJson } = body;

    if (!type || !["sizing", "compatibility"].includes(type)) {
      return NextResponse.json({ error: "Invalid or missing rule type" }, { status: 422 });
    }

    if (type === "sizing") {
      if (!productFamilyId || typeof productFamilyId !== "string") {
        return NextResponse.json({ error: "productFamilyId is required for sizing" }, { status: 422 });
      }
      if (!key || typeof key !== "string") {
        return NextResponse.json({ error: "key is required" }, { status: 422 });
      }
      if (!name || typeof name !== "string") {
        return NextResponse.json({ error: "name is required" }, { status: 422 });
      }

      const created = await prisma.sizingTemplate.create({
        data: {
          productFamilyId,
          templateKey: key,
          name,
          configJson: configJson ?? {},
          status: "DRAFT",
        },
      });
      return NextResponse.json({ ok: true, rule: created }, { status: 201 });
    } else {
      if (!sourceSkuId || typeof sourceSkuId !== "string" || !targetSkuId || typeof targetSkuId !== "string") {
        return NextResponse.json({ error: "sourceSkuId and targetSkuId are required for compatibility" }, { status: 422 });
      }

      const created = await prisma.compatibilityRule.create({
        data: {
          sourceSkuId,
          targetSkuId,
          ruleKey: key || "COMPAT_RULE",
          ruleType: "REQUIRES",
          configJson: configJson ?? {},
          status: "DRAFT",
        },
      });
      return NextResponse.json({ ok: true, rule: created }, { status: 201 });
    }
  } catch (error) {
    if (error instanceof CatalogRuleServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "internal error" },
      { status: 500 }
    );
  }
}
