import {
  addOpportunityLink,
  addOpportunityLinkSchema,
  advanceOpportunityStage,
  archiveOpportunity,
  assignOpportunityOwner,
  convertOpportunityToProject,
  getOpportunityDetail,
  opportunityAdvanceSchema,
  opportunityArchiveSchema,
  opportunityConversionCommandSchema,
  opportunityOwnerAssignmentSchema,
  removeOpportunityLink,
  removeOpportunityLinkSchema,
  resolveOpportunityAuthContext,
  updateOpportunity,
  updateOpportunitySchema,
} from "@sangfor/business";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

type RouteContext = { params: Promise<{ id: string }> };
const SCOPE_FIELDS = new Set(["tenantId", "companyId", "projectId", "projectSlug"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const updateBodySchema = updateOpportunitySchema.omit({ idempotencyKey: true });
const archiveBodySchema = opportunityArchiveSchema.omit({ idempotencyKey: true });
const ownerBodySchema = opportunityOwnerAssignmentSchema.omit({ idempotencyKey: true }).extend({
  action: z.literal("assign_owner"),
}).strict();
const advanceBodySchema = opportunityAdvanceSchema.omit({ idempotencyKey: true }).extend({
  action: z.literal("advance"),
}).strict();
const conversionBodySchema = opportunityConversionCommandSchema
  .omit({ opportunityId: true, idempotencyKey: true })
  .extend({ action: z.literal("convert_to_project") })
  .strict();
const addLinkBodySchema = addOpportunityLinkSchema.omit({ idempotencyKey: true }).extend({
  action: z.literal("add_link"),
}).strict();
const removeLinkBodySchema = removeOpportunityLinkSchema.omit({ idempotencyKey: true }).extend({
  action: z.literal("remove_link"),
}).strict();

function idempotencyKey(request: Request): string | null {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  return key.length > 0 && key.length <= 128 && !CONTROL_CHARACTERS.test(key) ? key : null;
}

function hasScopeField(input: unknown): boolean {
  return !!input && typeof input === "object" && !Array.isArray(input)
    && Object.keys(input).some((key) => SCOPE_FIELDS.has(key));
}

async function readJson(request: Request): Promise<
  { ok: true; input: unknown } | { ok: false; response: NextResponse }
> {
  try {
    return { ok: true, input: await request.json() };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "invalid_json" }, { status: 400 }) };
  }
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
    return {
      ok: true as const,
      ctx: await resolveOpportunityAuthContext({
        userId: session.userId,
        sessionId: null,
        tenantId: session.tenantId,
        companyId: session.companyId,
        projectId: session.projectId,
        product: "portal",
      }),
    };
  } catch (error) {
    return {
      ok: false as const,
      response: crmError(error, "authorization_failed", 403),
    };
  }
}

function crmError(error: unknown, fallback: string, status: number) {
  if (
    error instanceof Error
    && "httpStatus" in error
    && typeof error.httpStatus === "number"
    && "code" in error
    && typeof error.code === "string"
  ) {
    return NextResponse.json({ error: error.code }, { status: error.httpStatus });
  }
  return apiError(fallback, error, { status });
}

export async function GET(request: Request, route: RouteContext) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const { id } = await route.params;
  try {
    const opportunity = await getOpportunityDetail(auth.ctx, id);
    if (!opportunity) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
  } catch (error) {
    return crmError(error, "fetch_failed", 500);
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const key = idempotencyKey(request);
  if (!key) return NextResponse.json({ error: "validation_error" }, { status: 422 });
  const json = await readJson(request);
  if (!json.ok) return json.response;
  if (hasScopeField(json.input)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await route.params;
  try {
    if (json.input && typeof json.input === "object" && "action" in json.input) {
      const action = (json.input as { action?: unknown }).action;
      if (action === "assign_owner") {
        const parsed = ownerBodySchema.safeParse(json.input);
        if (!parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 422 });
        const { action: _action, ...command } = parsed.data;
        const opportunity = await assignOpportunityOwner(auth.ctx, id, {
          ...command,
          idempotencyKey: key,
        });
        return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
      }
      if (action === "advance") {
        const parsed = advanceBodySchema.safeParse(json.input);
        if (!parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 422 });
        const opportunity = await advanceOpportunityStage(auth.ctx, id, {
          expectedUpdatedAt: parsed.data.expectedUpdatedAt,
          idempotencyKey: key,
        });
        return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
      }
      if (action === "convert_to_project") {
        const parsed = conversionBodySchema.safeParse(json.input);
        if (!parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 422 });
        const result = await convertOpportunityToProject(auth.ctx, {
          opportunityId: id,
          expectedUpdatedAt: parsed.data.expectedUpdatedAt,
          idempotencyKey: key,
        });
        return NextResponse.json(
          serializeDecimalAtBoundary(result),
          { status: result.created ? 201 : 200 },
        );
      }
      if (action === "add_link") {
        const parsed = addLinkBodySchema.safeParse(json.input);
        if (!parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 422 });
        const { action: _action, ...command } = parsed.data;
        const link = await addOpportunityLink(auth.ctx, id, {
          ...command,
          idempotencyKey: key,
        });
        return NextResponse.json({ link }, { status: 201 });
      }
      if (action === "remove_link") {
        const parsed = removeLinkBodySchema.safeParse(json.input);
        if (!parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 422 });
        const { action: _action, ...command } = parsed.data;
        await removeOpportunityLink(auth.ctx, id, {
          ...command,
          idempotencyKey: key,
        });
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: "validation_error" }, { status: 422 });
    }

    const parsed = updateBodySchema.safeParse(json.input);
    if (!parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 422 });
    const opportunity = await updateOpportunity(auth.ctx, id, {
      ...parsed.data,
      idempotencyKey: key,
    });
    return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
  } catch (error) {
    return crmError(error, "update_failed", 422);
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const key = idempotencyKey(request);
  if (!key) return NextResponse.json({ error: "validation_error" }, { status: 422 });
  const json = await readJson(request);
  if (!json.ok) return json.response;
  if (hasScopeField(json.input)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = archiveBodySchema.safeParse(json.input);
  if (!parsed.success) return NextResponse.json({ error: "validation_error" }, { status: 422 });
  const { id } = await route.params;
  try {
    const opportunity = await archiveOpportunity(auth.ctx, id, {
      ...parsed.data,
      idempotencyKey: key,
    });
    return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
  } catch (error) {
    return crmError(error, "archive_failed", 422);
  }
}
